import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Room as LiveKitRoom, RoomEvent, Track } from 'livekit-client'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { playChime } from '../lib/sound'
import { parseYoutubeUrl, loadYoutubeApi, DEFAULT_YOUTUBE_URL, MUSIC_YOUTUBE_KEY, loadStoredYoutubeUrlOverride, type YTPlayer } from '../lib/youtube'
import { BUILTIN_TRACKS, type LibraryTrack } from '../lib/musicLibrary'
import { phaseTotalSeconds, computeLeftFromRoom, type RoomRow } from '../lib/timer'
import { ROOM_TYPE_RULES } from '../lib/roomTypeRules'
import DeviceCheck from '../components/DeviceCheck'
import SessionRating from '../components/SessionRating'
import HostLeaveModal from '../components/HostLeaveModal'
import InviteFriendModal from '../components/InviteFriendModal'
import { acceptFriendRequest, listFriendRequests, sendFriendRequest, type FriendRequestRow } from '../lib/friends'

type StatusKey = 'host' | 'focusing' | 'micOff' | 'camOff' | 'justJoined'
type Member = { id: string; name: string; statusKey: StatusKey; host: boolean; me?: boolean }
type Pending = { id: string; userId: string; name: string; wait: string }
type ChatMsg = { who: string; me: boolean; text: string }

type RealTrack = LibraryTrack & { isDefault: boolean }
type RealMemberRow = {
  id: string
  room_id: string
  user_id: string
  status: 'pending' | 'member'
  joined_at: string
  name: string
}
type RealMsgRow = {
  id: string
  room_id: string
  user_id: string
  text: string
  created_at: string
  name: string
}

function relativeWait(iso: string, t: (key: string, options?: Record<string, unknown>) => string) {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return t('room.wait.seconds', { count: sec })
  return t('room.wait.minutes', { min: Math.floor(sec / 60), sec: String(sec % 60).padStart(2, '0') })
}

function fmtTrackLength(sec: number | null) {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

// vị trí/độ dài hiện tại của bài đang phát (thanh tua trong tab Nhạc > Thư viện) — khác
// fmtTrackLength ở trên (dùng cho độ dài tĩnh trong danh sách playlist), không pad số phút.
function fmtTrackTime(totalSec: number) {
  const sec = Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}


const TRACK_KEYS = ['t1', 't2', 't3', 't4', 't5'] as const
const TRACK_LENGTHS: Record<(typeof TRACK_KEYS)[number], string> = {
  t1: '42:10',
  t2: '58:24',
  t3: '1:20:00',
  t4: '35:47',
  t5: '1:05:12',
}

const FOCUS_MINUTES = 25
const BREAK_MINUTES = 5
const SESSION_COUNT_DEFAULT = 4
const ACCENT = 'var(--ff-accent)'
const ACCENT_SOFT = 'var(--ff-accent-soft)'

function TrackMediaEl({ track, kind, mirror }: { track: MediaStreamTrack; kind: 'video' | 'audio'; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = new MediaStream([track])
    return () => {
      el.srcObject = null
    }
  }, [track])
  if (kind === 'video') {
    return (
      <video
        ref={ref}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 h-full w-full object-cover"
        style={mirror ? { transform: 'scaleX(-1)' } : undefined}
      />
    )
  }
  return <audio ref={ref} autoPlay />
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function focusSecs() {
  return FOCUS_MINUTES * 60
}
function breakSecs() {
  return BREAK_MINUTES * 60
}

type Phase = 'focus' | 'break'
type Tab = 'chat' | 'music' | 'members' | 'host'
type Admit = 'auto' | 'manual'
type Demo = 'two' | 'five'

function segStyle(on: boolean) {
  return {
    background: on ? '#ffffff' : 'transparent',
    color: on ? '#22483f' : 'rgba(51,71,94,0.55)',
    boxShadow: on ? '0 4px 12px rgba(58,98,126,0.12)' : 'none',
  }
}

export default function Room() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { id: code } = useParams<{ id: string }>()
  const user = useAuthStore((s) => s.user)

  const meMember = useMemo<Member>(
    () => ({ id: '12', name: t('room.you'), statusKey: 'host', host: true, me: true }),
    [t],
  )
  const demoSets = useMemo<Record<Demo, Member[]>>(
    () => ({
      two: [{ id: '10', name: 'Minh Anh', statusKey: 'focusing', host: false }, meMember],
      five: [
        { id: '10', name: 'Minh Anh', statusKey: 'focusing', host: false },
        { id: '11', name: 'Hà Vy', statusKey: 'micOff', host: false },
        { id: '13', name: 'Gia Bảo', statusKey: 'focusing', host: false },
        { id: '14', name: 'Thanh Trúc', statusKey: 'camOff', host: false },
        meMember,
      ],
    }),
    [meMember],
  )
  const statusLabel = (key: StatusKey) => t(`room.status.${key}`)

  const [realRoom, setRealRoom] = useState<RoomRow | null>(null)
  const [loadingRoom, setLoadingRoom] = useState(false)
  const isRealMode = !!user && !!realRoom
  const isHost = isRealMode ? realRoom!.host_id === user!.id : true
  const roomId = realRoom?.id
  const useDbTimer = isRealMode
  // Luật cam/mic/nhạc theo loại phòng (5 loại, xem lib/roomTypeRules.ts) — null ở demo/guest
  // mode (không có realRoom nên không enforce gì).
  const roomRule = isRealMode ? ROOM_TYPE_RULES[realRoom!.room_type] : null

  const [running, setRunning] = useState(true)
  const [phase, setPhase] = useState<Phase>('focus')
  const [left, setLeft] = useState(focusSecs() - 512)
  const [round, setRound] = useState(2)
  const [done, setDone] = useState(false)
  const roundRef = useRef(round)
  roundRef.current = round

  const [cam, setCam] = useState(true)
  const [mic, setMic] = useState(false)
  const [chatOpen, setChatOpen] = useState(true)
  const [tab, setTab] = useState<Tab>('chat')

  // Mã phòng — trước đây không hiện ở đâu trong Room dù đã dùng để nối LiveKit/query
  // (chỉ có lúc tạo/join phòng ở Matching.tsx), user báo không có chỗ xem lại mã để mời
  // thêm bạn. Hiện dạng thẻ nhỏ ở top bar kèm nút sao chép.
  const [codeCopied, setCodeCopied] = useState(false)
  const codeCopyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(codeCopyTimer.current), [])
  function copyRoomCode() {
    if (!code) return
    if (navigator.clipboard) navigator.clipboard.writeText(code.toUpperCase()).catch(() => {})
    setCodeCopied(true)
    clearTimeout(codeCopyTimer.current)
    codeCopyTimer.current = setTimeout(() => setCodeCopied(false), 1800)
  }

  // Mời bạn bè đã kết bạn vào thẳng room này — bỏ qua duyệt của host (xem
  // invite_friend_to_room/accept_room_invite, 0016_friends.sql).
  const [inviteFriendOpen, setInviteFriendOpen] = useState(false)

  // Tab "Thành viên" (mọi người xem được, khác tab "Manage" chỉ host thấy) — tải quan hệ
  // bạn bè của chính mình với từng người trong phòng để quyết định hiện nút gì.
  const [friendRows, setFriendRows] = useState<FriendRequestRow[]>([])
  const [friendActionId, setFriendActionId] = useState<string | null>(null)

  const refreshFriendRows = useCallback(() => {
    if (!user) return
    listFriendRequests().then(setFriendRows).catch(() => {})
  }, [user])

  useEffect(() => {
    if (tab !== 'members' || !user || !isRealMode) return
    refreshFriendRows()
  }, [tab, user, isRealMode, refreshFriendRows])

  function friendRowWith(otherId: string, myId: string) {
    return friendRows.find(
      (r) =>
        (r.requester_id === myId && r.addressee_id === otherId) ||
        (r.requester_id === otherId && r.addressee_id === myId),
    )
  }

  async function handleSendFriendRequest(otherId: string) {
    setFriendActionId(otherId)
    try {
      await sendFriendRequest(otherId)
      refreshFriendRows()
    } catch {
      // im lặng — không có dòng quan hệ nào đổi nên nút vẫn hiện "Kết bạn", bấm lại được
    } finally {
      setFriendActionId(null)
    }
  }

  async function handleAcceptFriendRow(rowId: string) {
    setFriendActionId(rowId)
    try {
      await acceptFriendRequest(rowId)
      refreshFriendRows()
    } finally {
      setFriendActionId(null)
    }
  }

  // GĐ9: màn "Kiểm tra trước khi vào phòng" hiện mỗi lần vào phòng thật — xong mới
  // connect LiveKit (effect kết nối bên dưới gate bằng deviceChecked).
  const [deviceChecked, setDeviceChecked] = useState(false)

  // GĐ9: card đánh giá sau buổi học — hiện khi phòng xong đủ phiên (timer_done) hoặc
  // khi bấm "Rời phòng" nếu đã có ít nhất 1 phiên focus trong phòng (pendingLeave).
  const [showRating, setShowRating] = useState(false)
  const [pendingLeave, setPendingLeave] = useState(false)

  const [preferredCameraId, setPreferredCameraId] = useState('')
  const [preferredMicId, setPreferredMicId] = useState('')
  const [notificationSound, setNotificationSound] = useState(true)
  const preferredCameraIdRef = useRef(preferredCameraId)
  preferredCameraIdRef.current = preferredCameraId
  const preferredMicIdRef = useRef(preferredMicId)
  preferredMicIdRef.current = preferredMicId

  const [profileDefaultYoutubeUrl, setProfileDefaultYoutubeUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('preferred_camera_id, preferred_mic_id, notification_sound, default_youtube_url')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setPreferredCameraId(data.preferred_camera_id ?? '')
        setPreferredMicId(data.preferred_mic_id ?? '')
        setNotificationSound(data.notification_sound)
        setProfileDefaultYoutubeUrl(data.default_youtube_url ?? null)
      })
  }, [user])
  const notificationSoundRef = useRef(notificationSound)
  notificationSoundRef.current = notificationSound

  const [musicOn, setMusicOn] = useState(true)
  const [trackIndex, setTrackIndex] = useState(0)
  const [volume, setVolume] = useState(45)
  // Cố tình luôn khởi tạo 'youtube' — y hệt Dashboard (main UI): mỗi lần vào phòng nhạc mặc
  // định vào thẳng YouTube (link đã lưu trên máy này, hoặc mặc định riêng đặt ở Settings,
  // hoặc DEFAULT_YOUTUBE_URL gốc của app), Thư viện là lựa chọn tạm trong phiên đang mở.
  const [musicSource, setMusicSource] = useState<'library' | 'youtube'>('youtube')
  // Tab đang XEM trong panel Nhạc — tách khỏi musicSource (nguồn đang thực sự phát), đúng
  // pattern đã sửa ở Dashboard (Giai đoạn 8 phần 8 "Bug 1"): trước đây bấm tab chỉ để xem
  // (chưa chốt) lại đổi thẳng musicSource, khiến nhạc đang phát bị ngắt ngay khi chỉ liếc
  // qua tab kia. Giờ musicSource chỉ đổi khi user "chốt" (chọn 1 bài, hoặc bấm "Dùng link
  // này"/"Phát" ở YouTube).
  const [activeTab, setActiveTab] = useState<'library' | 'youtube'>('youtube')
  // Cùng 1 key localStorage với Dashboard (lib/youtube.ts) — link YouTube là lựa chọn cá
  // nhân theo máy, không theo màn hình đang mở, nên đổi ở đâu cũng thấy ở chỗ kia.
  const [youtubeUrlOverride, setYoutubeUrlOverride] = useState(loadStoredYoutubeUrlOverride)
  useEffect(() => {
    if (youtubeUrlOverride === null) return
    try {
      localStorage.setItem(MUSIC_YOUTUBE_KEY, youtubeUrlOverride)
    } catch {
      // localStorage không khả dụng — chỉ mất tính năng nhớ lựa chọn, không lỗi.
    }
  }, [youtubeUrlOverride])
  // 3 tầng ưu tiên, giống hệt Dashboard: override máy này > mặc định riêng tài khoản
  // (Settings) > DEFAULT_YOUTUBE_URL gốc của app.
  const youtubeUrl = youtubeUrlOverride ?? profileDefaultYoutubeUrl ?? DEFAULT_YOUTUBE_URL

  // Enforce luật cam/mic/nhạc theo loại phòng — chạy ngay khi biết room_type (realRoom tải
  // xong), set đúng giá trị bắt buộc trước khi user kịp thấy màn hình. 'free' (Chill) không
  // đụng gì, giữ nguyên lựa chọn hiện tại của user.
  useEffect(() => {
    if (!roomRule) return
    if (roomRule.cam !== 'free') setCam(roomRule.cam === 'on')
    if (roomRule.mic !== 'free') setMic(roomRule.mic === 'on')
    if (roomRule.music === 'off') setMusicOn(false)
  }, [roomRule])

  function toggleCam() {
    if (roomRule && roomRule.cam !== 'free') return
    setCam((c) => !c)
  }
  function toggleMic() {
    if (roomRule && roomRule.mic !== 'free') return
    setMic((v) => !v)
  }
  const musicLocked = roomRule?.music === 'off'

  // Thư viện = nhạc built-in (mọi tài khoản) ∪ nhạc thật từ Supabase khi đã đăng nhập —
  // y hệt Dashboard (main UI), xem lib/musicLibrary.ts. Nhạc là riêng của từng người (xem
  // quyết định GĐ8) — playlist DB = mặc định (is_default=true, của bất kỳ ai) hợp với nhạc
  // riêng của chính mình, không liên quan gì tới host phòng.
  const [dbTracks, setDbTracks] = useState<RealTrack[]>([])
  const myIdForTracks = user?.id
  useEffect(() => {
    if (!isRealMode || !myIdForTracks) {
      setDbTracks([])
      return
    }
    let cancelled = false
    supabase
      .from('tracks')
      .select('id, name, storage_path, duration_seconds, is_default')
      .or(`is_default.eq.true,user_id.eq.${myIdForTracks}`)
      .order('created_at')
      .then(({ data }) => {
        if (cancelled || !data) return
        setDbTracks(
          data.map((r) => ({
            id: r.id,
            name: r.name,
            kind: 'db' as const,
            path: r.storage_path,
            durationSeconds: r.duration_seconds,
            isDefault: r.is_default,
          })),
        )
      })
    return () => {
      cancelled = true
    }
  }, [isRealMode, myIdForTracks])

  const libraryTracks = useMemo<RealTrack[]>(
    () => (isRealMode ? [...BUILTIN_TRACKS.map((tr) => ({ ...tr, isDefault: true })), ...dbTracks] : []),
    [isRealMode, dbTracks],
  )

  const tracks = useMemo(() => {
    if (isRealMode) {
      return libraryTracks.map((tr) => ({
        id: tr.id,
        name: tr.name,
        mood: tr.isDefault ? t('room.music.defaultTag') : t('room.music.mineTag'),
        length: fmtTrackLength(tr.durationSeconds),
      }))
    }
    return TRACK_KEYS.map((key) => ({
      id: key,
      name: t(`room.mockTracks.${key}.name`),
      mood: t(`room.mockTracks.${key}.mood`),
      length: TRACK_LENGTHS[key],
    }))
  }, [isRealMode, libraryTracks, t])

  // Nguồn phát của track đang chọn — track built-in dùng thẳng url tĩnh, track DB cần
  // signed URL (bucket `tracks` riêng tư, hết hạn sau 1h nhưng phiên nghe nhạc trong
  // phòng thường ngắn hơn).
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!isRealMode) {
      setAudioSrc(null)
      return
    }
    const track = libraryTracks[trackIndex]
    if (!track) {
      setAudioSrc(null)
      return
    }
    if (track.kind === 'builtin') {
      setAudioSrc(track.url)
      return
    }
    let cancelled = false
    supabase.storage
      .from('tracks')
      .createSignedUrl(track.path, 3600)
      .then(({ data }) => {
        if (!cancelled) setAudioSrc(data?.signedUrl ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [isRealMode, libraryTracks, trackIndex])

  const musicAudioRef = useRef<HTMLAudioElement>(null)
  // Vị trí/độ dài bài đang phát thật — dùng cho thanh tua trong tab Nhạc > Thư viện.
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  useEffect(() => {
    const el = musicAudioRef.current
    if (el) el.volume = volume / 100
  }, [volume])
  useEffect(() => {
    const el = musicAudioRef.current
    if (!el) return
    const onTime = () => setAudioCurrentTime(el.currentTime)
    const onMeta = () => setAudioDuration(Number.isFinite(el.duration) ? el.duration : 0)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('durationchange', onMeta)
    }
  }, [])
  function playRelativeTrack(delta: number) {
    if (tracks.length === 0 || musicLocked) return
    setTrackIndex((i) => (i + delta + tracks.length) % tracks.length)
    setMusicOn(true)
    setMusicSource('library')
  }
  function seekTrackTo(seconds: number) {
    const el = musicAudioRef.current
    if (el) el.currentTime = seconds
    setAudioCurrentTime(seconds)
  }
  useEffect(() => {
    const el = musicAudioRef.current
    if (!el || !isRealMode || musicSource !== 'library' || !audioSrc) return
    if (el.src !== audioSrc) el.src = audioSrc
    if (musicOn) {
      el.play().catch(() => {
        // Trình duyệt chặn autoplay khi chưa từng tương tác với trang (xảy ra ngay lúc mới
        // vào phòng vì `musicOn` mặc định `true` — nhạc thử tự phát trước khi user bấm gì).
        // Trước đây bỏ qua lỗi này, khiến UI vẫn hiện "đang phát" dù thực ra đang im lặng —
        // bấm nút Tạm dừng (tưởng đang phát) chỉ khiến nó pause cái đã pause sẵn, phải bấm
        // thêm lần 2 (lần bấm có tương tác thật) mới thực sự nghe được. Đồng bộ lại state
        // về đúng thực tế (chưa phát) để lần bấm ĐẦU TIÊN đã là tương tác thật, phát ngay.
        setMusicOn(false)
      })
    } else {
      el.pause()
    }
  }, [isRealMode, musicSource, audioSrc, musicOn])
  useEffect(() => {
    if (!isRealMode || musicSource !== 'library') musicAudioRef.current?.pause()
  }, [isRealMode, musicSource])

  // ============================================================
  // Nhạc từ YouTube — mỗi người tự dán link riêng, dùng YouTube IFrame Player API chính
  // chủ (không tách audio khỏi video, đúng ToS). Player nổi ở góc trái màn hình (widget
  // riêng, xem JSX bên dưới). Hoàn toàn local, không đồng bộ với ai khác trong phòng.
  // ============================================================
  const [ytInput, setYtInput] = useState('')
  const [ytError, setYtError] = useState(false)
  const [ytReady, setYtReady] = useState(false)
  const ytContainerRef = useRef<HTMLDivElement>(null)
  const ytPlayerRef = useRef<YTPlayer | null>(null)
  const ytActive = isRealMode && musicSource === 'youtube' && !musicLocked
  const ytParsed = useMemo(() => (youtubeUrl ? parseYoutubeUrl(youtubeUrl) : null), [youtubeUrl])

  useEffect(() => {
    if (!ytActive) return
    let cancelled = false
    loadYoutubeApi().then(() => {
      if (!cancelled) setYtReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [ytActive])

  useEffect(() => {
    if (!ytActive || !ytReady || !ytParsed || !ytContainerRef.current) return
    const player = new window.YT!.Player(ytContainerRef.current, {
      width: '260',
      height: '146',
      videoId: ytParsed.videoId || undefined,
      playerVars: { listType: ytParsed.playlistId ? 'playlist' : undefined, list: ytParsed.playlistId || undefined, playsinline: 1 },
      events: {
        onReady: (e: { target: YTPlayer }) => {
          ytPlayerRef.current = e.target
          e.target.setVolume(volume)
        },
      },
    })
    return () => {
      player.destroy()
      ytPlayerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytActive, ytReady, ytParsed?.videoId, ytParsed?.playlistId])

  useEffect(() => {
    const player = ytPlayerRef.current
    if (!player || !ytActive) return
    if (musicOn) player.playVideo()
    else player.pauseVideo()
  }, [ytActive, musicOn])
  useEffect(() => {
    ytPlayerRef.current?.setVolume(volume)
  }, [volume])

  function applyYoutubeLink() {
    if (musicLocked) return
    const parsed = parseYoutubeUrl(ytInput)
    if (!parsed) {
      setYtError(true)
      return
    }
    setYtError(false)
    setYoutubeUrlOverride(ytInput.trim())
    setMusicSource('youtube')
    setMusicOn(true)
    setYtInput('')
  }
  // Chỉ đổi tab đang XEM — không đụng musicSource (nguồn đang phát), xem ghi chú ở khai
  // báo activeTab phía trên.
  function switchToLibrary() {
    setActiveTab('library')
  }
  function switchToYoutube() {
    setActiveTab('youtube')
  }

  const [admit, setAdmit] = useState<Admit>('manual')
  const [pending, setPending] = useState<Pending[]>([
    { id: '1', userId: '1', name: 'Thanh Trúc', wait: t('room.wait.seconds', { count: 20 }) },
    { id: '2', userId: '2', name: 'Gia Bảo', wait: t('room.wait.minutes', { min: 1, sec: '05' }) },
  ])
  const [myStatus, setMyStatus] = useState<'member' | 'pending' | null>(null)
  const [membersLoaded, setMembersLoaded] = useState(false)

  const [demo, setDemo] = useState<Demo>('five')
  const [members, setMembers] = useState<Member[]>(demoSets.five.slice())
  const membersRef = useRef(members)
  membersRef.current = members
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())

  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<ChatMsg[]>([
    { who: 'Minh Anh', me: false, text: t('room.mockChat.m1') },
    { who: t('room.you'), me: true, text: t('room.mockChat.m2') },
    { who: 'Minh Anh', me: false, text: t('room.mockChat.m3') },
  ])

  useEffect(() => {
    if (!user || !code) {
      setRealRoom(null)
      return
    }
    let cancelled = false
    setLoadingRoom(true)
    supabase
      .from('rooms')
      .select(
        'id, code, name, host_id, admit_mode, capacity, room_type, created_at, duration_minutes, break_minutes, session_count, timer_phase, timer_round, timer_running, timer_done, timer_remaining_seconds, timer_updated_at',
      )
      .eq('code', code.toUpperCase())
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setLoadingRoom(false)
        setRealRoom(data ?? null)
        if (data) setAdmit(data.admit_mode)
      })
    return () => {
      cancelled = true
    }
  }, [user, code])

  useEffect(() => {
    if (!roomId) return
    const channel = supabase
      .channel('room-sync-' + roomId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
        (payload) => setRealRoom((prev) => (prev ? { ...prev, ...(payload.new as RoomRow) } : prev)),
      )
      .subscribe()
    return () => {
      channel.unsubscribe()
    }
  }, [roomId])

  useEffect(() => {
    if (!useDbTimer || !realRoom) return
    setPhase(realRoom.timer_phase)
    setRunning(realRoom.timer_running)
    setRound(realRoom.timer_round)
    setDone(realRoom.timer_done)
    setLeft(computeLeftFromRoom(realRoom))
  }, [useDbTimer, realRoom])

  // mỗi thành viên tự ghi phiên của mình khi thấy phase thật của phòng chuyển đổi
  // (host là nguồn chuyển phase, member chỉ quan sát qua Realtime — xem flipPhaseReal ở trên).
  const prevRealPhaseRef = useRef<Phase | null>(null)
  useEffect(() => {
    if (!realRoom || !user) return
    const prevPhase = prevRealPhaseRef.current
    if (prevPhase !== null && prevPhase !== realRoom.timer_phase && myStatus === 'member') {
      const completedMinutes = prevPhase === 'focus' ? realRoom.duration_minutes : realRoom.break_minutes
      const startedAt = new Date(Date.now() - completedMinutes * 60000).toISOString()
      supabase
        .from('focus_sessions')
        .insert({ user_id: user.id, room_id: realRoom.id, phase: prevPhase, minutes: completedMinutes, started_at: startedAt, completed: true })
        .then(({ error }) => {
          if (error) console.error('log focus_session failed', error)
        })
    }
    prevRealPhaseRef.current = realRoom.timer_phase
  }, [realRoom, user, myStatus])

  // Chuông báo hết phase — tách khỏi effect ghi focus_sessions ở trên vì áp dụng cho cả host
  // lẫn member (ghi log thì chỉ member, host không có hàng trong room_members).
  const prevRealPhaseForSoundRef = useRef<Phase | null>(null)
  useEffect(() => {
    if (!realRoom) return
    const prevPhase = prevRealPhaseForSoundRef.current
    if (prevPhase !== null && prevPhase !== realRoom.timer_phase && notificationSound && (isHost || myStatus === 'member')) {
      playChime()
    }
    prevRealPhaseForSoundRef.current = realRoom.timer_phase
  }, [realRoom, isHost, myStatus, notificationSound])

  useEffect(() => {
    if (!realRoom || !user) return
    const uid = user.id
    let cancelled = false
    setMembersLoaded(false)

    function load() {
      supabase
        .from('room_members_view')
        .select('*')
        .eq('room_id', realRoom!.id)
        .then(({ data }) => {
          if (cancelled || !data) return
          const rows = data as RealMemberRow[]
          setMembers(
            rows
              .filter((r) => r.status === 'member')
              .map((r) => ({
                id: r.user_id,
                name: r.name,
                statusKey: 'focusing' as StatusKey,
                host: r.user_id === realRoom!.host_id,
                me: r.user_id === uid,
              })),
          )
          setPending(
            rows
              .filter((r) => r.status === 'pending')
              .map((r) => ({ id: r.id, userId: r.user_id, name: r.name, wait: relativeWait(r.joined_at, t) })),
          )
          const mine = rows.find((r) => r.user_id === uid)
          setMyStatus(mine ? mine.status : null)
          setMembersLoaded(true)
        })
    }
    load()

    const channel = supabase
      .channel('room-members-' + realRoom.id)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${realRoom.id}` },
        load,
      )
      .subscribe()

    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [realRoom, user, t])

  async function approveReal(p: Pending) {
    await supabase.from('room_members').update({ status: 'member' }).eq('id', p.id)
  }
  async function rejectReal(p: Pending) {
    await supabase.from('room_members').delete().eq('id', p.id)
  }
  async function kickReal(m: Member) {
    if (!realRoom) return
    await supabase.from('room_members').delete().eq('room_id', realRoom.id).eq('user_id', m.id)
  }
  async function setAdmitReal(next: Admit) {
    setAdmit(next)
    if (realRoom) await supabase.from('rooms').update({ admit_mode: next }).eq('id', realRoom.id)
  }
  // Host rời phòng phải chọn đóng phòng hẳn hoặc chuyển quyền cho người khác trước —
  // trước đây host rời chỉ âm thầm xoá hàng room_members của chính mình, để lại
  // `rooms.host_id` trỏ tới người đã đi mất, phòng "mồ côi" không ai điều khiển được nữa.
  // `exitActionRef` nhớ hành động đã chọn (mặc định 'leave' cho member thường) để
  // `doLeaveRoom` thực hiện đúng việc SAU KHI (nếu có) đã hỏi đánh giá xong.
  type ExitAction = { kind: 'leave' } | { kind: 'close' } | { kind: 'transfer'; newHostId: string }
  const exitActionRef = useRef<ExitAction>({ kind: 'leave' })
  const [hostLeaveModalOpen, setHostLeaveModalOpen] = useState(false)
  const [transferError, setTransferError] = useState(false)
  const otherMembers = members.filter((m) => !m.me)

  function handleLeaveClick() {
    if (isRealMode && isHost && otherMembers.length > 0) {
      setTransferError(false)
      setHostLeaveModalOpen(true)
      return
    }
    // Host một mình trong phòng (không còn ai để chuyển quyền) — rời cũng đóng luôn
    // phòng, tránh để lại 1 hàng `rooms` mồ côi không ai vào được nữa.
    exitActionRef.current = isRealMode && isHost ? { kind: 'close' } : { kind: 'leave' }
    void leaveRoom()
  }
  function chooseCloseRoom() {
    exitActionRef.current = { kind: 'close' }
    setHostLeaveModalOpen(false)
    void leaveRoom()
  }
  function chooseTransfer(newHostId: string) {
    exitActionRef.current = { kind: 'transfer', newHostId }
    setHostLeaveModalOpen(false)
    void leaveRoom()
  }

  // GĐ9: bấm "Rời phòng" — nếu mình đã học thật ≥1 phiên focus trong phòng này thì
  // hỏi đánh giá bạn cùng học trước, rồi mới rời; chưa học gì thì rời thẳng.
  const pendingLeaveRef = useRef(false)
  async function leaveRoom() {
    if (isRealMode && user && realRoom) {
      const { data } = await supabase
        .from('focus_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('room_id', realRoom.id)
        .eq('phase', 'focus')
        .limit(1)
      if (data && data.length > 0) {
        pendingLeaveRef.current = true
        setPendingLeave(true)
        setShowRating(true)
        return
      }
    }
    doLeaveRoom()
  }
  async function doLeaveRoom() {
    if (isRealMode && user && realRoom) {
      const action = exitActionRef.current
      if (action.kind === 'close') {
        // Không xoá hẳn hàng `rooms` — `session_ratings`/`matching_queue` tham chiếu nó
        // `on delete cascade`, xoá cứng sẽ mất luôn rating vừa cho ở màn hình trước đó.
        // Đóng bằng cách đánh dấu `closed_at` + kick hết `room_members` (RLS/view trong
        // migration 0014 tự ẩn khỏi room_public_list và chặn join mới).
        await supabase.from('rooms').update({ closed_at: new Date().toISOString() }).eq('id', realRoom.id)
        await supabase.from('room_members').delete().eq('room_id', realRoom.id)
      } else if (action.kind === 'transfer') {
        const { error } = await supabase.rpc('transfer_room_host', {
          target_room_id: realRoom.id,
          new_host_id: action.newHostId,
        })
        if (error) {
          // Đừng để host rời trong khi phòng vẫn "mồ côi" — đúng thứ lỗi tính năng này
          // được làm ra để tránh. Mở lại modal để họ thử lại hoặc chọn đóng phòng thay.
          console.error('transfer_room_host failed', error)
          exitActionRef.current = { kind: 'leave' }
          setTransferError(true)
          setHostLeaveModalOpen(true)
          return
        }
      } else {
        await supabase.from('room_members').delete().eq('room_id', realRoom.id).eq('user_id', user.id)
      }
      exitActionRef.current = { kind: 'leave' }
    }
    navigate('/')
  }
  // Khi phòng xong đủ phiên (timer_done bật) thì hiện card đánh giá — dù user đang ở
  // màn "Đã hoàn thành" nào. Chỉ hỏi 1 lần (flip 0→1).
  const prevTimerDoneRef = useRef(false)
  useEffect(() => {
    if (!realRoom) return
    const prev = prevTimerDoneRef.current
    prevTimerDoneRef.current = realRoom.timer_done
    if (!prev && realRoom.timer_done && !pendingLeaveRef.current && myStatus === 'member') {
      setPendingLeave(false)
      setShowRating(true)
    }
  }, [realRoom, myStatus])

  async function toggleRunningReal() {
    if (!realRoom) return
    const currentLeft = computeLeftFromRoom(realRoom)
    await supabase
      .from('rooms')
      .update({ timer_running: !realRoom.timer_running, timer_remaining_seconds: currentLeft, timer_updated_at: new Date().toISOString() })
      .eq('id', realRoom.id)
  }
  async function resetTimerReal() {
    if (!realRoom) return
    await supabase
      .from('rooms')
      .update({
        timer_running: false,
        timer_remaining_seconds: phaseTotalSeconds(realRoom, realRoom.timer_phase),
        timer_updated_at: new Date().toISOString(),
      })
      .eq('id', realRoom.id)
  }
  const flippingRef = useRef(false)
  const flipPhaseReal = useCallback(async () => {
    if (!realRoom || flippingRef.current) return
    flippingRef.current = true
    const nextPhase: Phase = realRoom.timer_phase === 'focus' ? 'break' : 'focus'
    const isFinalCompletion = nextPhase === 'focus' && realRoom.timer_round >= realRoom.session_count
    if (isFinalCompletion) {
      await supabase
        .from('rooms')
        .update({
          timer_running: false,
          timer_done: true,
          timer_remaining_seconds: 0,
          timer_updated_at: new Date().toISOString(),
        })
        .eq('id', realRoom.id)
      flippingRef.current = false
      return
    }
    await supabase
      .from('rooms')
      .update({
        timer_phase: nextPhase,
        timer_round: nextPhase === 'focus' ? realRoom.timer_round + 1 : realRoom.timer_round,
        timer_running: true,
        timer_remaining_seconds: phaseTotalSeconds(realRoom, nextPhase),
        timer_updated_at: new Date().toISOString(),
      })
      .eq('id', realRoom.id)
    flippingRef.current = false
  }, [realRoom])
  async function startNewRoundReal() {
    if (!realRoom) return
    await supabase
      .from('rooms')
      .update({
        timer_phase: 'focus',
        timer_round: 1,
        timer_done: false,
        timer_running: true,
        timer_remaining_seconds: phaseTotalSeconds(realRoom, 'focus'),
        timer_updated_at: new Date().toISOString(),
      })
      .eq('id', realRoom.id)
  }
  useEffect(() => {
    if (!roomId || !user) return
    let cancelled = false
    supabase
      .from('room_messages_view')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at')
      .then(({ data }) => {
        if (cancelled || !data) return
        const rows = data as RealMsgRow[]
        setMessages(
          rows.map((m) => ({ who: m.user_id === user.id ? t('room.you') : m.name, me: m.user_id === user.id, text: m.text })),
        )
      })

    const channel = supabase
      .channel('room-messages-' + roomId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const row = payload.new as { user_id: string; text: string }
          if (row.user_id === user.id) return
          const senderName = membersRef.current.find((m) => m.id === row.user_id)?.name || t('room.unknownUser')
          setMessages((ms) => [...ms, { who: senderName, me: false, text: row.text }])
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      channel.unsubscribe()
    }
  }, [roomId, user, t])

  useEffect(() => {
    if (!roomId || !user) return
    const channel = supabase.channel('room-presence-' + roomId, { config: { presence: { key: user.id } } })
    channel
      .on('presence', { event: 'sync' }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())))
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') channel.track({ online_at: new Date().toISOString() })
      })
    return () => {
      channel.unsubscribe()
    }
  }, [roomId, user])

  const lkRoomRef = useRef<LiveKitRoom | null>(null)
  const [videoTracks, setVideoTracks] = useState<Record<string, MediaStreamTrack>>({})
  const [audioTracks, setAudioTracks] = useState<Record<string, MediaStreamTrack>>({})
  const camRef = useRef(cam)
  camRef.current = cam
  const micRef = useRef(mic)
  micRef.current = mic

  // Connect to LiveKit only once actually admitted ('member', not 'pending') AND after the
  // device-check screen is done — mirrors the same gate the livekit-token Edge Function
  // enforces server-side.
  useEffect(() => {
    if (!isRealMode || !code || myStatus !== 'member' || !deviceChecked) return
    let cancelled = false
    const lkRoom = new LiveKitRoom({ adaptiveStream: true, dynacast: true })
    lkRoomRef.current = lkRoom

    function setTrack(identity: string, track: Track) {
      if (track.kind === Track.Kind.Video) {
        setVideoTracks((m) => ({ ...m, [identity]: track.mediaStreamTrack }))
      } else if (track.kind === Track.Kind.Audio) {
        setAudioTracks((m) => ({ ...m, [identity]: track.mediaStreamTrack }))
      }
    }
    function clearTrack(identity: string, track: Track) {
      const key = track.kind === Track.Kind.Video ? 'video' : track.kind === Track.Kind.Audio ? 'audio' : null
      if (!key) return
      const setter = key === 'video' ? setVideoTracks : setAudioTracks
      setter((m) => {
        if (!(identity in m)) return m
        const next = { ...m }
        delete next[identity]
        return next
      })
    }

    lkRoom
      .on(RoomEvent.TrackSubscribed, (track, _pub, participant) => setTrack(participant.identity, track))
      .on(RoomEvent.TrackUnsubscribed, (track, _pub, participant) => clearTrack(participant.identity, track))
      .on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.track) setTrack(lkRoom.localParticipant.identity, pub.track)
      })
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.track) clearTrack(lkRoom.localParticipant.identity, pub.track)
      })

    supabase.functions
      .invoke<{ token?: string; error?: string }>('livekit-token', { body: { code } })
      .then(async ({ data, error }) => {
        if (cancelled || error || !data?.token) return
        await lkRoom.connect(import.meta.env.VITE_LIVEKIT_URL, data.token)
        if (cancelled) {
          lkRoom.disconnect()
          return
        }
        await lkRoom.localParticipant.setCameraEnabled(
          camRef.current,
          preferredCameraIdRef.current ? { deviceId: preferredCameraIdRef.current } : undefined,
        )
        await lkRoom.localParticipant.setMicrophoneEnabled(
          micRef.current,
          preferredMicIdRef.current ? { deviceId: preferredMicIdRef.current } : undefined,
        )
      })

    return () => {
      cancelled = true
      lkRoom.disconnect()
      lkRoomRef.current = null
      setVideoTracks({})
      setAudioTracks({})
    }
  }, [isRealMode, code, myStatus, deviceChecked])

  useEffect(() => {
    if (!isRealMode) return
    lkRoomRef.current?.localParticipant
      .setCameraEnabled(cam, preferredCameraId ? { deviceId: preferredCameraId } : undefined)
      .catch(() => {})
  }, [cam, isRealMode, preferredCameraId])
  useEffect(() => {
    if (!isRealMode) return
    lkRoomRef.current?.localParticipant
      .setMicrophoneEnabled(mic, preferredMicId ? { deviceId: preferredMicId } : undefined)
      .catch(() => {})
  }, [mic, isRealMode, preferredMicId])

  const runningRef = useRef(running)
  runningRef.current = running

  useEffect(() => {
    const id = setInterval(() => {
      if (useDbTimer && realRoom) {
        const newLeft = computeLeftFromRoom(realRoom)
        setLeft(newLeft)
        if (newLeft <= 0 && realRoom.timer_running && isHost) flipPhaseReal()
        return
      }
      if (!runningRef.current) return
      setLeft((prevLeft) => {
        if (prevLeft <= 1) {
          setPhase((prevPhase) => {
            const next: Phase = prevPhase === 'focus' ? 'break' : 'focus'
            const isFinalCompletion = next === 'focus' && roundRef.current >= SESSION_COUNT_DEFAULT
            if (next === 'focus' && !isFinalCompletion) setRound((r) => r + 1)
            if (isFinalCompletion) {
              setDone(true)
              setRunning(false)
              return prevPhase
            }
            return next
          })
          return 0
        }
        return prevLeft - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [useDbTimer, realRoom, isHost, flipPhaseReal])

  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (useDbTimer) {
      prevPhaseRef.current = phase
      return
    }
    if (prevPhaseRef.current !== phase) {
      setLeft(phase === 'focus' ? focusSecs() : breakSecs())
      prevPhaseRef.current = phase
    }
  }, [phase, useDbTimer])

  const total = useDbTimer && realRoom ? phaseTotalSeconds(realRoom, phase) : phase === 'focus' ? focusSecs() : breakSecs()
  const sessionCount = useDbTimer && realRoom ? realRoom.session_count : SESSION_COUNT_DEFAULT
  const progress = Math.min(1, Math.max(0, 1 - left / total))
  const dashOffset = 270.2 * (1 - progress)
  const m = Math.floor(left / 60)
  const s = left % 60
  const timeText = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')

  const queued = admit === 'manual' && pending.length > 0
  const effectiveTab: Tab = tab === 'host' && !isHost ? 'chat' : tab
  const currentTrack = tracks[trackIndex] || tracks[0] || { id: '', name: t('room.music.empty'), mood: '', length: '' }
  const n = Math.max(1, members.length)
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)

  const syncLabel =
    members.length > 2
      ? t('room.sync.withCount', { count: members.length - 1 })
      : t('room.sync.withName', { name: members.find((u) => !u.me)?.name || t('room.sync.fallbackRoom') })

  function openTab(next: Tab) {
    // Mỗi lần mở lại tab "Nhạc", hiện đúng tab (Thư viện/YouTube) theo nguồn đang thực sự
    // phát — không giữ tab đã xem dở lần trước, tránh nhầm "đang xem" với "đang phát".
    if (next === 'music') setActiveTab(musicSource)
    setChatOpen((open) => !(open && tab === next))
    setTab(next)
  }

  function resetTimer() {
    if (useDbTimer) {
      resetTimerReal()
      return
    }
    setLeft(total)
    setRunning(false)
  }
  function startNewRound() {
    if (useDbTimer) {
      startNewRoundReal()
      return
    }
    setPhase('focus')
    setRound(1)
    setDone(false)
    setLeft(focusSecs())
    setRunning(true)
  }
  function toggleRunning() {
    if (useDbTimer) {
      toggleRunningReal()
      return
    }
    setRunning((r) => !r)
  }

  function approve(p: Pending) {
    if (isRealMode) {
      approveReal(p)
      return
    }
    setPending((ps) => ps.filter((x) => x.id !== p.id))
    setMembers((ms) => [...ms, { id: p.id, name: p.name, statusKey: 'justJoined', host: false }])
  }
  function reject(p: Pending) {
    if (isRealMode) {
      rejectReal(p)
      return
    }
    setPending((ps) => ps.filter((x) => x.id !== p.id))
  }
  function approveAll() {
    if (isRealMode) {
      pending.forEach((p) => approveReal(p))
      return
    }
    setMembers((ms) => [
      ...ms,
      ...pending.map((p) => ({ id: p.id, name: p.name, statusKey: 'justJoined' as StatusKey, host: false })),
    ])
    setPending([])
  }
  function kick(u: Member) {
    if (isRealMode) {
      kickReal(u)
      return
    }
    setMembers((ms) => ms.filter((x) => x.id !== u.id))
  }

  function send() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    if (isRealMode && realRoom && user) {
      setMessages((ms) => [...ms, { who: t('room.you'), me: true, text }])
      supabase.from('room_messages').insert({ room_id: realRoom.id, user_id: user.id, text }).then(() => {})
      return
    }
    setMessages((ms) => [...ms, { who: t('room.you'), me: true, text }])
  }

  const tiles = members.map((u) => {
    const me = !!u.me
    const online = !isRealMode || me || onlineIds.has(u.id)
    const videoTrack = isRealMode ? videoTracks[u.id] : undefined
    const audioTrack = isRealMode && !me ? audioTracks[u.id] : undefined
    const camOff = me ? !cam : isRealMode ? !videoTrack : u.statusKey === 'camOff'
    const displayStatusKey: StatusKey = isRealMode && !me ? (audioTrack ? 'focusing' : 'micOff') : u.statusKey
    const displayStatusLabel =
      isRealMode && !me ? (!online ? t('room.status.offline') : statusLabel(displayStatusKey)) : statusLabel(u.statusKey)
    return {
      id: u.id,
      name: u.name,
      initials: initials(u.name),
      status: me ? (mic ? t('room.status.micOn') : t('room.status.micOff')) : displayStatusLabel,
      statusColor: me ? (mic ? '#2c5b53' : 'rgba(51,71,94,0.45)') : online ? 'rgba(51,71,94,0.45)' : 'rgba(51,71,94,0.3)',
      feedLabel: camOff ? t('room.camOffFeed') : t('room.webcamOf', { name: u.name }),
      videoTrack: camOff ? undefined : videoTrack,
      audioTrack,
      avatarBg: me ? 'rgba(140,205,196,0.55)' : 'rgba(160,200,225,0.5)',
      avatarColor: me ? '#22483f' : '#2b4d68',
      tileBorder: me ? '2.5px solid rgba(126,201,198,0.95)' : '2px solid rgba(140,205,196,0.45)',
      tileShadow: me ? '0 14px 32px rgba(58,98,126,0.18)' : '0 10px 24px rgba(58,98,126,0.1)',
      self: me,
    }
  })

  if (user && loadingRoom) {
    return (
      <div
        className="flex h-svh w-full items-center justify-center font-sans text-[15px] font-bold text-[rgba(51,71,94,0.55)]"
        style={{ background: 'var(--ff-page-gradient)' }}
      >
        {t('room.loadingRoom')}
      </div>
    )
  }

  if (isRealMode && membersLoaded && myStatus === null) {
    return (
      <div
        className="relative flex h-svh w-full items-center justify-center overflow-hidden px-6 font-sans text-[#33475e] antialiased"
        style={{ background: 'var(--ff-page-gradient)' }}
      >
        <div
          className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[30px] px-8 py-9 text-center"
          style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(22px)', boxShadow: '0 22px 56px rgba(58,98,126,0.15)' }}
        >
          <h2 className="m-0 text-xl font-extrabold text-[#2c3f55]">{t('room.notJoined.title')}</h2>
          <p className="mt-2 mb-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
            {t('room.notJoined.desc')}
          </p>
          <button
            onClick={() => navigate('/matching')}
            className="rounded-[20px] border-none px-6 py-[13px] font-sans text-[14.5px] font-extrabold text-[#1e3549]"
            style={{ background: 'var(--ff-accent-soft)' }}
          >
            {t('room.notJoined.goToMatching')}
          </button>
        </div>
      </div>
    )
  }

  if (isRealMode && myStatus === 'pending') {
    return (
      <div
        className="relative flex h-svh w-full items-center justify-center overflow-hidden px-6 font-sans text-[#33475e] antialiased"
        style={{ background: 'var(--ff-page-gradient)' }}
      >
        <div
          className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[30px] px-8 py-9 text-center"
          style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(22px)', boxShadow: '0 22px 56px rgba(58,98,126,0.15)' }}
        >
          <span
            className="flex h-[54px] w-[54px] items-center justify-center rounded-full text-[#7a4a2c]"
            style={{ background: 'rgba(226,190,150,0.4)' }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <div>
            <h2 className="m-0 text-xl font-extrabold text-[#2c3f55]">{t('room.waitingApproval.title')}</h2>
            <p className="mt-2 mb-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
              {t('room.waitingApproval.desc', { name: realRoom?.name })}
            </p>
          </div>
          <button
            onClick={leaveRoom}
            className="rounded-[20px] border-none px-6 py-[13px] font-sans text-[14.5px] font-extrabold text-[#43596f]"
            style={{ background: 'rgba(240,248,250,0.9)' }}
          >
            {t('room.waitingApproval.cancel')}
          </button>
        </div>
      </div>
    )
  }

  // GĐ9: màn kiểm tra cam/mic — hiện mỗi lần vào phòng thật, xong mới connect LiveKit.
  if (isRealMode && myStatus === 'member' && !deviceChecked) {
    return (
      <DeviceCheck
        cameraOn={cam}
        micOn={mic}
        camLocked={roomRule ? roomRule.cam !== 'free' : false}
        micLocked={roomRule ? roomRule.mic !== 'free' : false}
        onToggleCam={toggleCam}
        onToggleMic={toggleMic}
        onDone={() => setDeviceChecked(true)}
      />
    )
  }

  return (
    <div
      className="relative h-svh w-full overflow-hidden font-sans text-[#33475e] antialiased"
      style={{ background: 'var(--ff-page-gradient)' }}
    >
      {isRealMode && <audio ref={musicAudioRef} loop style={{ display: 'none' }} />}

      {/* mini player YouTube — góc dưới-trái (cùng hàng với control bar), chỉ hiện khi
          phòng đang phát từ YouTube. Iframe phải hiện thật (không display:none) theo
          đúng ToS nhúng của YouTube. */}
      {ytActive && (
        <div
          className="absolute bottom-4 left-[26px] z-[41] w-[260px] overflow-hidden rounded-[18px] md:bottom-7"
          style={{ background: 'rgba(0,0,0,0.85)', boxShadow: '0 10px 26px rgba(20,30,40,0.28)' }}
        >
          <div ref={ytContainerRef} className="block h-[146px] w-[260px]" />
        </div>
      )}

      {/* top bar */}
      <div className="absolute top-[22px] right-[26px] left-[26px] z-[42] flex flex-wrap items-center justify-between gap-[10px]">
        <div
          className="flex items-center gap-[11px] rounded-[22px] py-[9px] pr-[18px] pl-[13px]"
          style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
        >
          <div className="h-5 w-5 rounded-lg" style={{ background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))' }} />
          <span className="text-base font-extrabold tracking-[-0.2px] text-[#2f4459]">{t('app.name')}</span>
          <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
            · {t('room.headerTag')}
          </span>
        </div>
        {/* thẻ mã phòng — trước đây mã phòng không hiện ở đâu trong Room, chỉ thấy lúc
            tạo/join ở Matching, user phải tự nhớ để mời thêm bạn. */}
        {code && (
          <div
            className="flex items-center gap-2 rounded-[22px] py-[9px] pr-[9px] pl-[16px]"
            style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
          >
            <span className="text-[11px] font-extrabold tracking-[0.6px] text-[rgba(51,71,94,0.5)] uppercase">
              {t('room.roomCode.label')}
            </span>
            <span className="text-[14.5px] font-extrabold tracking-[2px] text-[#2c3f55]">{code.toUpperCase()}</span>
            <button
              onClick={copyRoomCode}
              title={t('room.roomCode.copy')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
              style={{ background: 'rgba(255,255,255,0.6)' }}
            >
              {codeCopied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
                  <path d="M5.5 15.5h-1a2 2 0 01-2-2v-8a2 2 0 012-2h8a2 2 0 012 2v1" />
                </svg>
              )}
            </button>
          </div>
        )}
        {/* mời bạn bè đã kết bạn vào thẳng room — chỉ hiện khi đã là member thật (cần status
            'member' để invite_friend_to_room không bị RPC từ chối). */}
        {isRealMode && myStatus === 'member' && (
          <button
            onClick={() => setInviteFriendOpen(true)}
            title={t('friends.inviteTitle')}
            className="flex items-center gap-2 rounded-[22px] border-none py-[9px] pr-[16px] pl-[14px] font-sans text-[13px] font-extrabold text-[#354c65] transition-colors duration-200 hover:!bg-white"
            style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="3" />
              <circle cx="16.5" cy="9" r="2.4" />
              <path d="M2.3 19c.6-3.3 2.8-5 5.7-5s5.1 1.7 5.7 5" />
              <path d="M14.5 14.3c2.2.3 3.7 1.8 4.2 4.2" />
            </svg>
            {t('friends.inviteButton')}
          </button>
        )}
        <div className="flex items-center gap-[10px]">
          {!isRealMode && (
            <div
              className="flex items-center gap-[5px] rounded-[20px] p-[5px]"
              style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
            >
              {(['two', 'five'] as Demo[]).map((key) => (
                <button
                  key={key}
                  onClick={() => {
                    setDemo(key)
                    setMembers(demoSets[key].slice())
                  }}
                  className="rounded-[15px] border-none px-[14px] py-2 font-sans text-[12.5px] font-extrabold transition-all duration-[220ms]"
                  style={segStyle(demo === key)}
                >
                  {t(`room.demo.${key}`)}
                </button>
              ))}
            </div>
          )}
          <div
            className="flex items-center gap-[9px] rounded-[20px] px-[17px] py-[9px]"
            style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(16px)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)' }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: 'oklch(0.76 0.09 170)' }} />
            <span className="text-[13.5px] font-bold text-[#35566b]">{syncLabel}</span>
          </div>
        </div>
      </div>

      {/* video stage */}
      <div
        className={`absolute inset-0 py-[84px] pr-[26px] pl-[26px] transition-[padding] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${chatOpen ? 'md:pr-[392px]' : 'md:pr-[26px]'}`}
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-[34px] p-4"
          style={{
            border: '2px solid rgba(140,205,196,0.4)',
            boxShadow: '0 22px 56px rgba(58,98,126,0.15)',
            background: 'repeating-linear-gradient(135deg, #dbe9ef 0 14px, #d2e3ea 14px 28px)',
          }}
        >
          <div
            className="grid h-full w-full gap-[14px]"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
              placeContent: 'stretch',
            }}
          >
            {tiles.map((tile) => (
              <div
                key={tile.id}
                className="relative m-auto w-full max-w-full overflow-hidden rounded-[24px]"
                style={{
                  maxHeight: '100%',
                  aspectRatio: '16 / 9',
                  border: tile.tileBorder,
                  boxShadow: tile.tileShadow,
                  background: 'repeating-linear-gradient(135deg, #e3eef2 0 12px, #dae8ee 12px 24px)',
                }}
              >
                {tile.videoTrack ? (
                  <TrackMediaEl track={tile.videoTrack} kind="video" mirror={tile.self} />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-[6px]">
                    <span
                      className="rounded-[11px] px-3 py-[7px] font-mono text-xs tracking-[0.5px] text-[rgba(51,71,94,0.5)]"
                      style={{ background: 'rgba(255,255,255,0.7)' }}
                    >
                      {tile.feedLabel}
                    </span>
                  </div>
                )}
                {tile.audioTrack && <TrackMediaEl track={tile.audioTrack} kind="audio" />}
                <div
                  className="absolute top-3 left-3 flex items-center gap-2 rounded-[18px] py-[6px] pr-[13px] pl-[7px]"
                  style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(14px)', boxShadow: '0 5px 15px rgba(58,98,126,0.1)' }}
                >
                  <span
                    className="flex h-[26px] w-[26px] items-center justify-center rounded-[10px] text-[11.5px] font-extrabold"
                    style={{ background: tile.avatarBg, color: tile.avatarColor }}
                  >
                    {tile.initials}
                  </span>
                  <span className="text-[13px] font-extrabold text-[#2c3f55]">{tile.name}</span>
                  <span className="text-[11.5px] font-bold" style={{ color: tile.statusColor }}>
                    {tile.status}
                  </span>
                </div>
                {tile.self && (
                  <span
                    className="absolute top-[14px] right-[14px] flex items-center gap-[6px] rounded-full px-[11px] py-[5px] text-[11px] font-extrabold tracking-[0.4px] text-[#22483f]"
                    style={{ background: 'rgba(255,255,255,0.82)' }}
                  >
                    <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'oklch(0.72 0.11 165)' }} />
                    {t('room.you')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* floating pomodoro — đồng bộ cả phòng qua DB (real mode), chỉ host điều khiển; local
          ở demo/guest mode */}
      {
        <div
          className="absolute top-[106px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-[18px] rounded-[30px] py-[14px] pr-6 pl-4"
          style={{ background: 'rgba(255,255,255,0.62)', backdropFilter: 'blur(18px)', boxShadow: '0 16px 40px rgba(58,98,126,0.16)' }}
        >
          <div className="relative flex h-[92px] w-[92px] items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute h-[92px] w-[92px]" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="50" cy="50" r="43" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="8" />
              <circle
                cx="50"
                cy="50"
                r="43"
                fill="none"
                stroke={ACCENT}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray="270.2"
                style={{ strokeDashoffset: dashOffset, transition: 'stroke-dashoffset 980ms linear' }}
              />
            </svg>
            <span className="relative text-xl font-extrabold text-[#2c3f55] tabular-nums">
              {done ? '🎉' : timeText}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-px">
              <span className="text-xs font-extrabold tracking-[1.2px] text-[rgba(51,71,94,0.5)] uppercase">
                {done
                  ? t('room.pomodoro.doneTitle')
                  : phase === 'focus'
                    ? t('room.pomodoro.focusing')
                    : t('room.pomodoro.onBreak')}
              </span>
              <span className="text-[13.5px] font-bold text-[#2c3f55]">
                {done
                  ? t('room.pomodoro.doneHint', { count: sessionCount })
                  : t('room.pomodoro.syncedNote')}
              </span>
            </div>
            <div className="flex gap-[7px]">
              {done ? (
                <button
                  onClick={startNewRound}
                  disabled={useDbTimer && !isHost}
                  className="rounded-2xl border-none px-[18px] py-[9px] font-sans text-[13px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:enabled:-translate-y-px disabled:opacity-50"
                  style={{ background: ACCENT_SOFT }}
                >
                  {t('room.pomodoro.newRound')}
                </button>
              ) : (
                <>
                  <button
                    onClick={toggleRunning}
                    disabled={useDbTimer && !isHost}
                    className="rounded-2xl border-none px-[18px] py-[9px] font-sans text-[13px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:enabled:-translate-y-px disabled:opacity-50"
                    style={{ background: ACCENT_SOFT }}
                  >
                    {running ? t('room.pomodoro.pause') : t('room.pomodoro.resume')}
                  </button>
                  <button
                    onClick={resetTimer}
                    disabled={useDbTimer && !isHost}
                    className="rounded-2xl border-none px-4 py-[9px] font-sans text-[13px] font-bold text-[#4a637d] hover:enabled:!bg-white disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.7)' }}
                  >
                    {t('room.pomodoro.reset')}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      }

      {/* bottom controls */}
      <div
        className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-[26px] p-[8px] md:bottom-7 md:max-w-none md:gap-2 md:p-[10px]"
        style={{ background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px rgba(58,98,126,0.15)' }}
      >
        <button
          onClick={toggleCam}
          disabled={roomRule ? roomRule.cam !== 'free' : false}
          title={
            roomRule && roomRule.cam !== 'free'
              ? t('room.controls.locked')
              : cam
                ? t('room.controls.camera')
                : t('room.controls.cameraOff')
          }
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold transition-all duration-[220ms] hover:enabled:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-70 md:px-5"
          style={{ background: cam ? 'rgba(255,255,255,0.4)' : 'rgba(206,222,232,0.85)', color: cam ? '#354c65' : 'rgba(51,71,94,0.62)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="2.5" y="6.5" width="13" height="11" rx="3.5" />
            <path d="M15.5 11.5l6-3v7l-6-3z" />
            <path d={cam ? 'M12 12' : 'M3 20L21 4'} />
          </svg>
          <span className="hidden md:inline">{cam ? t('room.controls.camera') : t('room.controls.cameraOff')}</span>
        </button>
        <button
          onClick={toggleMic}
          disabled={roomRule ? roomRule.mic !== 'free' : false}
          title={
            roomRule && roomRule.mic !== 'free'
              ? t('room.controls.locked')
              : mic
                ? t('room.controls.mic')
                : t('room.controls.micOff')
          }
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold transition-all duration-[220ms] hover:enabled:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-70 md:px-5"
          style={{ background: mic ? 'rgba(255,255,255,0.4)' : 'rgba(206,222,232,0.85)', color: mic ? '#354c65' : 'rgba(51,71,94,0.62)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5.5 12a6.5 6.5 0 0013 0M12 18.5V21" />
            <path d={mic ? 'M12 12' : 'M3 20L21 4'} />
          </svg>
          <span className="hidden md:inline">{mic ? t('room.controls.mic') : t('room.controls.micOff')}</span>
        </button>
        <button
          onClick={() => openTab('chat')}
          title={t('room.controls.chat')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-all duration-[220ms] hover:!bg-[rgba(255,255,255,0.95)] md:px-5"
          style={{ background: chatOpen && effectiveTab === 'chat' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M20 12.5c0 3.6-3.6 6.5-8 6.5-1 0-2-.15-2.9-.42L4.5 20l1.1-3.3A6.7 6.7 0 014 12.5C4 8.9 7.6 6 12 6s8 2.9 8 6.5z" />
          </svg>
          <span className="hidden md:inline">{t('room.controls.chat')}</span>
        </button>
        <button
          onClick={() => openTab('music')}
          title={t('room.controls.music')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-all duration-[220ms] hover:!bg-[rgba(255,255,255,0.95)] md:px-5"
          style={{ background: chatOpen && effectiveTab === 'music' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M9 18V6l10-2v12" />
            <circle cx="6.5" cy="18" r="2.6" />
            <circle cx="19" cy="16" r="2.6" />
          </svg>
          <span className="hidden md:inline">{t('room.controls.music')}</span>
        </button>
        <button
          onClick={() => openTab('members')}
          title={t('room.controls.members')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-all duration-[220ms] hover:!bg-[rgba(255,255,255,0.95)] md:px-5"
          style={{ background: chatOpen && effectiveTab === 'members' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="3" />
            <circle cx="16.5" cy="9" r="2.4" />
            <path d="M2.3 19c.6-3.3 2.8-5 5.7-5s5.1 1.7 5.7 5" />
            <path d="M14.5 14.3c2.2.3 3.7 1.8 4.2 4.2" />
          </svg>
          <span className="hidden md:inline">{t('room.controls.members')}</span>
        </button>
        {isHost && (
          <button
            onClick={() => openTab('host')}
            title={t('room.controls.manage')}
            className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-all duration-[220ms] hover:!bg-[rgba(255,255,255,0.95)] md:px-5"
            style={{ background: chatOpen && effectiveTab === 'host' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.4)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 19c.9-3 3.3-4.4 6-4.4S14.1 16 15 19" />
              <circle cx="9" cy="8.5" r="3.2" />
              <path d="M17 4.5l1.15 2.4 2.6.36-1.9 1.82.46 2.58L17 10.44l-2.31 1.22.46-2.58-1.9-1.82 2.6-.36z" />
            </svg>
            <span className="hidden md:inline">{t('room.controls.manage')}</span>
            {queued && (
              <span
                className="rounded-full px-2 py-[2px] text-xs font-extrabold text-[#7a4a2c]"
                style={{ background: 'oklch(0.87 0.075 55)' }}
              >
                {pending.length}
              </span>
            )}
          </button>
        )}
        <div className="mx-1 h-[26px] w-px shrink-0" style={{ background: 'rgba(51,71,94,0.13)' }} />
        <button
          onClick={handleLeaveClick}
          title={t('room.controls.leave')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-extrabold text-[#7a3f2c] transition-all duration-[220ms] hover:brightness-95 md:px-[22px]"
          style={{ background: 'oklch(0.86 0.055 45)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
            <path d="M15 5.5V4a2 2 0 00-2-2H6a2 2 0 00-2 2v16a2 2 0 002 2h7a2 2 0 002-2v-1.5" />
            <path d="M11 12h10m-3.5-3.5L21 12l-3.5 3.5" />
          </svg>
          <span className="hidden md:inline">{t('room.controls.leave')}</span>
        </button>
      </div>

      {/* side panel — bottom sheet on mobile, side panel on md+ */}
      <div
        className={`fixed inset-x-3 bottom-[112px] z-[28] flex max-h-[60vh] flex-col gap-[14px] rounded-[26px] p-[18px] md:absolute md:inset-x-auto md:top-[84px] md:right-[26px] md:max-h-none md:w-[340px] md:rounded-[30px] ${
          chatOpen ? 'translate-y-0 md:translate-x-0' : 'translate-y-[calc(100%+24px)] md:translate-y-0 md:translate-x-[380px]'
        }`}
        style={{
          background: 'rgba(255,255,255,0.84)',
          backdropFilter: 'blur(22px)',
          boxShadow: '0 18px 46px rgba(58,98,126,0.15)',
          opacity: chatOpen ? 1 : 0,
          pointerEvents: chatOpen ? 'auto' : 'none',
          transition: 'transform 440ms cubic-bezier(0.22,1,0.36,1), opacity 340ms ease',
        }}
      >
        <div className="mx-auto -mt-1 mb-1 h-1 w-9 shrink-0 rounded-full bg-[rgba(51,71,94,0.16)] md:hidden" />
        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-[5px] rounded-[20px] p-[5px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
            {(
              [
                { key: 'chat' as Tab, name: t('room.controls.chat'), show: true, badge: '' },
                { key: 'music' as Tab, name: t('room.controls.music'), show: true, badge: '' },
                { key: 'members' as Tab, name: t('room.controls.members'), show: true, badge: '' },
                {
                  key: 'host' as Tab,
                  name: t('room.controls.manage'),
                  show: isHost,
                  badge: queued ? String(pending.length) : '',
                },
              ] as const
            ).map(
              (x) =>
                x.show && (
                  <button
                    key={x.key}
                    onClick={() => setTab(x.key)}
                    className="flex flex-1 items-center justify-center gap-[7px] rounded-2xl border-none px-[6px] py-[9px] font-sans text-[13px] font-extrabold transition-all duration-[220ms]"
                    style={segStyle(effectiveTab === x.key)}
                  >
                    {x.name}
                    {x.badge && (
                      <span
                        className="rounded-full px-[7px] py-[2px] text-[11px] font-extrabold text-[#7a4a2c]"
                        style={{ background: 'oklch(0.87 0.075 55)' }}
                      >
                        {x.badge}
                      </span>
                    )}
                  </button>
                ),
            )}
          </div>
          <button
            onClick={() => setChatOpen(false)}
            className="border-none bg-transparent px-1 py-[6px] font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            {t('room.panel.collapse')}
          </button>
        </div>

        {/* tab: chat */}
        {effectiveTab === 'chat' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-1 flex-col gap-[9px] overflow-y-auto">
              {messages.map((msg, i) => (
                <div key={i} className="flex max-w-[84%] flex-col gap-[3px]" style={{ alignSelf: msg.me ? 'flex-end' : 'flex-start' }}>
                  <span className="pl-1 text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">{msg.who}</span>
                  <span
                    className="rounded-[18px] px-[14px] py-[11px] text-[13.5px] leading-[1.5] font-semibold text-[#2c3f55]"
                    style={{ background: msg.me ? 'color-mix(in oklab, var(--ff-accent) 26%, white)' : 'rgba(238,246,248,0.95)' }}
                  >
                    {msg.text}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="flex items-center gap-2 rounded-[20px] py-[5px] pr-[5px] pl-[15px]"
              style={{ background: 'rgba(255,255,255,0.9)', boxShadow: '0 4px 14px rgba(58,98,126,0.08)' }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                placeholder={t('room.panel.chatPlaceholder')}
                className="min-w-0 flex-1 border-none bg-transparent py-[10px] font-sans text-[13.5px] font-semibold text-[#2c3f55] outline-none"
              />
              <button
                onClick={send}
                className="rounded-[15px] border-none px-4 py-[10px] font-sans text-[13px] font-extrabold text-[#1e3549]"
                style={{ background: ACCENT_SOFT }}
              >
                {t('room.panel.send')}
              </button>
            </div>
          </div>
        )}

        {/* tab: music */}
        {effectiveTab === 'music' && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex items-center gap-[13px] rounded-[24px] px-4 py-[15px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
              <span className="flex h-[30px] w-[34px] shrink-0 items-end gap-[3px]">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-full flex-1 rounded-[3px]"
                    style={{
                      background: musicOn ? 'color-mix(in oklab, var(--ff-accent) 78%, white)' : 'rgba(51,71,94,0.18)',
                      transformOrigin: 'bottom',
                      animation: musicOn ? `ffEq 900ms ease-in-out infinite ${i * 300}ms` : 'none',
                    }}
                  />
                ))}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="text-sm font-extrabold text-[#2c3f55]">
                  {ytActive ? t('room.music.youtubeNowPlaying') : currentTrack.name}
                </span>
                <span className="text-xs font-semibold text-[rgba(51,71,94,0.5)]">
                  {musicOn
                    ? t('room.music.playing', { mood: ytActive ? t('room.music.youtubeTag') : currentTrack.mood })
                    : t('room.music.paused')}
                </span>
              </div>
              <button
                onClick={() => {
                  if (musicLocked) return
                  setMusicOn((v) => !v)
                }}
                disabled={musicLocked || (!ytActive && tracks.length === 0)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[15px] border-none text-[#1e3549] hover:enabled:brightness-[0.97] disabled:opacity-50"
                style={{ background: ACCENT_SOFT }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <path d={musicOn ? 'M8 5h3.2v14H8zM12.8 5H16v14h-3.2z' : 'M8 5l11 7-11 7z'} />
                </svg>
              </button>
            </div>

            {musicLocked && (
              <span
                className="rounded-[18px] px-[15px] py-3 text-[12.5px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.65)]"
                style={{ background: 'rgba(255,255,255,0.66)', boxShadow: 'inset 0 0 0 1.5px rgba(51,71,94,0.07)' }}
              >
                {t('room.music.lockedNote')}
              </span>
            )}

            {isRealMode && (
              <div className="flex gap-[7px] rounded-[20px] p-[5px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
                <button
                  onClick={switchToLibrary}
                  className="flex-1 rounded-2xl border-none px-[6px] py-[9px] font-sans text-[12.5px] font-extrabold transition-all duration-[220ms] disabled:cursor-default"
                  style={{ background: activeTab === 'library' ? 'white' : 'transparent', color: activeTab === 'library' ? '#22483f' : 'rgba(51,71,94,0.55)' }}
                >
                  {t('room.music.sourceLibrary')}
                </button>
                <button
                  onClick={switchToYoutube}
                  className="flex-1 rounded-2xl border-none px-[6px] py-[9px] font-sans text-[12.5px] font-extrabold transition-all duration-[220ms] disabled:cursor-default"
                  style={{ background: activeTab === 'youtube' ? 'white' : 'transparent', color: activeTab === 'youtube' ? '#22483f' : 'rgba(51,71,94,0.55)' }}
                >
                  {t('room.music.sourceYoutube')}
                </button>
              </div>
            )}

            {isRealMode && activeTab === 'youtube' && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-[7px]">
                  <div className="flex gap-[7px]">
                    <input
                      value={ytInput}
                      onChange={(e) => {
                        setYtInput(e.target.value)
                        setYtError(false)
                      }}
                      placeholder={t('room.music.youtubeInputPlaceholder')}
                      className="min-w-0 flex-1 rounded-[16px] border-none px-[13px] py-[10px] font-sans text-[13px] font-semibold text-[#2c3f55] outline-none"
                      style={{ background: 'rgba(238,246,248,0.9)' }}
                    />
                    <button
                      onClick={applyYoutubeLink}
                      disabled={!ytInput.trim()}
                      className="shrink-0 rounded-[16px] border-none px-[16px] py-[10px] font-sans text-[13px] font-extrabold text-[#1e3549] disabled:opacity-50"
                      style={{ background: ACCENT_SOFT }}
                    >
                      {t('room.music.youtubeUse')}
                    </button>
                  </div>
                  {ytError && (
                    <span className="text-[12px] font-semibold text-[#a13f2c]">{t('room.music.youtubeInvalid')}</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[12px] font-semibold text-[rgba(51,71,94,0.5)]">
                    {musicSource === 'youtube'
                      ? t('room.music.youtubeCurrent', { url: youtubeUrl })
                      : t('room.music.youtubeSaved', { url: youtubeUrl })}
                  </span>
                  {musicSource !== 'youtube' && (
                    <button
                      onClick={() => {
                        if (musicLocked) return
                        setMusicSource('youtube')
                        setMusicOn(true)
                      }}
                      disabled={musicLocked}
                      className="shrink-0 rounded-[15px] border-none px-[14px] py-[9px] font-sans text-[12.5px] font-extrabold text-[#1e3549] disabled:opacity-50"
                      style={{ background: ACCENT_SOFT }}
                    >
                      {t('room.music.play')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {(!isRealMode || activeTab === 'library') && (
            <div className="flex flex-col gap-3">
              {/* điều khiển thật (trước/sau + tua + âm lượng) — chỉ áp dụng cho Thư viện,
                  YouTube không cần vì widget nổi góc dưới-trái đã có control âm lượng thật
                  ngay trong iframe của nó. Mọi thao tác ở đây đều chốt nguồn 'library'. */}
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => playRelativeTrack(-1)}
                  disabled={musicLocked || tracks.length === 0}
                  title={t('room.music.prevTrack')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:enabled:!bg-white disabled:opacity-40"
                  style={{ background: 'rgba(238,246,248,0.9)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="5" y="5" width="3" height="14" />
                    <path d="M18 5v14l-8-7z" />
                  </svg>
                </button>
                <button
                  onClick={() => playRelativeTrack(1)}
                  disabled={musicLocked || tracks.length === 0}
                  title={t('room.music.nextTrack')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:enabled:!bg-white disabled:opacity-40"
                  style={{ background: 'rgba(238,246,248,0.9)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 5v14l8-7z" />
                    <rect x="16" y="5" width="3" height="14" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-7 shrink-0 text-right text-[11px] font-semibold text-[rgba(51,71,94,0.5)] tabular-nums">
                  {fmtTrackTime(audioCurrentTime)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={audioDuration || 0}
                  step={0.1}
                  value={Math.min(audioCurrentTime, audioDuration || 0)}
                  onChange={(e) => seekTrackTo(Number(e.target.value))}
                  disabled={!audioDuration}
                  className="ff-range w-full flex-1"
                />
                <span className="w-7 shrink-0 text-[11px] font-semibold text-[rgba(51,71,94,0.5)] tabular-nums">
                  {fmtTrackTime(audioDuration)}
                </span>
              </div>
              <div className="flex items-center gap-[11px]">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="rgba(51,71,94,0.45)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 9.5h3.5L13 5.5v13L8.5 14.5H5z" />
                  <path d={volume === 0 ? 'M16.5 9.5l4 5m0-5l-4 5' : 'M16.5 9a4 4 0 010 6'} />
                </svg>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  className="ff-range min-w-0 flex-1"
                />
                <span className="w-[34px] text-right text-[12.5px] font-extrabold text-[rgba(51,71,94,0.55)]">{volume}%</span>
              </div>

              <div className="flex items-baseline justify-between gap-[10px]">
                <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  {t('room.music.playlist')}
                </span>
                <span className="text-xs font-semibold text-[rgba(51,71,94,0.45)]">
                  {t('room.music.onlyYouHear')}
                </span>
              </div>
              {isRealMode && tracks.length === 0 && (
                <span className="rounded-[20px] px-[13px] py-[15px] text-[12.5px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.5)]" style={{ background: 'rgba(238,246,248,0.8)' }}>
                  {t('room.music.empty')}
                </span>
              )}
              {tracks.map((track, i) => {
                const on = i === trackIndex
                return (
                  <button
                    key={track.id}
                    onClick={() => {
                      if (musicLocked) return
                      setTrackIndex(i)
                      setMusicOn(true)
                      setMusicSource('library')
                    }}
                    disabled={musicLocked}
                    className="flex items-center gap-[11px] rounded-[20px] border-none px-[13px] py-[11px] text-left font-sans transition-all duration-200 hover:enabled:brightness-[0.98] disabled:cursor-default disabled:opacity-70"
                    style={{
                      background: on ? 'color-mix(in oklab, var(--ff-accent) 20%, white)' : 'rgba(238,246,248,0.8)',
                      boxShadow: on ? 'inset 0 0 0 1.5px color-mix(in oklab, var(--ff-accent) 55%, white)' : 'none',
                    }}
                  >
                    <span
                      className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[11px]"
                      style={{ background: on ? 'rgba(255,255,255,0.85)' : 'rgba(160,200,225,0.35)', color: on ? '#22483f' : '#2b4d68' }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                        <path d="M9 18V6l10-2v12" />
                        <circle cx="6.5" cy="18" r="2.6" />
                        <circle cx="19" cy="16" r="2.6" />
                      </svg>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13.5px] font-extrabold" style={{ color: on ? '#22483f' : '#2c3f55' }}>
                        {track.name}
                      </span>
                      <span className="text-[11.5px] font-semibold text-[rgba(51,71,94,0.48)]">{track.mood}</span>
                    </span>
                    <span className="text-[11.5px] font-extrabold text-[rgba(51,71,94,0.42)]">{track.length}</span>
                  </button>
                )
              })}
            </div>
            )}

            <span className="text-[12.5px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.5)]">
              {t('room.music.personalNote')}
            </span>
          </div>
        )}

        {/* tab: host */}
        {/* tab: members — mọi người xem được (khác "Manage" chỉ host thấy). Có nút gửi/chấp
            nhận lời mời kết bạn ngay tại đây nếu chưa là bạn với nhau (0016_friends.sql). */}
        {effectiveTab === 'members' && (
          <div className="flex min-h-0 flex-1 flex-col gap-[9px] overflow-y-auto">
            <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
              {t('room.members.title', { count: members.length })}
            </span>
            {members.map((u) => {
              const isSelf = !!u.me || (!!user && u.id === user.id)
              const row = !isSelf && user && isRealMode ? friendRowWith(u.id, user.id) : undefined
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-[10px] rounded-[20px] px-3 py-[10px]"
                  style={{ background: 'rgba(238,246,248,0.85)' }}
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[12.5px] font-extrabold"
                    style={{
                      background: u.host ? 'rgba(140,205,196,0.5)' : 'rgba(160,200,225,0.5)',
                      color: u.host ? '#22483f' : '#2b4d68',
                    }}
                  >
                    {initials(u.name)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-[6px]">
                      <span className="truncate text-[13.5px] font-extrabold text-[#2c3f55]">{u.name}</span>
                      {u.host && (
                        <span
                          className="shrink-0 rounded-full px-2 py-[2px] text-[10.5px] font-extrabold text-[#22483f]"
                          style={{ background: 'rgba(140,205,196,0.55)' }}
                        >
                          {t('room.members.hostBadge')}
                        </span>
                      )}
                    </div>
                    <span className="text-[11.5px] font-semibold text-[rgba(51,71,94,0.5)]">
                      {statusLabel(u.statusKey)}
                    </span>
                  </div>
                  {!isSelf && isRealMode && user && (
                    <>
                      {!row ? (
                        <button
                          onClick={() => void handleSendFriendRequest(u.id)}
                          disabled={friendActionId === u.id}
                          className="shrink-0 rounded-[14px] border-none px-[13px] py-2 font-sans text-[12.5px] font-extrabold text-[#1e3549] hover:enabled:brightness-[0.97] disabled:opacity-50"
                          style={{ background: ACCENT_SOFT }}
                        >
                          {t('room.members.addFriend')}
                        </button>
                      ) : row.status === 'accepted' ? (
                        <span className="shrink-0 text-[12px] font-bold text-[#2c5b53]">
                          {t('room.members.alreadyFriends')}
                        </span>
                      ) : row.requester_id === user.id ? (
                        <span className="shrink-0 text-[12px] font-semibold text-[rgba(51,71,94,0.5)]">
                          {t('room.members.requestSent')}
                        </span>
                      ) : (
                        <button
                          onClick={() => void handleAcceptFriendRow(row.id)}
                          disabled={friendActionId === row.id}
                          className="shrink-0 rounded-[14px] border-none px-[13px] py-2 font-sans text-[12.5px] font-extrabold text-[#1e3549] hover:enabled:brightness-[0.97] disabled:opacity-50"
                          style={{ background: ACCENT_SOFT }}
                        >
                          {t('room.members.acceptFriend')}
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {effectiveTab === 'host' && isHost && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <div className="flex flex-col gap-[9px]">
              <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('room.host.admitMode')}
              </span>
              <div className="flex gap-[7px] rounded-[20px] p-[5px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
                {(['auto', 'manual'] as Admit[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setAdmitReal(key)}
                    className="flex-1 rounded-2xl border-none px-[6px] py-[10px] font-sans text-[13px] font-extrabold transition-all duration-[220ms]"
                    style={segStyle(admit === key)}
                  >
                    {key === 'auto' ? t('room.host.autoAdmit') : t('room.host.manualAdmit')}
                  </button>
                ))}
              </div>
              <span className="text-[12.5px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.58)]">
                {admit === 'auto' ? t('room.host.autoAdmitDesc') : t('room.host.manualAdmitDesc')}
              </span>
            </div>

            {admit === 'manual' && (
              <div className="flex flex-col gap-[9px]">
                <div className="flex items-baseline justify-between gap-[10px]">
                  <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                    {t('room.host.queueTitle')}
                  </span>
                  {pending.length > 1 && (
                    <button
                      onClick={approveAll}
                      className="border-none bg-transparent font-sans text-[12.5px] font-extrabold text-[#2c5b53]"
                    >
                      {t('room.host.approveAll')}
                    </button>
                  )}
                </div>
                {pending.length === 0 ? (
                  <span
                    className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[rgba(51,71,94,0.45)]"
                    style={{ background: 'rgba(238,246,248,0.8)' }}
                  >
                    {t('room.host.emptyQueue')}
                  </span>
                ) : (
                  pending.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-[10px] rounded-[20px] px-3 py-[10px]"
                      style={{ background: 'rgba(255,246,238,0.9)', boxShadow: 'inset 0 0 0 1.5px rgba(196,142,96,0.18)' }}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[12.5px] font-extrabold text-[#7a4a2c]"
                        style={{ background: 'rgba(226,190,150,0.45)' }}
                      >
                        {initials(p.name)}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-[13.5px] font-extrabold text-[#2c3f55]">{p.name}</span>
                        <span className="text-[11.5px] font-semibold text-[rgba(51,71,94,0.5)]">
                          {t('room.host.waitPrefix', { wait: p.wait })}
                        </span>
                      </div>
                      <button
                        onClick={() => approve(p)}
                        title={t('room.host.approveTitle')}
                        className="rounded-[14px] border-none px-[13px] py-2 font-sans text-[12.5px] font-extrabold text-[#1e3549] hover:brightness-[0.97]"
                        style={{ background: ACCENT_SOFT }}
                      >
                        {t('room.host.approve')}
                      </button>
                      <button
                        onClick={() => reject(p)}
                        title={t('room.host.rejectTitle')}
                        className="rounded-[14px] border-none px-[11px] py-2 font-sans text-[12.5px] font-extrabold text-[rgba(51,71,94,0.55)] hover:!text-[#7a3f2c]"
                        style={{ background: 'rgba(255,255,255,0.9)' }}
                      >
                        {t('room.host.reject')}
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="flex flex-col gap-[9px]">
              <span className="text-xs font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('room.host.membersInRoom', { count: members.length })}
              </span>
              {members.map((u) => (
                <div key={u.id} className="flex items-center gap-[10px] rounded-[20px] px-3 py-[10px]" style={{ background: 'rgba(238,246,248,0.85)' }}>
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[12.5px] font-extrabold"
                    style={{
                      background: u.host ? 'rgba(140,205,196,0.5)' : 'rgba(160,200,225,0.5)',
                      color: u.host ? '#22483f' : '#2b4d68',
                    }}
                  >
                    {initials(u.name)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[13.5px] font-extrabold text-[#2c3f55]">{u.name}</span>
                    <span className="text-[11.5px] font-semibold text-[rgba(51,71,94,0.5)]">
                      {statusLabel(u.statusKey)}
                    </span>
                  </div>
                  {isHost && !u.host && (
                    <button
                      onClick={() => kick(u)}
                      className="rounded-[14px] border-none px-[13px] py-2 font-sans text-[12.5px] font-extrabold text-[#7a3f2c] hover:!bg-[oklch(0.86_0.055_45)]"
                      style={{ background: 'oklch(0.9 0.045 45)' }}
                    >
                      {t('room.host.kick')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* GĐ9: card đánh giá sau buổi học (timer_done hoặc rời phòng sau khi đã học) */}
      {showRating && isRealMode && realRoom && user && (
        <SessionRating
          roomId={realRoom.id}
          members={members.filter((m) => !m.me && m.id !== user.id)}
          pendingLeave={pendingLeave}
          onLeave={() => {
            setShowRating(false)
            void doLeaveRoom()
          }}
          onClose={() => setShowRating(false)}
        />
      )}

      {hostLeaveModalOpen && (
        <HostLeaveModal
          members={otherMembers.map((m) => ({ id: m.id, name: m.name }))}
          error={transferError}
          onClose={() => setHostLeaveModalOpen(false)}
          onCloseRoom={chooseCloseRoom}
          onTransfer={chooseTransfer}
        />
      )}

      {inviteFriendOpen && realRoom && (
        <InviteFriendModal
          roomId={realRoom.id}
          memberIds={members.map((m) => m.id)}
          onClose={() => setInviteFriendOpen(false)}
        />
      )}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { playChime } from '../lib/sound'
import { parseYoutubeUrl, loadYoutubeApi, DEFAULT_YOUTUBE_URL, MUSIC_YOUTUBE_KEY, loadStoredYoutubeUrlOverride, type YTPlayer } from '../lib/youtube'
import { BUILTIN_TRACKS, type LibraryTrack } from '../lib/musicLibrary'
import { loadSavedMatchConfig, othersWaiting, useQuickMatch } from '../lib/quickMatch'
import { isVideoWallpaper } from '../lib/wallpaper'
import { loadStoredAutoFullscreenFocus } from '../lib/focusFullscreen'
import MatchFound from '../components/MatchFound'
import Settings from './Settings'
import Stats from './Stats'
import FriendsPanel from '../components/FriendsPanel'
import { useFriendStore } from '../store/friendNotifications'

type WallpaperOption = { id: string; kind: 'gradient' | 'image' | 'video'; value: string }

const BUILTIN_GRADIENTS: WallpaperOption[] = ['linear-gradient(160deg, #dff1f4 0%, #cfe6f2 45%, #e6f4ee 100%)'].map(
  (value, i) => ({ id: 'gradient-' + i, kind: 'gradient' as const, value }),
)

// Ảnh/video nền có sẵn cho mọi tài khoản — thả file .jpg/.jpeg/.png/.webp/.gif/.mp4 vào
// app/src/assets/wallpapers/ là tự động xuất hiện trong popup "Đổi hình nền", không cần sửa
// code. .gif chạy động tự nhiên vì nền chỉ render qua CSS `background-image` (trình duyệt tự
// lo hoạt hình); .mp4 thì khác — không gán được qua `background-image`, phải render bằng thẻ
// <video> riêng (xem chỗ dùng `selectedWallpaper.kind === 'video'` bên dưới).
const builtinWallpaperMedia = import.meta.glob<string>('/src/assets/wallpapers/*.{jpg,jpeg,png,webp,gif,mp4}', {
  eager: true,
  import: 'default',
})
const BUILTIN_MEDIA: WallpaperOption[] = Object.entries(builtinWallpaperMedia)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => ({ id: path, kind: isVideoWallpaper(path) ? ('video' as const) : ('image' as const), value: url }))

const BUILTIN_WALLPAPERS: WallpaperOption[] = [...BUILTIN_GRADIENTS, ...BUILTIN_MEDIA]

const WALLPAPER_STORAGE_KEY = 'ff-wallpaper-id'
function loadStoredWallpaperId() {
  try {
    return localStorage.getItem(WALLPAPER_STORAGE_KEY) ?? BUILTIN_WALLPAPERS[0].id
  } catch {
    return BUILTIN_WALLPAPERS[0].id
  }
}

const LIBRARY_VOLUME_KEY = 'ff-music-library-volume'
function loadStoredLibraryVolume() {
  try {
    const raw = localStorage.getItem(LIBRARY_VOLUME_KEY)
    if (raw === null) return 100
    const v = Number(raw)
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 100
  } catch {
    return 100
  }
}

// Bật/tắt camera cũng phải nhớ qua localStorage giống wallpaper/musicSource ở trên —
// nếu không thì mỗi lần route Dashboard bị unmount/remount (vd điều hướng sang Settings
// rồi quay lại), state cameraOn reset về mặc định true dù user vừa tắt.
const CAMERA_ON_KEY = 'ff-camera-on'
function loadStoredCameraOn() {
  try {
    const v = localStorage.getItem(CAMERA_ON_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

// Nguồn nhạc (musicSource) cố tình không lưu localStorage — mỗi lần mở app luôn mặc định
// vào thẳng YouTube (auto-play link đã lưu, hoặc DEFAULT_YOUTUBE_URL nếu chưa từng đổi);
// chọn Thư viện chỉ có tác dụng tạm trong phiên đang mở, không "dính" sang lần mở app kế
// tiếp — theo đúng yêu cầu user. Link YouTube override (MUSIC_YOUTUBE_KEY) thì lưu, xem
// lib/youtube.ts.
type MusicSource = 'library' | 'youtube'

const FOCUS_MINUTES = 25
const BREAK_MINUTES = 5
const SESSION_COUNT_DEFAULT = 4
const ACCENT = 'var(--ff-accent)'

type Phase = 'focus' | 'break'
type Mode = 'dashboard' | 'focus'
type Panel = 'wp' | 'music' | 'todo' | null
type TimerType = 'pomodoro' | 'endless'
type EditField = 'loop' | 'work' | 'break' | null

type Task = {
  id: string
  name: string
  meta: string
  done: boolean
}

const MOCK_TASK_KEYS = ['t1', 't2', 't3', 't4'] as const
const MOCK_TASK_DONE: Record<(typeof MOCK_TASK_KEYS)[number], boolean> = {
  t1: false,
  t2: false,
  t3: true,
  t4: false,
}

function fmtHMS(totalSec: number) {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
}

function fmtTrackTime(totalSec: number) {
  const sec = Number.isFinite(totalSec) && totalSec > 0 ? totalSec : 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  // Cài đặt giờ là overlay mở ngay trên Dashboard thay vì route /settings riêng — tránh
  // Dashboard unmount mỗi lần vào Cài đặt (trước đó làm mất camera đang bật + nhạc đang
  // phát, vì cả 2 đều sống trong state của chính component này).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(false)
  const pendingFriendRequestCount = useFriendStore((s) => s.pendingRequestCount)
  // Ghép ngẫu nhiên nhanh từ Dashboard — hook dùng chung với Matching (GĐ9):
  // config từ localStorage (nhớ lần chọn cuối) hoặc defaults từ profiles.
  const quick = useQuickMatch()
  function quickStart() {
    if (!user) {
      navigate('/auth')
      return
    }
    setPanel(null)
    const saved = loadSavedMatchConfig()
    void quick.start(
      saved ?? {
        room_type: 'chill',
        focus_minutes: focusMin,
        break_minutes: breakMin,
        session_count: sessionCount,
        language: i18n.resolvedLanguage === 'en' ? 'en' : 'vi',
      },
    )
  }
  const initialTasks = useMemo<Task[]>(
    () =>
      MOCK_TASK_KEYS.map((key, i) => ({
        id: 'g' + (i + 1),
        name: t(`dashboard.mockTasks.${key}.name`),
        meta: t(`dashboard.mockTasks.${key}.meta`),
        done: MOCK_TASK_DONE[key],
      })),
    [t],
  )
  const [mode, setMode] = useState<Mode>('dashboard')
  // true khi Focus mode + fullscreen hiện tại là do startPomodoro() tự bật (setting "auto
  // fullscreen") — dùng để ẩn luôn top bar (tên app + toggle Focus/Dashboard), khác Focus mode
  // bật tay vẫn giữ top bar để còn đường quay lại Dashboard.
  const [autoFocusFullscreen, setAutoFocusFullscreen] = useState(false)
  const [timerType, setTimerType] = useState<TimerType>('pomodoro')
  const [pomodoroStarted, setPomodoroStarted] = useState(false)
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<Phase>('focus')
  const [left, setLeft] = useState(FOCUS_MINUTES * 60)
  const [round, setRound] = useState(1)
  const [done, setDone] = useState(false)
  const [endlessStarted, setEndlessStarted] = useState(false)
  const [endlessRunning, setEndlessRunning] = useState(false)
  const [endlessSeconds, setEndlessSeconds] = useState(0)
  const [now, setNow] = useState(() => new Date())
  // Lưu vào localStorage — chọn hình nền xong rồi rời trang (Settings/Matching...) quay lại phải
  // vẫn giữ đúng lựa chọn, không reset về mặc định (component Dashboard unmount/mount lại theo route).
  const [wp, setWp] = useState(loadStoredWallpaperId)
  const [customWallpapers, setCustomWallpapers] = useState<WallpaperOption[]>([])
  const wallpaperOptions = useMemo(() => [...BUILTIN_WALLPAPERS, ...customWallpapers], [customWallpapers])
  const selectedWallpaper = wallpaperOptions.find((w) => w.id === wp) ?? BUILTIN_WALLPAPERS[0]

  useEffect(() => {
    try {
      localStorage.setItem(WALLPAPER_STORAGE_KEY, wp)
    } catch {
      // localStorage không khả dụng (vd chế độ ẩn danh chặn) — chỉ mất tính năng nhớ lựa chọn, không lỗi.
    }
  }, [wp])
  const [panel, setPanel] = useState<Panel>(null)
  const [cameraOn, setCameraOn] = useState(loadStoredCameraOn)
  useEffect(() => {
    try {
      localStorage.setItem(CAMERA_ON_KEY, cameraOn ? '1' : '0')
    } catch {
      // localStorage không khả dụng — chỉ mất tính năng nhớ lựa chọn, không lỗi.
    }
  }, [cameraOn])
  const videoRef = useRef<HTMLVideoElement>(null)
  // Thư viện = nhạc built-in (mọi tài khoản, kể cả khách) ∪ nhạc thật từ Supabase khi đã
  // đăng nhập (RLS "tracks: select own or shared" — xem 0007_default_tracks.sql — tự trả
  // về đúng nhạc của mình + mọi track is_default=true của người khác, không cần lọc tay).
  const [tracks, setTracks] = useState<LibraryTrack[]>(BUILTIN_TRACKS)
  useEffect(() => {
    if (!user) {
      setTracks(BUILTIN_TRACKS)
      return
    }
    let cancelled = false
    supabase
      .from('tracks')
      .select('id, name, storage_path, duration_seconds')
      .order('created_at')
      .then(({ data }) => {
        if (cancelled) return
        const dbTracks: LibraryTrack[] = (data ?? []).map((r) => ({
          id: r.id,
          kind: 'db' as const,
          name: r.name,
          path: r.storage_path,
          durationSeconds: r.duration_seconds,
        }))
        setTracks([...BUILTIN_TRACKS, ...dbTracks])
      })
    return () => {
      cancelled = true
    }
    // settingsOpen: Settings mở như overlay ĐÈ LÊN Dashboard chứ không unmount nó, nên upload/
    // xoá nhạc trong đó xong đóng lại phải tự refetch ở đây — nếu không nhạc mới sẽ không bao
    // giờ xuất hiện ở popup "Nhạc nền" cho tới khi F5 lại trang (bug user báo cáo).
  }, [user, settingsOpen])

  const [track, setTrack] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  useEffect(() => {
    const current = tracks[track]
    if (!current) {
      setAudioSrc(null)
      return
    }
    if (current.kind === 'builtin') {
      setAudioSrc(current.url)
      return
    }
    let cancelled = false
    supabase.storage
      .from('tracks')
      .createSignedUrl(current.path, 3600)
      .then(({ data }) => {
        if (!cancelled) setAudioSrc(data?.signedUrl ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [tracks, track])

  const musicAudioRef = useRef<HTMLAudioElement>(null)
  // Vị trí/độ dài bài đang phát thật (từ chính thẻ <audio>) — dùng cho thanh tua thời lượng
  // + nút bài trước/bài tiếp ở popup "Nhạc nền" > Thư viện.
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  // Âm lượng nhạc Thư viện — chỉ áp dụng cho <audio>; nhạc YouTube có state âm lượng riêng
  // (ytVolume/ytMuted, xem thanh mini YouTube bên dưới). Nhớ qua localStorage giống các tuỳ
  // chỉnh khác (wallpaper/camera/nhạc) để không phải chỉnh lại mỗi lần mở app.
  const [libraryVolume, setLibraryVolume] = useState(loadStoredLibraryVolume)
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_VOLUME_KEY, String(libraryVolume))
    } catch {
      // localStorage không khả dụng — chỉ mất tính năng nhớ lựa chọn, không lỗi.
    }
    if (musicAudioRef.current) musicAudioRef.current.volume = libraryVolume / 100
  }, [libraryVolume])
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
    if (tracks.length === 0) return
    setTrack((t) => (t + delta + tracks.length) % tracks.length)
    setPlaying(true)
    setMusicSource('library')
  }
  function seekTrackTo(seconds: number) {
    const el = musicAudioRef.current
    if (el) el.currentTime = seconds
    setAudioCurrentTime(seconds)
  }
  // Cố tình luôn khởi tạo 'youtube' (không đọc từ localStorage) — mỗi lần mở app, nhạc nền
  // mặc định luôn tự phát link YouTube (đã lưu hoặc DEFAULT_YOUTUBE_URL), Thư viện chỉ là
  // lựa chọn tạm trong phiên hiện tại, không "dính" sang lần mở app kế tiếp.
  const [musicSource, setMusicSource] = useState<MusicSource>('youtube')
  // Tab đang xem trong popup "Nhạc nền" — tách riêng khỏi musicSource (nguồn đang thực sự
  // phát) để việc bấm xem tab kia (Thư viện <-> YouTube) không tự huỷ nguồn đang phát.
  // musicSource chỉ đổi khi user xác nhận (chọn 1 track ở Thư viện, hoặc bấm "Dùng"/"Phát"
  // ở YouTube) — không đổi chỉ vì bấm xem tab. Mỗi lần mở lại popup, tab hiển thị đúng theo
  // nguồn đang phát thật.
  const [activeTab, setActiveTab] = useState<MusicSource>(musicSource)
  useEffect(() => {
    if (panel === 'music') setActiveTab(musicSource)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel])
  useEffect(() => {
    const el = musicAudioRef.current
    if (!el || musicSource !== 'library' || !audioSrc) return
    if (el.src !== audioSrc) {
      el.src = audioSrc
      setAudioCurrentTime(0)
      setAudioDuration(0)
    }
    if (playing) el.play().catch(() => {})
    else el.pause()
  }, [musicSource, audioSrc, playing])
  useEffect(() => {
    if (musicSource !== 'library') musicAudioRef.current?.pause()
  }, [musicSource])

  // Nhạc YouTube — chế độ solo nên không cần đồng bộ vị trí phát qua nhiều máy như Room,
  // chỉ cần play/pause theo đúng state `playing` đã có sẵn cho nhạc thư viện.
  // 3 tầng ưu tiên: link đã dán/áp dụng trên máy này (localStorage) > link mặc định riêng
  // đặt ở Settings (profiles.default_youtube_url, chỉ có khi đăng nhập) > DEFAULT_YOUTUBE_URL.
  const [youtubeUrlOverride, setYoutubeUrlOverride] = useState(loadStoredYoutubeUrlOverride)
  const [profileDefaultYoutubeUrl, setProfileDefaultYoutubeUrl] = useState<string | null>(null)
  useEffect(() => {
    if (youtubeUrlOverride === null) return
    try {
      localStorage.setItem(MUSIC_YOUTUBE_KEY, youtubeUrlOverride)
    } catch {
      // localStorage không khả dụng — chỉ mất tính năng nhớ lựa chọn, không lỗi.
    }
  }, [youtubeUrlOverride])
  const youtubeUrl = youtubeUrlOverride ?? profileDefaultYoutubeUrl ?? DEFAULT_YOUTUBE_URL
  const [ytInput, setYtInput] = useState('')
  const [ytError, setYtError] = useState(false)
  const [ytReady, setYtReady] = useState(false)
  const ytContainerRef = useRef<HTMLDivElement>(null)
  const ytPlayerRef = useRef<YTPlayer | null>(null)
  const ytActive = musicSource === 'youtube'
  const ytParsed = useMemo(() => (youtubeUrl ? parseYoutubeUrl(youtubeUrl) : null), [youtubeUrl])

  // Widget mini nhạc nền góc dưới-trái — dùng CHUNG 1 vị trí + 1 kiểu tương tác (thu gọn
  // thành icon tròn, bấm mở ra thanh điều khiển) cho cả 2 nguồn Thư viện/YouTube, thay vì
  // 2 cụm UI khác nhau như trước (thẻ Thư viện luôn mở nổi giữa taskbar vs icon YouTube).
  // Nội dung bên trong thanh đổi tuỳ `musicSource` đang active — xem hasActiveMusic bên dưới.
  const [musicPanelOpen, setMusicPanelOpen] = useState(false)
  // Đổi nguồn (chọn bài Thư viện, hoặc bấm "Dùng link này"/"Phát" cho YouTube ở popup "Nhạc
  // nền") thì tự MỞ panel lên luôn — user vừa chủ động chọn nhạc thì nên thấy ngay điều khiển,
  // không phải tự bấm icon lần nữa. So với giá trị `musicSource` LẦN TRƯỚC (không phải cờ
  // "đã chạy lần đầu chưa") để không mở nhầm lúc mount — StrictMode chạy effect 2 lần liên
  // tiếp với cùng 1 giá trị nên cách dùng cờ boolean đơn giản sẽ bị lật sai ở lần chạy thứ 2.
  const prevMusicSourceRef = useRef<MusicSource | null>(null)
  useEffect(() => {
    if (prevMusicSourceRef.current !== null && prevMusicSourceRef.current !== musicSource) {
      setMusicPanelOpen(true)
    }
    prevMusicSourceRef.current = musicSource
  }, [musicSource])
  // Video YouTube (400x225) chỉ hiện thêm khi user chủ động bấm mở rộng trong thanh — chỉ có
  // ý nghĩa khi nguồn đang active là YouTube (Thư viện không có video để hiện).
  const [ytVideoVisible, setYtVideoVisible] = useState(false)
  const [ytMuted, setYtMuted] = useState(false)
  const [ytVolume, setYtVolume] = useState(70)
  useEffect(() => {
    if (ytActive) ytPlayerRef.current?.setVolume(ytVolume)
  }, [ytActive, ytVolume])
  useEffect(() => {
    if (!ytActive) return
    if (ytMuted) ytPlayerRef.current?.mute()
    else ytPlayerRef.current?.unMute()
  }, [ytActive, ytMuted])
  const hasActiveMusic = (ytActive && !!ytParsed) || (musicSource === 'library' && tracks.length > 0)

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
      width: '100%',
      height: '100%',
      videoId: ytParsed.videoId || undefined,
      playerVars: { listType: ytParsed.playlistId ? 'playlist' : undefined, list: ytParsed.playlistId || undefined, playsinline: 1 },
      events: {
        // Trình duyệt có thể chặn autoplay có tiếng vì lúc này chưa có tương tác nào của user
        // trên trang (chặn ngay từ đầu, không phải lỗi mạng/link) — YouTube IFrame API không
        // bắn sự kiện lỗi riêng cho việc này, `playVideo()` gọi xong coi như thành công dù
        // thực ra không có tiếng gì. Tự kiểm tra lại trạng thái thật sau 1.2s: nếu chưa thực
        // sự "đang phát" thì đồng bộ lại `playing=false`, để lần bấm Play đầu tiên của user
        // (có gesture thật) mới là lệnh play() thành công — cùng cách đã sửa cho nhạc Thư viện
        // (Giai đoạn 8 phần 8).
        onReady: (e: { target: YTPlayer }) => {
          ytPlayerRef.current = e.target
          e.target.setVolume(ytVolume)
          if (ytMuted) e.target.mute()
          if (playing) {
            e.target.playVideo()
            setTimeout(() => {
              if (ytPlayerRef.current === e.target && e.target.getPlayerState() !== 1) setPlaying(false)
            }, 1200)
          }
        },
        // Đồng bộ tiếp sau khi đã sẵn sàng — bắt cả trường hợp user tự bấm pause/play ngay
        // trên control gốc của khung video YouTube (khi đang mở rộng xem video), không chỉ
        // qua nút Play/Pause của app.
        onStateChange: (e: { data: number }) => {
          if (e.data === 1) setPlaying(true)
          else if (e.data === 2 || e.data === 0) setPlaying(false)
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
    if (playing) player.playVideo()
    else player.pauseVideo()
  }, [ytActive, playing])

  function applyYoutubeLink() {
    const parsed = parseYoutubeUrl(ytInput)
    if (!parsed) {
      setYtError(true)
      return
    }
    setYtError(false)
    setYoutubeUrlOverride(ytInput.trim())
    setMusicSource('youtube')
    setPlaying(true)
    setYtInput('')
  }

  const [draft, setDraft] = useState('')
  const [tasks, setTasks] = useState<Task[]>(initialTasks)

  // Pomodoro defaults — 25/5 cho khách, ghi đè bằng profile thật khi đăng nhập (xem effect bên dưới).
  const [focusMin, setFocusMin] = useState(FOCUS_MINUTES)
  const [breakMin, setBreakMin] = useState(BREAK_MINUTES)
  const [sessionCount, setSessionCount] = useState(SESSION_COUNT_DEFAULT)
  const [autoStart, setAutoStart] = useState(true)
  const [editingField, setEditingField] = useState<EditField>(null)
  const [editFieldValue, setEditFieldValue] = useState('')
  const [preferredCameraId, setPreferredCameraId] = useState('')
  const [notificationSound, setNotificationSound] = useState(true)

  const runningRef = useRef(running)
  runningRef.current = running
  const endlessRunningRef = useRef(endlessRunning)
  endlessRunningRef.current = endlessRunning
  const focusMinRef = useRef(focusMin)
  focusMinRef.current = focusMin
  const breakMinRef = useRef(breakMin)
  breakMinRef.current = breakMin
  const sessionCountRef = useRef(sessionCount)
  sessionCountRef.current = sessionCount
  const roundRef = useRef(round)
  roundRef.current = round
  const autoStartRef = useRef(autoStart)
  autoStartRef.current = autoStart
  const notificationSoundRef = useRef(notificationSound)
  notificationSoundRef.current = notificationSound
  const userRef = useRef(user)
  userRef.current = user
  const phaseStartRef = useRef(Date.now())
  const endlessStartRef = useRef(Date.now())
  // true khi Focus mode + fullscreen hiện tại là do startPomodoro() tự bật (setting "auto
  // fullscreen"), để cancelPomodoro/hoàn thành tự nhiên biết đường tắt lại đúng những gì đã bật.
  const autoFocusActiveRef = useRef(false)

  function exitAutoFocusFullscreen() {
    if (!autoFocusActiveRef.current) return
    autoFocusActiveRef.current = false
    setAutoFocusFullscreen(false)
    setMode('dashboard')
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }

  // Rời khỏi Dashboard (đổi route) giữa lúc đang auto-fullscreen thì đừng để trình duyệt kẹt
  // fullscreen luôn — chỉ cần thoát fullscreen, không cần setMode vì component đã unmount.
  useEffect(() => {
    return () => {
      if (autoFocusActiveRef.current && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select(
        'focus_minutes, break_minutes, session_count, auto_start_next, preferred_camera_id, notification_sound, default_youtube_url',
      )
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setFocusMin(data.focus_minutes)
        setBreakMin(data.break_minutes)
        setSessionCount(data.session_count)
        setAutoStart(data.auto_start_next)
        setPreferredCameraId(data.preferred_camera_id ?? '')
        setNotificationSound(data.notification_sound)
        setProfileDefaultYoutubeUrl(data.default_youtube_url ?? null)
      })
  }, [user])

  // Ảnh nền riêng của tài khoản (upload ở Settings) — gộp vào cùng danh sách với hình nền
  // built-in để chọn ngay từ Dashboard, không cần qua lại Settings.
  useEffect(() => {
    if (!user) {
      setCustomWallpapers([])
      return
    }
    let cancelled = false
    supabase
      .from('wallpapers')
      .select('id, storage_path')
      .eq('user_id', user.id)
      .order('created_at')
      .then(async ({ data }) => {
        if (cancelled || !data || data.length === 0) {
          if (!cancelled) setCustomWallpapers([])
          return
        }
        const paths = data.map((r) => r.storage_path)
        const { data: signed } = await supabase.storage.from('wallpapers').createSignedUrls(paths, 3600)
        if (cancelled) return
        setCustomWallpapers(
          data
            .map((r, i) => ({
              id: r.id,
              kind: isVideoWallpaper(r.storage_path) ? ('video' as const) : ('image' as const),
              value: signed?.[i]?.signedUrl ?? '',
            }))
            .filter((w) => w.value),
        )
      })
    return () => {
      cancelled = true
    }
    // settingsOpen: cùng lý do với effect load tracks bên trên — Settings không unmount
    // Dashboard nên phải tự refetch khi đóng lại, nếu không ảnh nền mới upload sẽ không hiện
    // trong popup "Đổi hình nền" cho tới khi F5 lại trang.
  }, [user, settingsOpen])

  // Dùng chung cho hoàn thành tự nhiên (hết giờ) lẫn bấm Skip — chỉ khác nhau ở số phút ghi
  // log (đủ vs. thực tế đã trôi qua) và có tự chạy tiếp phase kế hay không.
  function advancePhaseBody(
    prevPhase: Phase,
    opts: { minutesOverride?: number; continueRunning: boolean; natural?: boolean },
  ): Phase {
    if (opts.natural && notificationSoundRef.current) playChime()
    const next: Phase = prevPhase === 'focus' ? 'break' : 'focus'
    const completedMinutes = opts.minutesOverride ?? (prevPhase === 'focus' ? focusMinRef.current : breakMinRef.current)
    const isFinalCompletion = next === 'focus' && roundRef.current >= sessionCountRef.current
    if (next === 'focus' && !isFinalCompletion) setRound((r) => r + 1)
    const uid = userRef.current?.id
    if (uid && completedMinutes > 0) {
      supabase
        .from('focus_sessions')
        .insert({
          user_id: uid,
          phase: prevPhase,
          minutes: completedMinutes,
          started_at: new Date(phaseStartRef.current).toISOString(),
          completed: !!opts.natural,
        })
        .then(({ error }) => {
          if (error) console.error('log focus_session failed', error)
        })
    }
    if (isFinalCompletion) {
      setDone(true)
      setRunning(false)
      exitAutoFocusFullscreen()
      return prevPhase
    }
    setRunning(opts.continueRunning)
    return next
  }

  useEffect(() => {
    const id = setInterval(() => {
      if (!runningRef.current) return
      setLeft((prevLeft) => {
        if (prevLeft <= 1) {
          setPhase((prevPhase) => advancePhaseBody(prevPhase, { continueRunning: autoStartRef.current, natural: true }))
          return 0 // placeholder, replaced right after via phase effect below
        }
        return prevLeft - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      if (!endlessRunningRef.current) return
      setEndlessSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  // when phase flips (either by timer completion or skip), snap `left` to the new phase's duration.
  const prevPhaseRef = useRef(phase)
  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      setLeft(phase === 'focus' ? focusMin * 60 : breakMin * 60)
      prevPhaseRef.current = phase
      phaseStartRef.current = Date.now()
    }
  }, [phase, focusMin, breakMin])

  // logged in → load real todos from Supabase; guest → keep the local mock list untouched.
  useEffect(() => {
    if (!user) {
      setTasks(initialTasks)
      return
    }
    let cancelled = false
    supabase
      .from('todos')
      .select('id, name, meta, done')
      .order('created_at')
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        setTasks(data.map((row) => ({ id: row.id, name: row.name, meta: row.meta ?? '', done: row.done })))
      })
    return () => {
      cancelled = true
    }
  }, [user, initialTasks])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // Webcam thật cho ô "Bạn" — bật/tắt là start/stop stream thật, không chỉ đổi opacity icon.
  // Ưu tiên thiết bị đã chọn ở Settings (preferredCameraId); nếu deviceId đó không còn hợp lệ
  // (máy đổi/rút thiết bị) thì fallback về camera mặc định thay vì tắt hẳn camera.
  useEffect(() => {
    if (!cameraOn) return
    let cancelled = false
    let stream: MediaStream | null = null
    const constraints: MediaStreamConstraints = preferredCameraId
      ? { video: { deviceId: { exact: preferredCameraId } } }
      : { video: true }
    navigator.mediaDevices
      .getUserMedia(constraints)
      .catch((error) => {
        if (!preferredCameraId) throw error
        console.error('preferred camera unavailable, falling back to default', error)
        return navigator.mediaDevices.getUserMedia({ video: true })
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((track) => track.stop())
          return
        }
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      })
      .catch((error) => {
        console.error('camera access failed', error)
        if (!cancelled) setCameraOn(false)
      })
    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [cameraOn, preferredCameraId])

  const total = phase === 'focus' ? focusMin * 60 : breakMin * 60
  const showProgressRing = timerType === 'pomodoro' && pomodoroStarted && !done
  const progress = showProgressRing ? Math.min(1, Math.max(0, 1 - left / total)) : 0
  const dashOffset = 917.3 * (1 - progress)

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage === 'vi' ? 'vi-VN' : 'en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
    [i18n.resolvedLanguage],
  )
  const clockDateText = dateFormatter.format(now)
  const clockTimeText = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')

  const isFocus = mode === 'focus'
  const dashVisible = !isFocus

  const openCount = tasks.filter((task) => !task.done).length
  const active = tasks.find((task) => !task.done)

  function toggleRun() {
    setRunning((r) => !r)
  }

  function resetToIdle() {
    setRunning(false)
    setDone(false)
    setPhase('focus')
    setRound(1)
    setLeft(focusMin * 60)
    phaseStartRef.current = Date.now()
    setPomodoroStarted(false)
  }

  function startPomodoro() {
    setDone(false)
    setPhase('focus')
    setRound(1)
    setLeft(focusMin * 60)
    setRunning(true)
    phaseStartRef.current = Date.now()
    setPomodoroStarted(true)
    if (loadStoredAutoFullscreenFocus()) {
      autoFocusActiveRef.current = true
      setAutoFocusFullscreen(true)
      setMode('focus')
      // Phải gọi trực tiếp trong handler click (user gesture) thì Fullscreen API mới cho phép,
      // gọi trong .then()/setTimeout sẽ bị trình duyệt từ chối.
      void document.documentElement.requestFullscreen?.().catch(() => {})
    }
  }

  // Huỷ giữa chừng vẫn ghi lại phần thời gian học đã trôi qua (nếu đang ở phase focus) —
  // đúng ghi chú của user: "thời gian học mỗi ngày dựa trên timer đã chạy", không chỉ tính
  // các phiên hoàn thành trọn vẹn.
  function cancelPomodoro() {
    const uid = userRef.current?.id
    if (uid && phase === 'focus' && !done) {
      const elapsedMinutes = Math.round((focusMin * 60 - left) / 60)
      if (elapsedMinutes > 0) {
        supabase
          .from('focus_sessions')
          .insert({
            user_id: uid,
            phase: 'focus',
            minutes: elapsedMinutes,
            started_at: new Date(phaseStartRef.current).toISOString(),
            completed: false,
          })
          .then(({ error }) => {
            if (error) console.error('log focus_session failed', error)
          })
      }
    }
    resetToIdle()
    exitAutoFocusFullscreen()
  }

  function backToSetup() {
    resetToIdle()
  }

  // Bỏ qua phase hiện tại: ghi log đúng số phút ĐÃ trôi qua (không phải trọn vẹn cấu hình),
  // rồi luôn tự chạy tiếp phase kế (khác hoàn thành tự nhiên, vốn phụ thuộc "tự động bắt đầu").
  function skipPhase() {
    const totalSec = (phase === 'focus' ? focusMin : breakMin) * 60
    const elapsedMinutes = Math.round((totalSec - left) / 60)
    setPhase((prevPhase) => advancePhaseBody(prevPhase, { minutesOverride: elapsedMinutes, continueRunning: true }))
  }

  function startEndless() {
    setEndlessSeconds(0)
    setEndlessRunning(true)
    setEndlessStarted(true)
    endlessStartRef.current = Date.now()
  }

  function toggleEndlessRun() {
    setEndlessRunning((r) => !r)
  }

  function cancelEndless() {
    const uid = userRef.current?.id
    const elapsedMinutes = Math.round(endlessSeconds / 60)
    if (uid && elapsedMinutes > 0) {
      supabase
        .from('focus_sessions')
        .insert({
          user_id: uid,
          phase: 'focus',
          minutes: elapsedMinutes,
          started_at: new Date(endlessStartRef.current).toISOString(),
          completed: false,
        })
        .then(({ error }) => {
          if (error) console.error('log focus_session failed', error)
        })
    }
    setEndlessRunning(false)
    setEndlessStarted(false)
    setEndlessSeconds(0)
  }

  function persistFocusBreak(nextFocus: number, nextBreak: number) {
    if (!userRef.current) return
    supabase
      .from('profiles')
      .update({ focus_minutes: nextFocus, break_minutes: nextBreak })
      .eq('id', userRef.current.id)
      .then(({ error }) => {
        if (error) console.error('update focus/break minutes failed', error)
      })
  }

  function persistSessionCount(next: number) {
    if (!userRef.current) return
    supabase
      .from('profiles')
      .update({ session_count: next })
      .eq('id', userRef.current.id)
      .then(({ error }) => {
        if (error) console.error('update session_count failed', error)
      })
  }

  // Chỉ dùng ở màn hình cài đặt (chưa bấm Play) — Work/Break/Loop chỉnh độc lập, không đụng
  // tới timer đang đếm vì lúc này chưa có timer nào đang chạy.
  function nudgeFocusMinutes(delta: number) {
    const next = Math.min(120, Math.max(5, focusMin + delta))
    setFocusMin(next)
    persistFocusBreak(next, breakMin)
  }

  function nudgeBreakMinutes(delta: number) {
    const next = Math.min(20, Math.max(1, breakMin + delta))
    setBreakMin(next)
    persistFocusBreak(focusMin, next)
  }

  function nudgeLoopCount(delta: number) {
    const next = Math.min(12, Math.max(1, sessionCount + delta))
    setSessionCount(next)
    setRound((r) => Math.min(r, next))
    persistSessionCount(next)
  }

  function beginEditField(field: Exclude<EditField, null>) {
    const current = field === 'loop' ? sessionCount : field === 'work' ? focusMin : breakMin
    setEditFieldValue(String(current))
    setEditingField(field)
  }

  function commitEditField() {
    const parsed = parseInt(editFieldValue, 10)
    if (!Number.isNaN(parsed)) {
      if (editingField === 'loop') nudgeLoopCount(parsed - sessionCount)
      else if (editingField === 'work') nudgeFocusMinutes(parsed - focusMin)
      else if (editingField === 'break') nudgeBreakMinutes(parsed - breakMin)
    }
    setEditingField(null)
  }

  function togglePanel(p: Exclude<Panel, null>) {
    setPanel((cur) => (cur === p ? null : p))
  }

  async function addTask() {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    const newTaskMeta = t('dashboard.todoPanel.newTaskMeta')
    if (!user) {
      setTasks((ts) => [...ts, { id: 'g' + Date.now(), name, meta: newTaskMeta, done: false }])
      return
    }
    const { data, error } = await supabase
      .from('todos')
      .insert({ user_id: user.id, name, meta: newTaskMeta })
      .select('id, name, meta, done')
      .single()
    if (!error && data) {
      setTasks((ts) => [...ts, { id: data.id, name: data.name, meta: data.meta ?? '', done: data.done }])
    }
  }

  function toggleTask(task: Task) {
    const nextDone = !task.done
    setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, done: nextDone } : x)))
    if (user) {
      supabase
        .from('todos')
        .update({ done: nextDone, completed_at: nextDone ? new Date().toISOString() : null })
        .eq('id', task.id)
        .then(({ error }) => {
          if (error) console.error('toggle todo failed', error)
        })
    }
  }

  const dashStyleBase = {
    opacity: dashVisible ? 1 : 0,
    pointerEvents: dashVisible ? ('auto' as const) : ('none' as const),
  }

  return (
    <div
      className="relative h-svh w-full overflow-hidden bg-cover bg-center font-sans text-[#33475e] antialiased"
      style={{
        backgroundImage:
          selectedWallpaper.kind === 'gradient'
            ? selectedWallpaper.value
            : selectedWallpaper.kind === 'image'
              ? `url(${selectedWallpaper.value})`
              : undefined,
        transition: 'background-image 900ms ease',
      }}
    >
      {/* wallpaper video — .mp4 không gán được qua CSS `background-image` như ảnh/gradient nên
          render riêng bằng thẻ <video>, phủ kín màn hình ngay dưới lớp phủ màu bên dưới. `key`
          theo id để React remount hẳn thẻ <video> khi đổi giữa 2 video khác nhau thay vì chỉ đổi
          `src` (đổi src không tự load lại đáng tin cậy ở mọi trình duyệt). */}
      {selectedWallpaper.kind === 'video' && (
        <video
          key={selectedWallpaper.id}
          className="absolute inset-0 h-full w-full object-cover"
          src={selectedWallpaper.value}
          autoPlay
          loop
          muted
          playsInline
          // `loop` thường tự lo việc này, nhưng thêm chốt chặn thủ công phòng trường hợp trình
          // duyệt/codec không tự seek lại về đầu đáng tin cậy (từng gặp với video nặng/độ phân
          // giải cao) — video "đứng hình" ở khung cuối thay vì chạy lại.
          onEnded={(e) => {
            e.currentTarget.currentTime = 0
            e.currentTarget.play().catch(() => {})
          }}
        />
      )}
      <audio ref={musicAudioRef} loop style={{ display: 'none' }} />

      {/* mini player nhạc nền — góc dưới-trái, 1 vị trí + 1 kiểu tương tác (thu gọn thành icon
          tròn, bấm mở ra thanh điều khiển) dùng chung cho cả Thư viện lẫn YouTube, nội dung
          thanh đổi theo `musicSource` đang active (xem hasActiveMusic). Video YouTube (iframe)
          LUÔN mounted khi đang là nguồn active, kể cả lúc panel đóng — KHÔNG unmount, chỉ co
          kích thước + opacity về gần 0, để nhạc không bao giờ bị ngắt (đúng ToS nhúng của
          YouTube). Video 400x225 chỉ hiện thêm khi bấm nút mở rộng riêng trong thanh. */}
      {hasActiveMusic && (
        <div
          className="absolute z-[41] flex flex-col items-start"
          style={{ bottom: '34px', left: '26px', gap: musicPanelOpen && ytActive && ytVideoVisible ? '8px' : '0px' }}
        >
          {ytActive && ytParsed && (
            <div
              className="overflow-hidden rounded-[18px] transition-all duration-300"
              style={{
                width: musicPanelOpen && ytVideoVisible ? 'clamp(200px, 30vw, 400px)' : '1px',
                aspectRatio: '16 / 9',
                opacity: musicPanelOpen && ytVideoVisible ? 1 : 0,
                pointerEvents: musicPanelOpen && ytVideoVisible ? 'auto' : 'none',
                background: 'rgba(0,0,0,0.85)',
                boxShadow: musicPanelOpen && ytVideoVisible ? '0 10px 26px rgba(20,30,40,0.28)' : 'none',
              }}
            >
              <div ref={ytContainerRef} className="block h-full w-full" />
            </div>
          )}

          <div>
            {!musicPanelOpen ? (
              <button
                onClick={() => setMusicPanelOpen(true)}
                title={t('dashboard.musicMini.open')}
                aria-label={t('dashboard.musicMini.open')}
                className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px rgba(58,98,126,0.14)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V6l10-2v12" />
                  <circle cx="6.5" cy="18" r="2.5" />
                  <circle cx="16.5" cy="16" r="2.5" />
                </svg>
                {playing && (
                  <span
                    className="absolute right-[3px] bottom-[3px] h-[9px] w-[9px] rounded-full"
                    style={{ background: '#4bbf9a', boxShadow: '0 0 0 2px rgba(255,255,255,0.85)' }}
                  />
                )}
              </button>
            ) : ytActive ? (
              <div
                className="flex items-center gap-[4px] rounded-full py-[8px] pr-[12px] pl-[8px]"
                style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px rgba(58,98,126,0.14)' }}
              >
                <button
                  onClick={() => {
                    setMusicPanelOpen(false)
                    setYtVideoVisible(false)
                  }}
                  title={t('dashboard.musicMini.collapse')}
                  aria-label={t('dashboard.musicMini.collapse')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-200 hover:!bg-white"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V6l10-2v12" />
                    <circle cx="6.5" cy="18" r="2.5" />
                    <circle cx="16.5" cy="16" r="2.5" />
                  </svg>
                </button>
                <button
                  onClick={() => setPlaying((p) => !p)}
                  title={playing ? t('dashboard.musicPopup.pause') : t('dashboard.musicPopup.play')}
                  aria-label={playing ? t('dashboard.musicPopup.pause') : t('dashboard.musicPopup.play')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-200 hover:!bg-white"
                >
                  {playing ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="5" width="4" height="14" />
                      <rect x="14" y="5" width="4" height="14" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => setYtMuted((m) => !m)}
                  title={ytMuted ? t('dashboard.musicMini.unmute') : t('dashboard.musicMini.mute')}
                  aria-label={ytMuted ? t('dashboard.musicMini.unmute') : t('dashboard.musicMini.mute')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-200 hover:!bg-white"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
                    <path d={ytMuted ? 'M15.5 9.5l4 5m0-5l-4 5' : 'M15.5 9a4 4 0 010 6'} />
                  </svg>
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={ytVolume}
                  onChange={(e) => setYtVolume(Number(e.target.value))}
                  title={t('dashboard.musicPopup.volume')}
                  aria-label={t('dashboard.musicPopup.volume')}
                  className="ff-range"
                  style={{ width: '64px' }}
                />
                <button
                  onClick={() => setYtVideoVisible((v) => !v)}
                  title={ytVideoVisible ? t('dashboard.musicMini.hideVideo') : t('dashboard.musicMini.showVideo')}
                  aria-label={ytVideoVisible ? t('dashboard.musicMini.hideVideo') : t('dashboard.musicMini.showVideo')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-200 hover:!bg-white"
                  style={{ background: ytVideoVisible ? 'rgba(255,255,255,0.85)' : 'transparent' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M9.5 9v6l5-3z" fill="currentColor" stroke="none" />
                  </svg>
                </button>
              </div>
            ) : (
              <div
                className="flex w-[280px] max-w-[calc(100vw-52px)] flex-col gap-[8px] rounded-[22px] px-4 py-3"
                style={{ background: 'rgba(255,255,255,0.66)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px rgba(58,98,126,0.14)' }}
              >
                <span className="truncate text-[13px] font-bold text-[#2f4459]" title={tracks[track]?.name}>
                  {tracks[track]?.name}
                </span>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setMusicPanelOpen(false)}
                    title={t('dashboard.musicMini.collapse')}
                    aria-label={t('dashboard.musicMini.collapse')}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-200 hover:!bg-white"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V6l10-2v12" />
                      <circle cx="6.5" cy="18" r="2.5" />
                      <circle cx="16.5" cy="16" r="2.5" />
                    </svg>
                  </button>
                  <button
                    onClick={() => playRelativeTrack(-1)}
                    title={t('dashboard.musicPopup.prevTrack')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'rgba(255,255,255,0.6)' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="5" y="5" width="3" height="14" />
                      <path d="M18 5v14l-8-7z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setPlaying((p) => !p)}
                    title={playing ? t('dashboard.musicPopup.pause') : t('dashboard.musicPopup.play')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#21384f] transition-transform duration-200 hover:-translate-y-0.5"
                    style={{ background: 'rgba(140,205,196,0.45)' }}
                  >
                    {playing ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="5" width="4" height="14" />
                        <rect x="14" y="5" width="4" height="14" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => playRelativeTrack(1)}
                    title={t('dashboard.musicPopup.nextTrack')}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'rgba(255,255,255,0.6)' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 5v14l8-7z" />
                      <rect x="16" y="5" width="3" height="14" />
                    </svg>
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={libraryVolume}
                    onChange={(e) => setLibraryVolume(Number(e.target.value))}
                    title={t('dashboard.musicPopup.volume')}
                    aria-label={t('dashboard.musicPopup.volume')}
                    className="ff-range"
                    style={{ width: '52px' }}
                  />
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
              </div>
            )}
          </div>
        </div>
      )}

      {/* lớp phủ nền — trắng mờ + blur nhẹ hợp với 6 gradient pastel, nhưng phủ lên ảnh/video thật
          thì làm xám/mất chi tiết; ảnh/video thật dùng lớp tối rất nhẹ thay thế, không blur, để
          giữ màu gốc mà card kính trắng vẫn nổi rõ. */}
      <div
        className="absolute inset-0"
        style={
          selectedWallpaper.kind === 'image' || selectedWallpaper.kind === 'video'
            ? { background: 'rgba(8,20,24,0.12)' }
            : { backdropFilter: 'blur(2px)', background: 'rgba(255,255,255,0.14)' }
        }
      />

      {/* top bar — chỉ còn tên app + toggle Focus/Dashboard. Hide UI (Zen mode) và VI/EN đã bỏ
          khỏi đây (2026-08-06): Hide UI bị coi là dư thừa (làm gần như đúng việc tab Focus đã
          làm — ẩn bớt widget), còn đổi ngôn ngữ giờ CHỈ làm trong Cài đặt (Settings.tsx đã có
          sẵn khối "language" y hệt UI cũ ở đây), tránh trùng chỗ chỉnh. */}
      <div
        className="absolute top-[26px] right-8 left-8 z-40 flex flex-wrap items-center justify-between gap-4"
        style={{
          opacity: autoFocusFullscreen ? 0 : 1,
          pointerEvents: autoFocusFullscreen ? 'none' : 'auto',
          transform: `translateY(${autoFocusFullscreen ? '-16px' : '0px'})`,
          transition: 'opacity 480ms ease, transform 480ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div
          className="flex items-center gap-[11px] rounded-[22px] py-[9px] pr-[18px] pl-[13px]"
          style={{
            background: 'rgba(255,255,255,0.6)',
            boxShadow: '0 6px 20px rgba(64,102,128,0.09)',
            backdropFilter: 'blur(14px)',
          }}
        >
          <div
            className="h-5 w-5 rounded-lg"
            style={{
              background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))',
            }}
          />
          <span className="text-base font-extrabold tracking-[-0.2px] text-[#2f4459]">
            {t('app.name')}
          </span>
          <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
            · {isFocus ? t('dashboard.topbar.focusMode') : t('dashboard.topbar.dashboardMode')}
          </span>
        </div>

        <div className="flex items-center gap-[10px]">
          {!user && (
            <Link
              to="/auth"
              className="rounded-[18px] px-4 py-[10px] font-sans text-[13px] font-extrabold text-[#1e3549] no-underline"
              style={{
                background: 'var(--ff-accent-soft)',
                boxShadow: '0 6px 20px rgba(64,102,128,0.09)',
              }}
            >
              {t('dashboard.topbar.login')}
            </Link>
          )}
          <div
            className="flex gap-1 rounded-[20px] p-[5px]"
            style={{
              background: 'rgba(255,255,255,0.6)',
              boxShadow: '0 6px 20px rgba(64,102,128,0.09)',
              backdropFilter: 'blur(14px)',
            }}
          >
            <button
              onClick={() => {
                setMode('focus')
                setPanel(null)
              }}
              className="rounded-[15px] border-none px-4 py-2 font-sans text-[13px] font-bold transition-all duration-[260ms]"
              style={{
                background: isFocus ? 'rgba(255,255,255,0.95)' : 'transparent',
                color: isFocus ? '#25415c' : 'rgba(51,71,94,0.55)',
              }}
            >
              {t('dashboard.topbar.tabFocus')}
            </button>
            <button
              onClick={() => setMode('dashboard')}
              className="rounded-[15px] border-none px-4 py-2 font-sans text-[13px] font-bold transition-all duration-[260ms]"
              style={{
                background: !isFocus ? 'rgba(255,255,255,0.95)' : 'transparent',
                color: !isFocus ? '#25415c' : 'rgba(51,71,94,0.55)',
              }}
            >
              {t('dashboard.topbar.tabDashboard')}
            </button>
          </div>
        </div>
      </div>

      {/* clock */}
      <div
        className="relative flex h-full flex-col items-center justify-center px-6 pt-[104px] pb-[152px]"
        style={{ gap: 'clamp(14px, 3vh, 24px)' }}
      >
        <div
          className="group relative flex items-center justify-center"
          style={{
            transform: `scale(${isFocus ? 1 : 0.78})`,
            transition: 'transform 620ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <div
            className="absolute rounded-full"
            style={{
              width: 'min(450px, 62vh, 92vw)',
              height: 'min(450px, 62vh, 92vw)',
              background: 'rgba(255,255,255,0.42)',
              backdropFilter: 'blur(18px)',
              boxShadow: '0 24px 70px rgba(58,98,126,0.14)',
            }}
          />
          <svg
            viewBox="0 0 330 330"
            className="relative"
            style={{
              width: 'min(400px, 56vh, 84vw)',
              height: 'min(400px, 56vh, 84vw)',
              transform: 'rotate(-90deg)',
            }}
          >
            <circle
              cx="165"
              cy="165"
              r="146"
              fill="none"
              stroke="rgba(255,255,255,0.65)"
              strokeWidth="14"
            />
            {showProgressRing && (
              <circle
                cx="165"
                cy="165"
                r="146"
                fill="none"
                stroke={ACCENT}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray="917.3"
                style={{ strokeDashoffset: dashOffset, transition: 'stroke-dashoffset 980ms linear' }}
              />
            )}
          </svg>
          <div className="absolute flex flex-col items-center gap-3 px-4 text-center">
            {timerType === 'pomodoro' ? (
              !pomodoroStarted ? (
                <>
                  <div className="flex flex-col items-center gap-[6px]">
                    <span className="text-[13px] font-extrabold tracking-[1.2px] text-[rgba(51,71,94,0.62)] uppercase">
                      {t('dashboard.clock.loopLabel')}
                    </span>
                    <div className="flex items-center">
                      <div className="h-9 w-0 shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-out group-hover:mr-[14px] group-hover:w-9 focus-within:mr-[14px] focus-within:w-9">
                        <button
                          onClick={() => nudgeLoopCount(-1)}
                          aria-label="-"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#3c5470] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'rgba(255,255,255,0.85)' }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M15 6l-6 6 6 6" />
                          </svg>
                        </button>
                      </div>
                      {editingField === 'loop' ? (
                        <input
                          autoFocus
                          type="number"
                          value={editFieldValue}
                          onChange={(e) => setEditFieldValue(e.target.value)}
                          onBlur={commitEditField}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEditField()
                            if (e.key === 'Escape') setEditingField(null)
                          }}
                          className="rounded-lg border-none text-center text-3xl font-extrabold text-[#2c3f55] tabular-nums outline-none"
                          style={{ width: '1.5em', background: 'rgba(255,255,255,0.7)' }}
                        />
                      ) : (
                        <span
                          onClick={() => beginEditField('loop')}
                          title={t('dashboard.clock.editHint')}
                          className="cursor-pointer text-3xl font-extrabold text-[#2c3f55] tabular-nums transition-opacity duration-200 hover:opacity-70"
                        >
                          {sessionCount}
                        </span>
                      )}
                      <div className="h-9 w-0 shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-out group-hover:ml-[14px] group-hover:w-9 focus-within:ml-[14px] focus-within:w-9">
                        <button
                          onClick={() => nudgeLoopCount(1)}
                          aria-label="+"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#3c5470] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'rgba(255,255,255,0.85)' }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-9">
                    <div className="flex w-[76px] flex-col items-center">
                      <span className="mb-[6px] text-[13px] font-extrabold tracking-[1.2px] text-[rgba(51,71,94,0.62)] uppercase">
                        {t('dashboard.clock.workLabel')}
                      </span>
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mb-[6px] group-hover:h-9 focus-within:mb-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeFocusMinutes(5)}
                          aria-label="+"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#3c5470] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'rgba(255,255,255,0.85)' }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 15l6-6 6 6" />
                          </svg>
                        </button>
                      </div>
                      {editingField === 'work' ? (
                        <input
                          autoFocus
                          type="number"
                          value={editFieldValue}
                          onChange={(e) => setEditFieldValue(e.target.value)}
                          onBlur={commitEditField}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEditField()
                            if (e.key === 'Escape') setEditingField(null)
                          }}
                          className="rounded-2xl border-none text-center font-extrabold text-[#2c3f55] tabular-nums outline-none"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)', width: '2em', background: 'rgba(255,255,255,0.7)' }}
                        />
                      ) : (
                        <span
                          onClick={() => beginEditField('work')}
                          title={t('dashboard.clock.editHint')}
                          className="cursor-pointer leading-none font-extrabold text-[#2c3f55] tabular-nums transition-opacity duration-200 hover:opacity-70"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)' }}
                        >
                          {focusMin}
                        </span>
                      )}
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mt-[6px] group-hover:h-9 focus-within:mt-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeFocusMinutes(-5)}
                          aria-label="-"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#3c5470] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'rgba(255,255,255,0.85)' }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex w-[76px] flex-col items-center">
                      <span className="mb-[6px] text-[13px] font-extrabold tracking-[1.2px] text-[rgba(51,71,94,0.62)] uppercase">
                        {t('dashboard.clock.breakColumnLabel')}
                      </span>
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mb-[6px] group-hover:h-9 focus-within:mb-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeBreakMinutes(1)}
                          aria-label="+"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#3c5470] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'rgba(255,255,255,0.85)' }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 15l6-6 6 6" />
                          </svg>
                        </button>
                      </div>
                      {editingField === 'break' ? (
                        <input
                          autoFocus
                          type="number"
                          value={editFieldValue}
                          onChange={(e) => setEditFieldValue(e.target.value)}
                          onBlur={commitEditField}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEditField()
                            if (e.key === 'Escape') setEditingField(null)
                          }}
                          className="rounded-2xl border-none text-center font-extrabold text-[#2c3f55] tabular-nums outline-none"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)', width: '2em', background: 'rgba(255,255,255,0.7)' }}
                        />
                      ) : (
                        <span
                          onClick={() => beginEditField('break')}
                          title={t('dashboard.clock.editHint')}
                          className="cursor-pointer leading-none font-extrabold text-[#2c3f55] tabular-nums transition-opacity duration-200 hover:opacity-70"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)' }}
                        >
                          {breakMin}
                        </span>
                      )}
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mt-[6px] group-hover:h-9 focus-within:mt-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeBreakMinutes(-1)}
                          aria-label="-"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#3c5470] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'rgba(255,255,255,0.85)' }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={startPomodoro}
                    title={t('dashboard.controls.start')}
                    className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full border-none text-[#21384f] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(58,98,126,0.18)]"
                    style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 26px rgba(58,98,126,0.14)' }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                </>
              ) : done ? (
                <>
                  <span className="text-[13px] font-bold tracking-[1.6px] text-[rgba(51,71,94,0.55)] uppercase">
                    {t('dashboard.clock.doneTitle')}
                  </span>
                  <span className="leading-none" style={{ fontSize: 'clamp(36px, 7vh, 60px)' }}>
                    🎉
                  </span>
                  <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
                    {t('dashboard.clock.doneHint', { count: sessionCount })}
                  </span>
                  <button
                    onClick={backToSetup}
                    className="mt-1 rounded-[22px] border-none px-[26px] py-[13px] font-sans text-[15px] font-extrabold text-[#21384f] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(58,98,126,0.18)]"
                    style={{ background: 'rgba(255,255,255,0.82)', boxShadow: '0 10px 26px rgba(58,98,126,0.14)' }}
                  >
                    {t('dashboard.controls.newRound')}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[13px] font-bold text-[rgba(51,71,94,0.5)] tabular-nums">
                    {round}/{sessionCount}
                  </span>
                  <span className="text-[13px] font-bold tracking-[1.6px] text-[rgba(51,71,94,0.55)] uppercase">
                    {phase === 'focus' ? t('dashboard.clock.focusing') : t('dashboard.clock.onBreak')}
                  </span>
                  <span
                    className="leading-none font-extrabold text-[#2c3f55] tabular-nums"
                    style={{ fontSize: 'clamp(34px, 7.5vh, 60px)', letterSpacing: '-2px' }}
                  >
                    {fmtHMS(left)}
                  </span>
                  <div className="mt-1 flex items-center gap-4">
                    <button
                      onClick={cancelPomodoro}
                      title={t('dashboard.controls.cancel')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                      style={{ background: 'rgba(255,255,255,0.6)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </button>
                    <button
                      onClick={toggleRun}
                      title={running ? t('dashboard.controls.pause') : t('dashboard.controls.resume')}
                      className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border-none text-[#21384f] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5"
                      style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 26px rgba(58,98,126,0.14)' }}
                    >
                      {running ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" />
                          <rect x="14" y="5" width="4" height="14" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                    <button
                      onClick={skipPhase}
                      title={t('dashboard.controls.skip')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                      style={{ background: 'rgba(255,255,255,0.6)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 5v14l8-7z" />
                        <rect x="16" y="5" width="3" height="14" />
                      </svg>
                    </button>
                  </div>
                </>
              )
            ) : !endlessStarted ? (
              <>
                <span
                  className="leading-none font-extrabold text-[#2c3f55] tabular-nums"
                  style={{ fontSize: 'clamp(34px, 7.5vh, 60px)', letterSpacing: '-2px' }}
                >
                  {fmtHMS(0)}
                </span>
                <button
                  onClick={startEndless}
                  title={t('dashboard.controls.start')}
                  className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full border-none text-[#21384f] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_rgba(58,98,126,0.18)]"
                  style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 26px rgba(58,98,126,0.14)' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <span
                  className="leading-none font-extrabold text-[#2c3f55] tabular-nums"
                  style={{ fontSize: 'clamp(34px, 7.5vh, 60px)', letterSpacing: '-2px' }}
                >
                  {fmtHMS(endlessSeconds)}
                </span>
                <div className="mt-1 flex items-center gap-4">
                  <button
                    onClick={cancelEndless}
                    title={t('dashboard.controls.cancel')}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'rgba(255,255,255,0.6)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                  <button
                    onClick={toggleEndlessRun}
                    title={endlessRunning ? t('dashboard.controls.pause') : t('dashboard.controls.resume')}
                    className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border-none text-[#21384f] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5"
                    style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 26px rgba(58,98,126,0.14)' }}
                  >
                    {endlessRunning ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="5" width="4" height="14" />
                        <rect x="14" y="5" width="4" height="14" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* chuyển đổi Pomodoro / Endless — chỉ hiện ở màn hình cài đặt trước khi bấm Play */}
        <div
          className="flex items-center gap-3"
          style={{
            opacity: (timerType === 'pomodoro' ? !pomodoroStarted : !endlessStarted) ? 1 : 0,
            pointerEvents: (timerType === 'pomodoro' ? !pomodoroStarted : !endlessStarted) ? 'auto' : 'none',
            transition: 'opacity 480ms ease',
          }}
        >
          <button
            onClick={() => setTimerType('pomodoro')}
            title={t('dashboard.clock.pomodoroMode')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none transition-colors duration-200"
            style={{
              background: timerType === 'pomodoro' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
              color: timerType === 'pomodoro' ? '#21384f' : 'rgba(51,71,94,0.55)',
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l3 2" />
              <path d="M9 3h6" />
            </svg>
          </button>
          <button
            onClick={() => setTimerType('endless')}
            title={t('dashboard.clock.endlessMode')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none transition-colors duration-200"
            style={{
              background: timerType === 'endless' ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.5)',
              color: timerType === 'endless' ? '#21384f' : 'rgba(51,71,94,0.55)',
            }}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="14" r="7.5" />
              <path d="M12 14V10" />
              <path d="M10 3.5h4" />
              <path d="M12 3.5V6" />
            </svg>
          </button>
        </div>
      </div>

      {/* left widgets — hidden on mobile (would overlap the right column at narrow widths) */}
      <div
        className="absolute top-24 left-8 hidden w-[232px] flex-col gap-[14px] md:flex"
        style={{
          ...dashStyleBase,
          transform: `translateX(${dashVisible ? '0px' : '-24px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div
          className="rounded-[24px] px-5 py-[18px]"
          style={{
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 10px 28px rgba(58,98,126,0.1)',
          }}
        >
          <div className="text-[13px] leading-tight font-bold text-[rgba(51,71,94,0.6)]">
            {clockDateText}
          </div>
          <div className="mt-1 text-[34px] leading-none font-extrabold text-[#2c3f55] tabular-nums">
            {clockTimeText}
          </div>
        </div>
        <div
          className="rounded-[24px] px-5 py-[18px]"
          style={{
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 10px 28px rgba(58,98,126,0.1)',
          }}
        >
          <div className="mb-[10px] text-xs font-bold tracking-[1.2px] text-[rgba(51,71,94,0.5)] uppercase">
            {t('dashboard.leftWidgets.inProgress')}
          </div>
          <div className="text-[15px] leading-[1.4] font-bold text-[#2c3f55]">
            {active ? active.name : t('dashboard.leftWidgets.allDone')}
          </div>
          <div className="mt-[6px] text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">
            {t('dashboard.leftWidgets.remaining', {
              open: openCount,
              done: tasks.length - openCount,
            })}
          </div>
        </div>
      </div>

      {/* right column — hidden on mobile, see left widgets comment */}
      <div
        className="absolute top-24 right-8 z-20 hidden w-[248px] flex-col gap-[14px] md:flex"
        style={{
          ...dashStyleBase,
          transform: `translateX(${dashVisible ? '0px' : '24px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <button
          onClick={quickStart}
          className="flex w-full items-center gap-3 rounded-[24px] px-[18px] py-[15px] text-left text-inherit transition-[transform,background] duration-[220ms] hover:!bg-white hover:!-translate-y-0.5"
          style={{
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 12px 30px rgba(58,98,126,0.14)',
          }}
        >
          <span
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] text-[#2c5b53]"
            style={{ background: 'rgba(140,205,196,0.32)' }}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            >
              <circle cx="9" cy="8.5" r="3.2" />
              <path d="M3 19c.9-3 3.3-4.4 6-4.4S14.1 16 15 19" />
              <path d="M16.4 5.6a3.2 3.2 0 010 5.8" />
              <path d="M18.6 14.9c1.4.8 2.3 2.2 2.6 4.1" />
            </svg>
          </span>
          <span className="flex flex-col gap-[2px]">
            <span className="text-sm font-extrabold text-[#2c3f55]">
              {t('dashboard.rightColumn.studyTogether')}
            </span>
            <span className="text-xs font-semibold text-[rgba(51,71,94,0.55)]">
              {t('dashboard.rightColumn.findStudyBuddy')}
            </span>
          </span>
        </button>
        <Link
          to="/matching"
          className="mt-[2px] block rounded-[16px] px-3 py-[9px] text-center text-[12.5px] font-extrabold text-[#354c65] no-underline transition-colors duration-[220ms] hover:!bg-[rgba(255,255,255,0.85)]"
          style={{ background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(14px)' }}
        >
          {t('dashboard.rightColumn.browseRooms')}
        </Link>
      </div>

      {/* taskbar */}
      <div
        className="absolute bottom-[34px] left-1/2 flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-x-auto rounded-[26px] p-[8px] md:max-w-none md:gap-2 md:p-[10px]"
        style={{
          ...dashStyleBase,
          background: 'rgba(255,255,255,0.66)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px rgba(58,98,126,0.14)',
          transform: `translate(-50%, ${dashVisible ? '0px' : '26px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <button
          onClick={() => togglePanel('wp')}
          title={t('dashboard.taskbar.wallpaperTitle')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:px-5"
          style={{ background: panel === 'wp' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <rect x="3" y="4" width="18" height="16" rx="4" />
            <circle cx="9" cy="10" r="1.8" />
            <path d="M4 18l5.5-5 4 3.4 3-2.4L20 18" />
          </svg>
          <span className="hidden md:inline">{t('dashboard.taskbar.wallpaperLabel')}</span>
        </button>
        <button
          onClick={() => togglePanel('music')}
          title={t('dashboard.taskbar.musicTitle')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:px-5"
          style={{
            background: panel === 'music' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="7" cy="17" r="3" />
            <circle cx="18" cy="15" r="3" />
            <path d="M10 17V6l11-2v11" />
          </svg>
          <span className="hidden md:inline">{t('dashboard.taskbar.musicLabel')}</span>
        </button>
        <button
          onClick={() => togglePanel('todo')}
          title={t('dashboard.taskbar.todoTitle')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:px-5"
          style={{ background: panel === 'todo' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.35)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <path d="M4 7.5l2 2 3-3.5" />
            <path d="M4 16.5l2 2 3-3.5" />
            <path d="M13 8h7" />
            <path d="M13 17h7" />
          </svg>
          <span className="hidden md:inline">{t('dashboard.taskbar.todoLabel')}</span>
          <span
            className="rounded-full px-2 py-[2px] text-xs font-extrabold text-[#2c5b53]"
            style={{ background: 'rgba(120,190,180,0.28)' }}
          >
            {openCount}
          </span>
        </button>
        <button
          onClick={quickStart}
          title={t('dashboard.taskbar.studyTogetherTitle')}
          aria-label={t('dashboard.taskbar.studyTogetherTitle')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:hidden"
          style={{ background: 'rgba(255,255,255,0.35)' }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
          >
            <circle cx="9" cy="8.5" r="3.2" />
            <path d="M3 19c.9-3 3.3-4.4 6-4.4S14.1 16 15 19" />
            <path d="M16.4 5.6a3.2 3.2 0 010 5.8" />
            <path d="M18.6 14.9c1.4.8 2.3 2.2 2.6 4.1" />
          </svg>
        </button>
        <Link
          to="/matching"
          title={t('dashboard.taskbar.browseRooms')}
          className="flex shrink-0 items-center rounded-[19px] px-3 py-3 font-sans text-[12px] font-extrabold text-[#354c65] no-underline transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:hidden"
          style={{ background: 'rgba(255,255,255,0.35)' }}
        >
          {t('dashboard.taskbar.browseRooms')}
        </Link>
        <button
          type="button"
          onClick={() => {
            if (!user) {
              navigate('/auth')
              return
            }
            setPanel(null)
            setStatsOpen(true)
          }}
          title={t('dashboard.taskbar.stats')}
          className="flex shrink-0 items-center rounded-[19px] border-none px-3 py-3 font-sans text-[12px] font-extrabold text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:hidden"
          style={{ background: 'rgba(255,255,255,0.35)' }}
        >
          {t('dashboard.taskbar.stats')}
        </button>
      </div>

      {/* bạn bè — standalone icon-only button, cạnh trái nút camera, cùng hàng cùng kiểu
          (tròn, frosted glass) với Stats/Settings/camera. Badge đỏ hiện số lời mời kết bạn
          đang chờ, lấy từ friendNotifications store (subscribe realtime ở App.tsx). */}
      <button
        onClick={() => {
          if (!user) {
            navigate('/auth')
            return
          }
          setPanel(null)
          setFriendsOpen(true)
        }}
        title={t('dashboard.taskbar.friendsTitle')}
        aria-label={t('dashboard.taskbar.friendsTitle')}
        className="absolute right-[180px] bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:right-[200px]"
        style={{
          ...dashStyleBase,
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'rgba(255,255,255,0.66)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px rgba(58,98,126,0.14)',
          transform: `translateY(${dashVisible ? '0px' : '26px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="3" />
          <circle cx="16.5" cy="9" r="2.4" />
          <path d="M2.3 19c.6-3.3 2.8-5 5.7-5s5.1 1.7 5.7 5" />
          <path d="M14.5 14.3c2.2.3 3.7 1.8 4.2 4.2" />
        </svg>
        {pendingFriendRequestCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white"
            style={{ background: '#c0524a' }}
          >
            {pendingFriendRequestCount > 9 ? '9+' : pendingFriendRequestCount}
          </span>
        )}
      </button>

      {/* camera — đặt NGANG HÀNG với Stats/Settings (góc phải dưới), không gộp chung 1 khối,
          chỉ để nó có "chỗ dựa" cùng cụm icon thay vì đứng trơ trọi một mình như trước (từng
          nằm riêng ở đầu cột phải). Icon này LUÔN hiện ở đây (kể cả khi BẬT) — trước đó bị ẩn
          đi lúc bật, làm hàng icon tụt còn 2 cái trông như thiếu — giờ chỉ đổi hình (có gạch
          chéo khi tắt, chấm xanh khi bật) và bấm để bật/tắt, y như 1 toggle bình thường. Lúc
          BẬT, khung preview bung thêm lên phía trên đúng vị trí này — cùng cơ chế "bung lên
          trên từ 1 điểm neo" mà popup Wallpaper/Music/To-do đang dùng với taskbar. */}
      <button
        onClick={() => setCameraOn((c) => !c)}
        title={t(cameraOn ? 'dashboard.rightColumn.turnOffCamera' : 'dashboard.rightColumn.turnOnCamera')}
        aria-label={t(cameraOn ? 'dashboard.rightColumn.turnOffCamera' : 'dashboard.rightColumn.turnOnCamera')}
        className="absolute right-[124px] bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:right-[144px]"
        style={{
          ...dashStyleBase,
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'rgba(255,255,255,0.66)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px rgba(58,98,126,0.14)',
          transform: `translateY(${dashVisible ? '0px' : '26px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="12" height="12" rx="2.5" />
          <path d="M15 10.5l6-3.3v9.6l-6-3.3" />
          {!cameraOn && <path d="M3 3l18 18" />}
        </svg>
        {cameraOn && (
          <span
            className="absolute right-[3px] bottom-[3px] h-[9px] w-[9px] rounded-full"
            style={{ background: '#4bbf9a', boxShadow: '0 0 0 2px rgba(255,255,255,0.85)' }}
          />
        )}
      </button>
      {cameraOn && (
        <div
          // KHÔNG ẩn theo `panel` (khác Stats/Settings/icon camera lúc tắt) — user báo mở popup
          // Wallpaper/Music/To-do làm khung camera đang bật biến mất đột ngột, để lại chỗ trống
          // trông trống trải. Camera đang BẬT thì giữ hiển thị liên tục, chỉ ẩn theo `dashVisible`
          // (đúng lúc chuyển sang Focus mode — khi đó mọi thứ khác cũng ẩn theo, nhất quán).
          className="absolute right-3 bottom-[90px] w-[214px] rounded-[24px] p-3 md:right-8"
          style={{
            ...dashStyleBase,
            background: 'rgba(255,255,255,0.62)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 10px 28px rgba(58,98,126,0.1)',
            transform: `translateY(${dashVisible ? '0px' : '26px'})`,
            transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <div
            className="relative flex h-[148px] items-center justify-center overflow-hidden rounded-[18px]"
            style={{ background: 'linear-gradient(150deg, oklch(0.86 0.045 205), oklch(0.79 0.055 235))' }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
            />
            <div
              className="absolute top-[10px] left-[10px] flex items-center gap-[6px] rounded-full px-[9px] py-1 text-[11px] font-extrabold tracking-[0.4px] text-[#2c3f55]"
              style={{ background: 'rgba(255,255,255,0.82)' }}
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: '#4bbf9a' }} />
              {t('dashboard.rightColumn.you')}
            </div>
          </div>
          <button
            onClick={() => setCameraOn(false)}
            className="mt-[10px] w-full rounded-[15px] border-none py-[10px] font-sans text-[13px] font-extrabold text-[#2c3f55] transition-colors duration-[220ms] hover:!bg-white"
            style={{ background: 'rgba(255,255,255,0.72)' }}
          >
            {t('dashboard.rightColumn.turnOffCamera')}
          </button>
        </div>
      )}

      {/* stats — standalone icon-only button, ngay cạnh trái nút Cài đặt, cùng hàng cùng
          kiểu (tròn, frosted glass) — thay cho link text "Stats" trước đây nằm rời trong
          card "Study together". Cùng pattern hiện/ẩn theo dashVisible/panel với gear. */}
      <button
        onClick={() => {
          if (!user) {
            navigate('/auth')
            return
          }
          setPanel(null)
          setStatsOpen(true)
        }}
        title={t('dashboard.taskbar.stats')}
        aria-label={t('dashboard.taskbar.stats')}
        className="absolute right-[68px] bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] no-underline transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:right-[88px]"
        style={{
          ...dashStyleBase,
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'rgba(255,255,255,0.66)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px rgba(58,98,126,0.14)',
          transform: `translateY(${dashVisible ? '0px' : '26px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V11" />
          <path d="M11 20V4" />
          <path d="M18 20v-7" />
        </svg>
      </button>

      {/* settings — standalone icon-only button, bottom-right corner. Khách chưa đăng nhập
          bấm vào vẫn điều hướng sang /auth như hành vi cũ (route /settings trước đây tự
          redirect qua RequireAuth); đã đăng nhập thì mở overlay ngay tại chỗ, không điều
          hướng — Dashboard không unmount nên camera/nhạc đang phát không bị ngắt. */}
      <button
        onClick={() => {
          if (!user) {
            navigate('/auth')
            return
          }
          setPanel(null)
          setSettingsOpen(true)
        }}
        title={t('dashboard.taskbar.settingsTitle')}
        aria-label={t('dashboard.taskbar.settingsTitle')}
        className="absolute right-3 bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[#354c65] no-underline transition-colors duration-[240ms] hover:!bg-[rgba(255,255,255,0.9)] md:right-8"
        style={{
          ...dashStyleBase,
          // popup nào cũng nổi đè lên đúng góc này (todo panel full-height bên phải, wallpaper/music
          // popup căn giữa-dưới) — ẩn hẳn gear lúc đó thay vì chỉ dựa vào z-index, để chắc chắn
          // không bao giờ đè lên chữ/nút trong popup dù ở kích thước màn hình nào.
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'rgba(255,255,255,0.66)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px rgba(58,98,126,0.14)',
          transform: `translateY(${dashVisible ? '0px' : '26px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1.08-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1.08 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {statsOpen && <Stats onClose={() => setStatsOpen(false)} />}
      {friendsOpen && <FriendsPanel onClose={() => setFriendsOpen(false)} />}

      {/* quick match chờ người — overlay nhỏ gọn trên Dashboard, không rời trang (GĐ9) */}
      {quick.stage === 'waiting' && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ background: 'rgba(38,66,86,0.32)', backdropFilter: 'blur(7px)' }}
        >
          <div className="absolute inset-0" onClick={() => quick.cancel()} />
          <div
            className="relative flex w-full max-w-[340px] flex-col items-center gap-[18px] rounded-[30px] bg-white px-7 pt-8 pb-6 text-center"
            style={{ boxShadow: '0 30px 70px rgba(38,66,86,0.3)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
          >
            <div className="relative flex h-[120px] w-[120px] items-center justify-center">
              <div
                className="absolute h-[120px] w-[120px] rounded-full"
                style={{ border: '2px solid rgba(126,201,198,0.55)', animation: 'ffRipple 3.4s cubic-bezier(0.24,0.6,0.3,1) infinite' }}
              />
              <div
                className="absolute h-[120px] w-[120px] rounded-full"
                style={{ border: '2px solid rgba(150,190,220,0.5)', animation: 'ffRipple 3.4s cubic-bezier(0.24,0.6,0.3,1) infinite', animationDelay: '1.13s' }}
              />
              <div
                className="absolute h-[76px] w-[76px] rounded-full"
                style={{ background: 'rgba(255,255,255,0.72)', boxShadow: '0 10px 26px rgba(58,98,126,0.13)', animation: 'ffBreathe 3.4s ease-in-out infinite' }}
              />
              <span className="relative text-2xl font-extrabold text-[#2c3f55] tabular-nums">{quick.waited}</span>
            </div>
            <div className="flex flex-col gap-[6px]">
              <span className="text-[17px] font-extrabold tracking-[-0.2px] text-[#2c3f55]">
                {t('matching.searching.title')}
              </span>
              <span className="text-[13px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.55)]">
                {quick.matchError
                  ? t('matching.errors.' + quick.matchError)
                  : t('dashboard.quickMatch.hint')}
              </span>
              {quick.stage === 'waiting' && !quick.matchError && quick.waitingCount !== null && (
                <span className="text-[12px] font-bold text-[rgba(51,71,94,0.42)]">
                  {t('matching.searching.othersWaiting', { count: othersWaiting(quick.waitingCount) })}
                </span>
              )}
            </div>
            <button
              onClick={() => quick.cancel()}
              className="rounded-[20px] border-none px-[26px] py-[12px] font-sans text-[14px] font-extrabold text-[#43596f] hover:!bg-[rgba(240,248,250,0.95)]"
              style={{ background: 'rgba(240,248,250,0.9)' }}
            >
              {t('matching.searching.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* match thành công — card hồ sơ người cùng học (GĐ9) */}
      {quick.stage === 'matched' && quick.roomCode && (
        <MatchFound
          partner={quick.partner}
          roomCode={quick.roomCode}
          roomLabel={t('matching.roomTypes.' + (loadSavedMatchConfig()?.room_type ?? 'chill') + '.name')}
          onEnter={() => navigate('/room/' + quick.roomCode)}
          onClose={() => quick.reset()}
        />
      )}

      {/* wallpaper popup */}
      <div
        className="absolute bottom-[108px] left-1/2 w-[340px] rounded-[26px] p-5"
        style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 18px 44px rgba(58,98,126,0.16)',
          opacity: panel === 'wp' ? 1 : 0,
          transform: `translate(-50%, ${panel === 'wp' ? '0px' : '14px'})`,
          pointerEvents: panel === 'wp' ? 'auto' : 'none',
          transition: 'opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="mb-[14px] flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-[#2c3f55]">
            {t('dashboard.wallpaperPopup.title')}
          </span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            {t('dashboard.wallpaperPopup.close')}
          </button>
        </div>
        <div className="grid max-h-[280px] grid-cols-3 gap-[10px] overflow-y-auto pr-1">
          {wallpaperOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setWp(option.id)}
              className="relative h-[66px] overflow-hidden rounded-[18px] bg-cover bg-center transition-transform duration-200 hover:!-translate-y-0.5"
              style={{
                backgroundImage:
                  option.kind === 'gradient'
                    ? option.value
                    : option.kind === 'image'
                      ? `url(${option.value})`
                      : undefined,
                border: option.id === wp ? `2px solid ${ACCENT}` : '2px solid rgba(255,255,255,0.7)',
                boxShadow: '0 4px 12px rgba(58,98,126,0.1)',
              }}
            >
              {/* Popup này LUÔN mounted trong DOM (chỉ ẩn/hiện qua opacity, xem style của popup
                  bên dưới), không phải mở mới render — nên chỉ render <video> thumbnail khi
                  popup thật sự đang mở (`panel === 'wp'`), tránh video nền + video thumbnail
                  cùng giải mã song song VĨNH VIỄN dù popup chưa từng được mở, tốn tài nguyên vô
                  ích và có thể làm cả 2 video giật/đứng sau 1 lúc. */}
              {option.kind === 'video' && panel === 'wp' && (
                <video
                  className="absolute inset-0 h-full w-full object-cover"
                  src={option.value}
                  autoPlay
                  loop
                  muted
                  playsInline
                />
              )}
            </button>
          ))}
        </div>
        <div className="mt-[14px] text-xs font-semibold text-[rgba(51,71,94,0.5)]">
          {t('dashboard.wallpaperPopup.hint')}
        </div>
      </div>

      {/* music popup */}
      <div
        className="absolute bottom-[108px] left-1/2 w-[320px] rounded-[26px] p-5"
        style={{
          background: 'rgba(255,255,255,0.8)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 18px 44px rgba(58,98,126,0.16)',
          opacity: panel === 'music' ? 1 : 0,
          transform: `translate(-50%, ${panel === 'music' ? '0px' : '14px'})`,
          pointerEvents: panel === 'music' ? 'auto' : 'none',
          transition: 'opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="mb-[14px] flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-[#2c3f55]">
            {t('dashboard.musicPopup.title')}
          </span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            {t('dashboard.musicPopup.close')}
          </button>
        </div>

        <div className="mb-[10px] flex gap-[7px] rounded-[18px] p-[5px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
          <button
            onClick={() => setActiveTab('library')}
            className="flex-1 rounded-xl border-none px-[6px] py-[8px] font-sans text-[12px] font-extrabold transition-all duration-[220ms]"
            style={{ background: activeTab === 'library' ? 'white' : 'transparent', color: activeTab === 'library' ? '#22483f' : 'rgba(51,71,94,0.55)' }}
          >
            {t('dashboard.musicPopup.sourceLibrary')}
          </button>
          <button
            onClick={() => setActiveTab('youtube')}
            className="flex-1 rounded-xl border-none px-[6px] py-[8px] font-sans text-[12px] font-extrabold transition-all duration-[220ms]"
            style={{ background: activeTab === 'youtube' ? 'white' : 'transparent', color: activeTab === 'youtube' ? '#22483f' : 'rgba(51,71,94,0.55)' }}
          >
            {t('dashboard.musicPopup.sourceYoutube')}
          </button>
        </div>

        {activeTab === 'library' && (
          <div className="flex max-h-[220px] flex-col gap-[6px] overflow-y-auto">
            {tracks.length === 0 && (
              <span className="px-[14px] py-3 text-xs font-semibold text-[rgba(51,71,94,0.5)]">
                {t('dashboard.musicPopup.empty')}
              </span>
            )}
            {tracks.map((tr, i) => (
              <button
                key={tr.id}
                onClick={() => {
                  setTrack(i)
                  setPlaying(true)
                  setMusicSource('library')
                }}
                className="flex items-center gap-3 rounded-[17px] border-none px-[14px] py-3 text-left font-sans transition-colors duration-200 hover:!bg-[rgba(140,200,205,0.16)]"
                style={{ background: i === track ? 'rgba(140,200,205,0.22)' : 'rgba(255,255,255,0.55)' }}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-[#2f4459]" title={tr.name}>
                  {tr.name}
                </span>
                <span className="shrink-0 text-xs font-semibold text-[rgba(51,71,94,0.45)]">
                  {i === track && musicSource === 'library'
                    ? playing
                      ? t('dashboard.musicPopup.nowPlaying')
                      : t('dashboard.musicPopup.selected')
                    : ''}
                </span>
              </button>
            ))}
          </div>
        )}

        {activeTab === 'youtube' && (
          <div className="flex flex-col gap-[7px]">
            <div className="flex gap-[7px]">
              <input
                value={ytInput}
                onChange={(e) => {
                  setYtInput(e.target.value)
                  setYtError(false)
                }}
                placeholder={t('dashboard.musicPopup.youtubeInputPlaceholder')}
                className="min-w-0 flex-1 rounded-[15px] border-none px-[13px] py-[9px] font-sans text-[13px] font-semibold text-[#2c3f55] outline-none"
                style={{ background: 'rgba(238,246,248,0.9)' }}
              />
              <button
                onClick={applyYoutubeLink}
                disabled={!ytInput.trim()}
                className="shrink-0 rounded-[15px] border-none px-[14px] py-[9px] font-sans text-[12.5px] font-extrabold text-[#21384f] disabled:opacity-50"
                style={{ background: 'rgba(140,205,196,0.35)' }}
              >
                {t('dashboard.musicPopup.youtubeUse')}
              </button>
            </div>
            {ytError && <span className="text-[12px] font-semibold text-[#a13f2c]">{t('dashboard.musicPopup.youtubeInvalid')}</span>}
            {youtubeUrl && !ytError && (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-[rgba(51,71,94,0.5)]">
                  {musicSource === 'youtube'
                    ? t('dashboard.musicPopup.youtubeCurrent', { url: youtubeUrl })
                    : t('dashboard.musicPopup.youtubeSaved', { url: youtubeUrl })}
                </span>
                {musicSource !== 'youtube' && (
                  <button
                    onClick={() => {
                      setMusicSource('youtube')
                      setPlaying(true)
                    }}
                    className="shrink-0 rounded-[15px] border-none px-[14px] py-[9px] font-sans text-[12.5px] font-extrabold text-[#21384f]"
                    style={{ background: 'rgba(140,205,196,0.35)' }}
                  >
                    {t('dashboard.musicPopup.play')}
                  </button>
                )}
              </div>
            )}
            {!youtubeUrl && (
              <span className="px-[14px] py-3 text-xs font-semibold text-[rgba(51,71,94,0.5)]">
                {t('dashboard.musicPopup.youtubeEmpty')}
              </span>
            )}
          </div>
        )}

      </div>

      {/* todo slide-out */}
      <div
        className="absolute top-0 right-0 bottom-0 z-30 flex w-[352px] flex-col gap-4 px-[26px] pt-24 pb-[34px]"
        style={{
          background: 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(22px)',
          boxShadow: '-18px 0 50px rgba(58,98,126,0.14)',
          borderTopLeftRadius: 32,
          borderBottomLeftRadius: 32,
          transform: `translateX(${panel === 'todo' ? '0px' : '380px'})`,
          opacity: panel === 'todo' ? 1 : 0,
          pointerEvents: panel === 'todo' ? 'auto' : 'none',
          transition: 'transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 360ms ease',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xl font-extrabold text-[#2c3f55]">{t('dashboard.todoPanel.title')}</span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[rgba(51,71,94,0.5)]"
          >
            {t('dashboard.todoPanel.close')}
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => toggleTask(task)}
              className="flex cursor-pointer items-center gap-[13px] rounded-[20px] px-[15px] py-[14px] transition-colors duration-200 hover:!bg-[rgba(255,255,255,0.95)]"
              style={{ background: 'rgba(255,255,255,0.66)', boxShadow: '0 4px 14px rgba(58,98,126,0.07)' }}
            >
              <div
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg"
                style={{
                  border: task.done ? `2px solid ${ACCENT}` : '2px solid rgba(51,71,94,0.18)',
                  background: task.done ? ACCENT : 'rgba(255,255,255,0.9)',
                }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  style={{ opacity: task.done ? 1 : 0 }}
                >
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
              </div>
              <div className="flex flex-col gap-[2px]">
                <span
                  className="text-sm font-bold"
                  style={{
                    color: task.done ? 'rgba(51,71,94,0.42)' : '#2c3f55',
                    textDecoration: task.done ? 'line-through' : 'none',
                  }}
                >
                  {task.name}
                </span>
                <span className="text-xs font-semibold text-[rgba(51,71,94,0.42)]">{task.meta}</span>
              </div>
            </div>
          ))}
        </div>
        <div
          className="flex items-center gap-[10px] rounded-[20px] py-[6px] pr-[6px] pl-4"
          style={{ background: 'rgba(255,255,255,0.7)', boxShadow: '0 4px 14px rgba(58,98,126,0.07)' }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTask()
            }}
            placeholder={t('dashboard.todoPanel.placeholder')}
            className="flex-1 border-none bg-transparent py-[10px] font-sans text-sm font-semibold text-[#2c3f55] outline-none"
          />
          <button
            onClick={addTask}
            className="rounded-2xl border-none px-[18px] py-[10px] font-sans text-sm font-extrabold text-[#21384f]"
            style={{ background: 'rgba(140,205,196,0.38)' }}
          >
            {t('dashboard.todoPanel.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

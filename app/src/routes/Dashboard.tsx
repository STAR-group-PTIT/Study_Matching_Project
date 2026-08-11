import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore, useRequireAuth } from '../store/auth'
import { playChime } from '../lib/sound'
import { parseYoutubeUrl, loadYoutubeApi, DEFAULT_YOUTUBE_URL, MUSIC_YOUTUBE_KEY, loadStoredYoutubeUrlOverride, type YTPlayer } from '../lib/youtube'
import { BUILTIN_TRACKS, type LibraryTrack } from '../lib/musicLibrary'
import { RANDOM_MATCH_CONFIG, useQuickMatch } from '../lib/quickMatch'
import {
  isVideoWallpaper,
  prepareWallpaperFile,
  WallpaperFileError,
  readWallpaperUrlCache,
  refreshWallpaperUrlCache,
  writeWallpaperUrlCache,
  cacheWallpaperUrl,
} from '../lib/wallpaper'
import { loadStoredAutoFullscreenFocus } from '../lib/focusFullscreen'
import MatchFound from '../components/MatchFound'
import LobbyWaiting from '../components/LobbyWaiting'
import Settings from './Settings'
import Stats from './Stats'
import FriendsPanel from '../components/FriendsPanel'
import GuestOnboarding from '../components/GuestOnboarding'
import { hasSeenOnboarding } from '../lib/onboarding'
import { useFriendStore } from '../store/friendNotifications'

type WallpaperOption = { id: string; kind: 'gradient' | 'image' | 'video'; value: string }

const BUILTIN_GRADIENTS: WallpaperOption[] = ['linear-gradient(160deg, var(--c-1g0tv9u) 0%, var(--c-1fjrplj) 45%, var(--c-1frhffa) 100%)'].map(
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

// Bật/tắt nhạc (playing) cũng phải nhớ qua localStorage cùng lý do với cameraOn ở trên —
// nếu không thì mỗi lần route Dashboard bị unmount/remount (F5, hoặc điều hướng đi rồi
// quay lại), state playing reset về mặc định true, tự phát nhạc trở lại dù user vừa tắt.
const MUSIC_PLAYING_KEY = 'ff-music-playing'
function loadStoredMusicPlaying() {
  try {
    const v = localStorage.getItem(MUSIC_PLAYING_KEY)
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
// Chặn phòng hờ — to-do của 1 user vốn nhỏ (RLS chỉ trả về to-do của chính mình) nên không
// cần phân trang thật, chỉ cần 1 trần cứng phòng lúc dữ liệu phình bất thường.
const TODOS_FETCH_LIMIT = 500

type Phase = 'focus' | 'break'
type Mode = 'dashboard' | 'focus'
type Panel = 'wp' | 'music' | 'todo' | 'study' | null
type TimerType = 'pomodoro' | 'endless'
type EditField = 'loop' | 'work' | 'break' | null

type Priority = 'high' | 'medium' | 'low'

type Task = {
  id: string
  name: string
  meta: string
  done: boolean
  priority: Priority
  orderIndex: number
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
// Xoay vòng khi bấm chấm ưu tiên: Cao → Trung bình → Thấp → Cao.
const PRIORITY_CYCLE: Record<Priority, Priority> = { high: 'medium', medium: 'low', low: 'high' }
// Màu chấm ưu tiên dùng token riêng theo theme — đỏ/cam/xám phân biệt rõ 3 mức
// (trước dùng danger-text/warning-text: ở light theme 2 màu nâu đất gần như giống nhau).
const PRIORITY_COLOR: Record<Priority, string> = {
  high: 'var(--ff-priority-high)',
  medium: 'var(--ff-priority-medium)',
  low: 'var(--ff-priority-low)',
}
const PRIORITY_LABEL_KEY: Record<Priority, string> = {
  high: 'dashboard.todoPanel.priorityHigh',
  medium: 'dashboard.todoPanel.priorityMedium',
  low: 'dashboard.todoPanel.priorityLow',
}

function sortTasks(list: Task[]): Task[] {
  return [...list].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      a.orderIndex - b.orderIndex ||
      a.id.localeCompare(b.id),
  )
}

// Gán lại order_index 1..n cho việc ĐANG MỞ theo thứ tự ưu tiên hiện tại — việc đã xong
// không cần giữ thứ tự (mục "Đã xong" render thuần, không kéo-thả), vừa tránh ghi DB thừa.
function reorderTasks(next: Task[]): { ordered: Task[]; changed: Task[] } {
  const prevIndex = new Map(next.map((task) => [task.id, task.orderIndex]))
  const counts: Record<Priority, number> = { high: 0, medium: 0, low: 0 }
  const orderedOpen = sortTasks(next.filter((task) => !task.done)).map((task) => {
    counts[task.priority] += 1
    return counts[task.priority] === task.orderIndex ? task : { ...task, orderIndex: counts[task.priority] }
  })
  const changed = orderedOpen.filter((task) => prevIndex.get(task.id) !== task.orderIndex)
  return { ordered: [...orderedOpen, ...sortTasks(next.filter((task) => task.done))], changed }
}

const MOCK_TASK_KEYS = ['t1', 't2', 't3', 't4'] as const
const MOCK_TASK_DONE: Record<(typeof MOCK_TASK_KEYS)[number], boolean> = {
  t1: false,
  t2: false,
  t3: true,
  t4: false,
}
const MOCK_TASK_PRIORITY: Record<(typeof MOCK_TASK_KEYS)[number], Priority> = {
  t1: 'high',
  t2: 'medium',
  t3: 'medium',
  t4: 'low',
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
  const authLoading = useAuthStore((s) => s.loading)
  const requireAuth = useRequireAuth()
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  useEffect(() => {
    if (!authLoading && !user && !hasSeenOnboarding()) setOnboardingOpen(true)
  }, [authLoading, user])
  // Cài đặt giờ là overlay mở ngay trên Dashboard thay vì route /settings riêng — tránh
  // Dashboard unmount mỗi lần vào Cài đặt (trước đó làm mất camera đang bật + nhạc đang
  // phát, vì cả 2 đều sống trong state của chính component này).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [friendsOpen, setFriendsOpen] = useState(false)
  // Badge trên icon "Bạn bè" gộp cả lời mời kết bạn LẪN lời mời vào room đang chờ — trước đó
  // lời mời vào room không có chỗ nào hiện lại ngoài popup gián đoạn 1 lần lúc mới tới (dễ bị
  // lỡ), giờ cũng đếm vào đây và liệt kê lại được trong FriendsPanel.
  const pendingFriendRequestCount = useFriendStore((s) => s.pendingRequestCount) + useFriendStore((s) => s.pendingInviteCount)
  // Ghép ngẫu nhiên nhóm 5 người từ Dashboard (GĐ10 tiếp, thay bản ghép cặp cũ) — hook dùng
  // chung file với Matching.tsx (nút random ở đó đã bỏ, room list dùng filter+join là chính).
  // Không còn cho tuỳ chỉnh thời lượng/ngôn ngữ ở đây nữa (RANDOM_MATCH_CONFIG cố định) — ai
  // cần tuỳ chỉnh thật thì dùng "Duyệt phòng đang mở" bên dưới, vốn đã có đủ bộ lọc.
  const quick = useQuickMatch()
  function openStudyPanel() {
    requireAuth(() => setPanel('study'))
  }
  function startGroupMatch() {
    setPanel(null)
    void quick.start()
  }
  const initialTasks = useMemo<Task[]>(
    () =>
      MOCK_TASK_KEYS.map((key, i) => ({
        id: 'g' + (i + 1),
        name: t(`dashboard.mockTasks.${key}.name`),
        meta: t(`dashboard.mockTasks.${key}.meta`),
        done: MOCK_TASK_DONE[key],
        priority: MOCK_TASK_PRIORITY[key],
        orderIndex: i + 1,
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
  // Khởi tạo NGAY từ cache signed URL (nếu có) thay vì chờ effect fetch Supabase — nếu không,
  // mỗi lần reload trang sẽ render gradient mặc định trước rồi mới nhảy sang ảnh custom khi
  // fetch xong, gây hiện tượng "nháy" mà user báo. Entry hết hạn (URL đã 403) thì bỏ qua.
  const [customWallpapers, setCustomWallpapers] = useState<WallpaperOption[]>(() => {
    const cache = readWallpaperUrlCache()
    const now = Date.now()
    return Object.entries(cache)
      .filter(([, e]) => e.expiresAt > now && e.url)
      .map(([id, e]) => ({ id, kind: e.kind, value: e.url }))
  })
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
  const [playing, setPlaying] = useState(loadStoredMusicPlaying)
  useEffect(() => {
    try {
      localStorage.setItem(MUSIC_PLAYING_KEY, playing ? '1' : '0')
    } catch {
      // localStorage không khả dụng — chỉ mất tính năng nhớ lựa chọn, không lỗi.
    }
  }, [playing])
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

  // User tự thoát fullscreen bằng phím Esc (hoặc control gốc của trình duyệt/OS) thay vì bấm
  // Huỷ trong app — trước đây app không hay biết gì cả, top bar/widget vẫn kẹt ở trạng thái ẩn
  // (opacity 0, pointer-events none) dù trình duyệt đã thật sự thoát fullscreen rồi (bug user
  // báo cáo: "thoát" không tự trả UI về Dashboard). Lắng nghe fullscreenchange để đồng bộ lại.
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement && autoFocusActiveRef.current) {
        autoFocusActiveRef.current = false
        setAutoFocusFullscreen(false)
        setMode('dashboard')
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
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
        const rows = data.map((r) => ({
          id: r.id,
          kind: isVideoWallpaper(r.storage_path) ? ('video' as const) : ('image' as const),
        }))
        // Chỉ tạo signed URL mới cho ảnh không còn entry cache tươi — giữ nguyên URL cũ cho ảnh
        // còn hạn (URL khác nhau mỗi lần tạo, mà đổi URL lại gây nháy nền lần nữa).
        const { fresh, next } = refreshWallpaperUrlCache(rows.map((r) => r.id))
        const toSign = rows.filter((r) => !fresh[r.id])
        const signedMap: Record<string, string> = { ...fresh }
        if (toSign.length > 0) {
          const { data: signed } = await supabase.storage
            .from('wallpapers')
            .createSignedUrls(
              toSign.map((r) => data.find((d) => d.id === r.id)?.storage_path ?? ''),
              3600,
            )
          if (cancelled) return
          signed?.forEach((s, i) => {
            const r = toSign[i]
            if (s?.signedUrl && r) {
              signedMap[r.id] = s.signedUrl
              next[r.id] = { url: s.signedUrl, expiresAt: Date.now() + 3600 * 1000, kind: r.kind }
            }
          })
        }
        // Luôn ghi kể cả khi không tạo URL mới — để dọn entry của ảnh đã xoá ở Settings khỏi cache.
        writeWallpaperUrlCache(next)
        if (cancelled) return
        setCustomWallpapers(
          rows.filter((r) => signedMap[r.id]).map((r) => ({ id: r.id, kind: r.kind, value: signedMap[r.id] })),
        )
      })
    return () => {
      cancelled = true
    }
    // settingsOpen: cùng lý do với effect load tracks bên trên — Settings không unmount
    // Dashboard nên phải tự refetch khi đóng lại, nếu không ảnh nền mới upload sẽ không hiện
    // trong popup "Đổi hình nền" cho tới khi F5 lại trang.
  }, [user, settingsOpen])

  // Upload hình nền ngay từ popup "Hình nền" (kéo-thả / bấm chọn tệp) — dùng chung pipeline
  // chuẩn bị file (resize ảnh quá khổ + check dung lượng) với Settings, upload vào đúng bucket
  // + thư mục riêng của user, rồi thêm thẳng vào danh sách chọn, không cần chờ refetch.
  const [wpUploading, setWpUploading] = useState(false)
  const [wpUploadMsg, setWpUploadMsg] = useState<'done' | 'error' | 'tooLarge' | 'tooLargeVideo' | null>(null)
  const [wpDragOver, setWpDragOver] = useState(false)
  const wpFileInputRef = useRef<HTMLInputElement>(null)

  async function uploadWallpaperFile(file: File) {
    if (!user || wpUploading) return
    setWpUploading(true)
    setWpUploadMsg(null)
    try {
      const { file: prepared } = await prepareWallpaperFile(file)
      const path = `${user.id}/${crypto.randomUUID()}-${prepared.name}`
      const { error: upErr } = await supabase.storage.from('wallpapers').upload(path, prepared)
      if (upErr) throw upErr
      const { data: row, error: insErr } = await supabase
        .from('wallpapers')
        .insert({ user_id: user.id, name: prepared.name, storage_path: path })
        .select('id')
        .single()
      if (insErr || !row) throw insErr ?? new Error('no wallpaper row')
      const { data: signed } = await supabase.storage.from('wallpapers').createSignedUrl(path, 3600)
      if (!signed?.signedUrl) throw new Error('no signed url')
      cacheWallpaperUrl(row.id, signed.signedUrl, isVideoWallpaper(path) ? 'video' : 'image')
      setCustomWallpapers((ws) => [
        ...ws,
        { id: row.id, kind: isVideoWallpaper(path) ? ('video' as const) : ('image' as const), value: signed.signedUrl },
      ])
      setWpUploadMsg('done')
    } catch (err) {
      console.error('upload wallpaper from popup failed', err)
      setWpUploadMsg(err instanceof WallpaperFileError ? err.code : 'error')
    } finally {
      setWpUploading(false)
    }
  }

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
      .select('id, name, meta, done, priority, order_index')
      .order('created_at')
      .limit(TODOS_FETCH_LIMIT)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return
        const next = data.map((row) => ({
          id: row.id,
          name: row.name,
          meta: row.meta ?? '',
          done: row.done,
          priority: ((row.priority as Priority | null) ?? 'medium') as Priority,
          orderIndex: row.order_index ?? 0,
        }))
        setTasks(reorderTasks(next).ordered)
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
  const doneCount = tasks.length - openCount
  const hasTasks = tasks.length > 0
  const openTasks = sortTasks(tasks.filter((task) => !task.done))
  const doneTasks = sortTasks(tasks.filter((task) => task.done))

  function toggleRun() {
    // Bấm Tạm dừng (đang running -> dừng) thoát auto-fullscreen/trả UI về Dashboard, giống
    // Huỷ/hoàn thành phiên/Esc. Bấm Tiếp tục lại (đang dừng -> running) thì bật lại y hệt
    // những gì "Bắt đầu" đã bật (nếu setting auto-fullscreen đang bật) — trước đây không bật
    // lại, khiến user bấm Tiếp tục mà không fullscreen lại.
    if (running) {
      exitAutoFocusFullscreen()
      setRunning(false)
      return
    }
    setRunning(true)
    if (loadStoredAutoFullscreenFocus()) {
      autoFocusActiveRef.current = true
      setAutoFocusFullscreen(true)
      setMode('focus')
      // Phải gọi trực tiếp trong handler click (user gesture) thì Fullscreen API mới cho phép,
      // gọi trong .then()/setTimeout sẽ bị trình duyệt từ chối.
      void document.documentElement.requestFullscreen?.().catch(() => {})
    }
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

  // Ghi lại thứ tự mới (sau xoá/thêm/đổi ưu tiên/kéo-thả) — renormalize order_index của việc
  // đang mở rồi chỉ persist những row thực sự đổi, tránh ghi DB thừa cho cả danh sách.
  function commitOrder(next: Task[]) {
    const { ordered, changed } = reorderTasks(next)
    setTasks(ordered)
    if (!user || changed.length === 0) return
    void Promise.all(
      changed.map((task) =>
        supabase
          .from('todos')
          .update({ priority: task.priority, order_index: task.orderIndex })
          .eq('id', task.id)
          .then(({ error }) => {
            if (error) console.error('persist todo order failed', error)
          }),
      ),
    )
  }

  async function addTask() {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    const newTaskMeta = t('dashboard.todoPanel.newTaskMeta')
    if (!user) {
      commitOrder([...tasks, { id: 'g' + Date.now(), name, meta: newTaskMeta, done: false, priority: 'medium', orderIndex: 0 }])
      return
    }
    // Việc mới mặc định Trung bình, gắn cuối nhóm đó (order_index = max + 1) — renormalize
    // toàn bộ sau insert cũng được nhưng ghi sẵn 1 giá trị đúng thì không phải sửa lại row nào.
    const maxMedium = Math.max(
      0,
      ...tasks.filter((x) => !x.done && x.priority === 'medium').map((x) => x.orderIndex),
    )
    const { data, error } = await supabase
      .from('todos')
      .insert({ user_id: user.id, name, meta: newTaskMeta, priority: 'medium', order_index: maxMedium + 1 })
      .select('id, name, meta, done, priority, order_index')
      .single()
    if (!error && data) {
      setTasks((ts) => [
        ...ts,
        {
          id: data.id,
          name: data.name,
          meta: data.meta ?? '',
          done: data.done,
          priority: ((data.priority as Priority | null) ?? 'medium') as Priority,
          orderIndex: data.order_index ?? 0,
        },
      ])
    }
  }

  function toggleTask(task: Task) {
    const nextDone = !task.done
    if (nextDone) {
      // Tick xong: chỉ đánh dấu, không đụng thứ tự — việc tự chìm xuống mục "Đã xong" thuần
      // render (2 section tách riêng), khỏi ghi lại order_index cho cả danh sách.
      setTasks((ts) => ts.map((x) => (x.id === task.id ? { ...x, done: true } : x)))
    } else {
      // Bỏ tick: việc quay lại cuối nhóm ưu tiên của nó qua renormalize.
      commitOrder(tasks.map((x) => (x.id === task.id ? { ...x, done: false } : x)))
    }
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

  function deleteTask(task: Task) {
    commitOrder(tasks.filter((x) => x.id !== task.id))
    if (user) {
      supabase
        .from('todos')
        .delete()
        .eq('id', task.id)
        .then(({ error }) => {
          if (error) console.error('delete todo failed', error)
        })
    }
  }

  function cyclePriority(task: Task) {
    const nextPriority = PRIORITY_CYCLE[task.priority]
    commitOrder(tasks.map((x) => (x.id === task.id ? { ...x, priority: nextPriority } : x)))
    // commitOrder chỉ ghi lại row nào order_index đổi — đổi ưu tiên có thể giữ nguyên số thứ tự
    // (vd nhóm đó đang rỗng) nên phải ghi priority riêng cho chắc.
    if (user) {
      supabase
        .from('todos')
        .update({ priority: nextPriority })
        .eq('id', task.id)
        .then(({ error }) => {
          if (error) console.error('update todo priority failed', error)
        })
    }
  }

  // Kéo-thả HTML5 native (không thêm thư viện). Row chỉ bật `draggable` sau khi bấm giữ tay
  // cầm (grip) — tránh kéo nhầm khi click vào checkbox/chấm ưu tiên/nút xoá trên cùng row.
  const [draggableId, setDraggableId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropOverId, setDropOverId] = useState<string | null>(null)

  function handleDragStart(e: React.DragEvent, task: Task) {
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(task.id)
  }
  function handleDragOver(e: React.DragEvent, task: Task) {
    if (!dragId || dragId === task.id || task.done) return
    const dragging = tasks.find((x) => x.id === dragId)
    // Chỉ cho thả vào TRONG CÙNG mức ưu tiên (user chốt: nhãn quyết định thứ tự, kéo chỉ xếp
    // trong nhóm) — drag qua việc khác mức là no-op, không báo lỗi, không đổi chỗ.
    if (!dragging || dragging.priority !== task.priority) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropOverId(task.id)
  }
  function handleDrop(e: React.DragEvent, task: Task) {
    e.preventDefault()
    if (dragId && dragId !== task.id) {
      const drag = tasks.find((x) => x.id === dragId)
      const target = tasks.find((x) => x.id === task.id)
      if (drag && target && !drag.done && !target.done && drag.priority === target.priority) {
        const openSame = tasks.filter((x) => !x.done && x.priority === drag.priority)
        const from = openSame.findIndex((x) => x.id === dragId)
        const to = openSame.findIndex((x) => x.id === task.id)
        const reordered = [...openSame]
        const [moved] = reordered.splice(from, 1)
        reordered.splice(from < to ? to - 1 : to, 0, moved)
        const newIndex = new Map(reordered.map((x, i) => [x.id, i + 1]))
        commitOrder(tasks.map((x) => (newIndex.has(x.id) ? { ...x, orderIndex: newIndex.get(x.id)! } : x)))
      }
    }
    setDragId(null)
    setDropOverId(null)
  }
  function handleDragEnd() {
    setDragId(null)
    setDropOverId(null)
  }

  const dashStyleBase = {
    opacity: dashVisible ? 1 : 0,
    pointerEvents: dashVisible ? ('auto' as const) : ('none' as const),
  }

  return (
    <div
      className="relative h-svh w-full overflow-hidden bg-cover bg-center font-sans text-[var(--c-32fr7s)] antialiased"
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
                background: 'var(--c-xhdzkp)',
                boxShadow: musicPanelOpen && ytVideoVisible ? '0 10px 26px var(--c-xr2m53)' : 'none',
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
                className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'var(--c-6rf0kc)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px var(--c-1k1wm30)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18V6l10-2v12" />
                  <circle cx="6.5" cy="18" r="2.5" />
                  <circle cx="16.5" cy="16" r="2.5" />
                </svg>
                {playing && (
                  <span
                    className="absolute right-[3px] bottom-[3px] h-[9px] w-[9px] rounded-full"
                    style={{ background: 'var(--c-t8fca9)', boxShadow: '0 0 0 2px var(--c-6rf20v)' }}
                  />
                )}
              </button>
            ) : ytActive ? (
              <div
                className="flex items-center gap-[4px] rounded-full py-[8px] pr-[12px] pl-[8px]"
                style={{ background: 'var(--c-6rf0kc)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px var(--c-1k1wm30)' }}
              >
                <button
                  onClick={() => {
                    setMusicPanelOpen(false)
                    setYtVideoVisible(false)
                  }}
                  title={t('dashboard.musicMini.collapse')}
                  aria-label={t('dashboard.musicMini.collapse')}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-200 hover:!bg-white"
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-200 hover:!bg-white"
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-200 hover:!bg-white"
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-200 hover:!bg-white"
                  style={{ background: ytVideoVisible ? 'var(--c-6rf20v)' : 'transparent' }}
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
                style={{ background: 'var(--c-6rf0kc)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 34px var(--c-1k1wm30)' }}
              >
                <span className="truncate text-[13px] font-bold text-[var(--c-3dfktp)]" title={tracks[track]?.name}>
                  {tracks[track]?.name}
                </span>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={() => setMusicPanelOpen(false)}
                    title={t('dashboard.musicMini.collapse')}
                    aria-label={t('dashboard.musicMini.collapse')}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-200 hover:!bg-white"
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'var(--c-ijr2u8)' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="5" y="5" width="3" height="14" />
                      <path d="M18 5v14l-8-7z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setPlaying((p) => !p)}
                    title={playing ? t('dashboard.musicPopup.pause') : t('dashboard.musicPopup.play')}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-2k9xd7)] transition-transform duration-200 hover:-translate-y-0.5"
                    style={{ background: 'var(--c-hcls53)' }}
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'var(--c-ijr2u8)' }}
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
                  <span className="w-7 shrink-0 text-right text-[11px] font-semibold text-[var(--c-mfvyic)] tabular-nums">
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
                  <span className="w-7 shrink-0 text-[11px] font-semibold text-[var(--c-mfvyic)] tabular-nums">
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
            ? { background: 'var(--c-pz0zw9)' }
            : { backdropFilter: 'blur(2px)', background: 'var(--c-6rewt5)' }
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
          className="flex items-center gap-[9px] rounded-[14px] px-[14px] py-[8px]"
          style={{
            // Nền kính mờ nhẹ (theo theme) — user tự tải ảnh/video bất kỳ làm nền (xem
            // wallpaperPopup.hint), kể cả ảnh tối trùng tông chữ, nên drop-shadow đơn thuần
            // không đủ. Glass + blur đảm bảo chữ navy/sáng luôn tách khỏi mọi wallpaper.
            background: 'var(--ff-logo-glass)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid var(--ff-border)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
          }}
        >
          <div
            className="h-5 w-5 rounded-lg"
            style={{
              background: 'linear-gradient(135deg, var(--c-1feyjhs), var(--c-yr829))',
            }}
          />
          <span className="text-base font-extrabold tracking-[-0.2px] text-[var(--c-3dfktp)]">
            {t('app.name')}
          </span>
          <span className="text-[13px] font-semibold text-[var(--c-mfvyic)]">
            · {isFocus ? t('dashboard.topbar.focusMode') : t('dashboard.topbar.dashboardMode')}
          </span>
        </div>

        <div className="flex items-center gap-[10px]">
          {!user && (
            <Link
              to="/auth"
              className="rounded-[18px] px-4 py-[10px] font-sans text-[13px] font-extrabold text-[var(--c-2vtjkg)] no-underline"
              style={{
                background: 'var(--ff-accent-soft)',
                boxShadow: '0 6px 20px var(--c-fc5pjb)',
              }}
            >
              {t('dashboard.topbar.login')}
            </Link>
          )}
          <div
            className="flex gap-1 rounded-[20px] p-[5px]"
            style={{
              background: 'var(--c-ijr2u8)',
              boxShadow: '0 6px 20px var(--c-fc5pjb)',
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
                background: isFocus ? 'var(--c-6rf2rk)' : 'transparent',
                color: isFocus ? 'var(--c-2mhlk3)' : 'var(--c-1kei8bt)',
              }}
            >
              {t('dashboard.topbar.tabFocus')}
            </button>
            <button
              onClick={() => setMode('dashboard')}
              className="rounded-[15px] border-none px-4 py-2 font-sans text-[13px] font-bold transition-all duration-[260ms]"
              style={{
                background: !isFocus ? 'var(--c-6rf2rk)' : 'transparent',
                color: !isFocus ? 'var(--c-2mhlk3)' : 'var(--c-1kei8bt)',
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
              background: 'var(--c-6reyzi)',
              backdropFilter: 'blur(18px)',
              boxShadow: '0 24px 70px var(--c-1k1wm30)',
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
              stroke="var(--c-50bz5d)"
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
                    <span className="text-[13px] font-extrabold tracking-[1.2px] text-[var(--c-1kei8zx)] uppercase">
                      {t('dashboard.clock.loopLabel')}
                    </span>
                    <div className="flex items-center">
                      <div className="h-9 w-0 shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-out group-hover:mr-[14px] group-hover:w-9 focus-within:mr-[14px] focus-within:w-9">
                        <button
                          onClick={() => nudgeLoopCount(-1)}
                          aria-label="-"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-3suggt)] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'var(--c-6rf20v)' }}
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
                          className="rounded-lg border-none text-center text-3xl font-extrabold text-[var(--c-3bsl4p)] tabular-nums outline-none"
                          style={{ width: '1.5em', background: 'var(--c-ijr2v3)' }}
                        />
                      ) : (
                        <span
                          onClick={() => beginEditField('loop')}
                          title={t('dashboard.clock.editHint')}
                          className="cursor-pointer text-3xl font-extrabold text-[var(--c-3bsl4p)] tabular-nums transition-opacity duration-200 hover:opacity-70"
                        >
                          {sessionCount}
                        </span>
                      )}
                      <div className="h-9 w-0 shrink-0 overflow-hidden transition-[width,margin] duration-200 ease-out group-hover:ml-[14px] group-hover:w-9 focus-within:ml-[14px] focus-within:w-9">
                        <button
                          onClick={() => nudgeLoopCount(1)}
                          aria-label="+"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-3suggt)] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'var(--c-6rf20v)' }}
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
                      <span className="mb-[6px] text-[13px] font-extrabold tracking-[1.2px] text-[var(--c-1kei8zx)] uppercase">
                        {t('dashboard.clock.workLabel')}
                      </span>
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mb-[6px] group-hover:h-9 focus-within:mb-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeFocusMinutes(5)}
                          aria-label="+"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-3suggt)] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'var(--c-6rf20v)' }}
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
                          className="rounded-2xl border-none text-center font-extrabold text-[var(--c-3bsl4p)] tabular-nums outline-none"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)', width: '2em', background: 'var(--c-ijr2v3)' }}
                        />
                      ) : (
                        <span
                          onClick={() => beginEditField('work')}
                          title={t('dashboard.clock.editHint')}
                          className="cursor-pointer leading-none font-extrabold text-[var(--c-3bsl4p)] tabular-nums transition-opacity duration-200 hover:opacity-70"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)' }}
                        >
                          {focusMin}
                        </span>
                      )}
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mt-[6px] group-hover:h-9 focus-within:mt-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeFocusMinutes(-5)}
                          aria-label="-"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-3suggt)] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'var(--c-6rf20v)' }}
                        >
                          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="flex w-[76px] flex-col items-center">
                      <span className="mb-[6px] text-[13px] font-extrabold tracking-[1.2px] text-[var(--c-1kei8zx)] uppercase">
                        {t('dashboard.clock.breakColumnLabel')}
                      </span>
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mb-[6px] group-hover:h-9 focus-within:mb-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeBreakMinutes(1)}
                          aria-label="+"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-3suggt)] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'var(--c-6rf20v)' }}
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
                          className="rounded-2xl border-none text-center font-extrabold text-[var(--c-3bsl4p)] tabular-nums outline-none"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)', width: '2em', background: 'var(--c-ijr2v3)' }}
                        />
                      ) : (
                        <span
                          onClick={() => beginEditField('break')}
                          title={t('dashboard.clock.editHint')}
                          className="cursor-pointer leading-none font-extrabold text-[var(--c-3bsl4p)] tabular-nums transition-opacity duration-200 hover:opacity-70"
                          style={{ fontSize: 'clamp(40px, 7.5vh, 52px)' }}
                        >
                          {breakMin}
                        </span>
                      )}
                      <div className="h-0 w-9 shrink-0 overflow-hidden transition-[height,margin] duration-200 ease-out group-hover:mt-[6px] group-hover:h-9 focus-within:mt-[6px] focus-within:h-9">
                        <button
                          onClick={() => nudgeBreakMinutes(-1)}
                          aria-label="-"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-3suggt)] shadow-sm transition-colors duration-200 hover:!bg-white"
                          style={{ background: 'var(--c-6rf20v)' }}
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
                    className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full border-none text-[var(--c-2k9xd7)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_var(--c-1k1wm6g)]"
                    style={{ background: 'var(--c-6rf20v)', boxShadow: '0 10px 26px var(--c-1k1wm30)' }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                </>
              ) : done ? (
                <>
                  <span className="text-[13px] font-bold tracking-[1.6px] text-[var(--c-1kei8bt)] uppercase">
                    {t('dashboard.clock.doneTitle')}
                  </span>
                  <span className="leading-none" style={{ fontSize: 'clamp(36px, 7vh, 60px)' }}>
                    🎉
                  </span>
                  <span className="text-[13px] font-semibold text-[var(--c-mfvyic)]">
                    {t('dashboard.clock.doneHint', { count: sessionCount })}
                  </span>
                  <button
                    onClick={backToSetup}
                    className="mt-1 rounded-[22px] border-none px-[26px] py-[13px] font-sans text-[15px] font-extrabold text-[var(--c-2k9xd7)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_var(--c-1k1wm6g)]"
                    style={{ background: 'var(--c-6rf1ya)', boxShadow: '0 10px 26px var(--c-1k1wm30)' }}
                  >
                    {t('dashboard.controls.newRound')}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[13px] font-bold text-[var(--c-mfvyic)] tabular-nums">
                    {round}/{sessionCount}
                  </span>
                  <span className="text-[13px] font-bold tracking-[1.6px] text-[var(--c-1kei8bt)] uppercase">
                    {phase === 'focus' ? t('dashboard.clock.focusing') : t('dashboard.clock.onBreak')}
                  </span>
                  <span
                    className="leading-none font-extrabold text-[var(--c-3bsl4p)] tabular-nums"
                    style={{ fontSize: 'clamp(34px, 7.5vh, 60px)', letterSpacing: '-2px' }}
                  >
                    {fmtHMS(left)}
                  </span>
                  <div className="mt-1 flex items-center gap-4">
                    <button
                      onClick={cancelPomodoro}
                      title={t('dashboard.controls.cancel')}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                      style={{ background: 'var(--c-ijr2u8)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="2" />
                      </svg>
                    </button>
                    <button
                      onClick={toggleRun}
                      title={running ? t('dashboard.controls.pause') : t('dashboard.controls.resume')}
                      className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border-none text-[var(--c-2k9xd7)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5"
                      style={{ background: 'var(--c-6rf20v)', boxShadow: '0 10px 26px var(--c-1k1wm30)' }}
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
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                      style={{ background: 'var(--c-ijr2u8)' }}
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
                  className="leading-none font-extrabold text-[var(--c-3bsl4p)] tabular-nums"
                  style={{ fontSize: 'clamp(34px, 7.5vh, 60px)', letterSpacing: '-2px' }}
                >
                  {fmtHMS(0)}
                </span>
                <button
                  onClick={startEndless}
                  title={t('dashboard.controls.start')}
                  className="flex h-[64px] w-[64px] shrink-0 items-center justify-center rounded-full border-none text-[var(--c-2k9xd7)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_30px_var(--c-1k1wm6g)]"
                  style={{ background: 'var(--c-6rf20v)', boxShadow: '0 10px 26px var(--c-1k1wm30)' }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </>
            ) : (
              <>
                <span
                  className="leading-none font-extrabold text-[var(--c-3bsl4p)] tabular-nums"
                  style={{ fontSize: 'clamp(34px, 7.5vh, 60px)', letterSpacing: '-2px' }}
                >
                  {fmtHMS(endlessSeconds)}
                </span>
                <div className="mt-1 flex items-center gap-4">
                  <button
                    onClick={cancelEndless}
                    title={t('dashboard.controls.cancel')}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'var(--c-ijr2u8)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="6" y="6" width="12" height="12" rx="2" />
                    </svg>
                  </button>
                  <button
                    onClick={toggleEndlessRun}
                    title={endlessRunning ? t('dashboard.controls.pause') : t('dashboard.controls.resume')}
                    className="flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full border-none text-[var(--c-2k9xd7)] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5"
                    style={{ background: 'var(--c-6rf20v)', boxShadow: '0 10px 26px var(--c-1k1wm30)' }}
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
              background: timerType === 'pomodoro' ? 'var(--c-6rf2oz)' : 'var(--c-ijr2td)',
              color: timerType === 'pomodoro' ? 'var(--c-2k9xd7)' : 'var(--c-1kei8bt)',
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
              background: timerType === 'endless' ? 'var(--c-6rf2oz)' : 'var(--c-ijr2td)',
              color: timerType === 'endless' ? 'var(--c-2k9xd7)' : 'var(--c-1kei8bt)',
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

      {/* left widgets — hidden on mobile (would overlap the right column at narrow widths).
          1 panel liền (viền hairline + divider giữa 2 section) thay vì 2 card rời không viền —
          tránh cảm giác "hộp trôi nổi", xem thêm ghi chú thiết kế trong PLAN.md giai đoạn 10. */}
      <div
        className="absolute top-24 left-8 hidden w-[232px] flex-col md:flex"
        style={{
          ...dashStyleBase,
          transform: `translateX(${dashVisible ? '0px' : '-24px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div
          className="overflow-hidden rounded-[24px]"
          style={{
            background: 'var(--c-6rf0gw)',
            backdropFilter: 'blur(20px) saturate(140%)',
            boxShadow: '0 10px 28px var(--c-1w98bua)',
            border: '1px solid var(--ff-border)',
          }}
        >
          <div className="px-5 py-[18px]">
            <div className="text-[34px] leading-none font-extrabold text-[var(--c-3bsl4p)] tabular-nums">
              {clockTimeText}
            </div>
            <div className="mt-[6px] text-[13px] leading-tight font-bold text-[var(--c-mfvyj7)]">
              {clockDateText}
            </div>
          </div>
          <div className="px-5 py-[16px]" style={{ borderTop: '1px solid var(--ff-border)' }}>
            <div className="mb-[10px] text-xs font-bold tracking-[1.2px] text-[var(--c-mfvyic)] uppercase">
              {t('dashboard.leftWidgets.inProgress')}
            </div>
            <div className="flex items-start gap-[10px]">
              <svg width="26" height="26" viewBox="0 0 36 36" className="mt-[2px] shrink-0">
                <circle cx="18" cy="18" r="14" fill="none" stroke="var(--c-50bz5d)" strokeWidth="4" />
                {hasTasks && (
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke={ACCENT}
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 14}
                    strokeDashoffset={2 * Math.PI * 14 * (1 - doneCount / tasks.length)}
                    style={{ transition: 'stroke-dashoffset 480ms ease' }}
                    transform="rotate(-90 18 18)"
                  />
                )}
              </svg>
              <div>
                <div className="text-[15px] leading-[1.4] font-bold text-[var(--c-3bsl4p)]">
                  {!hasTasks ? t('dashboard.leftWidgets.empty') : active ? active.name : t('dashboard.leftWidgets.allDone')}
                </div>
                <div className="mt-[6px] text-[13px] font-semibold text-[var(--c-mfvyic)]">
                  {!hasTasks
                    ? t('dashboard.leftWidgets.emptyHint')
                    : t('dashboard.leftWidgets.remaining', { open: openCount, done: doneCount })}
                </div>
              </div>
            </div>
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
          onClick={openStudyPanel}
          className="flex w-full items-center gap-3 rounded-[24px] px-[18px] py-[15px] text-left text-inherit transition-[transform,background] duration-[220ms] hover:!bg-white hover:!-translate-y-0.5"
          style={{
            background: panel === 'study' ? 'var(--c-1gyy7ef)' : 'var(--c-6rf17l)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 12px 30px var(--c-1k1wm30)',
          }}
        >
          <span
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[14px] text-[var(--c-3bts4x)]"
            style={{ background: 'var(--c-hclrbt)' }}
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
            <span className="text-sm font-extrabold text-[var(--c-3bsl4p)]">
              {t('dashboard.rightColumn.studyTogether')}
            </span>
            <span className="text-xs font-semibold text-[var(--c-1kei8bt)]">
              {t('dashboard.rightColumn.findStudyBuddy')}
            </span>
          </span>
        </button>
      </div>

      {/* study together popup — cùng khuôn backdrop+card tròn-32px với FriendsPanel/Settings/Stats
          (thay vì khung nhỏ neo cạnh nút như wallpaper/music/todo). Gọn theo "hướng B — quyết định
          trước" (GĐ10 tiếp): cài đặt thời lượng/ngôn ngữ gập lại 1 dòng tóm tắt (bấm "Đổi" mới bung
          ra), 1 nút chính "Ghép ngẫu nhiên" nổi bật, "Duyệt phòng" hạ xuống thành link phụ — vì đa
          số người dùng chỉ bấm ghép ngẫu nhiên rồi đi. */}
      {panel === 'study' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'var(--c-1klvacf)', backdropFilter: 'blur(2px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setPanel(null)
          }}
        >
          <div
            className="relative flex w-full max-w-[380px] flex-col overflow-hidden rounded-[28px] font-sans text-[var(--c-32fr7s)] antialiased"
            style={{
              maxHeight: '88vh',
              background: 'linear-gradient(170deg, var(--c-1fqdrzz) 0%, var(--c-1fyn1i5) 50%, var(--c-1frhffa) 100%)',
              boxShadow: '0 30px 80px var(--c-1klv9ob)',
            }}
          >
            <div className="flex-1 overflow-y-auto">
              <div className="flex flex-col gap-[16px] px-6 pt-7 pb-7">
                <div className="flex items-center gap-[11px]">
                  <div
                    className="h-[20px] w-[20px] rounded-[8px]"
                    style={{ background: 'linear-gradient(135deg, var(--c-1feyjhs), var(--c-yr829))' }}
                  />
                  <span className="text-[16px] font-extrabold tracking-[-0.2px] text-[var(--c-3dfktp)]">{t('app.name')}</span>
                  <button
                    onClick={() => setPanel(null)}
                    title={t('dashboard.wallpaperPopup.close')}
                    aria-label={t('dashboard.wallpaperPopup.close')}
                    className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'var(--c-ijr2v3)' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>

                <span className="text-[19px] font-extrabold tracking-[-0.3px] text-[var(--c-2vtjkg)]">
                  {t('dashboard.studyPopup.title')}
                </span>

                <div className="flex items-center gap-3 rounded-[16px] px-5 py-[12px]" style={{ background: 'var(--c-rucw5u)' }}>
                  <span className="text-[13.5px] font-bold text-[var(--c-3bsl4p)]">
                    {RANDOM_MATCH_CONFIG.focus_minutes} / {RANDOM_MATCH_CONFIG.focus_minutes === 25 ? 5 : 10} · Tiếng Việt
                  </span>
                </div>

                <div className="flex flex-col gap-[8px]">
                  <button
                    onClick={startGroupMatch}
                    className="w-full rounded-[18px] border-none py-[15px] text-center font-sans text-[15px] font-extrabold text-white transition-transform duration-200 hover:-translate-y-0.5"
                    style={{
                      background: 'linear-gradient(135deg, var(--c-cvfsr8), var(--c-ecaxup))',
                      boxShadow: '0 14px 30px var(--c-10f8f7j)',
                    }}
                  >
                    {t('dashboard.studyPopup.tabRandom')}
                  </button>
                  <span className="text-center text-[12px] font-semibold text-[var(--c-mfvyic)]">
                    {t('dashboard.studyPopup.randomHint')}
                  </span>
                </div>

                <Link
                  to="/matching"
                  onClick={() => setPanel(null)}
                  className="text-center font-sans text-[13.5px] font-extrabold no-underline"
                  style={{ color: 'var(--c-2vwdyb)' }}
                >
                  {t('dashboard.studyPopup.tabBrowse')} →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* taskbar */}
      <div
        className="absolute bottom-[34px] left-1/2 flex max-w-[calc(100vw-24px)] items-center gap-1 overflow-x-auto rounded-[26px] p-[8px] md:max-w-none md:gap-2 md:p-[10px]"
        style={{
          ...dashStyleBase,
          background: 'var(--c-6rf0kc)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px var(--c-1k1wm30)',
          transform: `translate(-50%, ${dashVisible ? '0px' : '26px'})`,
          transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <button
          onClick={() => togglePanel('wp')}
          title={t('dashboard.taskbar.wallpaperTitle')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[var(--c-33k90l)] transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:px-5"
          style={{ background: panel === 'wp' ? 'var(--c-6rf2rk)' : 'var(--c-6reybe)' }}
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
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[var(--c-33k90l)] transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:px-5"
          style={{
            background: panel === 'music' ? 'var(--c-6rf2rk)' : 'var(--c-6reybe)',
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
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[var(--c-33k90l)] transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:px-5"
          style={{ background: panel === 'todo' ? 'var(--c-6rf2rk)' : 'var(--c-6reybe)' }}
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
            className="rounded-full px-2 py-[2px] text-xs font-extrabold text-[var(--c-3bts4x)]"
            style={{ background: 'var(--c-iz1xfk)' }}
          >
            {openCount}
          </span>
        </button>
        <button
          onClick={openStudyPanel}
          title={t('dashboard.taskbar.studyTogetherTitle')}
          aria-label={t('dashboard.taskbar.studyTogetherTitle')}
          className="flex shrink-0 items-center gap-[9px] rounded-[19px] border-none px-3 py-3 font-sans text-sm font-bold text-[var(--c-33k90l)] transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:hidden"
          style={{ background: panel === 'study' ? 'var(--c-ijr2wt)' : 'var(--c-6reybe)' }}
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
        <button
          type="button"
          onClick={() =>
            requireAuth(() => {
              setPanel(null)
              setStatsOpen(true)
            })
          }
          title={t('dashboard.taskbar.stats')}
          className="flex shrink-0 items-center rounded-[19px] border-none px-3 py-3 font-sans text-[12px] font-extrabold text-[var(--c-33k90l)] transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:hidden"
          style={{ background: 'var(--c-6reybe)' }}
        >
          {t('dashboard.taskbar.stats')}
        </button>
      </div>

      {/* bạn bè — standalone icon-only button, cạnh trái nút camera, cùng hàng cùng kiểu
          (tròn, frosted glass) với Stats/Settings/camera. Badge đỏ hiện số lời mời kết bạn
          đang chờ, lấy từ friendNotifications store (subscribe realtime ở App.tsx). */}
      <button
        onClick={() =>
          requireAuth(() => {
            setPanel(null)
            setFriendsOpen(true)
          })
        }
        title={t('dashboard.taskbar.friendsTitle')}
        aria-label={t('dashboard.taskbar.friendsTitle')}
        className="absolute right-[180px] bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:right-[200px]"
        style={{
          ...dashStyleBase,
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'var(--c-6rf0kc)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px var(--c-1k1wm30)',
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
            style={{ background: 'var(--c-1ep8226)' }}
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
        className="absolute right-[124px] bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:right-[144px]"
        style={{
          ...dashStyleBase,
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'var(--c-6rf0kc)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px var(--c-1k1wm30)',
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
            style={{ background: 'var(--c-t8fca9)', boxShadow: '0 0 0 2px var(--c-6rf20v)' }}
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
            background: 'var(--c-6rf0gw)',
            backdropFilter: 'blur(16px)',
            boxShadow: '0 10px 28px var(--c-1w98bua)',
            transform: `translateY(${dashVisible ? '0px' : '26px'})`,
            transition: 'opacity 520ms ease, transform 520ms cubic-bezier(0.22,1,0.36,1)',
          }}
        >
          <div
            className="relative flex h-[148px] items-center justify-center overflow-hidden rounded-[18px]"
            style={{ background: 'linear-gradient(150deg, var(--c-1b2b91a), var(--c-1yu9b2))' }}
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
              className="absolute top-[10px] left-[10px] flex items-center gap-[6px] rounded-full px-[9px] py-1 text-[11px] font-extrabold tracking-[0.4px] text-[var(--c-3bsl4p)]"
              style={{ background: 'var(--c-6rf1ya)' }}
            >
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: 'var(--c-t8fca9)' }} />
              {t('dashboard.rightColumn.you')}
            </div>
          </div>
          <button
            onClick={() => setCameraOn(false)}
            className="mt-[10px] w-full rounded-[15px] border-none py-[10px] font-sans text-[13px] font-extrabold text-[var(--c-3bsl4p)] transition-colors duration-[220ms] hover:!bg-white"
            style={{ background: 'var(--c-6rf17l)' }}
          >
            {t('dashboard.rightColumn.turnOffCamera')}
          </button>
        </div>
      )}

      {/* stats — standalone icon-only button, ngay cạnh trái nút Cài đặt, cùng hàng cùng
          kiểu (tròn, frosted glass) — thay cho link text "Stats" trước đây nằm rời trong
          card "Study together". Cùng pattern hiện/ẩn theo dashVisible/panel với gear. */}
      <button
        onClick={() =>
          requireAuth(() => {
            setPanel(null)
            setStatsOpen(true)
          })
        }
        title={t('dashboard.taskbar.stats')}
        aria-label={t('dashboard.taskbar.stats')}
        className="absolute right-[68px] bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] no-underline transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:right-[88px]"
        style={{
          ...dashStyleBase,
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'var(--c-6rf0kc)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px var(--c-1k1wm30)',
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
        onClick={() =>
          requireAuth(() => {
            setPanel(null)
            setSettingsOpen(true)
          })
        }
        title={t('dashboard.taskbar.settingsTitle')}
        aria-label={t('dashboard.taskbar.settingsTitle')}
        className="absolute right-3 bottom-[34px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-33k90l)] no-underline transition-colors duration-[240ms] hover:!bg-[var(--c-ijr2wt)] md:right-8"
        style={{
          ...dashStyleBase,
          // popup nào cũng nổi đè lên đúng góc này (todo panel full-height bên phải, wallpaper/music
          // popup căn giữa-dưới) — ẩn hẳn gear lúc đó thay vì chỉ dựa vào z-index, để chắc chắn
          // không bao giờ đè lên chữ/nút trong popup dù ở kích thước màn hình nào.
          opacity: dashVisible && panel === null ? 1 : 0,
          pointerEvents: dashVisible && panel === null ? 'auto' : 'none',
          background: 'var(--c-6rf0kc)',
          backdropFilter: 'blur(18px)',
          boxShadow: '0 14px 34px var(--c-1k1wm30)',
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
      {onboardingOpen && <GuestOnboarding onClose={() => setOnboardingOpen(false)} />}

      {/* quick match — lobby thật (GĐ10 tiếp): thấy ngay ai đã vào qua Realtime thay vì
          spinner trắng + số đếm ước lượng cũ */}
      {(quick.stage === 'lobby' || quick.stage === 'expired') && (
        <LobbyWaiting
          members={quick.lobbyMembers}
          memberCount={quick.memberCount}
          capacity={quick.capacity}
          secondsRemaining={quick.secondsRemaining}
          expired={quick.stage === 'expired'}
          matchError={quick.matchError}
          onCancel={() => quick.cancel()}
          onRetry={() => void quick.start()}
        />
      )}

      {/* match thành công — card hồ sơ người cùng học (GĐ9) */}
      {quick.stage === 'matched' && quick.roomCode && (
        <MatchFound
          partners={quick.partners}
          roomCode={quick.roomCode}
          roomLabel={t('matching.roomTypes.chill.name')}
          onEnter={() => navigate('/room/' + quick.roomCode)}
          onClose={() => quick.reset()}
        />
      )}

      {/* wallpaper popup */}
      <div
        className="absolute bottom-[108px] left-1/2 w-[340px] rounded-[26px] p-5"
        style={{
          background: 'var(--c-ijr2vy)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 18px 44px var(--c-1k1wm4q)',
          opacity: panel === 'wp' ? 1 : 0,
          transform: `translate(-50%, ${panel === 'wp' ? '0px' : '14px'})`,
          pointerEvents: panel === 'wp' ? 'auto' : 'none',
          transition: 'opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="mb-[14px] flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-[var(--c-3bsl4p)]">
            {t('dashboard.wallpaperPopup.title')}
          </span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[var(--c-mfvyic)]"
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
                border: option.id === wp ? `2px solid ${ACCENT}` : '2px solid var(--c-ijr2v3)',
                boxShadow: '0 4px 12px var(--c-1w98bua)',
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
        {user ? (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setWpDragOver(true)
            }}
            onDragLeave={() => setWpDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setWpDragOver(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void uploadWallpaperFile(file)
            }}
            onClick={() => wpFileInputRef.current?.click()}
            className="mt-[14px] flex cursor-pointer flex-col items-center justify-center gap-[2px] rounded-[18px] border-2 border-dashed py-3 text-center transition-colors"
            style={{
              borderColor: wpDragOver ? ACCENT : 'var(--c-dhk6uu)',
              background: wpDragOver ? 'var(--c-6rf2rk)' : 'transparent',
            }}
          >
            <span className="text-xs font-bold text-[var(--c-3bsl4p)]">
              {wpUploading ? t('dashboard.wallpaperPopup.uploading') : t('dashboard.wallpaperPopup.dragHere')}
            </span>
            <span className="text-[11px] font-semibold text-[var(--c-mfvyic)]">
              {t('dashboard.wallpaperPopup.orChoose')}
            </span>
            {wpUploadMsg && (
              <span
                className="text-[11px] font-bold"
                style={{
                  color:
                    wpUploadMsg === 'done'
                      ? 'var(--ff-accent-fg)'
                      : 'var(--ff-danger-text)',
                }}
              >
                {t(
                  wpUploadMsg === 'done'
                    ? 'dashboard.wallpaperPopup.uploaded'
                    : wpUploadMsg === 'tooLarge'
                      ? 'dashboard.wallpaperPopup.tooLarge'
                      : wpUploadMsg === 'tooLargeVideo'
                        ? 'dashboard.wallpaperPopup.tooLargeVideo'
                        : 'dashboard.wallpaperPopup.uploadError',
                )}
              </span>
            )}
            <input
              ref={wpFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void uploadWallpaperFile(file)
              }}
            />
          </div>
        ) : (
          // Khách chưa đăng nhập: không có thư mục riêng để lưu ảnh, chỉ dùng hình built-in +
          // hình người khác đánh dấu dùng chung — hiển thị đúng sự thật thay vì hint "kéo vào
          // đây" (trước đây nói dối: kéo vào cũng không có tác dụng gì).
          <div className="mt-[14px] text-xs font-semibold text-[var(--c-mfvyic)]">
            {t('dashboard.wallpaperPopup.loginToUpload')}
          </div>
        )}
      </div>

      {/* music popup */}
      <div
        className="absolute bottom-[108px] left-1/2 w-[320px] rounded-[26px] p-5"
        style={{
          background: 'var(--c-ijr2vy)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 18px 44px var(--c-1k1wm4q)',
          opacity: panel === 'music' ? 1 : 0,
          transform: `translate(-50%, ${panel === 'music' ? '0px' : '14px'})`,
          pointerEvents: panel === 'music' ? 'auto' : 'none',
          transition: 'opacity 320ms ease, transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="mb-[14px] flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-[var(--c-3bsl4p)]">
            {t('dashboard.musicPopup.title')}
          </span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[var(--c-mfvyic)]"
          >
            {t('dashboard.musicPopup.close')}
          </button>
        </div>

        <div className="mb-[10px] flex gap-[7px] rounded-[18px] p-[5px]" style={{ background: 'var(--c-rucw5u)' }}>
          <button
            onClick={() => setActiveTab('library')}
            className="flex-1 rounded-xl border-none px-[6px] py-[8px] font-sans text-[12px] font-extrabold transition-all duration-[220ms]"
            style={{ background: activeTab === 'library' ? 'var(--ff-surface-solid)' : 'transparent', color: activeTab === 'library' ? 'var(--ff-text-primary)' : 'var(--c-1kei8bt)' }}
          >
            {t('dashboard.musicPopup.sourceLibrary')}
          </button>
          <button
            onClick={() => setActiveTab('youtube')}
            className="flex-1 rounded-xl border-none px-[6px] py-[8px] font-sans text-[12px] font-extrabold transition-all duration-[220ms]"
            style={{ background: activeTab === 'youtube' ? 'var(--ff-surface-solid)' : 'transparent', color: activeTab === 'youtube' ? 'var(--ff-text-primary)' : 'var(--c-1kei8bt)' }}
          >
            {t('dashboard.musicPopup.sourceYoutube')}
          </button>
        </div>

        {activeTab === 'library' && (
          <div className="flex max-h-[220px] flex-col gap-[6px] overflow-y-auto">
            {tracks.length === 0 && (
              <span className="px-[14px] py-3 text-xs font-semibold text-[var(--c-mfvyic)]">
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
                className="flex items-center gap-3 rounded-[17px] border-none px-[14px] py-3 text-left font-sans transition-colors duration-200 hover:!bg-[var(--c-40zs1j)]"
                style={{ background: i === track ? 'var(--c-40zsos)' : 'var(--c-6rezss)' }}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-[var(--c-3dfktp)]" title={tr.name}>
                  {tr.name}
                </span>
                <span className="shrink-0 text-xs font-semibold text-[var(--c-1kei7l4)]">
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
                className="min-w-0 flex-1 rounded-[15px] border-none px-[13px] py-[9px] font-sans text-[13px] font-semibold text-[var(--c-3bsl4p)] outline-none"
                style={{ background: 'var(--c-rucw5u)' }}
              />
              <button
                onClick={applyYoutubeLink}
                disabled={!ytInput.trim()}
                className="shrink-0 rounded-[15px] border-none px-[14px] py-[9px] font-sans text-[12.5px] font-extrabold text-[var(--c-2k9xd7)] disabled:opacity-50"
                style={{ background: 'var(--c-hclree)' }}
              >
                {t('dashboard.musicPopup.youtubeUse')}
              </button>
            </div>
            {ytError && <span className="text-[12px] font-semibold text-[var(--c-otf3yh)]">{t('dashboard.musicPopup.youtubeInvalid')}</span>}
            {youtubeUrl && !ytError && (
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-[var(--c-mfvyic)]">
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
                    className="shrink-0 rounded-[15px] border-none px-[14px] py-[9px] font-sans text-[12.5px] font-extrabold text-[var(--c-2k9xd7)]"
                    style={{ background: 'var(--c-hclree)' }}
                  >
                    {t('dashboard.musicPopup.play')}
                  </button>
                )}
              </div>
            )}
            {!youtubeUrl && (
              <span className="px-[14px] py-3 text-xs font-semibold text-[var(--c-mfvyic)]">
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
          background: 'var(--c-6rf1cr)',
          backdropFilter: 'blur(22px)',
          boxShadow: '-18px 0 50px var(--c-1k1wm30)',
          borderTopLeftRadius: 32,
          borderBottomLeftRadius: 32,
          transform: `translateX(${panel === 'todo' ? '0px' : '380px'})`,
          opacity: panel === 'todo' ? 1 : 0,
          pointerEvents: panel === 'todo' ? 'auto' : 'none',
          transition: 'transform 460ms cubic-bezier(0.22,1,0.36,1), opacity 360ms ease',
        }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xl font-extrabold text-[var(--c-3bsl4p)]">{t('dashboard.todoPanel.title')}</span>
          <button
            onClick={() => setPanel(null)}
            className="border-none bg-transparent font-sans text-[13px] font-bold text-[var(--c-mfvyic)]"
          >
            {t('dashboard.todoPanel.close')}
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
          {!hasTasks ? (
            <div className="flex flex-1 items-center justify-center rounded-[20px] text-[13px] font-semibold text-[var(--c-mfvyic)]">
              {t('dashboard.todoPanel.empty')}
            </div>
          ) : (
            <>
              {openTasks.map((task) => (
                <div
                  key={task.id}
                  onClick={() => toggleTask(task)}
                  draggable={draggableId === task.id}
                  onDragStart={(e) => handleDragStart(e, task)}
                  onDragOver={(e) => handleDragOver(e, task)}
                  onDrop={(e) => handleDrop(e, task)}
                  onDragEnd={handleDragEnd}
                  className="relative flex cursor-pointer items-center gap-[10px] rounded-[20px] px-[15px] py-[14px] transition-colors duration-200 hover:!bg-[var(--c-6rf2rk)]"
                  style={{
                    background: 'var(--c-6rf0kc)',
                    boxShadow: '0 4px 14px var(--c-1k1wlew)',
                    opacity: dragId === task.id ? 0.45 : 1,
                    // Vạch chèn khi kéo qua — chỉ đánh dấu điểm thả hợp lệ (cùng mức ưu tiên).
                    borderTop: dropOverId === task.id && dragId ? `2px solid ${ACCENT}` : '2px solid transparent',
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      cyclePriority(task)
                    }}
                    title={t('dashboard.todoPanel.priorityLabel', { level: t(PRIORITY_LABEL_KEY[task.priority]) })}
                    aria-label={t('dashboard.todoPanel.priorityLabel', { level: t(PRIORITY_LABEL_KEY[task.priority]) })}
                    className="h-[20px] w-[20px] shrink-0 cursor-pointer rounded-full border-[3px] border-[var(--c-6rf2rk)] p-0"
                    style={{ background: PRIORITY_COLOR[task.priority] }}
                  />
                  <div
                    className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg"
                    style={{
                      border: task.done ? `2px solid ${ACCENT}` : '2px solid var(--c-dhk6uu)',
                      background: task.done ? ACCENT : 'var(--c-ijr2wt)',
                    }}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--c-s0owyd)"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                      style={{ opacity: task.done ? 1 : 0 }}
                    >
                      <path d="M5 12.5l4.5 4.5L19 7" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1 flex-col gap-[2px]">
                    <span
                      className="block truncate text-sm font-bold"
                      style={{
                        color: task.done ? 'var(--c-1kei7ij)' : 'var(--c-3bsl4p)',
                        textDecoration: task.done ? 'line-through' : 'none',
                      }}
                    >
                      {task.name}
                    </span>
                    <span className="block truncate text-xs font-semibold text-[var(--c-1kei7ij)]">{task.meta}</span>
                  </div>
                  <button
                    onMouseDown={() => setDraggableId(task.id)}
                    onMouseUp={() => setDraggableId(null)}
                    onMouseLeave={() => setDraggableId(null)}
                    onClick={(e) => e.stopPropagation()}
                    title={t('dashboard.todoPanel.dragHandle')}
                    aria-label={t('dashboard.todoPanel.dragHandle')}
                    className="cursor-grab border-none bg-transparent p-[3px] text-[var(--c-1kei7ij)]"
                  >
                    <svg width="12" height="15" viewBox="0 0 12 15" fill="currentColor">
                      <circle cx="3" cy="2.6" r="1.5" />
                      <circle cx="9" cy="2.6" r="1.5" />
                      <circle cx="3" cy="7.5" r="1.5" />
                      <circle cx="9" cy="7.5" r="1.5" />
                      <circle cx="3" cy="12.4" r="1.5" />
                      <circle cx="9" cy="12.4" r="1.5" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteTask(task)
                    }}
                    title={t('dashboard.todoPanel.delete')}
                    aria-label={t('dashboard.todoPanel.delete')}
                    className="border-none bg-transparent p-[3px] text-[var(--c-1kei7ij)] transition-colors hover:!text-[var(--ff-danger-text)]"
                  >
                    <svg width="13" height="14" viewBox="0 0 14 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 3.5h11M5 1.8h4M2.7 3.5l.7 9a1 1 0 0 0 1 .9h5.2a1 1 0 0 0 1-.9l.7-9M5.6 6.2v4.6M8.4 6.2v4.6" />
                    </svg>
                  </button>
                </div>
              ))}
              {doneTasks.length > 0 && (
                <>
                  <div className="mt-1 px-1 text-[11px] font-extrabold tracking-wider text-[var(--c-mfvyic)] uppercase">
                    {t('dashboard.todoPanel.doneSection')} · {doneTasks.length}
                  </div>
                  {doneTasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => toggleTask(task)}
                      className="flex cursor-pointer items-center gap-[13px] rounded-[20px] px-[15px] py-[12px] transition-colors duration-200 hover:!bg-[var(--c-6rf2rk)]"
                      style={{ background: 'var(--c-6rf0kc)', opacity: 0.72 }}
                    >
                      <div
                        className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-lg"
                        style={{ border: `2px solid ${ACCENT}`, background: ACCENT }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--c-s0owyd)"
                          strokeWidth="3.2"
                          strokeLinecap="round"
                        >
                          <path d="M5 12.5l4.5 4.5L19 7" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="block truncate text-sm font-bold text-[var(--c-1kei7ij)] line-through">{task.name}</span>
                        <span className="block truncate text-xs font-semibold text-[var(--c-1kei7ij)]">{task.meta}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteTask(task)
                        }}
                        title={t('dashboard.todoPanel.delete')}
                        aria-label={t('dashboard.todoPanel.delete')}
                        className="border-none bg-transparent p-[3px] text-[var(--c-1kei7ij)] transition-colors hover:!text-[var(--ff-danger-text)]"
                      >
                        <svg width="13" height="14" viewBox="0 0 14 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1.5 3.5h11M5 1.8h4M2.7 3.5l.7 9a1 1 0 0 0 1 .9h5.2a1 1 0 0 0 1-.9l.7-9M5.6 6.2v4.6M8.4 6.2v4.6" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <div
          className="flex items-center gap-[10px] rounded-[20px] py-[6px] pr-[6px] pl-4"
          style={{ background: 'var(--c-ijr2v3)', boxShadow: '0 4px 14px var(--c-1k1wlew)' }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTask()
            }}
            placeholder={t('dashboard.todoPanel.placeholder')}
            className="flex-1 border-none bg-transparent py-[10px] font-sans text-sm font-semibold text-[var(--c-3bsl4p)] outline-none"
          />
          <button
            onClick={addTask}
            className="rounded-2xl border-none px-[18px] py-[10px] font-sans text-sm font-extrabold text-[var(--c-2k9xd7)]"
            style={{ background: 'var(--c-hclrgz)' }}
          >
            {t('dashboard.todoPanel.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { parseYoutubeUrl, DEFAULT_YOUTUBE_URL } from '../lib/youtube'
import { isVideoWallpaper } from '../lib/wallpaper'
import { loadStoredAutoFullscreenFocus, saveStoredAutoFullscreenFocus } from '../lib/focusFullscreen'
import ChangeAvatarModal from '../components/ChangeAvatarModal'
import EditInfoModal from '../components/EditInfoModal'

const GRADIENTS = [
  'linear-gradient(160deg, #dff1f4 0%, #cfe6f2 45%, #e6f4ee 100%)',
  'linear-gradient(150deg, #e8f4f0 0%, #d5e9f4 100%)',
  'linear-gradient(200deg, #d9ecf5 0%, #eaf5f1 60%, #dceef0 100%)',
  'linear-gradient(135deg, #eef3f8 0%, #dbeaf0 50%, #cfe4e6 100%)',
  'radial-gradient(120% 100% at 20% 10%, #e9f6f2 0%, #d3e6f0 70%)',
  'linear-gradient(175deg, #f0f6f7 0%, #d8eaf0 55%, #cde5df 100%)',
]

const MAX_WALLPAPER_BYTES = 5 * 1024 * 1024
// Video nền (mp4) nặng hơn ảnh tĩnh dù đã nén tốt (dù mp4 vẫn nhẹ hơn GIF nhiều lần ở cùng chất
// lượng) — cho cap riêng cao hơn thay vì dùng chung MAX_WALLPAPER_BYTES với ảnh.
const MAX_WALLPAPER_VIDEO_BYTES = 15 * 1024 * 1024
const MAX_TRACK_BYTES = 25 * 1024 * 1024

// Ảnh nền upload thường chụp thẳng từ điện thoại (4000x3000+), nặng hơn nhiều so với mức cần
// thiết để làm background (màn hình lớn nhất thực tế cũng chỉ ~2560x1440). Tự co về tối đa
// Full HD trước khi lưu lên Storage — giảm dung lượng đáng kể mà mắt thường không thấy khác
// biệt khi dùng làm nền toàn màn hình, user không cần tự nén tay.
const MAX_WALLPAPER_WIDTH = 1920
const MAX_WALLPAPER_HEIGHT = 1080

// Chỉ resize ảnh TĨNH thật (jpg/png/webp) — GIF/mp4 bỏ qua vì canvas chỉ vẽ được 1 khung hình,
// resize qua canvas sẽ làm mất hoạt hình/chuyển động (GIF chỉ còn khung đầu, video thì canvas
// không đọc được luôn).
const RESIZABLE_STATIC_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
async function resizeWallpaperIfOversized(file: File): Promise<File> {
  if (!RESIZABLE_STATIC_TYPES.has(file.type)) return file
  const bitmap = await createImageBitmap(file)
  if (bitmap.width <= MAX_WALLPAPER_WIDTH && bitmap.height <= MAX_WALLPAPER_HEIGHT) {
    bitmap.close()
    return file
  }
  const scale = Math.min(MAX_WALLPAPER_WIDTH / bitmap.width, MAX_WALLPAPER_HEIGHT / bitmap.height)
  const targetWidth = Math.round(bitmap.width * scale)
  const targetHeight = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.88))
  if (!blob) return file
  return new File([blob], file.name, { type: blob.type })
}

const ACCENT_PRESETS = [
  { hue: 195, key: 'mint' },
  { hue: 235, key: 'blue' },
  { hue: 170, key: 'green' },
  { hue: 260, key: 'purple' },
] as const

type Wallpaper = { id: string; name: string; path: string; url: string | null }
type Track = { id: string; name: string; path: string; durationSeconds: number | null; isDefault: boolean }
type Tab = 'profile' | 'app'

function fmtDuration(sec: number | null) {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
}

function readAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      resolve(Number.isFinite(audio.duration) ? audio.duration : null)
      URL.revokeObjectURL(audio.src)
    }
    audio.onerror = () => resolve(null)
    audio.src = URL.createObjectURL(file)
  })
}

const ACCENT_SOFT = 'var(--ff-accent-soft)'

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (!parts[0]) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export default function Settings({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [activeTab, setActiveTab] = useState<Tab>('profile')

  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [profileName, setProfileName] = useState('')
  const [profileTag, setProfileTag] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarModalOpen, setAvatarModalOpen] = useState(false)
  const [editInfoModalOpen, setEditInfoModalOpen] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const wallpaperInputRef = useRef<HTMLInputElement>(null)
  const trackInputRef = useRef<HTMLInputElement>(null)

  const [focus, setFocus] = useState(25)
  const [brk, setBrk] = useState(5)
  const [sessionCount, setSessionCount] = useState(4)
  const [auto, setAuto] = useState(true)
  const [saved, setSaved] = useState(false)

  const [accentHue, setAccentHue] = useState(195)
  const [notificationSound, setNotificationSound] = useState(true)
  const [autoFullscreenFocus, setAutoFullscreenFocus] = useState(loadStoredAutoFullscreenFocus)

  // Link YouTube mặc định riêng của tài khoản, dùng làm nhạc nền solo ở Dashboard khi
  // user chưa dán link nào khác trên máy đang mở (xem 3 tầng ưu tiên trong Dashboard.tsx).
  // '' = chưa đặt, Dashboard sẽ tự fallback về DEFAULT_YOUTUBE_URL.
  const [defaultYoutubeUrl, setDefaultYoutubeUrl] = useState('')
  const [defaultYoutubeError, setDefaultYoutubeError] = useState(false)
  const [defaultYoutubeSaved, setDefaultYoutubeSaved] = useState(false)

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [devicePermission, setDevicePermission] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [preferredCameraId, setPreferredCameraId] = useState('')
  const [preferredMicId, setPreferredMicId] = useState('')

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select(
        'name, tag, avatar_url, focus_minutes, break_minutes, session_count, auto_start_next, accent_hue, preferred_camera_id, preferred_mic_id, notification_sound, default_youtube_url',
      )
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setProfileName(data.name)
        setProfileTag(data.tag)
        setAvatarUrl(data.avatar_url)
        setFocus(data.focus_minutes)
        setBrk(data.break_minutes)
        setSessionCount(data.session_count)
        setAuto(data.auto_start_next)
        setAccentHue(data.accent_hue)
        setPreferredCameraId(data.preferred_camera_id ?? '')
        setPreferredMicId(data.preferred_mic_id ?? '')
        setNotificationSound(data.notification_sound)
        setDefaultYoutubeUrl(data.default_youtube_url ?? '')
      })
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('wallpapers')
      .select('id, name, storage_path')
      .eq('user_id', user.id)
      .order('created_at')
      .then(async ({ data }) => {
        if (cancelled || !data || data.length === 0) return
        const paths = data.map((r) => r.storage_path)
        const { data: signed } = await supabase.storage.from('wallpapers').createSignedUrls(paths, 3600)
        if (cancelled) return
        setWallpapers(
          data.map((r, i) => ({ id: r.id, name: r.name, path: r.storage_path, url: signed?.[i]?.signedUrl ?? null })),
        )
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('tracks')
      .select('id, name, storage_path, duration_seconds, is_default')
      .eq('user_id', user.id)
      .order('created_at')
      .then(({ data }) => {
        if (cancelled || !data) return
        setTracks(
          data.map((r) => ({
            id: r.id,
            name: r.name,
            path: r.storage_path,
            durationSeconds: r.duration_seconds,
            isDefault: r.is_default,
          })),
        )
      })
    return () => {
      cancelled = true
    }
  }, [user])

  const [streak, setStreak] = useState(0)
  const [sessionsThisWeek, setSessionsThisWeek] = useState(0)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('focus_sessions')
      .select('started_at')
      .eq('user_id', user.id)
      .eq('phase', 'focus')
      .then(({ data }) => {
        if (cancelled || !data) return
        const startOfDay = (d: Date) => {
          const x = new Date(d)
          x.setHours(0, 0, 0, 0)
          return x.getTime()
        }
        const daySet = new Set(data.map((r) => startOfDay(new Date(r.started_at))))
        const today = startOfDay(new Date())
        const yesterday = today - 86400000
        let current = 0
        if (daySet.has(today) || daySet.has(yesterday)) {
          let cursor = daySet.has(today) ? today : yesterday
          while (daySet.has(cursor)) {
            current++
            cursor -= 86400000
          }
        }
        setStreak(current)
        const weekMonday = (() => {
          const x = new Date()
          x.setHours(0, 0, 0, 0)
          x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
          return x.getTime()
        })()
        setSessionsThisWeek(data.filter((r) => new Date(r.started_at).getTime() >= weekMonday).length)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // device labels only come populated after the browser has granted camera/mic permission at least once —
  // re-enumerate right after a successful permission prompt so the <select> options get real names.
  async function loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const list = await navigator.mediaDevices.enumerateDevices()
    setCameras(list.filter((d) => d.kind === 'videoinput'))
    setMics(list.filter((d) => d.kind === 'audioinput'))
    if (list.some((d) => d.label)) setDevicePermission('granted')
  }

  useEffect(() => {
    loadDevices()
  }, [])

  async function requestDevicePermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      stream.getTracks().forEach((track) => track.stop())
      await loadDevices()
    } catch (error) {
      console.error('device permission request failed', error)
      setDevicePermission('denied')
    }
  }

  async function saveDefaults() {
    if (!user) return
    const { error } = await supabase
      .from('profiles')
      .update({ focus_minutes: focus, break_minutes: brk, session_count: sessionCount, auto_start_next: auto })
      .eq('id', user.id)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    }
  }
  function resetDefaults() {
    setFocus(25)
    setBrk(5)
    setSessionCount(4)
  }
  function applyPreset(presetFocus: number, presetBreak: number) {
    setFocus(presetFocus)
    setBrk(presetBreak)
  }

  function copyFriendCode() {
    if (!profileTag) return
    const code = `${profileName}#${profileTag}`
    if (navigator.clipboard) navigator.clipboard.writeText(code).catch(() => {})
    setCodeCopied(true)
    setTimeout(() => setCodeCopied(false), 1800)
  }

  function toggleAutoFullscreenFocus() {
    setAutoFullscreenFocus((prev) => {
      const next = !prev
      saveStoredAutoFullscreenFocus(next)
      return next
    })
  }

  function selectAccent(hue: number) {
    setAccentHue(hue)
    document.documentElement.style.setProperty('--ff-accent-h', String(hue))
    if (!user) return
    supabase
      .from('profiles')
      .update({ accent_hue: hue })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.error('update accent_hue failed', error)
      })
  }

  function selectCamera(deviceId: string) {
    setPreferredCameraId(deviceId)
    if (!user) return
    supabase
      .from('profiles')
      .update({ preferred_camera_id: deviceId || null })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.error('update preferred_camera_id failed', error)
      })
  }

  function selectMic(deviceId: string) {
    setPreferredMicId(deviceId)
    if (!user) return
    supabase
      .from('profiles')
      .update({ preferred_mic_id: deviceId || null })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.error('update preferred_mic_id failed', error)
      })
  }

  function saveDefaultYoutubeUrl() {
    const trimmed = defaultYoutubeUrl.trim()
    if (trimmed && !parseYoutubeUrl(trimmed)) {
      setDefaultYoutubeError(true)
      return
    }
    setDefaultYoutubeError(false)
    if (!user) return
    supabase
      .from('profiles')
      .update({ default_youtube_url: trimmed || null })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) {
          console.error('update default_youtube_url failed', error)
          return
        }
        setDefaultYoutubeUrl(trimmed)
        setDefaultYoutubeSaved(true)
        setTimeout(() => setDefaultYoutubeSaved(false), 1800)
      })
  }

  function toggleNotificationSound() {
    setNotificationSound((prev) => {
      const next = !prev
      if (user) {
        supabase
          .from('profiles')
          .update({ notification_sound: next })
          .eq('id', user.id)
          .then(({ error }) => {
            if (error) console.error('update notification_sound failed', error)
          })
      }
      return next
    })
  }

  async function removeWallpaper(w: Wallpaper) {
    setWallpapers((ws) => ws.filter((x) => x.id !== w.id))
    await supabase.storage.from('wallpapers').remove([w.path])
    const { error } = await supabase.from('wallpapers').delete().eq('id', w.id)
    if (error) console.error('remove wallpaper failed', error)
  }

  async function handleWallpaperFile(e: ChangeEvent<HTMLInputElement>) {
    const rawFile = e.target.files?.[0]
    e.target.value = ''
    if (!rawFile || !user) return
    // Resize trước rồi mới kiểm tra dung lượng — ảnh chụp thẳng từ điện thoại thường vượt xa
    // MAX_WALLPAPER_BYTES ở kích thước gốc nhưng lọt qua dễ dàng sau khi co về Full HD.
    const file = await resizeWallpaperIfOversized(rawFile).catch(() => rawFile)
    const isVideo = isVideoWallpaper(file.name)
    const maxBytes = isVideo ? MAX_WALLPAPER_VIDEO_BYTES : MAX_WALLPAPER_BYTES
    if (file.size > maxBytes) {
      alert(t(isVideo ? 'settings.wallpapers.tooLargeVideo' : 'settings.wallpapers.tooLarge'))
      return
    }
    const path = `${user.id}/${crypto.randomUUID()}-${file.name}`
    const { error: upErr } = await supabase.storage.from('wallpapers').upload(path, file)
    if (upErr) {
      console.error('upload wallpaper failed', upErr)
      return
    }
    const { data: row, error: insErr } = await supabase
      .from('wallpapers')
      .insert({ user_id: user.id, name: file.name, storage_path: path })
      .select('id')
      .single()
    if (insErr || !row) {
      console.error('insert wallpaper row failed', insErr)
      return
    }
    const { data: signed } = await supabase.storage.from('wallpapers').createSignedUrl(path, 3600)
    setWallpapers((ws) => [...ws, { id: row.id, name: file.name, path, url: signed?.signedUrl ?? null }])
  }

  function renameTrack(id: string, name: string) {
    setTracks((ts) => ts.map((track) => (track.id === id ? { ...track, name } : track)))
  }
  function commitTrackName(track: Track) {
    supabase
      .from('tracks')
      .update({ name: track.name })
      .eq('id', track.id)
      .then(({ error }) => {
        if (error) console.error('rename track failed', error)
      })
  }
  async function removeTrack(track: Track) {
    setTracks((ts) => ts.filter((x) => x.id !== track.id))
    await supabase.storage.from('tracks').remove([track.path])
    const { error } = await supabase.from('tracks').delete().eq('id', track.id)
    if (error) console.error('remove track failed', error)
  }
  async function toggleDefault(track: Track) {
    const next = !track.isDefault
    setTracks((ts) => ts.map((x) => (x.id === track.id ? { ...x, isDefault: next } : x)))
    const { error } = await supabase.from('tracks').update({ is_default: next }).eq('id', track.id)
    if (error) {
      console.error('toggle default track failed', error)
      setTracks((ts) => ts.map((x) => (x.id === track.id ? { ...x, isDefault: !next } : x)))
    }
  }
  async function handleTrackFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    if (file.size > MAX_TRACK_BYTES) {
      alert(t('settings.music.tooLarge'))
      return
    }
    const durationSeconds = await readAudioDuration(file)
    const path = `${user.id}/${crypto.randomUUID()}-${file.name}`
    const { error: upErr } = await supabase.storage.from('tracks').upload(path, file)
    if (upErr) {
      console.error('upload track failed', upErr)
      return
    }
    const { data: row, error: insErr } = await supabase
      .from('tracks')
      .insert({ user_id: user.id, name: file.name, storage_path: path, duration_seconds: durationSeconds ? Math.round(durationSeconds) : null })
      .select('id')
      .single()
    if (insErr || !row) {
      console.error('insert track row failed', insErr)
      return
    }
    setTracks((ts) => [
      ...ts,
      { id: row.id, name: file.name, path, durationSeconds: durationSeconds ? Math.round(durationSeconds) : null, isDefault: false },
    ])
  }

  const devicesReady = devicePermission === 'granted'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,32,42,0.42)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex w-full max-w-[880px] flex-col overflow-hidden rounded-[32px] font-sans text-[#33475e] antialiased"
        style={{
          maxHeight: '88vh',
          background: 'linear-gradient(170deg, #e4f1f4 0%, #dbeaf2 50%, #e6f4ee 100%)',
          boxShadow: '0 30px 80px rgba(20,32,42,0.35)',
        }}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[880px] flex-col gap-[18px] px-8 pt-11 pb-[60px]">
            <div className="flex items-center gap-[11px]">
              <div
                className="h-[22px] w-[22px] rounded-[9px]"
                style={{ background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))' }}
              />
              <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[#2f4459]">{t('app.name')}</span>
              <span className="text-sm font-semibold text-[rgba(51,71,94,0.5)]">
                · {t('settings.headerTag')}
              </span>
              <button
                onClick={onClose}
                title={t('settings.close')}
                aria-label={t('settings.close')}
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'rgba(255,255,255,0.7)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* tabs */}
        <div
          className="flex w-fit gap-1 rounded-[20px] p-[5px]"
          style={{ background: 'rgba(255,255,255,0.6)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)', backdropFilter: 'blur(14px)' }}
        >
          {(['profile', 'app'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="rounded-[15px] border-none px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[240ms]"
              style={{
                background: activeTab === tab ? 'rgba(255,255,255,0.95)' : 'transparent',
                color: activeTab === tab ? '#25415c' : 'rgba(51,71,94,0.55)',
              }}
            >
              {t(`settings.tabs.${tab}`)}
            </button>
          ))}
        </div>

        {activeTab === 'profile' && (
          <>
            {/* profile */}
            <div
              className="flex flex-wrap items-center gap-5 rounded-[32px] px-7 py-[26px]"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={profileName}
                  className="h-[84px] w-[84px] shrink-0 rounded-[28px] object-cover"
                  style={{ boxShadow: '0 8px 22px rgba(58,98,126,0.12)' }}
                />
              ) : (
                <div
                  className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[28px] text-[28px] font-extrabold text-[#294a5f]"
                  style={{
                    background: 'linear-gradient(140deg, rgba(140,205,196,0.6), rgba(160,200,225,0.6))',
                    boxShadow: '0 8px 22px rgba(58,98,126,0.12)',
                  }}
                >
                  {initials(profileName || user?.email || '?')}
                </div>
              )}
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
                <span className="text-[22px] font-extrabold tracking-[-0.3px] text-[#2c3f55]">
                  {profileName || t('settings.profile.defaultName')}
                </span>
                <span className="text-sm font-semibold break-words text-[rgba(51,71,94,0.55)]">{user?.email}</span>
                {profileTag && (
                  <div className="flex flex-wrap items-center gap-[9px]">
                    <span className="text-[12.5px] font-bold tabular-nums text-[rgba(51,71,94,0.5)]">
                      {t('settings.profile.friendCode', { handle: `${profileName}#${profileTag}` })}
                    </span>
                    <button
                      onClick={copyFriendCode}
                      className="shrink-0 rounded-[10px] border-none px-[9px] py-[3px] font-sans text-[11.5px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
                      style={{ background: ACCENT_SOFT }}
                    >
                      {codeCopied ? t('settings.profile.codeCopied') : t('settings.profile.copyCode')}
                    </button>
                  </div>
                )}
                <span className="text-[13px] font-bold text-[#2c5b53]">
                  {t('settings.profile.streak', { days: streak, sessions: sessionsThisWeek })}
                </span>
              </div>
              <div className="flex flex-wrap gap-[9px]">
                <button
                  onClick={() => setAvatarModalOpen(true)}
                  className="rounded-[20px] border-none px-5 py-[13px] font-sans text-sm font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ background: ACCENT_SOFT }}
                >
                  {t('settings.profile.changeAvatar')}
                </button>
                <button
                  onClick={() => setEditInfoModalOpen(true)}
                  className="rounded-[20px] border-[1.5px] border-[rgba(51,71,94,0.14)] bg-[rgba(255,255,255,0.8)] px-[18px] py-[13px] font-sans text-sm font-bold text-[#445c74] transition-colors duration-200 hover:!bg-white"
                >
                  {t('settings.profile.editInfo')}
                </button>
              </div>
            </div>

            {/* wallpapers */}
            <div
              className="flex flex-col gap-4 rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-extrabold text-[#2c3f55]">{t('settings.wallpapers.title')}</span>
                <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">
                  {t('settings.wallpapers.count', { count: wallpapers.length })}
                </span>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {wallpapers.map((w, i) => {
                  const isVideo = w.url && isVideoWallpaper(w.name)
                  return (
                  <div
                    key={w.id}
                    className="relative h-[100px] overflow-hidden rounded-[22px]"
                    style={{
                      ...(w.url && !isVideo
                        ? { backgroundImage: `url(${w.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                        : !w.url
                          ? { background: GRADIENTS[i % GRADIENTS.length] }
                          : {}),
                      boxShadow: '0 6px 16px rgba(58,98,126,0.1)',
                      border: i === 0 ? '2px solid var(--ff-accent-border)' : '2px solid rgba(255,255,255,0.75)',
                    }}
                  >
                    {isVideo && (
                      <video
                        className="absolute inset-0 h-full w-full object-cover"
                        src={w.url ?? undefined}
                        autoPlay
                        loop
                        muted
                        playsInline
                        onEnded={(e) => {
                          e.currentTarget.currentTime = 0
                          e.currentTarget.play().catch(() => {})
                        }}
                      />
                    )}
                    <span
                      className="absolute bottom-[9px] left-[11px] rounded-[9px] px-2 py-1 font-mono text-[10.5px] text-[rgba(51,71,94,0.62)]"
                      style={{ background: 'rgba(255,255,255,0.72)' }}
                    >
                      {w.name}
                    </span>
                    <button
                      onClick={() => removeWallpaper(w)}
                      title={t('settings.wallpapers.delete')}
                      className="absolute top-2 right-2 flex h-[26px] w-[26px] items-center justify-center rounded-[10px] border-none text-[#7a3f2c] opacity-50 transition-all duration-200 hover:!bg-[oklch(0.88_0.05_45)] hover:opacity-100"
                      style={{ background: 'rgba(255,255,255,0.8)' }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  )
                })}
                <button
                  onClick={() => wallpaperInputRef.current?.click()}
                  className="flex h-[100px] cursor-pointer flex-col items-center justify-center gap-[5px] rounded-[22px] border-2 border-dashed border-[rgba(51,71,94,0.18)] font-sans text-[13px] font-bold text-[rgba(51,71,94,0.55)] transition-all duration-[220ms] hover:!border-[rgba(126,201,198,0.9)] hover:!text-[#2c5b53]"
                  style={{ background: 'rgba(238,246,248,0.6)' }}
                >
                  <span className="text-[22px] leading-none font-bold">+</span>
                  {t('settings.wallpapers.add')}
                </button>
                <input
                  ref={wallpaperInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
                  hidden
                  onChange={handleWallpaperFile}
                />
              </div>
              <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.45)]">
                {t('settings.wallpapers.hint')}
              </span>
            </div>

            {/* music */}
            <div
              className="flex flex-col gap-[14px] rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-extrabold text-[#2c3f55]">{t('settings.music.title')}</span>
                <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">
                  {t('settings.music.count', { count: tracks.length })}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-[13px] rounded-[22px] px-4 py-[13px] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'rgba(238,246,248,0.72)' }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#2c5b53]"
                      style={{ background: 'rgba(140,205,196,0.34)' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                        <circle cx="7" cy="17" r="3" />
                        <circle cx="18" cy="15" r="3" />
                        <path d="M10 17V6l11-2v11" />
                      </svg>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                      <input
                        value={track.name}
                        onChange={(e) => renameTrack(track.id, e.target.value)}
                        onBlur={() => commitTrackName(track)}
                        className="w-full rounded-lg border-none bg-transparent py-[2px] font-sans text-[14.5px] font-bold text-[#2c3f55] outline-none focus:!bg-[rgba(126,201,198,0.14)]"
                      />
                      <span className="font-mono text-[11.5px] text-[rgba(51,71,94,0.45)]">
                        {track.path.split('/').pop()}
                      </span>
                    </div>
                    <span className="text-[13px] font-bold text-[rgba(51,71,94,0.5)]">
                      {fmtDuration(track.durationSeconds)}
                    </span>
                    <button
                      onClick={() => toggleDefault(track)}
                      title={track.isDefault ? t('settings.music.unsetDefault') : t('settings.music.setDefault')}
                      className="shrink-0 rounded-full border-none px-3 py-[6px] font-sans text-[11.5px] font-extrabold whitespace-nowrap transition-all duration-200"
                      style={{
                        background: track.isDefault ? 'var(--ff-accent-chip-active)' : 'rgba(255,255,255,0.9)',
                        color: track.isDefault ? '#134034' : 'rgba(51,71,94,0.55)',
                      }}
                    >
                      {track.isDefault ? t('settings.music.isDefault') : t('settings.music.setDefault')}
                    </button>
                    <button
                      onClick={() => removeTrack(track)}
                      title={t('settings.music.delete')}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-xl border-none text-[#7a3f2c] opacity-60 transition-all duration-200 hover:!bg-[oklch(0.88_0.05_45)] hover:opacity-100"
                      style={{ background: 'rgba(255,255,255,0.9)' }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => trackInputRef.current?.click()}
                className="flex items-center justify-center gap-[7px] rounded-[22px] border-2 border-dashed border-[rgba(51,71,94,0.18)] py-[14px] font-sans text-sm font-bold text-[rgba(51,71,94,0.55)] transition-all duration-[220ms] hover:!border-[rgba(126,201,198,0.9)] hover:!text-[#2c5b53]"
                style={{ background: 'rgba(238,246,248,0.6)' }}
              >
                <span className="text-[19px] leading-none font-bold">+</span>
                {t('settings.music.upload')}
              </button>
              <input ref={trackInputRef} type="file" accept="audio/mpeg,audio/wav,audio/*" hidden onChange={handleTrackFile} />
              <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.45)]">
                {t('settings.music.hint')}
              </span>
            </div>
          </>
        )}

        {activeTab === 'app' && (
          <>
            {/* pomodoro defaults */}
            <div
              className="flex flex-col gap-5 rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <span className="text-[17px] font-extrabold text-[#2c3f55]">{t('settings.pomodoro.title')}</span>
              <div className="flex flex-col gap-[9px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  {t('settings.pomodoro.presetsLabel')}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => applyPreset(25, 5)}
                    className="rounded-[18px] border-[1.5px] px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={{
                      background: focus === 25 && brk === 5 ? 'var(--ff-accent-chip-active)' : 'rgba(255,255,255,0.72)',
                      borderColor: focus === 25 && brk === 5 ? 'var(--ff-accent-border)' : 'rgba(51,71,94,0.12)',
                      color: focus === 25 && brk === 5 ? '#22483f' : 'rgba(51,71,94,0.68)',
                    }}
                  >
                    25 : 5
                  </button>
                  <button
                    onClick={() => applyPreset(50, 10)}
                    className="rounded-[18px] border-[1.5px] px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={{
                      background: focus === 50 && brk === 10 ? 'var(--ff-accent-chip-active)' : 'rgba(255,255,255,0.72)',
                      borderColor: focus === 50 && brk === 10 ? 'var(--ff-accent-border)' : 'rgba(51,71,94,0.12)',
                      color: focus === 50 && brk === 10 ? '#22483f' : 'rgba(51,71,94,0.68)',
                    }}
                  >
                    50 : 10
                  </button>
                </div>
              </div>
              <div className="grid gap-[22px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <div className="flex flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                      {t('settings.pomodoro.focusMinutes')}
                    </span>
                    <span className="text-[15px] font-extrabold text-[#2c5b53]">
                      {t('settings.pomodoro.minutesValue', { count: focus })}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={focus}
                    onChange={(e) => setFocus(Number(e.target.value))}
                    className="ff-range-lg"
                  />
                  <div className="flex justify-between text-[11.5px] font-semibold text-[rgba(51,71,94,0.4)]">
                    <span>5</span>
                    <span>120</span>
                  </div>
                </div>
                <div className="flex flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                      {t('settings.pomodoro.breakMinutes')}
                    </span>
                    <span className="text-[15px] font-extrabold text-[#2c5b53]">
                      {t('settings.pomodoro.minutesValue', { count: brk })}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={1}
                    value={brk}
                    onChange={(e) => setBrk(Number(e.target.value))}
                    className="ff-range-lg"
                  />
                  <div className="flex justify-between text-[11.5px] font-semibold text-[rgba(51,71,94,0.4)]">
                    <span>1</span>
                    <span>20</span>
                  </div>
                </div>
                <div className="flex flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                      {t('settings.pomodoro.sessionCount')}
                    </span>
                    <span className="text-[15px] font-extrabold text-[#2c5b53]">
                      {t('settings.pomodoro.sessionsValue', { count: sessionCount })}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={sessionCount}
                    onChange={(e) => setSessionCount(Number(e.target.value))}
                    className="ff-range-lg"
                  />
                  <div className="flex justify-between text-[11.5px] font-semibold text-[rgba(51,71,94,0.4)]">
                    <span>1</span>
                    <span>12</span>
                  </div>
                </div>
              </div>
              <div
                className="flex flex-wrap items-center justify-between gap-[14px] rounded-[22px] px-[18px] py-[15px]"
                style={{ background: 'rgba(238,246,248,0.72)' }}
              >
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[14.5px] font-bold text-[#2c3f55]">
                    {t('settings.pomodoro.autoStartTitle')}
                  </span>
                  <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.48)]">
                    {t('settings.pomodoro.autoStartDesc')}
                  </span>
                </div>
                <button
                  onClick={() => setAuto((a) => !a)}
                  className="relative h-8 w-[58px] shrink-0 rounded-full border-none transition-colors duration-[240ms]"
                  style={{ background: auto ? 'var(--ff-accent-chip-active)' : 'rgba(51,71,94,0.18)' }}
                >
                  <span
                    className="absolute top-1 h-6 w-6 rounded-full bg-white transition-[left] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ left: auto ? '30px' : '4px', boxShadow: '0 3px 8px rgba(58,98,126,0.22)' }}
                  />
                </button>
              </div>
              <div
                className="flex flex-wrap items-center justify-between gap-[14px] rounded-[22px] px-[18px] py-[15px]"
                style={{ background: 'rgba(238,246,248,0.72)' }}
              >
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[14.5px] font-bold text-[#2c3f55]">
                    {t('settings.pomodoro.autoFullscreenTitle')}
                  </span>
                  <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.48)]">
                    {t('settings.pomodoro.autoFullscreenDesc')}
                  </span>
                </div>
                <button
                  onClick={toggleAutoFullscreenFocus}
                  className="relative h-8 w-[58px] shrink-0 rounded-full border-none transition-colors duration-[240ms]"
                  style={{ background: autoFullscreenFocus ? 'var(--ff-accent-chip-active)' : 'rgba(51,71,94,0.18)' }}
                >
                  <span
                    className="absolute top-1 h-6 w-6 rounded-full bg-white transition-[left] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ left: autoFullscreenFocus ? '30px' : '4px', boxShadow: '0 3px 8px rgba(58,98,126,0.22)' }}
                  />
                </button>
              </div>
              <div className="flex flex-wrap gap-[9px]">
                <button
                  onClick={saveDefaults}
                  className="rounded-[22px] border-none px-[26px] py-[14px] font-sans text-[14.5px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ background: ACCENT_SOFT }}
                >
                  {saved ? t('settings.pomodoro.saved') : t('settings.pomodoro.save')}
                </button>
                <button
                  onClick={resetDefaults}
                  className="rounded-[22px] border-[1.5px] border-[rgba(51,71,94,0.14)] bg-[rgba(255,255,255,0.8)] px-5 py-[14px] font-sans text-[14.5px] font-bold text-[#445c74] transition-colors duration-200 hover:!bg-white"
                >
                  {t('settings.pomodoro.resetDefault')}
                </button>
              </div>
            </div>

            {/* language */}
            <div
              className="flex flex-wrap items-center justify-between gap-[14px] rounded-[32px] px-7 py-[22px]"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <span className="text-[14.5px] font-bold text-[#2c3f55]">{t('settings.language.title')}</span>
              <div className="flex gap-1 rounded-[20px] p-[5px]" style={{ background: 'rgba(238,246,248,0.9)' }}>
                {(['vi', 'en'] as const).map((lng) => {
                  const on = i18n.resolvedLanguage === lng
                  return (
                    <button
                      key={lng}
                      onClick={() => void i18n.changeLanguage(lng)}
                      className="rounded-2xl border-none px-4 py-[9px] font-sans text-[13px] font-bold transition-all duration-[240ms]"
                      style={{
                        color: on ? '#25415c' : 'rgba(51,71,94,0.55)',
                        background: on ? 'rgba(255,255,255,0.98)' : 'transparent',
                        boxShadow: on ? '0 4px 12px rgba(58,98,126,0.1)' : 'none',
                      }}
                    >
                      {t(`settings.language.${lng}`)}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* accent color */}
            <div
              className="flex flex-wrap items-center justify-between gap-[18px] rounded-[32px] px-7 py-[22px]"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <span className="text-[14.5px] font-bold text-[#2c3f55]">{t('settings.accent.title')}</span>
              <div className="flex gap-3">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.hue}
                    onClick={() => selectAccent(preset.hue)}
                    title={t(`settings.accent.${preset.key}`)}
                    aria-label={t(`settings.accent.${preset.key}`)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none transition-transform duration-200 hover:-translate-y-0.5"
                    style={{
                      background: `oklch(0.74 0.085 ${preset.hue})`,
                      boxShadow:
                        accentHue === preset.hue
                          ? '0 0 0 3px rgba(255,255,255,0.95), 0 0 0 5px rgba(51,71,94,0.35)'
                          : '0 4px 12px rgba(58,98,126,0.18)',
                    }}
                  >
                    {accentHue === preset.hue && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e3549" strokeWidth="3" strokeLinecap="round">
                        <path d="M5 12.5l4.5 4.5L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* camera / mic devices */}
            <div
              className="flex flex-col gap-4 rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <span className="text-[17px] font-extrabold text-[#2c3f55]">{t('settings.devices.title')}</span>
              {devicesReady ? (
                <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  <div className="flex flex-col gap-[6px]">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                      {t('settings.devices.cameraLabel')}
                    </span>
                    <select
                      value={preferredCameraId}
                      onChange={(e) => selectCamera(e.target.value)}
                      className="rounded-[16px] border-none px-4 py-3 font-sans text-sm font-bold text-[#2c3f55] outline-none"
                      style={{ background: 'rgba(238,246,248,0.9)' }}
                    >
                      <option value="">{t('settings.devices.systemDefault')}</option>
                      {cameras.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || d.deviceId}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-[6px]">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                      {t('settings.devices.micLabel')}
                    </span>
                    <select
                      value={preferredMicId}
                      onChange={(e) => selectMic(e.target.value)}
                      className="rounded-[16px] border-none px-4 py-3 font-sans text-sm font-bold text-[#2c3f55] outline-none"
                      style={{ background: 'rgba(238,246,248,0.9)' }}
                    >
                      <option value="">{t('settings.devices.systemDefault')}</option>
                      {mics.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || d.deviceId}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <button
                    onClick={requestDevicePermission}
                    className="rounded-[18px] border-none px-5 py-[12px] font-sans text-sm font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
                    style={{ background: ACCENT_SOFT }}
                  >
                    {t('settings.devices.grantPermission')}
                  </button>
                  {devicePermission === 'denied' && (
                    <span className="text-[12.5px] font-semibold text-[#7a3f2c]">
                      {t('settings.devices.permissionDenied')}
                    </span>
                  )}
                </div>
              )}
              <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.45)]">
                {t('settings.devices.hint')}
              </span>
            </div>

            {/* default youtube background music */}
            <div
              className="flex flex-col gap-[10px] rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <span className="text-[17px] font-extrabold text-[#2c3f55]">{t('settings.defaultMusic.title')}</span>
              <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.48)]">
                {t('settings.defaultMusic.desc')}
              </span>
              <div className="flex flex-wrap gap-[7px]">
                <input
                  value={defaultYoutubeUrl}
                  onChange={(e) => {
                    setDefaultYoutubeUrl(e.target.value)
                    setDefaultYoutubeError(false)
                  }}
                  placeholder={DEFAULT_YOUTUBE_URL}
                  className="min-w-0 flex-1 rounded-[16px] border-none px-4 py-3 font-sans text-sm font-semibold text-[#2c3f55] outline-none"
                  style={{ background: 'rgba(238,246,248,0.9)' }}
                />
                <button
                  onClick={saveDefaultYoutubeUrl}
                  className="shrink-0 rounded-[16px] border-none px-5 py-3 font-sans text-sm font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ background: ACCENT_SOFT }}
                >
                  {defaultYoutubeSaved ? t('settings.defaultMusic.saved') : t('settings.defaultMusic.save')}
                </button>
              </div>
              {defaultYoutubeError && (
                <span className="text-[12px] font-semibold text-[#a13f2c]">{t('settings.defaultMusic.invalid')}</span>
              )}
              <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.45)]">
                {defaultYoutubeUrl ? t('settings.defaultMusic.hintCustom') : t('settings.defaultMusic.hintDefault')}
              </span>
            </div>

            {/* notifications */}
            <div
              className="flex flex-wrap items-center justify-between gap-[14px] rounded-[32px] px-7 py-[22px]"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <div className="flex flex-col gap-[2px]">
                <span className="text-[14.5px] font-bold text-[#2c3f55]">{t('settings.notifications.soundTitle')}</span>
                <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.48)]">
                  {t('settings.notifications.soundDesc')}
                </span>
              </div>
              <button
                onClick={toggleNotificationSound}
                className="relative h-8 w-[58px] shrink-0 rounded-full border-none transition-colors duration-[240ms]"
                style={{ background: notificationSound ? 'var(--ff-accent-chip-active)' : 'rgba(51,71,94,0.18)' }}
              >
                <span
                  className="absolute top-1 h-6 w-6 rounded-full bg-white transition-[left] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ left: notificationSound ? '30px' : '4px', boxShadow: '0 3px 8px rgba(58,98,126,0.22)' }}
                />
              </button>
            </div>
          </>
        )}

        {/* logout */}
        <div
          className="mt-[14px] flex flex-wrap items-center justify-between gap-[14px] pt-[22px]"
          style={{ borderTop: '1.5px solid rgba(51,71,94,0.1)' }}
        >
          <span className="max-w-[420px] text-[13.5px] leading-[1.55] font-semibold text-[rgba(51,71,94,0.5)]">
            {t('settings.logout.hint')}
          </span>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              onClose()
              navigate('/auth')
            }}
            className="flex items-center gap-[9px] rounded-[22px] border-[1.5px] px-6 py-[14px] font-sans text-[14.5px] font-extrabold text-[#7a3f2c] transition-colors duration-[220ms] hover:!bg-[oklch(0.88_0.05_45)]"
            style={{ borderColor: 'oklch(0.82 0.06 45)', background: 'oklch(0.93 0.03 45)' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M15 5.5V4a2 2 0 00-2-2H6a2 2 0 00-2 2v16a2 2 0 002 2h7a2 2 0 002-2v-1.5" />
              <path d="M11 12h10m-3.5-3.5L21 12l-3.5 3.5" />
            </svg>
            {t('settings.logout.action')}
          </button>
        </div>
          </div>
        </div>
      </div>

      {avatarModalOpen && (
        <ChangeAvatarModal
          currentAvatarUrl={avatarUrl}
          displayName={profileName || user?.email || '?'}
          onClose={() => setAvatarModalOpen(false)}
          onUploaded={setAvatarUrl}
        />
      )}
      {editInfoModalOpen && (
        <EditInfoModal
          currentName={profileName}
          onClose={() => setEditInfoModalOpen(false)}
          onSaved={setProfileName}
        />
      )}
    </div>
  )
}

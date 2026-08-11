import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useThemeStore } from '../store/theme'
import { parseYoutubeUrl, DEFAULT_YOUTUBE_URL } from '../lib/youtube'
import { isVideoWallpaper, prepareWallpaperFile, WallpaperFileError, type PreparedWallpaper } from '../lib/wallpaper'
import { loadStoredAutoFullscreenFocus, saveStoredAutoFullscreenFocus } from '../lib/focusFullscreen'
import ChangeAvatarModal from '../components/ChangeAvatarModal'
import EditInfoModal from '../components/EditInfoModal'

const GRADIENTS = [
  'linear-gradient(160deg, var(--c-1g0tv9u) 0%, var(--c-1fjrplj) 45%, var(--c-1frhffa) 100%)',
  'linear-gradient(150deg, var(--c-1fsl0le) 0%, var(--c-1f9vh56) 100%)',
  'linear-gradient(200deg, var(--c-1fc3int) 0%, var(--c-1gf4lnx) 60%, var(--c-1fz6x28) 100%)',
  'linear-gradient(135deg, var(--c-1ghbqk6) 0%, var(--c-1fyn1i3) 50%, var(--c-1fjro3e) 100%)',
  'radial-gradient(120% 100% at 20% 10%, var(--c-1ft4uo7) 0%, var(--c-1f8rtq9) 70%)',
  'linear-gradient(175deg, var(--c-1g58bqa) 0%, var(--c-1fbjokx) 55%, var(--c-1fio3nu) 100%)',
]

const MAX_TRACK_BYTES = 25 * 1024 * 1024

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
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

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

  function selectTheme(next: 'light' | 'dark') {
    setTheme(next)
    if (!user) return
    supabase
      .from('profiles')
      .update({ theme: next })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.error('update theme failed', error)
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
    let prepared: PreparedWallpaper
    try {
      prepared = await prepareWallpaperFile(rawFile)
    } catch (err) {
      alert(
        t(
          err instanceof WallpaperFileError && err.code === 'tooLargeVideo'
            ? 'settings.wallpapers.tooLargeVideo'
            : 'settings.wallpapers.tooLarge',
        ),
      )
      return
    }
    const { file } = prepared
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
      style={{ background: 'var(--c-1klvacf)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex w-full max-w-[880px] flex-col overflow-hidden rounded-[32px] font-sans text-[var(--c-32fr7s)] antialiased"
        style={{
          maxHeight: '88vh',
          background: 'linear-gradient(170deg, var(--c-1fqdrzz) 0%, var(--c-1fyn1i5) 50%, var(--c-1frhffa) 100%)',
          boxShadow: '0 30px 80px var(--c-1klv9ob)',
        }}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[880px] flex-col gap-[18px] px-8 pt-11 pb-[60px]">
            <div className="flex items-center gap-[11px]">
              <div
                className="h-[22px] w-[22px] rounded-[9px]"
                style={{ background: 'linear-gradient(135deg, var(--c-1feyjhs), var(--c-yr829))' }}
              />
              <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[var(--c-3dfktp)]">{t('app.name')}</span>
              <span className="text-sm font-semibold text-[var(--c-mfvyic)]">
                · {t('settings.headerTag')}
              </span>
              <button
                onClick={onClose}
                title={t('settings.close')}
                aria-label={t('settings.close')}
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'var(--c-ijr2v3)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* tabs */}
        <div
          className="flex w-fit gap-1 rounded-[20px] p-[5px]"
          style={{ background: 'var(--c-ijr2u8)', boxShadow: '0 6px 20px var(--c-fc5pjb)', backdropFilter: 'blur(14px)' }}
        >
          {(['profile', 'app'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="rounded-[15px] border-none px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[240ms]"
              style={{
                background: activeTab === tab ? 'var(--c-6rf2rk)' : 'transparent',
                color: activeTab === tab ? 'var(--c-2mhlk3)' : 'var(--c-1kei8bt)',
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
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={profileName}
                  className="h-[84px] w-[84px] shrink-0 rounded-[28px] object-cover"
                  style={{ boxShadow: '0 8px 22px var(--c-1k1wm1a)' }}
                />
              ) : (
                <div
                  className="flex h-[84px] w-[84px] shrink-0 items-center justify-center rounded-[28px] text-[28px] font-extrabold text-[var(--c-2opriy)]"
                  style={{
                    background: 'linear-gradient(140deg, var(--c-9q3js4), var(--c-1g0dok))',
                    boxShadow: '0 8px 22px var(--c-1k1wm1a)',
                  }}
                >
                  {initials(profileName || user?.email || '?')}
                </div>
              )}
              <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
                <span className="text-[22px] font-extrabold tracking-[-0.3px] text-[var(--c-3bsl4p)]">
                  {profileName || t('settings.profile.defaultName')}
                </span>
                <span className="text-sm font-semibold break-words text-[var(--c-1kei8bt)]">{user?.email}</span>
                {profileTag && (
                  <div className="flex flex-wrap items-center gap-[9px]">
                    <span className="text-[12.5px] font-bold tabular-nums text-[var(--c-mfvyic)]">
                      {t('settings.profile.friendCode', { handle: `${profileName}#${profileTag}` })}
                    </span>
                    <button
                      onClick={copyFriendCode}
                      className="shrink-0 rounded-[10px] border-none px-[9px] py-[3px] font-sans text-[11.5px] font-extrabold text-[var(--ff-btn-soft-fg)] transition-transform duration-200 hover:-translate-y-0.5"
                      style={{ background: 'var(--ff-btn-soft-bg)' }}
                    >
                      {codeCopied ? t('settings.profile.codeCopied') : t('settings.profile.copyCode')}
                    </button>
                  </div>
                )}
                <span className="text-[13px] font-bold text-[var(--c-3bts4x)]">
                  {t('settings.profile.streak', { days: streak, sessions: sessionsThisWeek })}
                </span>
              </div>
              <div className="flex flex-wrap gap-[9px]">
                <button
                  onClick={() => setAvatarModalOpen(true)}
                  className="rounded-[20px] border-none px-5 py-[13px] font-sans text-sm font-extrabold text-[var(--ff-btn-primary-fg)] transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ background: 'var(--ff-btn-primary-bg)' }}
                >
                  {t('settings.profile.changeAvatar')}
                </button>
                <button
                  onClick={() => setEditInfoModalOpen(true)}
                  className="rounded-[20px] border-[1.5px] border-[var(--c-1kei5c6)] bg-[var(--c-ijr2vy)] px-[18px] py-[13px] font-sans text-sm font-bold text-[var(--c-3k2pts)] transition-colors duration-200 hover:!bg-white"
                >
                  {t('settings.profile.editInfo')}
                </button>
              </div>
            </div>

            {/* wallpapers */}
            <div
              className="flex flex-col gap-4 rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-extrabold text-[var(--c-3bsl4p)]">{t('settings.wallpapers.title')}</span>
                <span className="text-[13px] font-bold text-[var(--c-1kei7np)]">
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
                      boxShadow: '0 6px 16px var(--c-1w98bua)',
                      border: i === 0 ? '2px solid var(--ff-accent-border)' : '2px solid var(--c-6rf1a6)',
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
                    {/* scrim — filename must stay readable over an arbitrary user photo, not
                        just whatever the theme's surface color happens to be, so this stays
                        a fixed dark gradient in both themes instead of a token */}
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
                      style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}
                    />
                    {/* fixed light color, not a theme token — always sits on the dark
                        scrim above regardless of light/dark theme */}
                    <span className="absolute bottom-[9px] left-[11px] px-1 font-mono text-[10.5px]" style={{ color: '#e6edef' }}>
                      {w.name}
                    </span>
                    <button
                      onClick={() => removeWallpaper(w)}
                      title={t('settings.wallpapers.delete')}
                      className="absolute top-2 right-2 flex h-[26px] w-[26px] items-center justify-center rounded-[10px] border-none text-[var(--c-5nx3vn)] opacity-50 transition-all duration-200 hover:!bg-[var(--c-1eu539k)] hover:opacity-100"
                      style={{ background: 'var(--c-ijr2vy)' }}
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
                  className="flex h-[100px] cursor-pointer flex-col items-center justify-center gap-[5px] rounded-[22px] border-2 border-dashed border-[var(--c-1kei5fm)] font-sans text-[13px] font-bold text-[var(--c-1kei8bt)] transition-all duration-[220ms] hover:!border-[var(--c-125fipz)] hover:!text-[var(--c-3bts4x)]"
                  style={{ background: 'var(--c-rucw39)' }}
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
              <span className="text-[12.5px] font-semibold text-[var(--c-1kei7l4)]">
                {t('settings.wallpapers.hint')}
              </span>
            </div>

            {/* music */}
            <div
              className="flex flex-col gap-[14px] rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[17px] font-extrabold text-[var(--c-3bsl4p)]">{t('settings.music.title')}</span>
                <span className="text-[13px] font-bold text-[var(--c-1kei7np)]">
                  {t('settings.music.count', { count: tracks.length })}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {tracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-[13px] rounded-[22px] px-4 py-[13px] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'var(--c-arr030)' }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--c-3bts4x)]"
                      style={{ background: 'var(--c-hclrdj)' }}
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
                        className="w-full rounded-lg border-none bg-transparent py-[2px] font-sans text-[14.5px] font-bold text-[var(--c-3bsl4p)] outline-none focus:!bg-[var(--c-1bxn4ij)]"
                      />
                      <span className="font-mono text-[11.5px] text-[var(--c-1kei7l4)]">
                        {track.path.split('/').pop()}
                      </span>
                    </div>
                    <span className="text-[13px] font-bold text-[var(--c-mfvyic)]">
                      {fmtDuration(track.durationSeconds)}
                    </span>
                    <button
                      onClick={() => toggleDefault(track)}
                      title={track.isDefault ? t('settings.music.unsetDefault') : t('settings.music.setDefault')}
                      className="shrink-0 rounded-full border-none px-3 py-[6px] font-sans text-[11.5px] font-extrabold whitespace-nowrap transition-all duration-200"
                      style={{
                        background: track.isDefault ? 'var(--ff-accent-chip-active)' : 'var(--c-ijr2wt)',
                        color: track.isDefault ? 'var(--c-24cd5g)' : 'var(--c-1kei8bt)',
                      }}
                    >
                      {track.isDefault ? t('settings.music.isDefault') : t('settings.music.setDefault')}
                    </button>
                    <button
                      onClick={() => removeTrack(track)}
                      title={t('settings.music.delete')}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-xl border-none text-[var(--c-5nx3vn)] opacity-60 transition-all duration-200 hover:!bg-[var(--c-1eu539k)] hover:opacity-100"
                      style={{ background: 'var(--c-ijr2wt)' }}
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
                className="flex items-center justify-center gap-[7px] rounded-[22px] border-2 border-dashed border-[var(--c-1kei5fm)] py-[14px] font-sans text-sm font-bold text-[var(--c-1kei8bt)] transition-all duration-[220ms] hover:!border-[var(--c-125fipz)] hover:!text-[var(--c-3bts4x)]"
                style={{ background: 'var(--c-rucw39)' }}
              >
                <span className="text-[19px] leading-none font-bold">+</span>
                {t('settings.music.upload')}
              </button>
              <input ref={trackInputRef} type="file" accept="audio/mpeg,audio/wav,audio/*" hidden onChange={handleTrackFile} />
              <span className="text-[12.5px] font-semibold text-[var(--c-1kei7l4)]">
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
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <span className="text-[17px] font-extrabold text-[var(--c-3bsl4p)]">{t('settings.pomodoro.title')}</span>
              <div className="flex flex-col gap-[9px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                  {t('settings.pomodoro.presetsLabel')}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => applyPreset(25, 5)}
                    className="rounded-[18px] border-[1.5px] px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={{
                      background: focus === 25 && brk === 5 ? 'var(--ff-accent-chip-active)' : 'var(--c-6rf17l)',
                      borderColor: focus === 25 && brk === 5 ? 'var(--ff-accent-border)' : 'var(--c-1kei5ag)',
                      color: focus === 25 && brk === 5 ? 'var(--c-2kucx8)' : 'var(--c-1kei953)',
                    }}
                  >
                    25 : 5
                  </button>
                  <button
                    onClick={() => applyPreset(50, 10)}
                    className="rounded-[18px] border-[1.5px] px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={{
                      background: focus === 50 && brk === 10 ? 'var(--ff-accent-chip-active)' : 'var(--c-6rf17l)',
                      borderColor: focus === 50 && brk === 10 ? 'var(--ff-accent-border)' : 'var(--c-1kei5ag)',
                      color: focus === 50 && brk === 10 ? 'var(--c-2kucx8)' : 'var(--c-1kei953)',
                    }}
                  >
                    50 : 10
                  </button>
                </div>
              </div>
              <div className="grid gap-[22px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                <div className="flex flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                      {t('settings.pomodoro.focusMinutes')}
                    </span>
                    <span className="text-[15px] font-extrabold text-[var(--c-3bts4x)]">
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
                  <div className="flex justify-between text-[11.5px] font-semibold text-[var(--c-mfvyhh)]">
                    <span>5</span>
                    <span>120</span>
                  </div>
                </div>
                <div className="flex flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                      {t('settings.pomodoro.breakMinutes')}
                    </span>
                    <span className="text-[15px] font-extrabold text-[var(--c-3bts4x)]">
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
                  <div className="flex justify-between text-[11.5px] font-semibold text-[var(--c-mfvyhh)]">
                    <span>1</span>
                    <span>20</span>
                  </div>
                </div>
                <div className="flex flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                      {t('settings.pomodoro.sessionCount')}
                    </span>
                    <span className="text-[15px] font-extrabold text-[var(--c-3bts4x)]">
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
                  <div className="flex justify-between text-[11.5px] font-semibold text-[var(--c-mfvyhh)]">
                    <span>1</span>
                    <span>12</span>
                  </div>
                </div>
              </div>
              <div
                className="flex flex-wrap items-center justify-between gap-[14px] rounded-[22px] px-[18px] py-[15px]"
                style={{ background: 'var(--c-arr030)' }}
              >
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[14.5px] font-bold text-[var(--c-3bsl4p)]">
                    {t('settings.pomodoro.autoStartTitle')}
                  </span>
                  <span className="text-[12.5px] font-semibold text-[var(--c-1kei7np)]">
                    {t('settings.pomodoro.autoStartDesc')}
                  </span>
                </div>
                <button
                  onClick={() => setAuto((a) => !a)}
                  className="relative h-8 w-[58px] shrink-0 rounded-full border-none transition-colors duration-[240ms]"
                  style={{ background: auto ? 'var(--ff-accent-chip-active)' : 'var(--c-dhk6uu)' }}
                >
                  <span
                    className="absolute top-1 h-6 w-6 rounded-full bg-white transition-[left] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ left: auto ? '30px' : '4px', boxShadow: '0 3px 8px var(--c-1k1wmrz)' }}
                  />
                </button>
              </div>
              <div
                className="flex flex-wrap items-center justify-between gap-[14px] rounded-[22px] px-[18px] py-[15px]"
                style={{ background: 'var(--c-arr030)' }}
              >
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[14.5px] font-bold text-[var(--c-3bsl4p)]">
                    {t('settings.pomodoro.autoFullscreenTitle')}
                  </span>
                  <span className="text-[12.5px] font-semibold text-[var(--c-1kei7np)]">
                    {t('settings.pomodoro.autoFullscreenDesc')}
                  </span>
                </div>
                <button
                  onClick={toggleAutoFullscreenFocus}
                  className="relative h-8 w-[58px] shrink-0 rounded-full border-none transition-colors duration-[240ms]"
                  style={{ background: autoFullscreenFocus ? 'var(--ff-accent-chip-active)' : 'var(--c-dhk6uu)' }}
                >
                  <span
                    className="absolute top-1 h-6 w-6 rounded-full bg-white transition-[left] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{ left: autoFullscreenFocus ? '30px' : '4px', boxShadow: '0 3px 8px var(--c-1k1wmrz)' }}
                  />
                </button>
              </div>
              <div className="flex flex-wrap gap-[9px]">
                <button
                  onClick={saveDefaults}
                  className="rounded-[22px] border-none px-[26px] py-[14px] font-sans text-[14.5px] font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ background: ACCENT_SOFT }}
                >
                  {saved ? t('settings.pomodoro.saved') : t('settings.pomodoro.save')}
                </button>
                <button
                  onClick={resetDefaults}
                  className="rounded-[22px] border-[1.5px] border-[var(--c-1kei5c6)] bg-[var(--c-ijr2vy)] px-5 py-[14px] font-sans text-[14.5px] font-bold text-[var(--c-3k2pts)] transition-colors duration-200 hover:!bg-white"
                >
                  {t('settings.pomodoro.resetDefault')}
                </button>
              </div>
            </div>

            {/* language */}
            <div
              className="flex flex-wrap items-center justify-between gap-[14px] rounded-[32px] px-7 py-[22px]"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <span className="text-[14.5px] font-bold text-[var(--c-3bsl4p)]">{t('settings.language.title')}</span>
              <div className="flex gap-1 rounded-[20px] p-[5px]" style={{ background: 'var(--c-rucw5u)' }}>
                {(['vi', 'en'] as const).map((lng) => {
                  const on = i18n.resolvedLanguage === lng
                  return (
                    <button
                      key={lng}
                      onClick={() => void i18n.changeLanguage(lng)}
                      className="rounded-2xl border-none px-4 py-[9px] font-sans text-[13px] font-bold transition-all duration-[240ms]"
                      style={{
                        color: on ? 'var(--c-2mhlk3)' : 'var(--c-1kei8bt)',
                        background: on ? 'var(--c-6rf2u5)' : 'transparent',
                        boxShadow: on ? '0 4px 12px var(--c-1w98bua)' : 'none',
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
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <span className="text-[14.5px] font-bold text-[var(--c-3bsl4p)]">{t('settings.accent.title')}</span>
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
                          ? '0 0 0 3px var(--c-6rf2rk), 0 0 0 5px var(--c-dhk89n)'
                          : '0 4px 12px var(--c-1k1wm6g)',
                    }}
                  >
                    {accentHue === preset.hue && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c-2vtjkg)" strokeWidth="3" strokeLinecap="round">
                        <path d="M5 12.5l4.5 4.5L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* theme (light/dark) */}
            <div
              className="flex flex-wrap items-center justify-between gap-[14px] rounded-[32px] px-7 py-[22px]"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <span className="text-[14.5px] font-bold text-[var(--c-3bsl4p)]">{t('settings.theme.title')}</span>
              <div className="flex gap-1 rounded-[20px] p-[5px]" style={{ background: 'var(--c-rucw5u)' }}>
                {(['light', 'dark'] as const).map((mode) => {
                  const on = theme === mode
                  return (
                    <button
                      key={mode}
                      onClick={() => selectTheme(mode)}
                      className="rounded-2xl border-none px-4 py-[9px] font-sans text-[13px] font-bold transition-all duration-[240ms]"
                      style={{
                        color: on ? 'var(--c-2mhlk3)' : 'var(--c-1kei8bt)',
                        background: on ? 'var(--c-6rf2u5)' : 'transparent',
                        boxShadow: on ? '0 4px 12px var(--c-1w98bua)' : 'none',
                      }}
                    >
                      {t(`settings.theme.${mode}`)}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* camera / mic devices */}
            <div
              className="flex flex-col gap-4 rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <span className="text-[17px] font-extrabold text-[var(--c-3bsl4p)]">{t('settings.devices.title')}</span>
              {devicesReady ? (
                <div className="grid gap-[18px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                  <div className="flex flex-col gap-[6px]">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                      {t('settings.devices.cameraLabel')}
                    </span>
                    <select
                      value={preferredCameraId}
                      onChange={(e) => selectCamera(e.target.value)}
                      className="rounded-[16px] border-none px-4 py-3 font-sans text-sm font-bold text-[var(--c-3bsl4p)] outline-none"
                      style={{ background: 'var(--c-rucw5u)' }}
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
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                      {t('settings.devices.micLabel')}
                    </span>
                    <select
                      value={preferredMicId}
                      onChange={(e) => selectMic(e.target.value)}
                      className="rounded-[16px] border-none px-4 py-3 font-sans text-sm font-bold text-[var(--c-3bsl4p)] outline-none"
                      style={{ background: 'var(--c-rucw5u)' }}
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
                    className="rounded-[18px] border-none px-5 py-[12px] font-sans text-sm font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5"
                    style={{ background: ACCENT_SOFT }}
                  >
                    {t('settings.devices.grantPermission')}
                  </button>
                  {devicePermission === 'denied' && (
                    <span className="text-[12.5px] font-semibold text-[var(--c-5nx3vn)]">
                      {t('settings.devices.permissionDenied')}
                    </span>
                  )}
                </div>
              )}
              <span className="text-[12.5px] font-semibold text-[var(--c-1kei7l4)]">
                {t('settings.devices.hint')}
              </span>
            </div>

            {/* default youtube background music */}
            <div
              className="flex flex-col gap-[10px] rounded-[32px] px-7 pt-[26px] pb-6"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <span className="text-[17px] font-extrabold text-[var(--c-3bsl4p)]">{t('settings.defaultMusic.title')}</span>
              <span className="text-[12.5px] font-semibold text-[var(--c-1kei7np)]">
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
                  className="min-w-0 flex-1 rounded-[16px] border-none px-4 py-3 font-sans text-sm font-semibold text-[var(--c-3bsl4p)] outline-none"
                  style={{ background: 'var(--c-rucw5u)' }}
                />
                <button
                  onClick={saveDefaultYoutubeUrl}
                  className="shrink-0 rounded-[16px] border-none px-5 py-3 font-sans text-sm font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5"
                  style={{ background: ACCENT_SOFT }}
                >
                  {defaultYoutubeSaved ? t('settings.defaultMusic.saved') : t('settings.defaultMusic.save')}
                </button>
              </div>
              {defaultYoutubeError && (
                <span className="text-[12px] font-semibold text-[var(--c-otf3yh)]">{t('settings.defaultMusic.invalid')}</span>
              )}
              <span className="text-[12.5px] font-semibold text-[var(--c-1kei7l4)]">
                {defaultYoutubeUrl ? t('settings.defaultMusic.hintCustom') : t('settings.defaultMusic.hintDefault')}
              </span>
            </div>

            {/* notifications */}
            <div
              className="flex flex-wrap items-center justify-between gap-[14px] rounded-[32px] px-7 py-[22px]"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <div className="flex flex-col gap-[2px]">
                <span className="text-[14.5px] font-bold text-[var(--c-3bsl4p)]">{t('settings.notifications.soundTitle')}</span>
                <span className="text-[12.5px] font-semibold text-[var(--c-1kei7np)]">
                  {t('settings.notifications.soundDesc')}
                </span>
              </div>
              <button
                onClick={toggleNotificationSound}
                className="relative h-8 w-[58px] shrink-0 rounded-full border-none transition-colors duration-[240ms]"
                style={{ background: notificationSound ? 'var(--ff-accent-chip-active)' : 'var(--c-dhk6uu)' }}
              >
                <span
                  className="absolute top-1 h-6 w-6 rounded-full bg-white transition-[left] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ left: notificationSound ? '30px' : '4px', boxShadow: '0 3px 8px var(--c-1k1wmrz)' }}
                />
              </button>
            </div>
          </>
        )}

        {/* logout */}
        <div
          className="mt-[14px] flex flex-wrap items-center justify-between gap-[14px] pt-[22px]"
          style={{ borderTop: '1.5px solid var(--c-wihkuc)' }}
        >
          <span className="max-w-[420px] text-[13.5px] leading-[1.55] font-semibold text-[var(--c-mfvyic)]">
            {t('settings.logout.hint')}
          </span>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              onClose()
              navigate('/auth')
            }}
            className="flex items-center gap-[9px] rounded-[22px] border-[1.5px] px-6 py-[14px] font-sans text-[14.5px] font-extrabold text-[var(--c-5nx3vn)] transition-colors duration-[220ms] hover:!bg-[var(--c-1eu539k)]"
            style={{ borderColor: 'var(--c-p573sp)', background: 'var(--c-11c6fho)' }}
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

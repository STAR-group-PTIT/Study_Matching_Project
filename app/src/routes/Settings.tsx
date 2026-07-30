import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

const GRADIENTS = [
  'linear-gradient(160deg, #dff1f4 0%, #cfe6f2 45%, #e6f4ee 100%)',
  'linear-gradient(150deg, #e8f4f0 0%, #d5e9f4 100%)',
  'linear-gradient(200deg, #d9ecf5 0%, #eaf5f1 60%, #dceef0 100%)',
  'linear-gradient(135deg, #eef3f8 0%, #dbeaf0 50%, #cfe4e6 100%)',
  'radial-gradient(120% 100% at 20% 10%, #e9f6f2 0%, #d3e6f0 70%)',
  'linear-gradient(175deg, #f0f6f7 0%, #d8eaf0 55%, #cde5df 100%)',
]

const MAX_WALLPAPER_BYTES = 5 * 1024 * 1024
const MAX_TRACK_BYTES = 25 * 1024 * 1024

type Wallpaper = { id: string; name: string; path: string; url: string | null }
type Track = { id: string; name: string; path: string; durationSeconds: number | null }

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

export default function Settings() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([])
  const [tracks, setTracks] = useState<Track[]>([])
  const [focus, setFocus] = useState(25)
  const [brk, setBrk] = useState(5)
  const [auto, setAuto] = useState(true)
  const [profileName, setProfileName] = useState('')
  const [saved, setSaved] = useState(false)
  const wallpaperInputRef = useRef<HTMLInputElement>(null)
  const trackInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('name, focus_minutes, break_minutes, auto_start_next')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (!data) return
        setProfileName(data.name)
        setFocus(data.focus_minutes)
        setBrk(data.break_minutes)
        setAuto(data.auto_start_next)
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
      .select('id, name, storage_path, duration_seconds')
      .eq('user_id', user.id)
      .order('created_at')
      .then(({ data }) => {
        if (cancelled || !data) return
        setTracks(data.map((r) => ({ id: r.id, name: r.name, path: r.storage_path, durationSeconds: r.duration_seconds })))
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

  async function saveDefaults() {
    if (!user) return
    const { error } = await supabase
      .from('profiles')
      .update({ focus_minutes: focus, break_minutes: brk, auto_start_next: auto })
      .eq('id', user.id)
    if (!error) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1800)
    }
  }

  async function removeWallpaper(w: Wallpaper) {
    setWallpapers((ws) => ws.filter((x) => x.id !== w.id))
    await supabase.storage.from('wallpapers').remove([w.path])
    const { error } = await supabase.from('wallpapers').delete().eq('id', w.id)
    if (error) console.error('remove wallpaper failed', error)
  }

  async function handleWallpaperFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    if (file.size > MAX_WALLPAPER_BYTES) {
      alert('Ảnh tối đa 5 MB.')
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
    setTracks((ts) => ts.map((t) => (t.id === id ? { ...t, name } : t)))
  }
  function commitTrackName(t: Track) {
    supabase
      .from('tracks')
      .update({ name: t.name })
      .eq('id', t.id)
      .then(({ error }) => {
        if (error) console.error('rename track failed', error)
      })
  }
  async function removeTrack(t: Track) {
    setTracks((ts) => ts.filter((x) => x.id !== t.id))
    await supabase.storage.from('tracks').remove([t.path])
    const { error } = await supabase.from('tracks').delete().eq('id', t.id)
    if (error) console.error('remove track failed', error)
  }
  async function handleTrackFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !user) return
    if (file.size > MAX_TRACK_BYTES) {
      alert('Nhạc tối đa 25 MB.')
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
    setTracks((ts) => [...ts, { id: row.id, name: file.name, path, durationSeconds: durationSeconds ? Math.round(durationSeconds) : null }])
  }
  function resetDefaults() {
    setFocus(25)
    setBrk(5)
  }

  return (
    <div
      className="relative min-h-svh w-full font-sans text-[#33475e] antialiased"
      style={{ background: 'linear-gradient(170deg, #e4f1f4 0%, #dbeaf2 50%, #e6f4ee 100%)' }}
    >
      <div className="mx-auto flex max-w-[880px] flex-col gap-[18px] px-8 pt-11 pb-[60px]">
        <div className="flex items-center gap-[11px]">
          <div
            className="h-[22px] w-[22px] rounded-[9px]"
            style={{ background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))' }}
          />
          <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[#2f4459]">FocusFlow</span>
          <span className="text-sm font-semibold text-[rgba(51,71,94,0.5)]">· Cài đặt &amp; hồ sơ</span>
        </div>

        {/* profile */}
        <div
          className="flex flex-wrap items-center gap-5 rounded-[32px] px-7 py-[26px]"
          style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
        >
          <div
            className="flex h-[84px] w-[84px] items-center justify-center rounded-[28px] text-[28px] font-extrabold text-[#294a5f]"
            style={{
              background: 'linear-gradient(140deg, rgba(140,205,196,0.6), rgba(160,200,225,0.6))',
              boxShadow: '0 8px 22px rgba(58,98,126,0.12)',
            }}
          >
            {initials(profileName || user?.email || '?')}
          </div>
          <div className="flex flex-[1_1_200px] flex-col gap-1">
            <span className="text-[22px] font-extrabold tracking-[-0.3px] text-[#2c3f55]">
              {profileName || 'Người dùng mới'}
            </span>
            <span className="text-sm font-semibold text-[rgba(51,71,94,0.55)]">{user?.email}</span>
            <span className="text-[13px] font-bold text-[#2c5b53]">
              Streak {streak} ngày · {sessionsThisWeek} phiên tuần này
            </span>
          </div>
          <div className="flex flex-wrap gap-[9px]">
            <button
              className="rounded-[20px] border-none px-5 py-[13px] font-sans text-sm font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
              style={{ background: ACCENT_SOFT }}
            >
              Đổi ảnh đại diện
            </button>
            <button
              className="rounded-[20px] border-[1.5px] border-[rgba(51,71,94,0.14)] bg-[rgba(255,255,255,0.8)] px-[18px] py-[13px] font-sans text-sm font-bold text-[#445c74] transition-colors duration-200 hover:!bg-white"
            >
              Sửa thông tin
            </button>
          </div>
        </div>

        {/* wallpapers */}
        <div
          className="flex flex-col gap-4 rounded-[32px] px-7 pt-[26px] pb-6"
          style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[17px] font-extrabold text-[#2c3f55]">Wallpaper của tôi</span>
            <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">{wallpapers.length} ảnh</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
            {wallpapers.map((w, i) => (
              <div
                key={w.id}
                className="relative h-[100px] overflow-hidden rounded-[22px]"
                style={{
                  ...(w.url
                    ? { backgroundImage: `url(${w.url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                    : { background: GRADIENTS[i % GRADIENTS.length] }),
                  boxShadow: '0 6px 16px rgba(58,98,126,0.1)',
                  border: i === 0 ? '2px solid var(--ff-accent-border)' : '2px solid rgba(255,255,255,0.75)',
                }}
              >
                <span
                  className="absolute bottom-[9px] left-[11px] rounded-[9px] px-2 py-1 font-mono text-[10.5px] text-[rgba(51,71,94,0.62)]"
                  style={{ background: 'rgba(255,255,255,0.72)' }}
                >
                  {w.name}
                </span>
                <button
                  onClick={() => removeWallpaper(w)}
                  title="Xoá"
                  className="absolute top-2 right-2 flex h-[26px] w-[26px] items-center justify-center rounded-[10px] border-none text-[#7a3f2c] opacity-50 transition-all duration-200 hover:!bg-[oklch(0.88_0.05_45)] hover:opacity-100"
                  style={{ background: 'rgba(255,255,255,0.8)' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              onClick={() => wallpaperInputRef.current?.click()}
              className="flex h-[100px] cursor-pointer flex-col items-center justify-center gap-[5px] rounded-[22px] border-2 border-dashed border-[rgba(51,71,94,0.18)] font-sans text-[13px] font-bold text-[rgba(51,71,94,0.55)] transition-all duration-[220ms] hover:!border-[rgba(126,201,198,0.9)] hover:!text-[#2c5b53]"
              style={{ background: 'rgba(238,246,248,0.6)' }}
            >
              <span className="text-[22px] leading-none font-bold">+</span>
              Thêm ảnh
            </button>
            <input ref={wallpaperInputRef} type="file" accept="image/jpeg,image/png" hidden onChange={handleWallpaperFile} />
          </div>
          <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.45)]">
            JPG hoặc PNG, tối đa 5 MB mỗi ảnh.
          </span>
        </div>

        {/* music */}
        <div
          className="flex flex-col gap-[14px] rounded-[32px] px-7 pt-[26px] pb-6"
          style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[17px] font-extrabold text-[#2c3f55]">Nhạc của tôi</span>
            <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">{tracks.length} bài</span>
          </div>
          <div className="flex flex-col gap-2">
            {tracks.map((t) => (
              <div
                key={t.id}
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
                    value={t.name}
                    onChange={(e) => renameTrack(t.id, e.target.value)}
                    onBlur={() => commitTrackName(t)}
                    className="w-full rounded-lg border-none bg-transparent py-[2px] font-sans text-[14.5px] font-bold text-[#2c3f55] outline-none focus:!bg-[rgba(126,201,198,0.14)]"
                  />
                  <span className="font-mono text-[11.5px] text-[rgba(51,71,94,0.45)]">{t.path.split('/').pop()}</span>
                </div>
                <span className="text-[13px] font-bold text-[rgba(51,71,94,0.5)]">{fmtDuration(t.durationSeconds)}</span>
                <button
                  onClick={() => removeTrack(t)}
                  title="Xoá"
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
            Upload nhạc (MP3, WAV)
          </button>
          <input ref={trackInputRef} type="file" accept="audio/mpeg,audio/wav,audio/*" hidden onChange={handleTrackFile} />
          <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.45)]">
            Bấm vào tên bài để đổi tên. Nhạc chỉ phát trong phiên học của bạn.
          </span>
        </div>

        {/* pomodoro defaults */}
        <div
          className="flex flex-col gap-5 rounded-[32px] px-7 pt-[26px] pb-6"
          style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
        >
          <span className="text-[17px] font-extrabold text-[#2c3f55]">Pomodoro mặc định</span>
          <div className="grid gap-[22px]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  Phút tập trung
                </span>
                <span className="text-[15px] font-extrabold text-[#2c5b53]">{focus} phút</span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={focus}
                onChange={(e) => setFocus(Number(e.target.value))}
                className="ff-range-lg"
              />
              <div className="flex justify-between text-[11.5px] font-semibold text-[rgba(51,71,94,0.4)]">
                <span>5</span>
                <span>60</span>
              </div>
            </div>
            <div className="flex flex-col gap-[6px]">
              <div className="flex items-baseline justify-between">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  Phút nghỉ
                </span>
                <span className="text-[15px] font-extrabold text-[#2c5b53]">{brk} phút</span>
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
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-[14px] rounded-[22px] px-[18px] py-[15px]"
            style={{ background: 'rgba(238,246,248,0.72)' }}
          >
            <div className="flex flex-col gap-[2px]">
              <span className="text-[14.5px] font-bold text-[#2c3f55]">Tự động bắt đầu phiên tiếp theo</span>
              <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.48)]">
                Hết giờ nghỉ là vào phiên học luôn
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
          <div className="flex flex-wrap gap-[9px]">
            <button
              onClick={saveDefaults}
              className="rounded-[22px] border-none px-[26px] py-[14px] font-sans text-[14.5px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
              style={{ background: ACCENT_SOFT }}
            >
              {saved ? 'Đã lưu ✓' : 'Lưu thay đổi'}
            </button>
            <button
              onClick={resetDefaults}
              className="rounded-[22px] border-[1.5px] border-[rgba(51,71,94,0.14)] bg-[rgba(255,255,255,0.8)] px-5 py-[14px] font-sans text-[14.5px] font-bold text-[#445c74] transition-colors duration-200 hover:!bg-white"
            >
              Về mặc định 25/5
            </button>
          </div>
        </div>

        {/* logout */}
        <div
          className="mt-[14px] flex flex-wrap items-center justify-between gap-[14px] pt-[22px]"
          style={{ borderTop: '1.5px solid rgba(51,71,94,0.1)' }}
        >
          <span className="max-w-[420px] text-[13.5px] leading-[1.55] font-semibold text-[rgba(51,71,94,0.5)]">
            Đăng xuất sẽ giữ lại wallpaper và nhạc trên tài khoản; máy này chuyển về chế độ khách.
          </span>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              navigate('/auth')
            }}
            className="flex items-center gap-[9px] rounded-[22px] border-[1.5px] px-6 py-[14px] font-sans text-[14.5px] font-extrabold text-[#7a3f2c] transition-colors duration-[220ms] hover:!bg-[oklch(0.88_0.05_45)]"
            style={{ borderColor: 'oklch(0.82 0.06 45)', background: 'oklch(0.93 0.03 45)' }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M15 5.5V4a2 2 0 00-2-2H6a2 2 0 00-2 2v16a2 2 0 002 2h7a2 2 0 002-2v-1.5" />
              <path d="M11 12h10m-3.5-3.5L21 12l-3.5 3.5" />
            </svg>
            Đăng xuất
          </button>
        </div>

        <Link to="/" className="mt-[6px] self-center text-[13.5px] font-bold text-[oklch(0.58_0.075_220)] no-underline hover:text-[oklch(0.5_0.08_220)]">
          ← Về màn hình học
        </Link>
      </div>
    </div>
  )
}

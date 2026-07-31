import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

type RoomTypeKey = 'chill' | 'hardcore' | 'silent' | 'discuss' | 'watch'

type RoomType = {
  key: RoomTypeKey
  hue: number
  paths: string[]
  circle: { cx: number; cy: number; r: number } | null
}

const ROOM_TYPES: RoomType[] = [
  {
    key: 'chill',
    hue: 195,
    paths: ['M9 18V6l10-2v12'],
    circle: { cx: 6.5, cy: 18, r: 2.6 },
  },
  {
    key: 'hardcore',
    hue: 45,
    paths: [
      'M12 3c2.5 3 1 5 0 6-1.2-1-2.6-.6-2.6 1.2 0 1.1-1.4 1-1.4-1C6.4 11 5.5 13 5.5 15a6.5 6.5 0 1013 0c0-4-3-8.5-6.5-12z',
    ],
    circle: null,
  },
  {
    key: 'silent',
    hue: 265,
    paths: ['M20.5 14.5A8.5 8.5 0 019.5 3.5a8.5 8.5 0 1011 11z'],
    circle: null,
  },
  {
    key: 'discuss',
    hue: 235,
    paths: [
      'M3 15V6.5A2.5 2.5 0 015.5 4h8A2.5 2.5 0 0116 6.5V11a2.5 2.5 0 01-2.5 2.5H7L3 15z',
      'M9 17.5a2.5 2.5 0 002.5 2.5h4l3.5 1.5-.8-2.2A2.5 2.5 0 0021 17v-3',
    ],
    circle: null,
  },
  {
    key: 'watch',
    hue: 150,
    paths: ['M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z'],
    circle: { cx: 12, cy: 12, r: 2.8 },
  },
]

type PublicRoomRow = {
  id: string
  code: string
  name: string
  room_type: RoomTypeKey
  duration_minutes: number
  language: string
  capacity: number
  host_name: string
  member_count: number
}

const ACCENT_SOFT = 'var(--ff-accent-soft)'
const ACCENT_CHIP_ACTIVE = 'var(--ff-accent-chip-active)'
const ACCENT_BORDER = 'var(--ff-accent-border)'

type Stage = 'filters' | 'searching' | 'rooms'
type Language = 'Tiếng Việt' | 'English'
type Visibility = 'public' | 'private'

function chipStyle(on: boolean) {
  return {
    background: on ? ACCENT_CHIP_ACTIVE : 'rgba(255,255,255,0.72)',
    borderColor: on ? ACCENT_BORDER : 'rgba(51,71,94,0.12)',
    color: on ? '#22483f' : 'rgba(51,71,94,0.68)',
  }
}

function RoomTypeIcon({ type }: { type: RoomType }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      {type.paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
      {type.circle && <circle cx={type.circle.cx} cy={type.circle.cy} r={type.circle.r} />}
    </svg>
  )
}

export default function Matching() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  const roomTypeLabel = (key: RoomTypeKey) => t(`matching.roomTypes.${key}.name`)
  const roomTypeRule = (key: RoomTypeKey) => t(`matching.roomTypes.${key}.rule`)
  const visibilityLabel = (v: Visibility) => t(`matching.visibility.${v}`)
  const hints = useMemo(
    () => [
      t('matching.searching.hints.h1'),
      t('matching.searching.hints.h2'),
      t('matching.searching.hints.h3'),
      t('matching.searching.hints.h4'),
    ],
    [t],
  )

  const [stage, setStage] = useState<Stage>('filters')
  const [fade, setFade] = useState(1)
  const [roomType, setRoomType] = useState<RoomTypeKey>('chill')
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [breakMinutes, setBreakMinutes] = useState(5)
  const [sessionCount, setSessionCount] = useState(4)
  const [language, setLanguage] = useState<Language>('Tiếng Việt')
  const [waited, setWaited] = useState(0)
  const [matchError, setMatchError] = useState('')

  const [modal, setModal] = useState(false)
  const [created, setCreated] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [visibility, setVisibility] = useState<Visibility>('public')
  const [capacity, setCapacity] = useState(4)
  const [roomId, setRoomId] = useState('')
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  const [profileName, setProfileName] = useState('')
  const [authNotice, setAuthNotice] = useState(false)

  const [publicRooms, setPublicRooms] = useState<PublicRoomRow[] | null>(null)
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)

  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const stageRef = useRef(stage)
  stageRef.current = stage
  const queueChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      if (stageRef.current === 'searching') setWaited((w) => w + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => clearTimeout(copyTimer.current), [])
  useEffect(() => () => void queueChannelRef.current?.unsubscribe(), [])

  useEffect(() => {
    if (!user) {
      setProfileName('')
      return
    }
    supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.name) setProfileName(data.name)
      })
  }, [user])

  useEffect(() => {
    if (stage !== 'rooms') return
    let cancelled = false
    setLoadingRooms(true)
    supabase
      .from('room_public_list')
      .select('*')
      .order('member_count', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        setLoadingRooms(false)
        if (!error && data) setPublicRooms(data as PublicRoomRow[])
      })
    return () => {
      cancelled = true
    }
  }, [stage])

  function requireAuth() {
    if (!user) {
      setAuthNotice(true)
      return false
    }
    setAuthNotice(false)
    return true
  }

  function go(next: Stage) {
    setFade(0)
    setTimeout(() => {
      setStage(next)
      setFade(1)
      setWaited(0)
    }, 200)
  }

  function cancelSearch() {
    if (user) supabase.from('matching_queue').delete().eq('user_id', user.id).then(() => {})
    queueChannelRef.current?.unsubscribe()
    queueChannelRef.current = null
    setMatchError('')
    go('filters')
  }

  function subscribeQueue(userId: string) {
    const channel = supabase
      .channel('matching-queue-' + userId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matching_queue', filter: `user_id=eq.${userId}` },
        (payload) => {
          const code = (payload.new as { matched_room_code: string | null }).matched_room_code
          if (!code) return
          channel.unsubscribe()
          queueChannelRef.current = null
          supabase.from('matching_queue').delete().eq('user_id', userId).then(() => {})
          navigate('/room/' + code)
        },
      )
      .subscribe()
    queueChannelRef.current = channel
  }

  async function startRandomMatch() {
    if (!requireAuth()) return
    go('searching')
    setMatchError('')
    const durationMinutes = focusMinutes
    const languageCode = language === 'Tiếng Việt' ? 'vi' : 'en'

    const { data, error } = await supabase.functions.invoke('match-room', {
      body: { room_type: roomType, duration_minutes: durationMinutes, language: languageCode },
    })

    if (error) {
      setMatchError(t('matching.errors.matchServiceDown'))
      return
    }
    const result = data?.result as { status: string; room_id: string; room_code: string } | null
    if (result?.status === 'matched' && result.room_code) {
      navigate('/room/' + result.room_code)
    } else if (result?.status === 'queued' && user) {
      subscribeQueue(user.id)
    } else {
      setMatchError(t('matching.errors.matchGeneric'))
    }
  }

  async function submitJoinCode() {
    if (!requireAuth()) return
    const code = joinCode.trim().toUpperCase()
    if (code.length < 6) return
    setJoining(true)
    setJoinError('')
    const { data, error } = await supabase.rpc('join_room_by_code', { p_code: code })
    setJoining(false)
    if (error) {
      setJoinError(t('matching.errors.joinGeneric'))
      return
    }
    const row = data?.[0] as { status: string; room_id: string; member_status: string } | undefined
    if (!row || row.status === 'not_found') {
      setJoinError(t('matching.errors.invalidCode'))
      return
    }
    if (row.status === 'full') {
      setJoinError(t('matching.errors.roomFull'))
      return
    }
    navigate('/room/' + code)
  }

  async function joinPublicRoom(code: string) {
    if (!requireAuth()) return
    setJoinError('')
    const { data, error } = await supabase.rpc('join_room_by_code', { p_code: code })
    if (error) return
    const row = data?.[0] as { status: string } | undefined
    if (!row || row.status === 'not_found' || row.status === 'full') return
    navigate('/room/' + code)
  }

  const current = ROOM_TYPES.find((r) => r.key === roomType)!
  const fadeStyle = {
    opacity: fade,
    transform: `translateY(${fade ? '0px' : '8px'})`,
    transition: 'opacity 420ms ease, transform 420ms cubic-bezier(0.22,1,0.36,1)',
  }

  function openCreate() {
    if (!requireAuth()) return
    setModal(true)
    setCreated(false)
    setCopied(false)
    setCreateError('')
    setRoomName('')
  }

  const defaultRoomName = t('matching.create.defaultName', {
    name: profileName || t('matching.create.you'),
  })

  async function createRoom() {
    if (!user) return
    setCreating(true)
    setCreateError('')

    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const genCode = () => Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

    let inserted: { id: string; code: string } | null = null
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      const code = genCode()
      const { data, error } = await supabase
        .from('rooms')
        .insert({
          code,
          name: roomName.trim() || defaultRoomName,
          host_id: user.id,
          room_type: roomType,
          duration_minutes: focusMinutes,
          break_minutes: breakMinutes,
          session_count: sessionCount,
          language: language === 'Tiếng Việt' ? 'vi' : 'en',
          capacity,
          visibility,
        })
        .select('id, code')
        .single()
      if (!error && data) {
        inserted = data
        break
      }
      if (error && error.code !== '23505') {
        setCreateError(t('matching.errors.createFailed'))
        setCreating(false)
        return
      }
    }

    if (!inserted) {
      setCreateError(t('matching.errors.createFailed'))
      setCreating(false)
      return
    }

    await supabase.from('room_members').insert({ room_id: inserted.id, user_id: user.id, status: 'member' })
    setRoomId(inserted.code)
    setCreated(true)
    setCreating(false)
  }

  function copyId() {
    if (navigator.clipboard) navigator.clipboard.writeText(roomId).catch(() => {})
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1800)
  }

  const createdName = roomName.trim() || defaultRoomName

  return (
    <div
      className="relative min-h-svh w-full overflow-hidden font-sans text-[#33475e] antialiased"
      style={{ background: 'var(--ff-page-gradient)' }}
    >
      <div
        className="absolute inset-0"
        style={{ backdropFilter: 'blur(3px)', background: 'rgba(255,255,255,0.16)' }}
      />

      <div className="relative flex min-h-svh flex-col items-center justify-center gap-5 px-6 py-[46px]">
        <div className="flex items-center gap-[11px]">
          <div
            className="h-[22px] w-[22px] rounded-[9px]"
            style={{ background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))' }}
          />
          <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[#2f4459]">{t('app.name')}</span>
          <span className="text-sm font-semibold text-[rgba(51,71,94,0.5)]">
            · {t('matching.headerTag')}
          </span>
        </div>

        {authNotice && (
          <div
            className="flex w-full max-w-[560px] items-center justify-between gap-3 rounded-[18px] px-5 py-[13px]"
            style={{ background: 'rgba(255,246,238,0.9)', boxShadow: 'inset 0 0 0 1.5px rgba(196,142,96,0.25)' }}
          >
            <span className="text-[13.5px] font-semibold text-[#7a4a2c]">
              {t('matching.authNotice.text')}
            </span>
            <Link
              to="/auth"
              className="shrink-0 rounded-[14px] px-4 py-2 text-[13px] font-extrabold text-[#7a4a2c] no-underline"
              style={{ background: 'rgba(226,190,150,0.5)' }}
            >
              {t('matching.authNotice.login')}
            </Link>
          </div>
        )}

        {/* STATE 1: filters */}
        {stage === 'filters' && (
          <div
            className="flex w-full max-w-[560px] flex-col gap-6 rounded-[34px] px-[34px] pt-8 pb-[30px]"
            style={{
              ...fadeStyle,
              background: 'rgba(255,255,255,0.8)',
              backdropFilter: 'blur(22px)',
              boxShadow: '0 22px 56px rgba(58,98,126,0.13)',
            }}
          >
            <div>
              <h1 className="m-0 text-[26px] font-extrabold tracking-[-0.5px] text-[#2c3f55]">
                {t('matching.filters.title')}
              </h1>
              <p className="mt-2 mb-0 text-[14.5px] leading-[1.55] font-semibold text-[rgba(51,71,94,0.58)]">
                {t('matching.filters.subtitle')}
              </p>
            </div>

            <div className="flex flex-col gap-[11px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  {t('matching.filters.roomTypeLabel')}
                </span>
                <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.42)]">
                  {t('matching.filters.pickOne')}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {ROOM_TYPES.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRoomType(r.key)}
                    className="flex items-center gap-2 rounded-[18px] border-[1.5px] px-4 py-[10px] font-sans text-sm font-bold transition-all duration-[220ms] hover:-translate-y-px"
                    style={chipStyle(roomType === r.key)}
                  >
                    <RoomTypeIcon type={r} />
                    {roomTypeLabel(r.key)}
                  </button>
                ))}
              </div>
              <div
                className="flex items-start gap-[9px] rounded-[18px] px-[15px] py-3"
                style={{ background: 'rgba(255,255,255,0.66)', boxShadow: 'inset 0 0 0 1.5px rgba(51,71,94,0.07)' }}
              >
                <span
                  className="mt-px flex shrink-0"
                  style={{ color: `oklch(0.62 0.09 ${current.hue})` }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5" />
                    <path d="M12 7.7v.2" />
                  </svg>
                </span>
                <span className="text-[13.5px] leading-[1.5] font-semibold text-[rgba(51,71,94,0.72)]">
                  {roomTypeRule(current.key)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-[11px]">
              <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('matching.filters.durationLabel')}
              </span>
              <div className="flex flex-col gap-[9px]">
                <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.5)]">
                  {t('matching.filters.presetsLabel')}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setFocusMinutes(25)
                      setBreakMinutes(5)
                    }}
                    className="rounded-[18px] border-[1.5px] px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={chipStyle(focusMinutes === 25 && breakMinutes === 5)}
                  >
                    25 : 5
                  </button>
                  <button
                    onClick={() => {
                      setFocusMinutes(50)
                      setBreakMinutes(10)
                    }}
                    className="rounded-[18px] border-[1.5px] px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={chipStyle(focusMinutes === 50 && breakMinutes === 10)}
                  >
                    50 : 10
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-5">
                <div className="flex flex-[1_1_160px] flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.5)]">
                      {t('matching.filters.focusMinutesLabel')}
                    </span>
                    <span className="text-[13px] font-extrabold text-[#2c5b53]">
                      {t('matching.filters.minutesValue', { count: focusMinutes })}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={5}
                    value={focusMinutes}
                    onChange={(e) => setFocusMinutes(Number(e.target.value))}
                    className="ff-range-lg"
                  />
                </div>
                <div className="flex flex-[1_1_160px] flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.5)]">
                      {t('matching.filters.breakMinutesLabel')}
                    </span>
                    <span className="text-[13px] font-extrabold text-[#2c5b53]">
                      {t('matching.filters.minutesValue', { count: breakMinutes })}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    step={1}
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(Number(e.target.value))}
                    className="ff-range-lg"
                  />
                </div>
                <div className="flex flex-[1_1_160px] flex-col gap-[6px]">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.5)]">
                      {t('matching.filters.sessionCountLabel')}
                    </span>
                    <span className="text-[13px] font-extrabold text-[#2c5b53]">
                      {t('matching.filters.sessionsValue', { count: sessionCount })}
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
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-[11px]">
              <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('matching.filters.languageLabel')}
              </span>
              <div className="flex gap-2">
                {(['Tiếng Việt', 'English'] as Language[]).map((name) => (
                  <button
                    key={name}
                    onClick={() => setLanguage(name)}
                    className="flex-1 rounded-[18px] border-[1.5px] py-[11px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={chipStyle(language === name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-[10px]">
              <button
                onClick={startRandomMatch}
                className="flex-[1_1_180px] rounded-[22px] border-[1.5px] border-transparent px-3 py-[15px] font-sans text-[15.5px] font-extrabold text-[#1e3549] transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(58,98,126,0.22)]"
                style={{ background: ACCENT_SOFT, boxShadow: '0 12px 26px rgba(58,98,126,0.16)' }}
              >
                {t('matching.filters.randomMatch')}
              </button>
              <button
                onClick={openCreate}
                className="flex-[1_1_180px] rounded-[22px] border-[1.5px] bg-white px-3 py-[15px] font-sans text-[15.5px] font-extrabold text-[#22483f] transition-[transform,background] duration-200 hover:-translate-y-0.5 hover:!bg-[rgba(255,255,255,0.86)]"
                style={{ borderColor: ACCENT_BORDER }}
              >
                {t('matching.filters.createRoom')}
              </button>
              <button
                onClick={() => go('rooms')}
                className="flex-[1_1_180px] rounded-[22px] border-[1.5px] border-[rgba(51,71,94,0.16)] bg-white px-3 py-[15px] font-sans text-[15.5px] font-extrabold text-[#43596f] transition-[transform,background] duration-200 hover:-translate-y-0.5 hover:!bg-[rgba(255,255,255,0.86)]"
              >
                {t('matching.filters.roomList')}
              </button>
            </div>

            <div className="flex flex-col gap-2 border-t border-[rgba(51,71,94,0.1)] pt-5">
              <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('matching.filters.joinByCodeLabel')}
              </span>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(e) => {
                    setJoinCode(e.target.value.toUpperCase())
                    setJoinError('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitJoinCode()
                  }}
                  maxLength={6}
                  placeholder={t('matching.filters.joinCodePlaceholder')}
                  className="w-full min-w-0 flex-1 rounded-[18px] border-[1.5px] border-[rgba(51,71,94,0.14)] px-4 py-[13px] font-sans text-[15px] font-bold tracking-[2px] text-[#2c3f55] uppercase outline-none focus:border-[rgba(126,201,198,0.9)] focus:bg-white"
                  style={{ background: 'rgba(240,248,250,0.7)' }}
                />
                <button
                  onClick={submitJoinCode}
                  disabled={joining || joinCode.trim().length < 6}
                  className="shrink-0 rounded-[18px] border-none px-5 py-[13px] font-sans text-sm font-extrabold text-[#1e3549] disabled:opacity-50"
                  style={{ background: ACCENT_SOFT }}
                >
                  {joining ? t('matching.filters.joining') : t('matching.filters.join')}
                </button>
              </div>
              {joinError && <span className="text-[12.5px] font-semibold text-[#7a3f2c]">{joinError}</span>}
            </div>
          </div>
        )}

        {/* STATE 2: searching */}
        {stage === 'searching' && (
          <div
            className="flex w-full max-w-[560px] flex-col items-center gap-[26px] rounded-[34px] p-[34px]"
            style={{
              ...fadeStyle,
              background: 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(22px)',
              boxShadow: '0 22px 56px rgba(58,98,126,0.12)',
            }}
          >
            <div className="flex flex-wrap justify-center gap-[7px]">
              {[roomTypeLabel(current.key), t('matching.filters.minutesValue', { count: focusMinutes }), language].map((text) => (
                <span
                  key={text}
                  className="rounded-full px-[14px] py-[7px] text-[12.5px] font-bold text-[#35566b]"
                  style={{ background: 'rgba(255,255,255,0.8)', boxShadow: '0 3px 10px rgba(58,98,126,0.07)' }}
                >
                  {text}
                </span>
              ))}
            </div>

            <div className="relative flex h-[240px] w-[240px] items-center justify-center">
              <div
                className="absolute h-[240px] w-[240px] rounded-full"
                style={{
                  border: '2px solid rgba(126,201,198,0.55)',
                  animation: 'ffRipple 3.4s cubic-bezier(0.24,0.6,0.3,1) infinite',
                }}
              />
              <div
                className="absolute h-[240px] w-[240px] rounded-full"
                style={{
                  border: '2px solid rgba(150,190,220,0.5)',
                  animation: 'ffRipple 3.4s cubic-bezier(0.24,0.6,0.3,1) infinite',
                  animationDelay: '1.13s',
                }}
              />
              <div
                className="absolute h-[240px] w-[240px] rounded-full"
                style={{
                  border: '2px solid rgba(126,201,198,0.4)',
                  animation: 'ffRipple 3.4s cubic-bezier(0.24,0.6,0.3,1) infinite',
                  animationDelay: '2.26s',
                }}
              />
              <div
                className="absolute h-[150px] w-[150px] rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.72)',
                  boxShadow: '0 12px 34px rgba(58,98,126,0.13)',
                  animation: 'ffBreathe 3.4s ease-in-out infinite',
                }}
              />
              <div
                className="relative flex flex-col items-center gap-[2px]"
                style={{ animation: 'ffDrift 3.4s ease-in-out infinite' }}
              >
                <span className="text-[34px] leading-none font-extrabold text-[#2c3f55] tabular-nums">
                  {waited}
                </span>
                <span className="text-[12.5px] font-bold text-[rgba(51,71,94,0.5)]">
                  {t('matching.searching.seconds')}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-[7px] text-center">
              <span className="text-[19px] font-extrabold tracking-[-0.2px] text-[#2c3f55]">
                {t('matching.searching.title')}
              </span>
              <span className="text-sm font-semibold text-[rgba(51,71,94,0.55)]">
                {matchError || hints[Math.min(hints.length - 1, Math.floor(waited / 8))]}
              </span>
            </div>

            <div className="flex items-center gap-[10px]">
              <button
                onClick={cancelSearch}
                className="rounded-[22px] border-none px-[30px] py-[14px] font-sans text-[15px] font-extrabold text-[#43596f] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 8px 20px rgba(58,98,126,0.1)' }}
              >
                {t('matching.searching.cancel')}
              </button>
              <button
                onClick={cancelSearch}
                className="rounded-[22px] border-none bg-transparent px-[22px] py-[14px] font-sans text-[15px] font-bold text-[rgba(51,71,94,0.6)] transition-colors duration-200 hover:!text-[#2c3f55]"
              >
                {t('matching.searching.editFilters')}
              </button>
            </div>
          </div>
        )}

        {/* STATE 3: public room list */}
        {stage === 'rooms' && (
          <div
            className="flex w-full max-w-[660px] flex-col gap-5 rounded-[34px] px-8 pt-[30px] pb-7"
            style={{
              ...fadeStyle,
              background: 'rgba(255,255,255,0.8)',
              backdropFilter: 'blur(22px)',
              boxShadow: '0 22px 56px rgba(58,98,126,0.13)',
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="m-0 text-[23px] font-extrabold tracking-[-0.4px] text-[#2c3f55]">
                  {t('matching.rooms.title')}
                </h2>
                <p className="mt-[7px] mb-0 text-sm font-semibold text-[rgba(51,71,94,0.55)]">
                  {publicRooms
                    ? t('matching.rooms.countOpen', { count: publicRooms.length })
                    : loadingRooms
                      ? t('matching.rooms.loading')
                      : t('matching.rooms.loadFailed')}{' '}
                  · {t('matching.rooms.liveUpdate')}
                </p>
              </div>
              <button
                onClick={() => go('filters')}
                className="shrink-0 rounded-[18px] border-none px-[18px] py-[10px] font-sans text-sm font-extrabold text-[#43596f] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'rgba(255,255,255,0.8)', boxShadow: '0 6px 16px rgba(58,98,126,0.09)' }}
              >
                {t('matching.rooms.back')}
              </button>
            </div>

            {joinError && <span className="text-[12.5px] font-semibold text-[#7a3f2c]">{joinError}</span>}

            <div className="flex flex-col gap-[10px]">
              {loadingRooms && (
                <span className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[rgba(51,71,94,0.45)]" style={{ background: 'rgba(255,255,255,0.6)' }}>
                  {t('matching.rooms.loadingList')}
                </span>
              )}
              {!loadingRooms && publicRooms?.length === 0 && (
                <span className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[rgba(51,71,94,0.45)]" style={{ background: 'rgba(255,255,255,0.6)' }}>
                  {t('matching.rooms.empty')}
                </span>
              )}
              {!loadingRooms && publicRooms === null && (
                <span className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[rgba(51,71,94,0.45)]" style={{ background: 'rgba(255,255,255,0.6)' }}>
                  {t('matching.rooms.loadListFailed')}
                </span>
              )}
              {publicRooms?.map((p) => {
                const roomTypeMeta = ROOM_TYPES.find((r) => r.key === p.room_type)!
                const full = p.member_count >= p.capacity
                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-[24px] px-[18px] py-[15px]"
                    style={{ background: 'rgba(255,255,255,0.74)', boxShadow: '0 8px 20px rgba(58,98,126,0.08)' }}
                  >
                    <div className="flex min-w-0 flex-[1_1_230px] flex-col gap-[7px]">
                      <div className="flex flex-wrap items-center gap-[9px]">
                        <span className="text-[15.5px] font-extrabold text-[#2c3f55]">{p.name}</span>
                        <span
                          className="rounded-full px-[11px] py-1 text-[11.5px] font-extrabold tracking-[0.3px]"
                          style={{
                            background: `oklch(0.93 0.045 ${roomTypeMeta.hue})`,
                            color: `oklch(0.42 0.08 ${roomTypeMeta.hue})`,
                          }}
                        >
                          {roomTypeLabel(roomTypeMeta.key)}
                        </span>
                      </div>
                      <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.55)]">
                        {t('matching.rooms.host', { name: p.host_name, minutes: p.duration_minutes })}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className="flex items-center gap-[6px] text-[13.5px] font-extrabold"
                        style={{ color: full ? 'rgba(51,71,94,0.42)' : '#2c5b53' }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                          <circle cx="9" cy="8.5" r="3.2" />
                          <path d="M3 19c.9-3 3.3-4.4 6-4.4S14.1 16 15 19" />
                          <path d="M16.4 5.6a3.2 3.2 0 010 5.8" />
                          <path d="M18.6 14.9c1.4.8 2.3 2.2 2.6 4.1" />
                        </svg>
                        {p.member_count}/{p.capacity}
                      </div>
                      <button
                        onClick={() => !full && joinPublicRoom(p.code)}
                        disabled={full}
                        className="rounded-[18px] border-none px-[22px] py-[11px] font-sans text-sm font-extrabold transition-transform duration-200 hover:enabled:-translate-y-px"
                        style={{
                          cursor: full ? 'not-allowed' : 'pointer',
                          color: full ? 'rgba(51,71,94,0.42)' : '#1e3549',
                          background: full ? 'rgba(51,71,94,0.08)' : ACCENT_SOFT,
                        }}
                      >
                        {full ? t('matching.rooms.full') : t('matching.rooms.joinAction')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <Link to="/" className="text-[13.5px] font-bold text-[oklch(0.58_0.075_220)] no-underline hover:text-[oklch(0.5_0.08_220)]">
          {t('matching.backToStudy')}
        </Link>
      </div>

      {/* create-room modal */}
      {modal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: 'rgba(38,66,86,0.28)', backdropFilter: 'blur(6px)' }}
        >
          <div className="absolute inset-0" onClick={() => setModal(false)} />
          <div
            className="relative flex w-full max-w-[400px] flex-col gap-[18px] rounded-[30px] bg-white px-7 pt-7 pb-6"
            style={{ boxShadow: '0 30px 70px rgba(38,66,86,0.28)', animation: 'ffPop 320ms cubic-bezier(0.22,1,0.36,1)' }}
          >
            {!created ? (
              <div className="flex flex-col gap-[18px]">
                <div>
                  <h3 className="m-0 text-xl font-extrabold tracking-[-0.3px] text-[#2c3f55]">
                    {t('matching.create.title')}
                  </h3>
                  <p className="mt-[6px] mb-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
                    {t('matching.create.hostLine', {
                      name: profileName || t('matching.create.you'),
                      roomType: roomTypeLabel(current.key),
                    })}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                    {t('matching.create.nameLabel')}
                  </span>
                  <input
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder={t('matching.create.namePlaceholder')}
                    className="w-full rounded-[18px] border-[1.5px] border-[rgba(51,71,94,0.14)] px-4 py-[13px] font-sans text-[15px] font-bold text-[#2c3f55] outline-none focus:border-[rgba(126,201,198,0.9)] focus:bg-white"
                    style={{ background: 'rgba(240,248,250,0.7)' }}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                      {t('matching.create.maxPeopleLabel')}
                    </span>
                    <span className="text-[13.5px] font-extrabold text-[#2c5b53]">
                      {t('matching.create.maxPeopleValue', { count: capacity })}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {[2, 4, 6, 8, 12].map((n) => (
                      <button
                        key={n}
                        onClick={() => setCapacity(n)}
                        className="flex-1 rounded-[18px] border-[1.5px] py-[11px] font-sans text-sm font-bold transition-all duration-[220ms]"
                        style={chipStyle(capacity === n)}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                    {t('matching.create.privacyLabel')}
                  </span>
                  <div className="flex gap-2">
                    {(['public', 'private'] as Visibility[]).map((v) => (
                      <button
                        key={v}
                        onClick={() => setVisibility(v)}
                        className="flex-1 rounded-[18px] border-[1.5px] py-[11px] font-sans text-sm font-bold transition-all duration-[220ms]"
                        style={chipStyle(visibility === v)}
                      >
                        {visibilityLabel(v)}
                      </button>
                    ))}
                  </div>
                  <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.5)]">
                    {visibility === 'public'
                      ? t('matching.create.publicHint')
                      : t('matching.create.privateHint')}
                  </span>
                </div>

                {createError && <span className="text-[12.5px] font-semibold text-[#7a3f2c]">{createError}</span>}

                <button
                  onClick={createRoom}
                  disabled={creating}
                  className="w-full rounded-[22px] border-none py-[15px] font-sans text-base font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-60"
                  style={{ background: ACCENT_SOFT, boxShadow: '0 12px 26px rgba(58,98,126,0.16)' }}
                >
                  {creating ? t('matching.create.submitting') : t('matching.create.submit')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 text-center">
                <span
                  className="flex h-[54px] w-[54px] items-center justify-center rounded-full text-[#2c5b53]"
                  style={{ background: 'rgba(140,205,196,0.3)' }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <div>
                  <h3 className="m-0 text-xl font-extrabold text-[#2c3f55]">
                    {t('matching.create.created', { name: createdName })}
                  </h3>
                  <p className="mt-[6px] mb-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
                    {t('matching.create.createdMeta', {
                      visibility: visibilityLabel(visibility),
                      count: capacity,
                    })}
                  </p>
                </div>
                <div
                  className="flex w-full items-center gap-[10px] rounded-[20px] py-3 pr-3 pl-[18px]"
                  style={{ background: 'rgba(240,248,250,0.9)', boxShadow: 'inset 0 0 0 1.5px rgba(51,71,94,0.08)' }}
                >
                  <span className="flex-1 text-left text-[22px] font-extrabold tracking-[3px] text-[#2c3f55]">
                    {roomId}
                  </span>
                  <button
                    onClick={copyId}
                    className="rounded-[15px] border-none px-4 py-[10px] font-sans text-[13.5px] font-extrabold text-[#22483f] hover:brightness-[0.97]"
                    style={{ background: ACCENT_SOFT }}
                  >
                    {copied ? t('matching.create.copied') : t('matching.create.copy')}
                  </button>
                </div>
                <div className="flex w-full gap-[9px]">
                  <button
                    onClick={() => setModal(false)}
                    className="flex-1 rounded-[20px] border-[1.5px] border-[rgba(51,71,94,0.16)] bg-white py-[13px] font-sans text-[14.5px] font-extrabold text-[#43596f] hover:!bg-[rgba(240,248,250,0.8)]"
                  >
                    {t('matching.create.close')}
                  </button>
                  <button
                    onClick={() => navigate('/room/' + roomId)}
                    className="flex-1 rounded-[20px] border-none py-[13px] text-center font-sans text-[14.5px] font-extrabold text-[#1e3549]"
                    style={{ background: ACCENT_SOFT }}
                  >
                    {t('matching.create.enterRoom')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

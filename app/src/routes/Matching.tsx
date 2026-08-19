import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import type { RoomTypeKey } from '../lib/roomTypeRules'

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

const ROOMS_PER_PAGE = 8
// Chặn phòng hờ cho fetch gốc (trước khi cắt trang ở client) — `room_public_list` đã tự
// khoanh vùng còn phòng public đang mở/có người, nhưng vẫn cần 1 trần cứng phòng lúc traffic
// bất thường (spam tạo phòng) kéo về không giới hạn.
const PUBLIC_ROOMS_FETCH_LIMIT = 500
const DURATION_TOLERANCE_MINUTES = 5

type Language = 'Tiếng Việt' | 'English'
type Visibility = 'public' | 'private'

function chipStyle(on: boolean) {
  return {
    background: on ? ACCENT_CHIP_ACTIVE : 'var(--c-6rf17l)',
    borderColor: on ? ACCENT_BORDER : 'var(--c-1kei5ag)',
    color: on ? 'var(--c-2kucx8)' : 'var(--c-1kei953)',
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

  const [roomType, setRoomType] = useState<RoomTypeKey>('chill')
  const [roomTypePopupOpen, setRoomTypePopupOpen] = useState(false)
  const [focusMinutes, setFocusMinutes] = useState(25)
  const [breakMinutes, setBreakMinutes] = useState(5)
  const [language, setLanguage] = useState<Language>('Tiếng Việt')

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

  const [publicRooms, setPublicRooms] = useState<PublicRoomRow[] | null>(null)
  const [loadingRooms, setLoadingRooms] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [joining, setJoining] = useState(false)

  const [roomFilter, setRoomFilter] = useState<{ roomType: RoomTypeKey; focusMinutes: number; language: Language } | null>(null)
  const [roomPage, setRoomPage] = useState(1)

  // Mã phòng khác mà user đang thực sự ở (GĐ10 tiếp, chặn 1 user vào 2 phòng cùng lúc) — có
  // giá trị thì disable tạo/tham gia phòng mới + hiện banner trỏ về phòng đó, thay vì để user
  // bấm rồi mới nhận lỗi.
  const [blockedRoomCode, setBlockedRoomCode] = useState<string | null>(null)

  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(copyTimer.current), [])

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
    let cancelled = false
    setLoadingRooms(true)
    // Dọn lười hàng room_members bỏ hoang trước khi tải danh sách (GĐ10 tiếp) — cùng pattern
    // TTL lười đã dùng cho matching_queue, không cần pg_cron.
    void supabase.rpc('cleanup_stale_room_members').then(() =>
      supabase
        .from('room_public_list')
        .select('*')
        .order('member_count', { ascending: false })
        .limit(PUBLIC_ROOMS_FETCH_LIMIT)
        .then(({ data, error }) => {
          if (cancelled) return
          setLoadingRooms(false)
          if (!error && data) setPublicRooms(data as PublicRoomRow[])
        }),
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Chặn sớm (GĐ10 tiếp): nếu user đã có 1 phòng active khác, disable tạo/tham gia phòng mới
  // ngay từ đầu thay vì để họ bấm rồi mới nhận lỗi.
  useEffect(() => {
    if (!user) {
      setBlockedRoomCode(null)
      return
    }
    let cancelled = false
    supabase
      .rpc('find_other_active_room')
      .then(({ data }) => {
        if (cancelled) return
        const row = data?.[0] as { room_code: string } | undefined
        setBlockedRoomCode(row?.room_code ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  async function submitJoinCode() {
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
    const row = data?.[0] as
      | { status: string; room_id: string; member_status: string; other_room_code: string | null }
      | undefined
    if (!row || row.status === 'not_found') {
      setJoinError(t('matching.errors.invalidCode'))
      return
    }
    if (row.status === 'full') {
      setJoinError(t('matching.errors.roomFull'))
      return
    }
    if (row.status === 'already_in_another_room') {
      setBlockedRoomCode(row.other_room_code)
      setJoinError(t('matching.errors.alreadyInRoom'))
      return
    }
    navigate('/room/' + code)
  }

  async function joinPublicRoom(code: string) {
    setJoinError('')
    const { data, error } = await supabase.rpc('join_room_by_code', { p_code: code })
    if (error) return
    const row = data?.[0] as { status: string; other_room_code: string | null } | undefined
    if (!row || row.status === 'not_found' || row.status === 'full') return
    if (row.status === 'already_in_another_room') {
      setBlockedRoomCode(row.other_room_code)
      setJoinError(t('matching.errors.alreadyInRoom'))
      return
    }
    navigate('/room/' + code)
  }

  function applyRoomFilter() {
    setRoomFilter({ roomType, focusMinutes, language })
    setRoomPage(1)
  }

  function clearRoomFilter() {
    setRoomFilter(null)
    setRoomPage(1)
  }

  const filteredRooms = useMemo(() => {
    if (!publicRooms || !roomFilter) return publicRooms
    const languageCode = roomFilter.language === 'Tiếng Việt' ? 'vi' : 'en'
    return publicRooms.filter(
      (p) =>
        p.room_type === roomFilter.roomType &&
        p.language === languageCode &&
        Math.abs(p.duration_minutes - roomFilter.focusMinutes) <= DURATION_TOLERANCE_MINUTES,
    )
  }, [publicRooms, roomFilter])

  const roomPageCount = Math.max(1, Math.ceil((filteredRooms?.length ?? 0) / ROOMS_PER_PAGE))
  const currentRoomPage = Math.min(roomPage, roomPageCount)
  const pagedRooms = filteredRooms?.slice((currentRoomPage - 1) * ROOMS_PER_PAGE, currentRoomPage * ROOMS_PER_PAGE)

  const current = ROOM_TYPES.find((r) => r.key === roomType)!

  function openCreate() {
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

    // create_room (migration 0024) gộp guard "không đang ở phòng khác" + insert rooms/
    // room_members vào 1 RPC — trước đây createRoom() làm 2 insert riêng từ client, không
    // enforce được guard này ở đâu. Mã trùng vẫn retry y hệt cũ (unique_violation -> 23505).
    let result: { status: string; room_code: string; other_room_code: string | null } | null = null
    for (let attempt = 0; attempt < 5 && !result; attempt++) {
      const code = genCode()
      const { data, error } = await supabase.rpc('create_room', {
        p_code: code,
        p_name: roomName.trim() || defaultRoomName,
        p_room_type: roomType,
        p_duration_minutes: focusMinutes,
        p_break_minutes: breakMinutes,
        p_language: language === 'Tiếng Việt' ? 'vi' : 'en',
        p_capacity: capacity,
        p_visibility: visibility,
      })
      const row = data?.[0] as { status: string; room_code: string; other_room_code: string | null } | undefined
      if (!error && row) {
        result = row
        break
      }
      if (error && error.code !== '23505') {
        setCreateError(t('matching.errors.createFailed'))
        setCreating(false)
        return
      }
    }

    if (!result) {
      setCreateError(t('matching.errors.createFailed'))
      setCreating(false)
      return
    }

    if (result.status === 'already_in_another_room') {
      setCreating(false)
      setModal(false)
      setBlockedRoomCode(result.other_room_code)
      return
    }

    setRoomId(result.room_code)
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
      className="relative min-h-svh w-full font-sans text-[var(--c-32fr7s)] antialiased"
      style={{ background: 'var(--ff-page-gradient)' }}
    >
      <div
        className="absolute inset-0"
        style={{ backdropFilter: 'blur(3px)', background: 'var(--c-6rewuv)' }}
      />

      <div className="relative flex min-h-svh w-full flex-col items-center gap-5 px-6 py-[46px]">
        <div className="flex items-center gap-[11px]">
          <div
            className="h-[22px] w-[22px] rounded-[9px]"
            style={{ background: 'linear-gradient(135deg, var(--c-1feyjhs), var(--c-yr829))' }}
          />
          <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[var(--c-3dfktp)]">{t('app.name')}</span>
          <span className="text-sm font-semibold text-[var(--c-mfvyic)]">
            · {t('matching.headerTag')}
          </span>
        </div>

        <div className="flex w-full max-w-[1180px] flex-col items-start gap-5 lg:flex-row">
          {/* LEFT: public room list — always visible */}
          <div
            className="flex w-full flex-col gap-5 rounded-[34px] px-8 pt-[30px] pb-7 lg:min-w-0 lg:flex-1"
            style={{
              background: 'var(--c-ijr2vy)',
              backdropFilter: 'blur(22px)',
              boxShadow: '0 22px 56px var(--c-1k1wm25)',
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="m-0 text-[23px] font-extrabold tracking-[-0.4px] text-[var(--c-3bsl4p)]">
                  {t('matching.rooms.title')}
                </h2>
                <p className="mt-[7px] mb-0 text-sm font-semibold text-[var(--c-1kei8bt)]">
                  {filteredRooms
                    ? t('matching.rooms.countOpen', { count: filteredRooms.length })
                    : loadingRooms
                      ? t('matching.rooms.loading')
                      : t('matching.rooms.loadFailed')}{' '}
                  · {t('matching.rooms.liveUpdate')}
                  {roomFilter && ' · ' + t('matching.rooms.filteredNote')}
                </p>
              </div>
              {roomFilter && (
                <button
                  onClick={clearRoomFilter}
                  className="shrink-0 rounded-[18px] border-none px-[16px] py-[9px] font-sans text-[13px] font-extrabold text-[var(--c-3ji23s)] transition-colors duration-200 hover:!bg-white"
                  style={{ background: 'var(--c-ijr2vy)', boxShadow: '0 6px 16px var(--c-1k1wlgm)' }}
                >
                  {t('matching.filters.clearFilter')}
                </button>
              )}
            </div>

            {blockedRoomCode && (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-[14px] text-[13px] font-semibold text-[var(--c-1kei7l4)]"
                style={{ background: 'var(--c-ijr2u8)' }}
              >
                <span>{t('matching.errors.alreadyInRoom')}</span>
                <button
                  onClick={() => navigate('/room/' + blockedRoomCode)}
                  className="shrink-0 rounded-[16px] border-none px-4 py-[9px] font-sans text-[13px] font-extrabold text-[var(--c-2vtjkg)]"
                  style={{ background: ACCENT_SOFT }}
                >
                  {t('matching.create.enterRoom')}
                </button>
              </div>
            )}

            {joinError && <span className="text-[12.5px] font-semibold text-[var(--c-5nx3vn)]">{joinError}</span>}

            <div className="flex flex-col gap-[10px]">
              {loadingRooms && (
                <span className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[var(--c-1kei7l4)]" style={{ background: 'var(--c-ijr2u8)' }}>
                  {t('matching.rooms.loadingList')}
                </span>
              )}
              {!loadingRooms && publicRooms?.length === 0 && (
                <span className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[var(--c-1kei7l4)]" style={{ background: 'var(--c-ijr2u8)' }}>
                  {t('matching.rooms.empty')}
                </span>
              )}
              {!loadingRooms && publicRooms === null && (
                <span className="rounded-[18px] p-[14px] text-center text-[13px] font-semibold text-[var(--c-1kei7l4)]" style={{ background: 'var(--c-ijr2u8)' }}>
                  {t('matching.rooms.loadListFailed')}
                </span>
              )}
              {!loadingRooms && publicRooms && publicRooms.length > 0 && roomFilter && filteredRooms?.length === 0 && (
                <div className="flex flex-col items-center gap-2 rounded-[18px] p-[14px] text-center" style={{ background: 'var(--c-ijr2u8)' }}>
                  <span className="text-[13px] font-semibold text-[var(--c-1kei7l4)]">
                    {t('matching.rooms.noFilterMatch')}
                  </span>
                  <button
                    onClick={clearRoomFilter}
                    className="text-[12.5px] font-extrabold text-[var(--c-3bts4x)] underline"
                  >
                    {t('matching.filters.clearFilter')}
                  </button>
                </div>
              )}
              {pagedRooms?.map((p) => {
                const roomTypeMeta = ROOM_TYPES.find((r) => r.key === p.room_type)!
                const full = p.member_count >= p.capacity
                return (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center gap-3 rounded-[24px] px-[18px] py-[15px]"
                    style={{ background: 'var(--c-6rf19b)', boxShadow: '0 8px 20px var(--c-1k1wlfr)' }}
                  >
                    <div className="flex min-w-0 flex-[1_1_230px] flex-col gap-[7px]">
                      <div className="flex flex-wrap items-center gap-[9px]">
                        <span className="text-[15.5px] font-extrabold text-[var(--c-3bsl4p)]">{p.name}</span>
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
                      <span className="text-[13px] font-semibold text-[var(--c-1kei8bt)]">
                        {t('matching.rooms.host', { name: p.host_name, minutes: p.duration_minutes })}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div
                        className="flex items-center gap-[6px] text-[13.5px] font-extrabold"
                        style={{ color: full ? 'var(--c-1kei7ij)' : 'var(--c-3bts4x)' }}
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
                        onClick={() => !full && !blockedRoomCode && joinPublicRoom(p.code)}
                        disabled={full || !!blockedRoomCode}
                        className="rounded-[18px] border-none px-[22px] py-[11px] font-sans text-sm font-extrabold transition-transform duration-200 hover:enabled:-translate-y-px"
                        style={{
                          cursor: full || blockedRoomCode ? 'not-allowed' : 'pointer',
                          color: full || blockedRoomCode ? 'var(--c-1kei7ij)' : 'var(--c-2vtjkg)',
                          background: full || blockedRoomCode ? 'var(--c-dhk645)' : ACCENT_SOFT,
                        }}
                      >
                        {full ? t('matching.rooms.full') : t('matching.rooms.joinAction')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {roomPageCount > 1 && (
              <div className="flex items-center justify-center gap-[6px]">
                <button
                  onClick={() => setRoomPage((p) => Math.max(1, p - 1))}
                  disabled={currentRoomPage === 1}
                  aria-label={t('matching.rooms.prevPage')}
                  className="flex h-9 w-9 items-center justify-center rounded-full border-none text-[13px] font-extrabold text-[var(--c-3ji23s)] disabled:opacity-35"
                  style={{ background: 'var(--c-ijr2vy)' }}
                >
                  ‹
                </button>
                {Array.from({ length: roomPageCount }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setRoomPage(n)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border-none text-[13px] font-extrabold"
                    style={{
                      background: n === currentRoomPage ? ACCENT_SOFT : 'var(--c-ijr2vy)',
                      color: n === currentRoomPage ? 'var(--c-2vtjkg)' : 'var(--c-3ji23s)',
                    }}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setRoomPage((p) => Math.min(roomPageCount, p + 1))}
                  disabled={currentRoomPage === roomPageCount}
                  aria-label={t('matching.rooms.nextPage')}
                  className="flex h-9 w-9 items-center justify-center rounded-full border-none text-[13px] font-extrabold text-[var(--c-3ji23s)] disabled:opacity-35"
                  style={{ background: 'var(--c-ijr2vy)' }}
                >
                  ›
                </button>
              </div>
            )}
          </div>

          {/* RIGHT: filters panel — dùng để lọc room list bên trái VÀ làm config khi "Tạo phòng".
              Sticky on desktop so it stays in view while the (usually much longer) room list scrolls. */}
          <div className="flex w-full flex-col gap-5 lg:sticky lg:top-6 lg:w-[400px] lg:shrink-0 lg:self-start">
              <div
                className="flex w-full flex-col gap-6 rounded-[34px] px-[30px] pt-8 pb-[30px] lg:max-h-[calc(100svh-3rem)] lg:overflow-y-auto"
                style={{
                  background: 'var(--c-ijr2vy)',
                  backdropFilter: 'blur(22px)',
                  boxShadow: '0 22px 56px var(--c-1k1wm25)',
                }}
              >
                <div>
                  <h1 className="m-0 text-[22px] font-extrabold tracking-[-0.5px] text-[var(--c-3bsl4p)]">
                    {t('matching.filters.title')}
                  </h1>
                  <p className="mt-2 mb-0 text-[13.5px] leading-[1.55] font-semibold text-[var(--c-1kei8ee)]">
                    {t('matching.filters.subtitle')}
                  </p>
                </div>

                <div className="flex flex-col gap-[11px]">
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                    {t('matching.filters.roomTypeLabel')}
                  </span>
                  <button
                    onClick={() => setRoomTypePopupOpen(true)}
                    className="flex w-full items-center justify-between gap-3 rounded-[18px] border-[1.5px] border-[var(--c-1kei5c6)] px-4 py-[13px] font-sans text-[15px] font-bold text-[var(--c-3bsl4p)] transition-colors duration-200 hover:!bg-white"
                    style={{ background: 'var(--c-1h0taas)' }}
                  >
                    <span className="flex items-center gap-[9px]">
                      <span style={{ color: `oklch(0.62 0.09 ${current.hue})` }}>
                        <RoomTypeIcon type={current} />
                      </span>
                      {roomTypeLabel(current.key)}
                    </span>
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--c-1kei7l4)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </button>
                  <div
                    className="flex items-start gap-[9px] rounded-[18px] px-[15px] py-3"
                    style={{ background: 'var(--c-6rf0kc)', boxShadow: 'inset 0 0 0 1.5px var(--c-dhk63a)' }}
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
                    <span className="text-[13.5px] leading-[1.5] font-semibold text-[var(--c-1kei9qm)]">
                      {roomTypeRule(current.key)}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-[11px]">
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                    {t('matching.filters.durationLabel')}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setFocusMinutes(25)
                        setBreakMinutes(5)
                      }}
                      className="flex-1 rounded-[18px] border-[1.5px] py-[13px] font-sans text-sm font-bold transition-all duration-[220ms]"
                      style={chipStyle(focusMinutes === 25 && breakMinutes === 5)}
                    >
                      25 : 5
                    </button>
                    <button
                      onClick={() => {
                        setFocusMinutes(50)
                        setBreakMinutes(10)
                      }}
                      className="flex-1 rounded-[18px] border-[1.5px] py-[13px] font-sans text-sm font-bold transition-all duration-[220ms]"
                      style={chipStyle(focusMinutes === 50 && breakMinutes === 10)}
                    >
                      50 : 10
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-[11px]">
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
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

                <div className="flex flex-col gap-2 border-t border-[var(--c-mfvyew)] pt-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                      {t('matching.filters.filterRoomsLabel')}
                    </span>
                    {roomFilter && (
                      <button
                        onClick={clearRoomFilter}
                        className="text-[12px] font-bold text-[var(--c-1kei8bt)] underline"
                      >
                        {t('matching.filters.clearFilter')}
                      </button>
                    )}
                  </div>
                  <button
                    onClick={applyRoomFilter}
                    className="w-full rounded-[18px] border-[1.5px] py-[11px] font-sans text-sm font-bold transition-all duration-[220ms]"
                    style={chipStyle(!!roomFilter)}
                  >
                    {t('matching.filters.applyFilter')}
                  </button>
                  {roomFilter && (
                    <span className="text-[12.5px] font-semibold text-[var(--c-mfvyic)]">
                      {t('matching.filters.filterActiveSummary', {
                        roomType: roomTypeLabel(roomFilter.roomType),
                        minutes: roomFilter.focusMinutes,
                        language: roomFilter.language,
                      })}
                    </span>
                  )}
                </div>

                <button
                  onClick={openCreate}
                  disabled={!!blockedRoomCode}
                  className="w-full rounded-[22px] border-[1.5px] bg-white px-3 py-[15px] font-sans text-[15.5px] font-extrabold text-[var(--c-2kucx8)] transition-[transform,background] duration-200 hover:-translate-y-0.5 hover:!bg-[var(--c-6rf21q)] disabled:opacity-50 disabled:hover:translate-y-0"
                  style={{ borderColor: ACCENT_BORDER }}
                >
                  {t('matching.filters.createRoom')}
                </button>

                <div className="flex flex-col gap-2 border-t border-[var(--c-mfvyew)] pt-5">
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
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
                      className="w-full min-w-0 flex-1 rounded-[18px] border-[1.5px] border-[var(--c-1kei5c6)] px-4 py-[13px] font-sans text-base font-bold tracking-[2px] text-[var(--c-3bsl4p)] uppercase outline-none focus:border-[var(--c-125fipz)] focus:bg-white"
                      style={{ background: 'var(--c-1h0taas)' }}
                    />
                    <button
                      onClick={submitJoinCode}
                      disabled={joining || joinCode.trim().length < 6 || !!blockedRoomCode}
                      className="shrink-0 rounded-[18px] border-none px-5 py-[13px] font-sans text-sm font-extrabold text-[var(--c-2vtjkg)] disabled:opacity-50"
                      style={{ background: ACCENT_SOFT }}
                    >
                      {joining ? t('matching.filters.joining') : t('matching.filters.join')}
                    </button>
                  </div>
                  {joinError && <span className="text-[12.5px] font-semibold text-[var(--c-5nx3vn)]">{joinError}</span>}
                </div>
              </div>
          </div>
        </div>

        <Link to="/" className="px-3 py-[12px] text-[13.5px] font-bold text-[var(--c-1swujpp)] no-underline hover:text-[var(--c-ounphr)]">
          {t('matching.backToStudy')}
        </Link>
      </div>

      {/* create-room modal */}
      {modal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: 'var(--c-a8sm65)', backdropFilter: 'blur(6px)' }}
        >
          <div className="absolute inset-0" onClick={() => setModal(false)} />
          <div
            className="relative flex max-h-[85svh] w-full max-w-[400px] flex-col gap-[18px] overflow-y-auto rounded-[30px] bg-white px-7 pt-7 pb-6"
            style={{ boxShadow: '0 30px 70px var(--c-a8sm65)', animation: 'ffPop 320ms cubic-bezier(0.22,1,0.36,1)' }}
          >
            {!created ? (
              <div className="flex flex-col gap-[18px]">
                <div>
                  <h3 className="m-0 text-xl font-extrabold tracking-[-0.3px] text-[var(--c-3bsl4p)]">
                    {t('matching.create.title')}
                  </h3>
                  <p className="mt-[6px] mb-0 text-[13.5px] font-semibold text-[var(--c-1kei8bt)]">
                    {t('matching.create.hostLine', {
                      name: profileName || t('matching.create.you'),
                      roomType: roomTypeLabel(current.key),
                    })}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                    {t('matching.create.nameLabel')}
                  </span>
                  <input
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder={t('matching.create.namePlaceholder')}
                    className="w-full rounded-[18px] border-[1.5px] border-[var(--c-1kei5c6)] px-4 py-[13px] font-sans text-base font-bold text-[var(--c-3bsl4p)] outline-none focus:border-[var(--c-125fipz)] focus:bg-white"
                    style={{ background: 'var(--c-1h0taas)' }}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                      {t('matching.create.maxPeopleLabel')}
                    </span>
                    <span className="text-[13.5px] font-extrabold text-[var(--c-3bts4x)]">
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
                  <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
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
                  <span className="text-[12.5px] font-semibold text-[var(--c-mfvyic)]">
                    {visibility === 'public'
                      ? t('matching.create.publicHint')
                      : t('matching.create.privateHint')}
                  </span>
                </div>

                {createError && <span className="text-[12.5px] font-semibold text-[var(--c-5nx3vn)]">{createError}</span>}

                <button
                  onClick={createRoom}
                  disabled={creating}
                  className="w-full rounded-[22px] border-none py-[15px] font-sans text-base font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-60"
                  style={{ background: ACCENT_SOFT, boxShadow: '0 12px 26px var(--c-1k1wm4q)' }}
                >
                  {creating ? t('matching.create.submitting') : t('matching.create.submit')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4 text-center">
                <span
                  className="flex h-[54px] w-[54px] items-center justify-center rounded-full text-[var(--c-3bts4x)]"
                  style={{ background: 'var(--c-9q3jpj)' }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                </span>
                <div>
                  <h3 className="m-0 text-xl font-extrabold text-[var(--c-3bsl4p)]">
                    {t('matching.create.created', { name: createdName })}
                  </h3>
                  <p className="mt-[6px] mb-0 text-[13.5px] font-semibold text-[var(--c-1kei8bt)]">
                    {t('matching.create.createdMeta', {
                      visibility: visibilityLabel(visibility),
                      count: capacity,
                    })}
                  </p>
                </div>
                <div
                  className="flex w-full items-center gap-[10px] rounded-[20px] py-3 pr-3 pl-[18px]"
                  style={{ background: 'var(--c-1h0taci)', boxShadow: 'inset 0 0 0 1.5px var(--c-dhk645)' }}
                >
                  <span className="flex-1 text-left text-[22px] font-extrabold tracking-[3px] text-[var(--c-3bsl4p)]">
                    {roomId}
                  </span>
                  <button
                    onClick={copyId}
                    className="rounded-[15px] border-none px-4 py-[10px] font-sans text-[13.5px] font-extrabold text-[var(--c-2kucx8)] hover:brightness-[0.97]"
                    style={{ background: ACCENT_SOFT }}
                  >
                    {copied ? t('matching.create.copied') : t('matching.create.copy')}
                  </button>
                </div>
                <div className="flex w-full gap-[9px]">
                  <button
                    onClick={() => setModal(false)}
                    className="flex-1 rounded-[20px] border-[1.5px] border-[var(--c-1kei5dw)] bg-white py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-3ji23s)] hover:!bg-[var(--c-1h0tabn)]"
                  >
                    {t('matching.create.close')}
                  </button>
                  <button
                    onClick={() => navigate('/room/' + roomId)}
                    className="flex-1 rounded-[20px] border-none py-[13px] text-center font-sans text-[14.5px] font-extrabold text-[var(--c-2vtjkg)]"
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

      {/* popup chọn loại phòng — liệt kê đủ tất cả, thay cho hàng chip cũ (dễ tràn khi số
          loại phòng tăng dần, xem CONTEXT.md Giai đoạn 8 phần 11) */}
      {roomTypePopupOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-6"
          style={{ background: 'var(--c-a8sm65)', backdropFilter: 'blur(6px)' }}
        >
          <div className="absolute inset-0" onClick={() => setRoomTypePopupOpen(false)} />
          <div
            className="relative flex max-h-[85svh] w-full max-w-[440px] flex-col gap-4 overflow-y-auto rounded-[30px] bg-white px-7 pt-7 pb-6"
            style={{ boxShadow: '0 30px 70px var(--c-a8sm65)', animation: 'ffPop 320ms cubic-bezier(0.22,1,0.36,1)' }}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="m-0 text-xl font-extrabold tracking-[-0.3px] text-[var(--c-3bsl4p)]">
                {t('matching.filters.roomTypeLabel')}
              </h3>
              <button
                onClick={() => setRoomTypePopupOpen(false)}
                title={t('matching.create.close')}
                aria-label={t('matching.create.close')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-[var(--c-1h0taci)]"
                style={{ background: 'var(--c-1h0taas)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
              {ROOM_TYPES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => {
                    setRoomType(r.key)
                    setRoomTypePopupOpen(false)
                  }}
                  className="flex items-start gap-3 rounded-[20px] border-[1.5px] px-4 py-3 text-left transition-all duration-[220ms] hover:-translate-y-px"
                  style={chipStyle(roomType === r.key)}
                >
                  <span className="mt-0.5 flex shrink-0" style={{ color: `oklch(0.52 0.1 ${r.hue})` }}>
                    <RoomTypeIcon type={r} />
                  </span>
                  <span className="flex flex-col gap-[3px]">
                    <span className="text-sm font-extrabold text-[var(--c-3bsl4p)]">{roomTypeLabel(r.key)}</span>
                    <span className="text-[12.5px] leading-[1.45] font-semibold text-[var(--c-1kei92i)]">
                      {roomTypeRule(r.key)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

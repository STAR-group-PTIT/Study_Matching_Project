import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import ContributionGraph from '../components/ContributionGraph'
import { computeStreaks } from '../lib/contributions'

function fmtDdMm(d: Date) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
}
function formatHistoryDate(iso: string, t: (key: string, options?: Record<string, unknown>) => string) {
  const d = new Date(iso)
  const now = new Date()
  const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return t('stats.history.today', { time: hhmm })
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return t('stats.history.yesterday', { time: hhmm })
  return `${fmtDdMm(d)} · ${hhmm}`
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i) // 0-indexed, giống Date native

type SessionRow = {
  id: string
  minutes: number
  room_id: string | null
  started_at: string
  phase: 'focus' | 'break'
  completed: boolean
}
type TodoRow = { id: string; name: string; meta: string | null; completed_at: string | null; created_at: string }

export default function Stats({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((s) => s.user)
  // Lọc theo đúng 1 tháng-năm (GĐ10 tiếp) — thay 3 tab "Tuần này/Tháng này/Tất cả" cũ, đồng thời
  // gộp luôn với bộ chọn năm từng nằm riêng trong ContributionGraph. 1 bộ lọc duy nhất chi phối
  // cả 3 KPI lẫn lưới lịch bên dưới, thay vì 2 bộ filter tách biệt như trước.
  const now = new Date()
  const [filterYear, setFilterYear] = useState(() => now.getFullYear())
  const [filterMonth, setFilterMonth] = useState(() => now.getMonth())
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [completedTodos, setCompletedTodos] = useState<TodoRow[]>([])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([
      supabase
        .from('focus_sessions')
        .select('id, minutes, room_id, started_at, phase, completed')
        .eq('user_id', user.id)
        .eq('phase', 'focus')
        .order('started_at', { ascending: false }),
      supabase
        .from('todos')
        .select('id, name, meta, completed_at, created_at')
        .eq('user_id', user.id)
        .eq('done', true)
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(6),
    ]).then(([sessionsRes, todosRes]) => {
      if (cancelled) return
      setSessions((sessionsRes.data as SessionRow[] | null) ?? [])
      setCompletedTodos((todosRes.data as TodoRow[] | null) ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [user])

  const years = useMemo(() => {
    const currentYear = now.getFullYear()
    let earliest = currentYear
    for (const s of sessions) {
      const y = new Date(s.started_at).getFullYear()
      if (y < earliest) earliest = y
    }
    const list: number[] = []
    for (let y = currentYear; y >= earliest; y--) list.push(y)
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions])

  const monthLabel = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { month: 'long' })
    return (m: number) => fmt.format(new Date(2020, m, 1))
  }, [i18n.language])

  const rangeStart = useMemo(() => new Date(filterYear, filterMonth, 1), [filterYear, filterMonth])
  const rangeEnd = useMemo(() => new Date(filterYear, filterMonth + 1, 0, 23, 59, 59, 999), [filterYear, filterMonth])

  const sessionsInRange = useMemo(
    () => sessions.filter((s) => {
      const d = new Date(s.started_at)
      return d >= rangeStart && d <= rangeEnd
    }),
    [sessions, rangeStart, rangeEnd],
  )
  const totalMinutesRange = sessionsInRange.reduce((a, s) => a + s.minutes, 0)
  const sessionsCountRange = sessionsInRange.length
  const groupSessionsCountRange = sessionsInRange.filter((s) => s.room_id).length

  const prevMonthMinutes = useMemo(() => {
    const prevStart = new Date(filterYear, filterMonth - 1, 1)
    const prevEnd = new Date(rangeStart.getTime() - 1)
    return sessions
      .filter((s) => {
        const d = new Date(s.started_at)
        return d >= prevStart && d <= prevEnd
      })
      .reduce((a, s) => a + s.minutes, 0)
  }, [sessions, filterYear, filterMonth, rangeStart])

  let kpi1Delta: string
  let kpi1DeltaColor = 'rgba(51,71,94,0.55)'
  if (prevMonthMinutes === 0) {
    kpi1Delta = totalMinutesRange > 0 ? t('stats.kpi.noDataLastMonth') : t('stats.kpi.noSessionsThisMonth')
  } else {
    const pct = Math.round(((totalMinutesRange - prevMonthMinutes) / prevMonthMinutes) * 100)
    kpi1Delta = t('stats.kpi.deltaVsLastMonth', { sign: pct >= 0 ? '+' : '', pct })
    kpi1DeltaColor = pct >= 0 ? '#2c5b53' : '#7a3f2c'
  }

  // Streak luôn tính trên toàn bộ lịch sử, không bị bó theo tháng/năm đang lọc — 1 khái niệm
  // xuyên suốt chứ không theo khung xem (giữ nguyên hành vi gốc).
  const { currentStreak, bestStreak } = useMemo(
    () => computeStreaks(sessions.map((s) => s.started_at)),
    [sessions],
  )

  const KPIS = [
    {
      label: t('stats.kpi.focusMinutes'),
      value: totalMinutesRange,
      unit: t('stats.kpi.minutesUnit'),
      delta: kpi1Delta,
      deltaColor: kpi1DeltaColor,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6v6h4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: t('stats.kpi.completedSessions'),
      value: sessionsCountRange,
      unit: t('stats.kpi.sessionsUnit'),
      delta: t('stats.kpi.groupSessions', { count: groupSessionsCountRange }),
      deltaColor: 'rgba(51,71,94,0.55)',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 12.5l2.25 2.25L15.5 9.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: t('stats.kpi.streak'),
      value: currentStreak,
      unit: t('stats.kpi.daysUnit'),
      delta: t('stats.kpi.bestStreak', { count: bestStreak }),
      deltaColor: 'rgba(51,71,94,0.55)',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#ffffff">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.176 7.547 7.547 0 01-1.705-1.715.75.75 0 00-1.152-.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.545 3.75 3.75 0 013.255 3.717z"
          />
        </svg>
      ),
    },
  ]

  const HISTORY = completedTodos.map((todo) => ({
    name: todo.name,
    meta: todo.meta || t('stats.history.noMeta'),
    date: formatHistoryDate(todo.completed_at ?? todo.created_at, t),
  }))

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
              <span className="text-sm font-semibold text-[rgba(51,71,94,0.5)]">· {t('stats.headerTag')}</span>
              <button
                onClick={onClose}
                title={t('stats.close')}
                aria-label={t('stats.close')}
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'rgba(255,255,255,0.7)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* bộ lọc tháng + năm — chi phối cả 3 KPI lẫn ContributionGraph bên dưới (1 bộ filter
                duy nhất, thay 3 tab tuần/tháng/tất cả + nút năm riêng trong graph trước đây). */}
            <div
              className="flex w-fit items-center gap-1 rounded-[20px] p-[5px]"
              style={{ background: 'rgba(255,255,255,0.6)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)', backdropFilter: 'blur(14px)' }}
            >
              <select
                value={filterMonth}
                onChange={(e) => setFilterMonth(Number(e.target.value))}
                aria-label={t('stats.selectMonth')}
                className="cursor-pointer rounded-[15px] border-none bg-transparent px-4 py-[10px] font-sans text-sm font-bold text-[#25415c] capitalize outline-none"
              >
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
              <select
                value={filterYear}
                onChange={(e) => setFilterYear(Number(e.target.value))}
                aria-label={t('stats.selectYear')}
                className="cursor-pointer rounded-[15px] border-none bg-transparent px-4 py-[10px] font-sans text-sm font-bold text-[#25415c] outline-none"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div
              className="flex items-stretch overflow-hidden rounded-[26px]"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              {KPIS.map((k, i) => (
                <div
                  key={k.label}
                  className="flex min-w-0 flex-1 items-center gap-3 px-6 py-5"
                  style={i > 0 ? { borderLeft: '1px solid rgba(51,71,94,0.08)' } : undefined}
                >
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]"
                    style={{ background: 'var(--ff-accent-soft)' }}
                  >
                    {k.icon}
                  </div>
                  <div className="flex min-w-0 flex-col gap-[2px]">
                    <span className="truncate text-[10.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                      {k.label}
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[22px] leading-none font-extrabold tracking-[-0.5px] text-[#2c3f55]">{k.value}</span>
                      <span className="text-[12px] font-bold text-[rgba(51,71,94,0.55)]">{k.unit}</span>
                    </div>
                    <span className="text-[11.5px] leading-[1.3] font-bold" style={{ color: k.deltaColor }}>
                      {k.delta}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <ContributionGraph sessions={sessions} year={filterYear} month={filterMonth} />

            {/* history */}
            <div
              className="flex flex-col gap-4 rounded-[30px] px-7 pt-[26px] pb-[22px]"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[16.5px] font-extrabold text-[#2c3f55]">{t('stats.history.title')}</span>
                <a href="#" onClick={(e) => e.preventDefault()} className="text-[13px] font-bold no-underline">
                  {t('stats.history.viewAll')}
                </a>
              </div>
              {HISTORY.length === 0 ? (
                <div className="rounded-[22px] px-[18px] py-[22px] text-center text-[13.5px] font-semibold text-[rgba(51,71,94,0.5)]" style={{ background: 'rgba(238,246,248,0.72)' }}>
                  {t('stats.history.empty')}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {HISTORY.map((h, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-[14px] rounded-[22px] px-[18px] py-[14px] transition-colors duration-200 hover:!bg-white"
                      style={{ background: 'rgba(238,246,248,0.72)' }}
                    >
                      <div
                        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[10px]"
                        style={{ background: 'var(--ff-accent-soft)' }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round">
                          <path d="M5 12.5l4.5 4.5L19 7" />
                        </svg>
                      </div>
                      <div className="flex flex-1 flex-col gap-[2px]">
                        <span className="text-[14.5px] font-bold text-[#2c3f55]">{h.name}</span>
                        <span className="text-[12.5px] font-semibold text-[rgba(51,71,94,0.48)]">{h.meta}</span>
                      </div>
                      <span className="text-[13px] font-bold whitespace-nowrap text-[rgba(51,71,94,0.5)]">{h.date}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

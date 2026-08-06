import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import ContributionGraph from '../components/ContributionGraph'
import { computeStreaks } from '../lib/contributions'

function startOfWeekMonday(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const shift = (x.getDay() + 6) % 7 // Monday = 0
  x.setDate(x.getDate() - shift)
  return x
}
function startOfMonth(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(1)
  return x
}
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

type Range = 'week' | 'month' | 'all'

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
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [range, setRange] = useState<Range>('week')
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

  const rangeStart = useMemo(() => {
    const today = new Date()
    if (range === 'week') return startOfWeekMonday(today)
    if (range === 'month') return startOfMonth(today)
    return null
  }, [range])

  const sessionsInRange = useMemo(
    () => (rangeStart ? sessions.filter((s) => new Date(s.started_at) >= rangeStart) : sessions),
    [sessions, rangeStart],
  )
  const totalMinutesRange = sessionsInRange.reduce((a, s) => a + s.minutes, 0)
  const sessionsCountRange = sessionsInRange.length
  const groupSessionsCountRange = sessionsInRange.filter((s) => s.room_id).length

  const prevWeekMinutes = useMemo(() => {
    const thisWeekStart = startOfWeekMonday(new Date())
    const prevWeekStart = new Date(thisWeekStart)
    prevWeekStart.setDate(prevWeekStart.getDate() - 7)
    return sessions
      .filter((s) => {
        const startedAt = new Date(s.started_at)
        return startedAt >= prevWeekStart && startedAt < thisWeekStart
      })
      .reduce((a, s) => a + s.minutes, 0)
  }, [sessions])

  let kpi1Delta: string
  let kpi1DeltaColor = 'rgba(51,71,94,0.55)'
  if (range === 'week') {
    if (prevWeekMinutes === 0) {
      kpi1Delta =
        totalMinutesRange > 0 ? t('stats.kpi.noDataLastWeek') : t('stats.kpi.noSessionsThisWeek')
    } else {
      const pct = Math.round(((totalMinutesRange - prevWeekMinutes) / prevWeekMinutes) * 100)
      kpi1Delta = t('stats.kpi.deltaVsLastWeek', { sign: pct >= 0 ? '+' : '', pct })
      kpi1DeltaColor = pct >= 0 ? '#2c5b53' : '#7a3f2c'
    }
  } else {
    kpi1Delta = range === 'month' ? t('stats.kpi.totalMinutesMonth') : t('stats.kpi.totalMinutesAll')
  }

  const { currentStreak, bestStreak } = useMemo(
    () => computeStreaks(sessions.map((s) => s.started_at)),
    [sessions],
  )

  const KPIS = [
    {
      label:
        range === 'week'
          ? t('stats.kpi.focusMinutesThisWeek')
          : range === 'month'
            ? t('stats.kpi.focusMinutesThisMonth')
            : t('stats.kpi.focusMinutes'),
      value: totalMinutesRange,
      unit: t('stats.kpi.minutesUnit'),
      delta: kpi1Delta,
      deltaColor: kpi1DeltaColor,
    },
    {
      label: t('stats.kpi.completedSessions'),
      value: sessionsCountRange,
      unit: t('stats.kpi.sessionsUnit'),
      delta: t('stats.kpi.groupSessions', { count: groupSessionsCountRange }),
      deltaColor: 'rgba(51,71,94,0.55)',
    },
    {
      label: t('stats.kpi.streak'),
      value: currentStreak,
      unit: t('stats.kpi.daysUnit'),
      delta: t('stats.kpi.bestStreak', { count: bestStreak }),
      deltaColor: 'rgba(51,71,94,0.55)',
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

            <div
              className="flex w-fit gap-1 rounded-[20px] p-[5px]"
              style={{ background: 'rgba(255,255,255,0.6)', boxShadow: '0 6px 20px rgba(64,102,128,0.09)', backdropFilter: 'blur(14px)' }}
            >
              {(['week', 'month', 'all'] as Range[]).map((r) => {
                const on = range === r
                return (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className="rounded-[15px] border-none px-5 py-[10px] font-sans text-sm font-bold transition-all duration-[240ms]"
                    style={{
                      background: on ? 'rgba(255,255,255,0.95)' : 'transparent',
                      color: on ? '#25415c' : 'rgba(51,71,94,0.55)',
                    }}
                  >
                    {t(`stats.ranges.${r}`)}
                  </button>
                )
              })}
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              {KPIS.map((k) => (
                <div
                  key={k.label}
                  className="flex flex-col gap-[10px] rounded-[30px] px-7 py-[26px]"
                  style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
                >
                  <span className="text-xs font-extrabold tracking-[1.1px] text-[rgba(51,71,94,0.5)] uppercase">{k.label}</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[40px] leading-none font-extrabold tracking-[-1.5px] text-[#2c3f55]">{k.value}</span>
                    <span className="text-[14.5px] font-bold text-[rgba(51,71,94,0.55)]">{k.unit}</span>
                  </div>
                  <span className="text-[13px] font-bold" style={{ color: k.deltaColor }}>
                    {k.delta}
                  </span>
                </div>
              ))}
            </div>

            <ContributionGraph sessions={sessions} />

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

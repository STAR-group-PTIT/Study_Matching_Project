import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

const WEEKDAY_LABELS = ['T2', '', 'T4', '', 'T6', '', 'CN']

function mix(percent: number) {
  return `color-mix(in oklab, var(--ff-accent) ${percent}%, white)`
}

function startOfDay(d: Date) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function startOfWeekMonday(d: Date) {
  const x = startOfDay(d)
  const shift = (x.getDay() + 6) % 7 // Monday = 0
  x.setDate(x.getDate() - shift)
  return x
}
function startOfMonth(d: Date) {
  const x = startOfDay(d)
  x.setDate(1)
  return x
}
function fmtDdMm(d: Date) {
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
}
function formatHistoryDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const hhmm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
  if (d.toDateString() === now.toDateString()) return `Hôm nay ${hhmm}`
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Hôm qua ${hhmm}`
  return `${fmtDdMm(d)} · ${hhmm}`
}

type Range = 'Tuần này' | 'Tháng này' | 'Tất cả'

type SessionRow = { id: string; minutes: number; room_id: string | null; started_at: string }
type TodoRow = { id: string; name: string; meta: string | null; completed_at: string | null; created_at: string }

export default function Stats() {
  const user = useAuthStore((s) => s.user)
  const [range, setRange] = useState<Range>('Tuần này')
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [completedTodos, setCompletedTodos] = useState<TodoRow[]>([])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    Promise.all([
      supabase
        .from('focus_sessions')
        .select('id, minutes, room_id, started_at')
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
    if (range === 'Tuần này') return startOfWeekMonday(today)
    if (range === 'Tháng này') return startOfMonth(today)
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
        const t = new Date(s.started_at)
        return t >= prevWeekStart && t < thisWeekStart
      })
      .reduce((a, s) => a + s.minutes, 0)
  }, [sessions])

  let kpi1Delta: string
  let kpi1DeltaColor = 'rgba(51,71,94,0.55)'
  if (range === 'Tuần này') {
    if (prevWeekMinutes === 0) {
      kpi1Delta = totalMinutesRange > 0 ? 'Chưa có dữ liệu tuần trước để so sánh' : 'Chưa có phiên nào tuần này'
    } else {
      const pct = Math.round(((totalMinutesRange - prevWeekMinutes) / prevWeekMinutes) * 100)
      kpi1Delta = `${pct >= 0 ? '+' : ''}${pct}% so với tuần trước`
      kpi1DeltaColor = pct >= 0 ? '#2c5b53' : '#7a3f2c'
    }
  } else {
    kpi1Delta = range === 'Tháng này' ? 'Tổng phút trong tháng' : 'Tổng phút từ trước tới nay'
  }

  const { currentStreak, bestStreak } = useMemo(() => {
    const daySet = new Set(sessions.map((s) => startOfDay(new Date(s.started_at)).getTime()))
    if (daySet.size === 0) return { currentStreak: 0, bestStreak: 0 }
    const sortedDays = Array.from(daySet).sort((a, b) => a - b)
    let best = 1
    let run = 1
    for (let i = 1; i < sortedDays.length; i++) {
      const diff = Math.round((sortedDays[i] - sortedDays[i - 1]) / 86400000)
      run = diff === 1 ? run + 1 : 1
      if (run > best) best = run
    }
    const today = startOfDay(new Date()).getTime()
    const yesterday = today - 86400000
    const mostRecent = sortedDays[sortedDays.length - 1]
    let current = 0
    if (mostRecent === today || mostRecent === yesterday) {
      current = 1
      let cursor = mostRecent
      for (let i = sortedDays.length - 2; i >= 0; i--) {
        if (cursor - sortedDays[i] === 86400000) {
          current++
          cursor = sortedDays[i]
        } else break
      }
    }
    return { currentStreak: current, bestStreak: Math.max(best, current) }
  }, [sessions])

  const KPIS = [
    {
      label: `Phút tập trung${range === 'Tuần này' ? ' tuần này' : range === 'Tháng này' ? ' tháng này' : ''}`,
      value: totalMinutesRange,
      unit: 'phút',
      delta: kpi1Delta,
      deltaColor: kpi1DeltaColor,
    },
    {
      label: 'Phiên hoàn thành',
      value: sessionsCountRange,
      unit: 'phiên',
      delta: `${groupSessionsCountRange} phiên học cùng bạn`,
      deltaColor: 'rgba(51,71,94,0.55)',
    },
    {
      label: 'Streak liên tiếp',
      value: currentStreak,
      unit: 'ngày',
      delta: `Kỷ lục của bạn: ${bestStreak} ngày`,
      deltaColor: 'rgba(51,71,94,0.55)',
    },
  ]

  const WEEK = useMemo(() => {
    const monday = startOfWeekMonday(new Date())
    const labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
    return labels.map((name, i) => {
      const dayStart = new Date(monday)
      dayStart.setDate(dayStart.getDate() + i)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const minutes = sessions
        .filter((s) => {
          const t = new Date(s.started_at)
          return t >= dayStart && t < dayEnd
        })
        .reduce((a, s) => a + s.minutes, 0)
      return { name, minutes, date: dayStart }
    })
  }, [sessions])

  const weekTotalMinutes = WEEK.reduce((a, d) => a + d.minutes, 0)
  const MAX_MINUTES = Math.max(1, ...WEEK.map((d) => d.minutes))
  const BEST_DAY = weekTotalMinutes > 0 ? WEEK.reduce((a, d) => (d.minutes > a.minutes ? d : a), WEEK[0]) : null
  const weekRangeLabel = `${fmtDdMm(WEEK[0].date)} – ${fmtDdMm(WEEK[6].date)}`

  const HEAT_CELLS = useMemo(() => {
    const minutesByDay = new Map<number, number>()
    sessions.forEach((s) => {
      const key = startOfDay(new Date(s.started_at)).getTime()
      minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + s.minutes)
    })
    const mondayThisWeek = startOfWeekMonday(new Date())
    const gridStart = new Date(mondayThisWeek)
    gridStart.setDate(gridStart.getDate() - 11 * 7)
    return Array.from({ length: 84 }, (_, i) => {
      const day = new Date(gridStart)
      day.setDate(day.getDate() + i)
      const minutes = minutesByDay.get(day.getTime()) ?? 0
      const lv = minutes === 0 ? 0 : minutes <= 30 ? 1 : minutes <= 60 ? 2 : minutes <= 90 ? 3 : 4
      return {
        lv,
        bg: lv === 0 ? 'rgba(51,71,94,0.07)' : mix(18 + lv * 20),
        title: lv === 0 ? 'Không học' : `${minutes} phút`,
      }
    })
  }, [sessions])
  const ACTIVE_DAYS = HEAT_CELLS.filter((c) => c.lv > 0).length

  const HISTORY = completedTodos.map((t) => ({
    name: t.name,
    meta: t.meta || '—',
    date: formatHistoryDate(t.completed_at ?? t.created_at),
  }))

  return (
    <div
      className="relative min-h-svh w-full font-sans text-[#33475e] antialiased"
      style={{ background: 'linear-gradient(170deg, #e4f1f4 0%, #dbeaf2 50%, #e6f4ee 100%)' }}
    >
      <div className="mx-auto flex max-w-[1120px] flex-col gap-[22px] px-8 pt-11 pb-16">
        <div className="flex flex-wrap items-center justify-between gap-[14px]">
          <div className="flex items-center gap-[11px]">
            <div
              className="h-[22px] w-[22px] rounded-[9px]"
              style={{ background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))' }}
            />
            <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[#2f4459]">FocusFlow</span>
            <span className="text-sm font-semibold text-[rgba(51,71,94,0.5)]">· Thống kê cá nhân</span>
          </div>
          <div
            className="flex gap-1 rounded-[20px] p-[5px]"
            style={{ background: 'rgba(255,255,255,0.7)', boxShadow: '0 6px 18px rgba(58,98,126,0.08)' }}
          >
            {(['Tuần này', 'Tháng này', 'Tất cả'] as Range[]).map((name) => {
              const on = range === name
              return (
                <button
                  key={name}
                  onClick={() => setRange(name)}
                  className="rounded-2xl border-none px-[17px] py-[9px] font-sans text-[13px] font-bold transition-all duration-[240ms]"
                  style={{
                    color: on ? '#25415c' : 'rgba(51,71,94,0.55)',
                    background: on ? 'rgba(255,255,255,0.98)' : 'transparent',
                    boxShadow: on ? '0 4px 12px rgba(58,98,126,0.1)' : 'none',
                  }}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </div>

        {/* overview */}
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {KPIS.map((k) => (
            <div
              key={k.label}
              className="flex flex-col gap-[10px] rounded-[30px] px-7 py-[26px]"
              style={{ background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <span className="text-xs font-extrabold tracking-[1.1px] text-[rgba(51,71,94,0.5)] uppercase">{k.label}</span>
              <div className="flex items-baseline gap-2">
                <span className="text-[44px] leading-none font-extrabold tracking-[-1.5px] text-[#2c3f55]">{k.value}</span>
                <span className="text-[14.5px] font-bold text-[rgba(51,71,94,0.55)]">{k.unit}</span>
              </div>
              <span className="text-[13px] font-bold" style={{ color: k.deltaColor }}>
                {k.delta}
              </span>
            </div>
          ))}
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }}>
          {/* bar chart */}
          <div
            className="flex flex-col gap-5 rounded-[30px] px-7 pt-[26px] pb-[22px]"
            style={{ background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[16.5px] font-extrabold text-[#2c3f55]">Phút tập trung theo ngày</span>
              <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">
                {weekRangeLabel}
                {BEST_DAY ? ` · cao nhất ${BEST_DAY.name}` : ''}
              </span>
            </div>
            <div className="flex h-[208px] items-end gap-3">
              {WEEK.map((d) => {
                const isBest = BEST_DAY !== null && d === BEST_DAY
                return (
                  <div key={d.name} className="flex h-full flex-1 flex-col items-center justify-end gap-[9px]">
                    <span className="text-[12.5px] font-extrabold" style={{ color: isBest ? '#22483f' : 'rgba(51,71,94,0.55)' }}>
                      {d.minutes}
                    </span>
                    <div
                      className="w-full rounded-[14px_14px_8px_8px] transition-[height] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{
                        height: Math.round((d.minutes / MAX_MINUTES) * 100) + '%',
                        background: isBest ? mix(58) : mix(32),
                        boxShadow: '0 6px 14px rgba(58,98,126,0.08)',
                      }}
                    />
                    <span className="text-[12.5px] font-bold" style={{ color: isBest ? '#2c3f55' : 'rgba(51,71,94,0.5)' }}>
                      {d.name}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* heatmap */}
          <div
            className="flex flex-col gap-[18px] rounded-[30px] px-7 pt-[26px] pb-6"
            style={{ background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[16.5px] font-extrabold text-[#2c3f55]">Mật độ học 12 tuần</span>
              <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">{ACTIVE_DAYS}/84 ngày có học</span>
            </div>
            <div className="flex gap-[10px]">
              <div className="flex flex-col justify-between pt-px pb-px">
                {WEEKDAY_LABELS.map((text, i) => (
                  <span key={i} className="h-[15px] text-[10.5px] leading-[15px] font-bold text-[rgba(51,71,94,0.4)]">
                    {text}
                  </span>
                ))}
              </div>
              <div
                className="grid flex-1 justify-between gap-[5px]"
                style={{ gridTemplateRows: 'repeat(7, 15px)', gridAutoFlow: 'column', gridAutoColumns: '15px' }}
              >
                {HEAT_CELLS.map((c, i) => (
                  <div key={i} title={c.title} className="rounded-[5px]" style={{ background: c.bg }} />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-[7px]">
              <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">ít</span>
              {[0, 1, 2, 3, 4].map((lv) => (
                <div
                  key={lv}
                  className="h-[13px] w-[13px] rounded"
                  style={{ background: lv === 0 ? 'rgba(51,71,94,0.07)' : mix(18 + lv * 20) }}
                />
              ))}
              <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">nhiều</span>
            </div>
          </div>
        </div>

        {/* history */}
        <div
          className="flex flex-col gap-4 rounded-[30px] px-7 pt-[26px] pb-[22px]"
          style={{ background: 'rgba(255,255,255,0.78)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[16.5px] font-extrabold text-[#2c3f55]">Việc đã hoàn thành gần đây</span>
            <a href="#" onClick={(e) => e.preventDefault()} className="text-[13px] font-bold no-underline">
              Xem tất cả
            </a>
          </div>
          {HISTORY.length === 0 ? (
            <div className="rounded-[22px] px-[18px] py-[22px] text-center text-[13.5px] font-semibold text-[rgba(51,71,94,0.5)]" style={{ background: 'rgba(238,246,248,0.72)' }}>
              Chưa có việc nào hoàn thành. Đánh dấu xong việc ở Dashboard để thấy ở đây.
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

        <Link to="/" className="self-center text-[13.5px] font-bold text-[oklch(0.58_0.075_220)] no-underline hover:text-[oklch(0.5_0.08_220)]">
          ← Về màn hình học
        </Link>
      </div>
    </div>
  )
}

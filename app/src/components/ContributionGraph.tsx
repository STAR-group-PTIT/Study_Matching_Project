import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildContributionDays,
  computeStreaks,
  contributionCellColor,
  type ContributionDay,
  type ContributionRange,
  type ContributionSession,
} from '../lib/contributions'

// Sun-first (0=Sun..6=Sat), khớp đúng layout thật của GitHub contribution graph — khác với
// heatmap 12 tuần cũ ở Stats.tsx (Mon-first). Chỉ hiện nhãn Mon/Wed/Fri, đúng ảnh mẫu user gửi.
const WEEKDAY_ROW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const WEEKDAY_LABEL_ROWS = new Set([1, 3, 5])
const WEEKDAY_COL_WIDTH = 22

function buildWeeks(days: ContributionDay[]): (ContributionDay | null)[][] {
  if (days.length === 0) return []
  const startPad = days[0].date.getDay()
  const cells: (ContributionDay | null)[] = Array(startPad).fill(null)
  cells.push(...days)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (ContributionDay | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export default function ContributionGraph({ sessions }: { sessions: ContributionSession[] }) {
  const { t, i18n } = useTranslation()
  const [range, setRange] = useState<ContributionRange>({ mode: 'trailing365' })

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear()
    let earliest = currentYear
    for (const s of sessions) {
      const y = new Date(s.started_at).getFullYear()
      if (y < earliest) earliest = y
    }
    const list: number[] = []
    for (let y = currentYear; y >= earliest; y--) list.push(y)
    return list
  }, [sessions])

  const days = useMemo(() => buildContributionDays(sessions, range), [sessions, range])
  const weeks = useMemo(() => buildWeeks(days), [days])
  const monthFormatter = useMemo(() => new Intl.DateTimeFormat(i18n.language, { month: 'short' }), [i18n.language])

  const monthLabels = useMemo(() => {
    const labels = new Map<number, string>()
    let lastMonth = -1
    weeks.forEach((week, wi) => {
      const firstDay = week.find((d) => d !== null)
      if (!firstDay) return
      const m = firstDay.date.getMonth()
      if (m !== lastMonth) {
        labels.set(wi, monthFormatter.format(firstDay.date))
        lastMonth = m
      }
    })
    return labels
  }, [weeks, monthFormatter])

  const activeDays = days.filter((d) => d.totalMinutes > 0).length
  const pomo25Total = days.reduce((a, d) => a + d.pomo25, 0)
  const pomo50Total = days.reduce((a, d) => a + d.pomo50, 0)

  // Streak luôn tính trên toàn bộ lịch sử (không bị bó theo năm/365 ngày đang chọn) — cùng
  // hành vi với KPI "Streak" ở tab Tổng quan, một khái niệm xuyên suốt chứ không theo khung xem.
  const { currentStreak, bestStreak } = useMemo(
    () => computeStreaks(sessions.map((s) => s.started_at)),
    [sessions],
  )

  const summary =
    range.mode === 'trailing365'
      ? t('stats.contributions.summaryTrailing', { count: activeDays })
      : t('stats.contributions.summaryYear', { count: activeDays, year: range.year })

  const cardStyle = {
    background: 'rgba(255,255,255,0.78)',
    backdropFilter: 'blur(18px)',
    boxShadow: '0 14px 36px rgba(58,98,126,0.1)',
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-[18px] rounded-[30px] px-7 pt-[26px] pb-6" style={cardStyle}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col gap-[2px]">
            <span className="text-[16.5px] font-extrabold text-[#2c3f55]">{t('stats.contributions.title')}</span>
            <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">{summary}</span>
          </div>
          <div className="flex flex-wrap gap-[6px]">
            <button
              onClick={() => setRange({ mode: 'trailing365' })}
              className="rounded-2xl border-none px-[15px] py-[8px] font-sans text-[12.5px] font-bold transition-all duration-[240ms]"
              style={{
                color: range.mode === 'trailing365' ? '#25415c' : 'rgba(51,71,94,0.55)',
                background: range.mode === 'trailing365' ? 'rgba(255,255,255,0.98)' : 'rgba(238,246,248,0.72)',
                boxShadow: range.mode === 'trailing365' ? '0 4px 12px rgba(58,98,126,0.1)' : 'none',
              }}
            >
              {t('stats.contributions.trailingLabel')}
            </button>
            {years.map((y) => {
              const on = range.mode === 'year' && range.year === y
              return (
                <button
                  key={y}
                  onClick={() => setRange({ mode: 'year', year: y })}
                  className="rounded-2xl border-none px-[15px] py-[8px] font-sans text-[12.5px] font-bold transition-all duration-[240ms]"
                  style={{
                    color: on ? '#25415c' : 'rgba(51,71,94,0.55)',
                    background: on ? 'rgba(255,255,255,0.98)' : 'rgba(238,246,248,0.72)',
                    boxShadow: on ? '0 4px 12px rgba(58,98,126,0.1)' : 'none',
                  }}
                >
                  {y}
                </button>
              )
            })}
          </div>
        </div>

        <div className="overflow-x-auto pb-1">
          <div className="flex min-w-fit flex-col gap-[6px]">
            {/* nhãn tháng — spacer bên trái rộng bằng đúng cột nhãn thứ bên dưới để 2 hàng thẳng cột */}
            <div className="flex gap-[10px]">
              <div style={{ width: WEEKDAY_COL_WIDTH }} className="shrink-0" />
              <div className="grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, 15px)`, gap: '5px' }}>
                {weeks.map((_, wi) => (
                  <span key={wi} className="text-[10.5px] font-bold whitespace-nowrap text-[rgba(51,71,94,0.4)]">
                    {monthLabels.get(wi) ?? ''}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-[10px]">
              <div style={{ width: WEEKDAY_COL_WIDTH }} className="flex shrink-0 flex-col justify-between">
                {WEEKDAY_ROW_KEYS.map((key, i) => (
                  <span key={key} className="h-[15px] text-[10.5px] leading-[15px] font-bold text-[rgba(51,71,94,0.4)]">
                    {WEEKDAY_LABEL_ROWS.has(i) ? t(`stats.weekdaysShort.${key}`) : ''}
                  </span>
                ))}
              </div>
              <div
                className="grid"
                style={{ gridTemplateRows: 'repeat(7, 15px)', gridAutoFlow: 'column', gridAutoColumns: '15px', gap: '5px' }}
              >
                {weeks.flat().map((day, i) => {
                  if (!day) return <div key={i} />
                  const title = day.totalMinutes > 0
                    ? t('stats.contributions.tooltipStudied', {
                        date: day.key,
                        minutes: day.totalMinutes,
                        p25: day.pomo25,
                        p50: day.pomo50,
                      })
                    : t('stats.contributions.tooltipEmpty', { date: day.key })
                  return (
                    <div
                      key={i}
                      title={title}
                      className="rounded-[3px]"
                      style={{ background: contributionCellColor(day.level) }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-[7px]">
          <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">{t('stats.heatmap.less')}</span>
          {([0, 1, 2, 3, 4] as const).map((lv) => (
            <div key={lv} className="h-[13px] w-[13px] rounded" style={{ background: contributionCellColor(lv) }} />
          ))}
          <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">{t('stats.heatmap.more')}</span>
        </div>
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="flex flex-col gap-[10px] rounded-[30px] px-6 py-[22px]" style={cardStyle}>
          <span className="text-xs font-extrabold tracking-[1.1px] text-[rgba(51,71,94,0.5)] uppercase">
            {t('stats.contributions.activeDaysLabel')}
          </span>
          <span className="text-[36px] leading-none font-extrabold tracking-[-1.5px] text-[#2c3f55]">{activeDays}</span>
        </div>
        <div className="flex flex-col gap-[10px] rounded-[30px] px-6 py-[22px]" style={cardStyle}>
          <span className="text-xs font-extrabold tracking-[1.1px] text-[rgba(51,71,94,0.5)] uppercase">
            {t('stats.kpi.streak')}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-[36px] leading-none font-extrabold tracking-[-1.5px] text-[#2c3f55]">{currentStreak}</span>
            <span className="text-[14.5px] font-bold text-[rgba(51,71,94,0.55)]">{t('stats.kpi.daysUnit')}</span>
          </div>
          <span className="text-[13px] font-bold text-[rgba(51,71,94,0.55)]">{t('stats.kpi.bestStreak', { count: bestStreak })}</span>
        </div>
        <div className="flex flex-col gap-[10px] rounded-[30px] px-6 py-[22px]" style={cardStyle}>
          <span className="text-xs font-extrabold tracking-[1.1px] text-[rgba(51,71,94,0.5)] uppercase">
            {t('stats.contributions.pomo25Label')}
          </span>
          <span className="text-[36px] leading-none font-extrabold tracking-[-1.5px] text-[#2c3f55]">{pomo25Total}</span>
        </div>
        <div className="flex flex-col gap-[10px] rounded-[30px] px-6 py-[22px]" style={cardStyle}>
          <span className="text-xs font-extrabold tracking-[1.1px] text-[rgba(51,71,94,0.5)] uppercase">
            {t('stats.contributions.pomo50Label')}
          </span>
          <span className="text-[36px] leading-none font-extrabold tracking-[-1.5px] text-[#2c3f55]">{pomo50Total}</span>
        </div>
      </div>
    </div>
  )
}

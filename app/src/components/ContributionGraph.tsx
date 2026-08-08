import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  buildContributionDays,
  contributionCellColor,
  mixAccent,
  type ContributionDay,
  type ContributionSession,
} from '../lib/contributions'

// Thứ bắt đầu Thứ Hai (khớp `startOfWeekMonday` ở Stats.tsx) — khác bản GitHub-strip cũ (Sun-first,
// tuần chạy theo cột). Lưới lịch thật: 7 cột thứ x tối đa 6 hàng tuần, gọn theo đúng 1 tháng.
const WEEKDAY_ROW_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

function buildMonthWeeks(days: ContributionDay[]): (ContributionDay | null)[][] {
  if (days.length === 0) return []
  const firstWeekday = (days[0].date.getDay() + 6) % 7 // Mon=0..Sun=6
  const cells: (ContributionDay | null)[] = Array(firstWeekday).fill(null)
  cells.push(...days)
  while (cells.length % 7 !== 0) cells.push(null)
  const weeks: (ContributionDay | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

export default function ContributionGraph({
  sessions,
  year,
  month,
}: {
  sessions: ContributionSession[]
  year: number
  month: number // 0-indexed
}) {
  const { t, i18n } = useTranslation()

  const days = useMemo(() => buildContributionDays(sessions, { year, month }), [sessions, year, month])
  const weeks = useMemo(() => buildMonthWeeks(days), [days])

  // Chi tiết 7 ngày gần nhất — luôn tính trên 7 ngày thật gần đây nhất, bất kể tháng/năm đang
  // chọn ở trên, để phần "gần đây" ổn định thay vì biến mất khi user lùi xem tháng cũ.
  const last7Days = useMemo(() => {
    const end = new Date()
    end.setHours(0, 0, 0, 0)
    const start = new Date(end)
    start.setDate(start.getDate() - 6)
    const startYear = start.getFullYear()
    const startMonth = start.getMonth()
    const endYear = end.getFullYear()
    const endMonth = end.getMonth()
    const pool =
      startYear === endYear && startMonth === endMonth
        ? buildContributionDays(sessions, { year: startYear, month: startMonth })
        : [
            ...buildContributionDays(sessions, { year: startYear, month: startMonth }),
            ...buildContributionDays(sessions, { year: endYear, month: endMonth }),
          ]
    return pool.filter((d) => d.date >= start && d.date <= end).slice(-7)
  }, [sessions])
  const last7Max = Math.max(1, ...last7Days.map((d) => d.totalMinutes))
  const last7Best = last7Days.some((d) => d.totalMinutes > 0)
    ? last7Days.reduce((a, d) => (d.totalMinutes > a.totalMinutes ? d : a), last7Days[0])
    : null

  const activeDays = days.filter((d) => d.totalMinutes > 0).length
  const monthYearLabel = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric' }).format(new Date(year, month, 1)),
    [i18n.language, year, month],
  )
  const summary = t('stats.contributions.summaryMonth', { count: activeDays, month: monthYearLabel })

  const cardStyle = {
    background: 'rgba(255,255,255,0.78)',
    backdropFilter: 'blur(18px)',
    boxShadow: '0 14px 36px rgba(58,98,126,0.1)',
  }

  return (
    <div className="flex flex-col gap-[18px] rounded-[30px] px-7 pt-[26px] pb-6 lg:flex-row lg:items-stretch lg:gap-8" style={cardStyle}>
      {/* trái: lưới lịch tháng — rộng cố định theo 7 cột, không kéo giãn để khỏi méo ô ngày */}
      <div className="flex w-fit shrink-0 flex-col gap-[14px]">
        <div className="flex flex-col gap-[2px]">
          <span className="text-[16.5px] font-extrabold text-[#2c3f55]">{t('stats.contributions.title')}</span>
          <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">{summary}</span>
        </div>

        <div className="flex w-fit flex-col gap-[5px]">
          <div className="grid gap-[5px]" style={{ gridTemplateColumns: 'repeat(7, 32px)' }}>
            {WEEKDAY_ROW_KEYS.map((key) => (
              <span key={key} className="text-center text-[10px] font-bold text-[rgba(51,71,94,0.4)]">
                {t(`stats.weekdaysShort.${key}`)}
              </span>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="grid gap-[5px]" style={{ gridTemplateColumns: 'repeat(7, 32px)' }}>
              {week.map((day, di) => {
                if (!day) return <div key={di} className="h-[32px] w-[32px]" />
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
                    key={di}
                    title={title}
                    className="flex h-[32px] w-[32px] items-center justify-center rounded-[7px] text-[11px] font-bold"
                    style={{
                      background: contributionCellColor(day.level),
                      color: day.level >= 3 ? 'rgba(255,255,255,0.92)' : 'rgba(51,71,94,0.6)',
                    }}
                  >
                    {day.date.getDate()}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-[7px]">
          <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">{t('stats.heatmap.less')}</span>
          {([0, 1, 2, 3, 4] as const).map((lv) => (
            <div key={lv} className="h-[13px] w-[13px] rounded" style={{ background: contributionCellColor(lv) }} />
          ))}
          <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.42)]">{t('stats.heatmap.more')}</span>
        </div>
      </div>

      <div className="hidden shrink-0 self-stretch lg:block" style={{ borderLeft: '1px solid rgba(51,71,94,0.08)' }} />

      {/* phải: "7 ngày gần nhất" — trước là 1 thẻ riêng bên dưới, giờ ghép cùng hàng để lấp
          khoảng trống bên phải lưới lịch thay vì để trắng. */}
      <div className="flex min-w-0 flex-1 flex-col gap-5 pt-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[16.5px] font-extrabold text-[#2c3f55]">{t('stats.contributions.last7Title')}</span>
          <span className="text-[13px] font-bold text-[rgba(51,71,94,0.48)]">
            {last7Best
              ? t('stats.contributions.last7Highest', {
                  day: t(`stats.weekdaysShort.${WEEKDAY_ROW_KEYS[(last7Best.date.getDay() + 6) % 7]}`),
                })
              : ''}
          </span>
        </div>
        <div className="flex h-[150px] items-end gap-3">
          {last7Days.map((d) => {
            const isBest = last7Best !== null && d.key === last7Best.key
            const weekdayKey = WEEKDAY_ROW_KEYS[(d.date.getDay() + 6) % 7]
            return (
              <div key={d.key} className="flex h-full flex-1 flex-col items-center justify-end gap-[9px]">
                <span className="text-[12.5px] font-extrabold" style={{ color: isBest ? '#22483f' : 'rgba(51,71,94,0.55)' }}>
                  {d.totalMinutes}
                </span>
                <div
                  className="w-full rounded-[14px_14px_8px_8px] transition-[height] duration-[600ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    height: Math.round((d.totalMinutes / last7Max) * 100) + '%',
                    background: isBest ? mixAccent(58) : mixAccent(32),
                    boxShadow: '0 6px 14px rgba(58,98,126,0.08)',
                  }}
                />
                <span className="text-[12.5px] font-bold" style={{ color: isBest ? '#2c3f55' : 'rgba(51,71,94,0.5)' }}>
                  {t(`stats.weekdaysShort.${weekdayKey}`)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

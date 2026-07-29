import { useState } from 'react'
import { Link } from 'react-router-dom'

const WEEK = [
  { name: 'T2', minutes: 95 },
  { name: 'T3', minutes: 140 },
  { name: 'T4', minutes: 60 },
  { name: 'T5', minutes: 175 },
  { name: 'T6', minutes: 120 },
  { name: 'T7', minutes: 205 },
  { name: 'CN', minutes: 75 },
]

const HISTORY = [
  { name: 'Ôn chương 4 – Đạo hàm', meta: 'Toán · 3 phiên · 75 phút', date: 'Hôm nay 14:20' },
  { name: 'Làm 10 câu trắc nghiệm Lý', meta: 'Vật lý · 1 phiên · 25 phút', date: 'Hôm nay 10:05' },
  { name: 'Reading Unit 7 + từ mới', meta: 'Tiếng Anh · 2 phiên · 50 phút', date: 'Hôm qua 21:40' },
  { name: 'Bài tập thuật toán đệ quy', meta: 'Lập trình · 4 phiên · 100 phút', date: 'Hôm qua 16:10' },
  { name: 'Ghi chú lỗi sai đề thi thử', meta: 'Ôn tập · 1 phiên · 25 phút', date: '25/07 · 20:15' },
  { name: 'Học cùng Minh Anh – chương 3', meta: 'Phòng chung · 2 phiên · 50 phút', date: '24/07 · 19:30' },
]

const WEEKDAY_LABELS = ['T2', '', 'T4', '', 'T6', '', 'CN']

function mix(percent: number) {
  return `color-mix(in oklab, var(--ff-accent) ${percent}%, white)`
}

// deterministic pseudo-random density, 12 weeks × 7 days
function density(i: number) {
  const v = Math.sin(i * 12.9898) * 43758.5453
  const f = v - Math.floor(v)
  const d = i % 7
  const weekendBoost = d >= 5 ? 0.15 : 0
  return Math.max(0, Math.min(4, Math.round((f + weekendBoost) * 4.4 - 0.4)))
}

const HEAT_CELLS = Array.from({ length: 84 }, (_, i) => {
  const lv = density(i)
  return {
    lv,
    bg: lv === 0 ? 'rgba(51,71,94,0.07)' : mix(18 + lv * 20),
    title: lv === 0 ? 'Không học' : `${lv * 30}–${lv * 30 + 30} phút`,
  }
})
const ACTIVE_DAYS = HEAT_CELLS.filter((c) => c.lv > 0).length

const TOTAL_MINUTES = WEEK.reduce((a, d) => a + d.minutes, 0)
const MAX_MINUTES = Math.max(...WEEK.map((d) => d.minutes))
const BEST_DAY = WEEK.reduce((a, d) => (d.minutes > a.minutes ? d : a), WEEK[0])

const KPIS = [
  { label: 'Phút tập trung tuần này', value: TOTAL_MINUTES, unit: 'phút', delta: '+18% so với tuần trước', deltaColor: '#2c5b53' },
  { label: 'Phiên hoàn thành', value: 34, unit: 'phiên', delta: '5 phiên học cùng bạn', deltaColor: 'rgba(51,71,94,0.55)' },
  { label: 'Streak liên tiếp', value: 12, unit: 'ngày', delta: 'Kỷ lục của bạn: 19 ngày', deltaColor: 'rgba(51,71,94,0.55)' },
]

type Range = 'Tuần này' | 'Tháng này' | 'Tất cả'

export default function Stats() {
  const [range, setRange] = useState<Range>('Tuần này')

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
                21/07 – 27/07 · cao nhất {BEST_DAY.name}
              </span>
            </div>
            <div className="flex h-[208px] items-end gap-3">
              {WEEK.map((d) => {
                const isBest = d === BEST_DAY
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
          <div className="flex flex-col gap-2">
            {HISTORY.map((h) => (
              <div
                key={h.name}
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
        </div>

        <Link to="/" className="self-center text-[13.5px] font-bold text-[oklch(0.58_0.075_220)] no-underline hover:text-[oklch(0.5_0.08_220)]">
          ← Về màn hình học
        </Link>
      </div>
    </div>
  )
}

// FocusFlow — dữ liệu cho tab "Tiến độ" (biểu đồ đóng góp kiểu GitHub). Pure, không import
// supabase để test được đơn lẻ không cần env (cùng pattern timer.ts/levels.ts/queueStats.ts).

export type PomodoroType = '25:5' | '50:10' | 'other'

// 2 preset duy nhất app cho chọn từ Giai đoạn 8 (phần 10) trở đi — dữ liệu cũ hơn (từng có
// slider tự do) rơi vào 'other', vẫn tính vào tổng phút nhưng không tính vào breakdown 25:5/50:10.
export function classifyPomodoroType(minutes: number): PomodoroType {
  if (minutes === 25) return '25:5'
  if (minutes === 50) return '50:10'
  return 'other'
}

export type ContributionSession = {
  minutes: number
  started_at: string
  phase: 'focus' | 'break'
  completed: boolean
}

export type ContributionDay = {
  key: string // yyyy-mm-dd, local
  date: Date
  totalMinutes: number
  pomo25: number
  pomo50: number
  level: 0 | 1 | 2 | 3 | 4
}

export type ContributionRange = { mode: 'trailing365' } | { mode: 'year'; year: number }

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function levelFromMinutes(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes === 0) return 0
  if (minutes <= 30) return 1
  if (minutes <= 60) return 2
  if (minutes <= 90) return 3
  return 4
}

function rangeBounds(range: ContributionRange): { start: Date; end: Date } {
  if (range.mode === 'trailing365') {
    const end = startOfDay(new Date())
    const start = new Date(end)
    start.setDate(start.getDate() - 364)
    return { start, end }
  }
  return { start: new Date(range.year, 0, 1), end: new Date(range.year, 11, 31) }
}

// Gom sessions theo ngày (giờ địa phương) trong khung `range`. `totalMinutes` cộng mọi phiên
// phase='focus' bất kể hoàn thành hay bị huỷ giữa chừng (khớp ý nghĩa "thời gian đã học thật");
// `pomo25`/`pomo50` chỉ đếm khi `completed === true` (Pomodoro hoàn thành trọn vẹn).
export function buildContributionDays(sessions: ContributionSession[], range: ContributionRange): ContributionDay[] {
  const { start, end } = rangeBounds(range)
  const byKey = new Map<string, { totalMinutes: number; pomo25: number; pomo50: number }>()
  for (const s of sessions) {
    if (s.phase !== 'focus') continue
    const d = startOfDay(new Date(s.started_at))
    if (d < start || d > end) continue
    const key = dayKey(d)
    const entry = byKey.get(key) ?? { totalMinutes: 0, pomo25: 0, pomo50: 0 }
    entry.totalMinutes += s.minutes
    if (s.completed) {
      const type = classifyPomodoroType(s.minutes)
      if (type === '25:5') entry.pomo25 += 1
      else if (type === '50:10') entry.pomo50 += 1
    }
    byKey.set(key, entry)
  }
  const days: ContributionDay[] = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const key = dayKey(cursor)
    const entry = byKey.get(key) ?? { totalMinutes: 0, pomo25: 0, pomo50: 0 }
    days.push({ key, date: new Date(cursor), ...entry, level: levelFromMinutes(entry.totalMinutes) })
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

// Streak ngày liên tiếp có ít nhất 1 phiên focus — generalize logic đã có ở Stats.tsx để dùng
// chung cho cả tab Tổng quan lẫn tab Tiến độ. Nhận thẳng danh sách `started_at` (không cần lọc
// theo range — streak luôn tính trên toàn bộ lịch sử, giống hành vi gốc ở Stats.tsx).
export function computeStreaks(startedAtList: string[]): { currentStreak: number; bestStreak: number } {
  const daySet = new Set(startedAtList.map((iso) => startOfDay(new Date(iso)).getTime()))
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
}

// Trộn màu accent hiện hành (biến CSS --ff-accent) với trắng theo % — dùng cho bar chart ở
// Stats.tsx (cột "cao nhất" vs cột thường), một dải màu nhạt có chủ đích cho biểu đồ cột.
export function mixAccent(percent: number): string {
  return `color-mix(in oklab, var(--ff-accent) ${percent}%, white)`
}

// Màu ô lưới contribution — đậm/bão hoà hơn hẳn mixAccent() ở trên vì lưới cả năm cần "nổi
// bật" như GitHub thật (dải xanh lá đậm dần), trong khi mixAccent() chỉ trộn nhạt với trắng
// (--ff-accent gốc vốn là tông pastel oklch chroma ~0.085, giữ nguyên percent thấp sẽ bị chìm
// vào nền card cũng pastel). Dựng thẳng bằng oklch(L C H) theo đúng hue accent user đang chọn
// (biến --ff-accent-h) nhưng tăng chroma + kéo giãn lightness xuống thấp ở level cao.
const CELL_LIGHTNESS: Record<1 | 2 | 3 | 4, number> = { 1: 0.86, 2: 0.72, 3: 0.58, 4: 0.44 }
const CELL_CHROMA: Record<1 | 2 | 3 | 4, number> = { 1: 0.09, 2: 0.13, 3: 0.16, 4: 0.18 }

export function contributionCellColor(level: 0 | 1 | 2 | 3 | 4): string {
  if (level === 0) return 'rgba(51,71,94,0.07)'
  return `oklch(${CELL_LIGHTNESS[level]} ${CELL_CHROMA[level]} var(--ff-accent-h))`
}

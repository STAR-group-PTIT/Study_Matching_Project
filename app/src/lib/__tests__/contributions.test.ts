import { describe, expect, it } from 'vitest'
import {
  buildContributionDays,
  classifyPomodoroType,
  computeStreaks,
  contributionCellColor,
  type ContributionSession,
} from '../contributions'

describe('contributionCellColor', () => {
  it('level 0 là màu track trung tính, không phải oklch theo accent', () => {
    expect(contributionCellColor(0)).toBe('rgba(51,71,94,0.07)')
  })

  it('level 1-4 dùng oklch theo đúng hue accent hiện hành, đậm dần', () => {
    for (const lv of [1, 2, 3, 4] as const) {
      const color = contributionCellColor(lv)
      expect(color).toContain('oklch(')
      expect(color).toContain('var(--ff-accent-h)')
    }
  })
})

describe('classifyPomodoroType', () => {
  it('25 phút → 25:5', () => {
    expect(classifyPomodoroType(25)).toBe('25:5')
  })
  it('50 phút → 50:10', () => {
    expect(classifyPomodoroType(50)).toBe('50:10')
  })
  it('giá trị khác (vd dữ liệu cũ trước khi khoá 2 preset) → other', () => {
    expect(classifyPomodoroType(30)).toBe('other')
    expect(classifyPomodoroType(0)).toBe('other')
  })
})

function session(overrides: Partial<ContributionSession> & { started_at: string }): ContributionSession {
  return { minutes: 25, phase: 'focus', completed: true, ...overrides }
}

// Giờ trong ngày cố định 12:00 THEO GIỜ ĐỊA PHƯƠNG (không phải UTC) để test không phụ thuộc
// timezone của máy chạy test — dùng Date(y, m, d, h) rồi toISOString() thay vì viết tay chuỗi
// "...Z" (chuỗi Z là UTC tuyệt đối, dễ lệch sang ngày khác tuỳ timezone local).
function localNoonIso(year: number, month: number, day: number): string {
  return new Date(year, month - 1, day, 12, 0, 0).toISOString()
}

describe('buildContributionDays', () => {
  it('gom đúng theo ngày local, đúng ngưỡng level, đếm pomo25/pomo50 chỉ khi completed', () => {
    const sessions: ContributionSession[] = [
      session({ started_at: localNoonIso(2025, 3, 10), minutes: 25, completed: true }),
      session({ started_at: localNoonIso(2025, 3, 10), minutes: 50, completed: true }),
      session({ started_at: localNoonIso(2025, 3, 10), minutes: 30, completed: false }), // huỷ giữa chừng, không tính pomo
      session({ started_at: localNoonIso(2025, 3, 11), minutes: 50, completed: false }), // dở dang đúng bằng 50 phút nhưng KHÔNG hoàn thành
      session({ started_at: localNoonIso(2025, 3, 15), minutes: 90, completed: true, phase: 'break' }), // break không tính vào contribution
    ]
    const days = buildContributionDays(sessions, { mode: 'year', year: 2025 })
    expect(days).toHaveLength(365)

    const day10 = days.find((d) => d.key === '2025-03-10')!
    expect(day10.totalMinutes).toBe(105) // 25 + 50 + 30
    expect(day10.pomo25).toBe(1)
    expect(day10.pomo50).toBe(1)
    expect(day10.level).toBe(4) // >90 phút

    const day11 = days.find((d) => d.key === '2025-03-11')!
    expect(day11.totalMinutes).toBe(50)
    expect(day11.pomo25).toBe(0)
    expect(day11.pomo50).toBe(0) // completed=false nên không đếm dù đúng 50 phút
    expect(day11.level).toBe(2) // 50 phút nằm trong ngưỡng level 2 (31-60)

    const day15 = days.find((d) => d.key === '2025-03-15')!
    expect(day15.totalMinutes).toBe(0) // phase='break' bị loại khỏi contribution
    expect(day15.level).toBe(0)

    const emptyDay = days.find((d) => d.key === '2025-01-01')!
    expect(emptyDay.totalMinutes).toBe(0)
    expect(emptyDay.level).toBe(0)
  })

  it('lọc đúng theo range: year cụ thể loại session ngoài năm đó', () => {
    const sessions: ContributionSession[] = [
      session({ started_at: localNoonIso(2024, 12, 31), minutes: 25 }),
      session({ started_at: localNoonIso(2025, 6, 1), minutes: 25 }),
      session({ started_at: localNoonIso(2026, 1, 1), minutes: 25 }),
    ]
    const days = buildContributionDays(sessions, { mode: 'year', year: 2025 })
    const totalMinutesAll = days.reduce((a, d) => a + d.totalMinutes, 0)
    expect(totalMinutesAll).toBe(25)
  })

  it('trailing365 gồm đúng 365 ngày tính tới hôm nay, loại session quá cũ', () => {
    const today = new Date()
    const iso = (daysAgo: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() - daysAgo)
      d.setHours(12, 0, 0, 0)
      return d.toISOString()
    }
    const sessions: ContributionSession[] = [
      session({ started_at: iso(0), minutes: 25 }),
      session({ started_at: iso(400), minutes: 25 }), // quá 365 ngày, phải bị loại
    ]
    const days = buildContributionDays(sessions, { mode: 'trailing365' })
    expect(days).toHaveLength(365)
    const totalMinutesAll = days.reduce((a, d) => a + d.totalMinutes, 0)
    expect(totalMinutesAll).toBe(25)
  })
})

describe('computeStreaks', () => {
  it('rỗng → 0/0', () => {
    expect(computeStreaks([])).toEqual({ currentStreak: 0, bestStreak: 0 })
  })

  it('liên tục nhiều ngày tính tới hôm nay', () => {
    const today = new Date()
    const iso = (daysAgo: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() - daysAgo)
      return d.toISOString()
    }
    const result = computeStreaks([iso(0), iso(1), iso(2)])
    expect(result.currentStreak).toBe(3)
    expect(result.bestStreak).toBe(3)
  })

  it('có khoảng trống thì currentStreak reset nhưng bestStreak giữ kỷ lục cũ', () => {
    const result = computeStreaks([
      localNoonIso(2025, 1, 1),
      localNoonIso(2025, 1, 2),
      localNoonIso(2025, 1, 3),
      localNoonIso(2025, 1, 10),
    ])
    expect(result.bestStreak).toBe(3)
    expect(result.currentStreak).toBe(0) // ngày gần nhất (01-10) không phải hôm nay/hôm qua
  })

  it('biên năm: 31/12 → 1/1 vẫn tính liên tục', () => {
    const result = computeStreaks([localNoonIso(2024, 12, 30), localNoonIso(2024, 12, 31), localNoonIso(2025, 1, 1)])
    expect(result.bestStreak).toBe(3)
  })
})

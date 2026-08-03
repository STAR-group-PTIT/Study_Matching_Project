import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computeLeftFromRoom, computeMusicPositionFromRoom, phaseTotalSeconds, type RoomRow } from '../timer'

function makeRow(overrides: Partial<RoomRow> = {}): RoomRow {
  const now = new Date('2026-08-03T10:00:00Z')
  return {
    id: 'r1',
    code: 'ABC123',
    name: 'Test',
    host_id: 'h1',
    admit_mode: 'auto',
    capacity: 4,
    duration_minutes: 25,
    break_minutes: 5,
    session_count: 4,
    timer_phase: 'focus',
    timer_round: 1,
    timer_running: false,
    timer_done: false,
    timer_remaining_seconds: null,
    timer_updated_at: now.toISOString(),
    music_on: false,
    music_track_index: 0,
    music_updated_at: now.toISOString(),
    music_position_seconds: 0,
    music_source: 'library',
    youtube_url: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-03T10:00:30Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('phaseTotalSeconds', () => {
  it('focus = duration_minutes * 60, break = break_minutes * 60', () => {
    const r = makeRow({ duration_minutes: 25, break_minutes: 5 })
    expect(phaseTotalSeconds(r, 'focus')).toBe(1500)
    expect(phaseTotalSeconds(r, 'break')).toBe(300)
  })
})

describe('computeLeftFromRoom', () => {
  it('dùng duration mặc định khi chưa từng lưu remaining', () => {
    const r = makeRow({ timer_running: true })
    expect(computeLeftFromRoom(r)).toBe(1500 - 30)
  })

  it('dừng: trả đúng remaining đã lưu, không trừ thời gian trôi', () => {
    const r = makeRow({ timer_running: false, timer_remaining_seconds: 1200 })
    expect(computeLeftFromRoom(r)).toBe(1200)
  })

  it('đang chạy: trừ elapsed từ timer_updated_at', () => {
    const r = makeRow({ timer_running: true, timer_remaining_seconds: 1200 })
    expect(computeLeftFromRoom(r)).toBe(1200 - 30)
  })

  it('không bao giờ âm', () => {
    const r = makeRow({ timer_running: true, timer_remaining_seconds: 10 })
    expect(computeLeftFromRoom(r)).toBe(0)
  })
})

describe('computeMusicPositionFromRoom', () => {
  it('music tắt: trả position đã lưu nguyên vẹn', () => {
    const r = makeRow({ music_on: false, music_position_seconds: 42 })
    expect(computeMusicPositionFromRoom(r)).toBe(42)
  })

  it('music bật: position + elapsed (float)', () => {
    const r = makeRow({ music_on: true, music_position_seconds: 10 })
    expect(computeMusicPositionFromRoom(r)).toBe(40)
  })
})

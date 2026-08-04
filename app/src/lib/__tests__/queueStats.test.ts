import { describe, expect, it } from 'vitest'
import { othersWaiting } from '../queueStats'

describe('othersWaiting', () => {
  it('null giữ nguyên null', () => {
    expect(othersWaiting(null)).toBeNull()
  })

  it('0 → 0 (không âm)', () => {
    expect(othersWaiting(0)).toBe(0)
  })

  it('1 → 0 (chỉ có mình trong hàng chờ)', () => {
    expect(othersWaiting(1)).toBe(0)
  })

  it('5 → 4 (bớt chính mình)', () => {
    expect(othersWaiting(5)).toBe(4)
  })
})

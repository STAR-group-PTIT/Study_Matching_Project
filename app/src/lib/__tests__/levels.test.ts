import { describe, expect, it } from 'vitest'
import { levelFromTotalMinutes } from '../levels'

describe('levelFromTotalMinutes', () => {
  it('level 0 dưới 120 phút', () => {
    expect(levelFromTotalMinutes(0)).toBe(0)
    expect(levelFromTotalMinutes(119)).toBe(0)
  })

  it('level 1 từ 120 đến dưới 500', () => {
    expect(levelFromTotalMinutes(120)).toBe(1)
    expect(levelFromTotalMinutes(499)).toBe(1)
  })

  it('level 2 từ 500 đến dưới 2000', () => {
    expect(levelFromTotalMinutes(500)).toBe(2)
    expect(levelFromTotalMinutes(1999)).toBe(2)
  })

  it('level 3 từ 2000 trở lên', () => {
    expect(levelFromTotalMinutes(2000)).toBe(3)
    expect(levelFromTotalMinutes(99999)).toBe(3)
  })
})

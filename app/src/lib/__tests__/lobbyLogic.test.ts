import { describe, expect, it } from 'vitest'
import { decideLobby } from '../lobbyLogic'

const base = { memberCount: 1, capacity: 5, now: 1000, lobbyExpiresAt: null, graceExtended: false }

describe('decideLobby', () => {
  it('0 thành viên → close (mọi người đã rời)', () => {
    expect(decideLobby({ ...base, memberCount: 0 })).toBe('close')
  })

  it('đủ capacity → activate', () => {
    expect(decideLobby({ ...base, memberCount: 5, capacity: 5 })).toBe('activate')
  })

  it('vượt capacity vẫn → activate', () => {
    expect(decideLobby({ ...base, memberCount: 6, capacity: 5 })).toBe('activate')
  })

  it('chưa hết giờ, chưa đủ người → stay', () => {
    expect(decideLobby({ ...base, memberCount: 2, capacity: 5, lobbyExpiresAt: 2000, now: 1000 })).toBe('stay')
  })

  it('chưa có lobbyExpiresAt (chưa set) → stay', () => {
    expect(decideLobby({ ...base, memberCount: 2, capacity: 5, lobbyExpiresAt: null })).toBe('stay')
  })

  it('hết giờ, ≥2 người → activate (không ép ghép 1 mình nhưng cũng không bắt chờ thêm)', () => {
    expect(decideLobby({ ...base, memberCount: 2, capacity: 5, lobbyExpiresAt: 1000, now: 1000 })).toBe('activate')
  })

  it('hết giờ, đúng 1 người, chưa gia hạn → extend', () => {
    expect(decideLobby({ ...base, memberCount: 1, lobbyExpiresAt: 1000, now: 1000, graceExtended: false })).toBe('extend')
  })

  it('hết giờ, đúng 1 người, đã gia hạn rồi → expire', () => {
    expect(decideLobby({ ...base, memberCount: 1, lobbyExpiresAt: 1000, now: 1000, graceExtended: true })).toBe('expire')
  })
})

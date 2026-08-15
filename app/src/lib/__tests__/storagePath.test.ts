import { describe, expect, it } from 'vitest'
import { buildStoragePath, toStorageSafeName } from '../storagePath'

// Bộ ký tự Supabase Storage chấp nhận trong key (regex phía server) — dùng để khẳng
// định kết quả sau khi làm sạch chắc chắn không còn dính 400 InvalidKey nữa.
const SERVER_KEY_RE = /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/

describe('toStorageSafeName', () => {
  it('bỏ dấu tiếng Việt', () => {
    expect(toStorageSafeName('Nhạc học bài.mp3')).toBe('Nhac hoc bai.mp3')
  })

  it('bỏ dấu tiếng Pháp/Đức (ca gây lỗi thật của user)', () => {
    expect(toStorageSafeName('Lumière - Sandfall Interactive (1).mp3')).toBe(
      'Lumiere - Sandfall Interactive (1).mp3',
    )
  })

  it('map được đ/Đ (NFD không tách được)', () => {
    expect(toStorageSafeName('Đường xa.mp3')).toBe('Duong xa.mp3')
  })

  it('giữ nguyên tên đã hợp lệ', () => {
    expect(toStorageSafeName('01-lofi-rain.mp3')).toBe('01-lofi-rain.mp3')
  })

  it('thay ký tự ngoài bộ cho phép bằng _ (kể cả / để không tạo thư mục lạ)', () => {
    expect(toStorageSafeName('a/b#c%d.mp3')).toBe('a_b_c_d.mp3')
  })

  it('rơi về "file" khi tên toàn ký tự lạ (không được trả chuỗi rỗng)', () => {
    // '日本語' -> '___' -> bỏ '_' đầu chuỗi -> rỗng -> fallback
    expect(toStorageSafeName('日本語')).toBe('file')
    expect(toStorageSafeName('###')).toBe('file')
  })

  it('kết quả luôn khớp regex key của server', () => {
    const names = ['Nhạc học bài.mp3', 'Lumière (1).mp3', 'Đường xa.wav', 'a/b#c%d.mp3', '日本語.m4a']
    for (const name of names) expect(toStorageSafeName(name)).toMatch(SERVER_KEY_RE)
  })
})

describe('buildStoragePath', () => {
  it('giữ user id làm thư mục đầu (điều kiện RLS) và tên file đã làm sạch', () => {
    const userId = '11111111-2222-3333-4444-555555555555'
    const path = buildStoragePath(userId, 'Nhạc học bài.mp3')
    expect(path.startsWith(`${userId}/`)).toBe(true)
    expect(path.endsWith('-Nhac hoc bai.mp3')).toBe(true)
    expect(path).toMatch(SERVER_KEY_RE)
  })
})

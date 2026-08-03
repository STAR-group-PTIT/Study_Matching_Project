import { describe, expect, it } from 'vitest'
import { parseYoutubeUrl } from '../youtube'

describe('parseYoutubeUrl', () => {
  it('nhận dạng watch?v= thường', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=e6KzjUOfmBk')).toEqual({
      videoId: 'e6KzjUOfmBk',
      playlistId: null,
    })
  })

  it('nhận dạng youtu.be/', () => {
    expect(parseYoutubeUrl('https://youtu.be/e6KzjUOfmBk')).toEqual({
      videoId: 'e6KzjUOfmBk',
      playlistId: null,
    })
  })

  it('nhận dạng link Mix (list=RD...) kèm start_radio', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=e6KzjUOfmBk&list=RDe6KzjUOfmBk&start_radio=1')).toEqual({
      videoId: 'e6KzjUOfmBk',
      playlistId: 'RDe6KzjUOfmBk',
    })
  })

  it('nhận dạng playlist thuần (không có video)', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/playlist?list=PL1234567890')).toEqual({
      videoId: null,
      playlistId: 'PL1234567890',
    })
  })

  it('nhận dạng /embed/', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/embed/e6KzjUOfmBk')).toEqual({
      videoId: 'e6KzjUOfmBk',
      playlistId: null,
    })
  })

  it('dùng hostname tên miền phụ (m.youtube.com)', () => {
    expect(parseYoutubeUrl('https://m.youtube.com/watch?v=abc')).toEqual({ videoId: 'abc', playlistId: null })
  })

  it('trim khoảng trắng', () => {
    expect(parseYoutubeUrl('  https://youtu.be/abc  ')).toEqual({ videoId: 'abc', playlistId: null })
  })

  it('từ chối domain không phải YouTube', () => {
    expect(parseYoutubeUrl('https://vimeo.com/watch?v=abc')).toBeNull()
    expect(parseYoutubeUrl('https://notyoutube.com/watch?v=abc')).toBeNull()
  })

  it('từ chối chuỗi không phải URL hợp lệ', () => {
    expect(parseYoutubeUrl('not a url')).toBeNull()
    expect(parseYoutubeUrl('')).toBeNull()
  })

  it('từ chối URL YouTube không có video lẫn playlist', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/feed/trending')).toBeNull()
  })
})

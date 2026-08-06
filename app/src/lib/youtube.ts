// Dùng chung cho Dashboard (solo) và Room (đồng bộ cả phòng) — nhận link YouTube dạng
// watch?v=, youtu.be/, playlist?list= (kể cả list=RD... của "Mix") và tách videoId/
// playlistId cho YouTube IFrame Player API chính chủ (không tách audio, đúng ToS).

// Mặc định gốc khi chưa ai từng đổi gì — dùng ở Dashboard (fallback cuối cùng của chuỗi
// override máy này > mặc định riêng tài khoản ở Settings > link này) và ở Settings (đặt
// làm placeholder + fallback khi ô "link mặc định riêng" đang để trống).
export const DEFAULT_YOUTUBE_URL = 'https://www.youtube.com/watch?v=e6KzjUOfmBk&list=RDe6KzjUOfmBk&start_radio=1'

// Link YouTube đã dán/áp dụng trên máy này — cùng 1 key dùng chung cho Dashboard (solo) và
// Room (trong phòng), vì đây là lựa chọn cá nhân theo máy, không theo màn hình đang mở: đổi
// ở Dashboard thì Room cũng thấy ngay và ngược lại. Chuỗi ưu tiên đầy đủ khi phát: override
// máy này > `profiles.default_youtube_url` (đặt ở Settings) > DEFAULT_YOUTUBE_URL ở trên.
export const MUSIC_YOUTUBE_KEY = 'ff-music-youtube-url'
export function loadStoredYoutubeUrlOverride(): string | null {
  try {
    return localStorage.getItem(MUSIC_YOUTUBE_KEY)
  } catch {
    return null
  }
}

export function parseYoutubeUrl(raw: string): { videoId: string | null; playlistId: string | null } | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (!/(^|\.)youtube\.com$/.test(url.hostname) && url.hostname !== 'youtu.be') return null
  let videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v')
  if (!videoId && url.pathname.startsWith('/embed/')) videoId = url.pathname.replace('/embed/', '')
  const playlistId = url.searchParams.get('list')
  if (!videoId && !playlistId) return null
  return { videoId: videoId || null, playlistId: playlistId || null }
}

export type YTPlayer = {
  playVideo: () => void
  pauseVideo: () => void
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  getCurrentTime: () => number
  getPlayerState: () => number
  setVolume: (v: number) => void
  mute: () => void
  unMute: () => void
  destroy: () => void
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer }
    onYouTubeIframeAPIReady?: () => void
  }
}

let ytApiPromise: Promise<void> | null = null
export function loadYoutubeApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve()
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve()
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return ytApiPromise
}

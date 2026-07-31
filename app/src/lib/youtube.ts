// Dùng chung cho Dashboard (solo) và Room (đồng bộ cả phòng) — nhận link YouTube dạng
// watch?v=, youtu.be/, playlist?list= (kể cả list=RD... của "Mix") và tách videoId/
// playlistId cho YouTube IFrame Player API chính chủ (không tách audio, đúng ToS).
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
  setVolume: (v: number) => void
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

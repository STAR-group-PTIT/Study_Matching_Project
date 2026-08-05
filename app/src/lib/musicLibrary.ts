// Nhạc built-in dùng chung cho Dashboard (solo) và Room (trong phòng) — thả file
// .mp3/.wav/.ogg/.m4a vào app/src/assets/music/ là tự động xuất hiện ở cả 2 nơi, không
// cần sửa code. Tên hiển thị = tên file, bỏ đuôi mở rộng và số thứ tự đặt trước (vd
// "01-lofi-rain.mp3" -> "lofi-rain") — đặt số thứ tự để kiểm soát thứ tự hiển thị.
export type LibraryTrack = { id: string; name: string; durationSeconds: number | null } & (
  | { kind: 'builtin'; url: string }
  | { kind: 'db'; path: string }
)

const builtinMusicFiles = import.meta.glob<string>('/src/assets/music/*.{mp3,wav,ogg,m4a}', {
  eager: true,
  import: 'default',
})
export const BUILTIN_TRACKS: LibraryTrack[] = Object.entries(builtinMusicFiles)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, url]) => ({
    id: path,
    kind: 'builtin' as const,
    url,
    name: path
      .split('/')
      .pop()!
      .replace(/\.[^.]+$/, '')
      .replace(/^\d+[-_.\s]*/, ''),
    durationSeconds: null,
  }))

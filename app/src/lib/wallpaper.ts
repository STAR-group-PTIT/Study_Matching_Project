// Dùng chung cho Dashboard (render nền + thumbnail popup) và Settings (thumbnail "Wallpaper của
// tôi") — xác định 1 file wallpaper là video (mp4) hay ảnh tĩnh/GIF dựa theo đuôi file, để biết
// render bằng thẻ <video> hay CSS `background-image`.
export function isVideoWallpaper(nameOrPath: string): boolean {
  return /\.mp4$/i.test(nameOrPath)
}

export const MAX_WALLPAPER_BYTES = 5 * 1024 * 1024
// Video nền (mp4) nặng hơn ảnh tĩnh dù đã nén tốt (dù mp4 vẫn nhẹ hơn GIF nhiều lần ở cùng chất
// lượng) — cho cap riêng cao hơn thay vì dùng chung MAX_WALLPAPER_BYTES với ảnh.
export const MAX_WALLPAPER_VIDEO_BYTES = 15 * 1024 * 1024

// Ảnh nền upload thường chụp thẳng từ điện thoại (4000x3000+), nặng hơn nhiều so với mức cần
// thiết để làm background (màn hình lớn nhất thực tế cũng chỉ ~2560x1440). Tự co về tối đa
// Full HD trước khi lưu lên Storage — giảm dung lượng đáng kể mà mắt thường không thấy khác
// biệt khi dùng làm nền toàn màn hình, user không cần tự nén tay.
const MAX_WALLPAPER_WIDTH = 1920
const MAX_WALLPAPER_HEIGHT = 1080

// Chỉ resize ảnh TĨNH thật (jpg/png/webp) — GIF/mp4 bỏ qua vì canvas chỉ vẽ được 1 khung hình,
// resize qua canvas sẽ làm mất hoạt hình/chuyển động (GIF chỉ còn khung đầu, video thì canvas
// không đọc được luôn).
const RESIZABLE_STATIC_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type PreparedWallpaper = { file: File; isVideo: boolean }

export class WallpaperFileError extends Error {
  readonly code: 'tooLarge' | 'tooLargeVideo'
  constructor(code: 'tooLarge' | 'tooLargeVideo') {
    super(code)
    this.name = 'WallpaperFileError'
    this.code = code
  }
}

// Resize ảnh tĩnh quá khổ về tối đa Full HD (giữ tỉ lệ) trước, RỒI mới check dung lượng — ảnh
// chụp thẳng từ điện thoại thường vượt xa cap ở kích thước gốc nhưng lọt qua dễ dàng sau khi co.
// Ném `WallpaperFileError` với mã lỗi để caller hiển thị đúng thông báo i18n của chính nó.
export async function prepareWallpaperFile(file: File): Promise<PreparedWallpaper> {
  const isVideo = isVideoWallpaper(file.name)
  const prepared = RESIZABLE_STATIC_TYPES.has(file.type)
    ? await resizeWallpaperIfOversized(file).catch(() => file)
    : file
  const maxBytes = isVideo ? MAX_WALLPAPER_VIDEO_BYTES : MAX_WALLPAPER_BYTES
  if (prepared.size > maxBytes) {
    throw new WallpaperFileError(isVideo ? 'tooLargeVideo' : 'tooLarge')
  }
  return { file: prepared, isVideo }
}

async function resizeWallpaperIfOversized(file: File): Promise<File> {
  if (!RESIZABLE_STATIC_TYPES.has(file.type)) return file
  const bitmap = await createImageBitmap(file)
  if (bitmap.width <= MAX_WALLPAPER_WIDTH && bitmap.height <= MAX_WALLPAPER_HEIGHT) {
    bitmap.close()
    return file
  }
  const scale = Math.min(MAX_WALLPAPER_WIDTH / bitmap.width, MAX_WALLPAPER_HEIGHT / bitmap.height)
  const targetWidth = Math.round(bitmap.width * scale)
  const targetHeight = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.88))
  if (!blob) return file
  return new File([blob], file.name, { type: blob.type })
}

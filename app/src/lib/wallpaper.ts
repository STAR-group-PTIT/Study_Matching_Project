// Dùng chung cho Dashboard (render nền + thumbnail popup) và Settings (thumbnail "Wallpaper của
// tôi") — xác định 1 file wallpaper là video (mp4) hay ảnh tĩnh/GIF dựa theo đuôi file, để biết
// render bằng thẻ <video> hay CSS `background-image`.
export function isVideoWallpaper(nameOrPath: string): boolean {
  return /\.mp4$/i.test(nameOrPath)
}

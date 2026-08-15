// Supabase Storage chỉ chấp nhận key theo bộ ký tự "S3-safe" — regex phía server là
// /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/, trong đó `\w` = [A-Za-z0-9_].
// Nghĩa là MỌI ký tự có dấu (tiếng Việt "Nhạc học bài.mp3", tiếng Pháp "Lumière.mp3",
// ü/ñ/ç…) đều làm upload trả về 400 InvalidKey. Vì vậy tên file phải được bỏ dấu +
// lọc ký tự lạ TRƯỚC khi ghép vào storage path. Tên hiển thị cho người dùng không đi
// qua đây — vẫn lưu nguyên `file.name` gốc vào cột `name` của bảng tương ứng.
const COMBINING_MARKS = /[̀-ͯ]/g
const DISALLOWED_KEY_CHARS = /[^\w!\-.*'() &$@=;:+,?]/g

export function toStorageSafeName(fileName: string): string {
  const withoutDiacritics = fileName
    .normalize('NFD')
    .replace(COMBINING_MARKS, '') // dấu thanh/dấu mũ tách rời ra sau khi normalize
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D') // đ/Đ không tách được bằng NFD, phải map tay
  const safe = withoutDiacritics.replace(DISALLOWED_KEY_CHARS, '_').replace(/^[_\s]+/, '')
  return safe || 'file'
}

// Path chuẩn cho mọi bucket của app: `${user.id}/${uuid}-${tên file đã làm sạch}`.
// Thư mục đầu = user id là điều kiện bắt buộc của RLS trên storage.objects.
export function buildStoragePath(userId: string, fileName: string): string {
  return `${userId}/${crypto.randomUUID()}-${toStorageSafeName(fileName)}`
}

// 5 loại phòng gốc — mỗi loại là 1 tổ hợp cố định luật cam/mic/nhạc (xem README.md +
// matching.roomTypes.* trong i18n cho mô tả người dùng thấy). 'free' dùng cho luật
// nghĩa là người dùng tự do bật/tắt; 'on'/'off' nghĩa là bị khoá, không đổi được.
// Dùng chung giữa Matching.tsx (hiển thị luật, gửi lên khi tạo/ghép phòng) và
// Room.tsx (enforce thật: set state đúng luật + khoá nút toggle).
export type RoomTypeKey = 'chill' | 'hardcore' | 'silent' | 'discuss' | 'watch'
export type LockState = 'on' | 'off' | 'free'
export type RoomTypeRule = { cam: LockState; mic: LockState; music: LockState }

export const ROOM_TYPE_RULES: Record<RoomTypeKey, RoomTypeRule> = {
  chill: { cam: 'free', mic: 'free', music: 'free' },
  hardcore: { cam: 'on', mic: 'off', music: 'off' },
  silent: { cam: 'off', mic: 'off', music: 'off' },
  discuss: { cam: 'on', mic: 'on', music: 'off' },
  watch: { cam: 'on', mic: 'off', music: 'off' },
}

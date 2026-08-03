// Level cá nhân tính từ tổng phút focus — 4 bậc, hiển thị qua i18n `matchFound.levels.l0..l3`.
// Tách khỏi quickMatch.ts (vốn import supabase client) để test được đơn lẻ không cần env.
export function levelFromTotalMinutes(totalMinutes: number) {
  if (totalMinutes < 120) return 0
  if (totalMinutes < 500) return 1
  if (totalMinutes < 2000) return 2
  return 3
}

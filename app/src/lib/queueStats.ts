// Hiển thị số người khác đang chờ ghép (không tính mình): khi đang đứng hàng chờ,
// row của chính mình nằm trong matching_queue nên count từ view matching_queue_stats
// luôn ≥ 1 kể cả khi không có ai khác — trừ 1 để chỉ đếm "người cũng đang chờ".
// Tách khỏi quickMatch.ts (vốn import supabase client) để test được đơn lẻ không cần env.
export function othersWaiting(count: number | null): number | null {
  return count === null ? null : Math.max(0, count - 1)
}

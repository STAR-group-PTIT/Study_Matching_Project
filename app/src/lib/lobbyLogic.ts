// Bản TS thuần của cây quyết định trong finalize_lobby() (0019_lobby_match.sql) — cho phía
// client biết "có nên gọi finalize_lobby ngay không" mà không cần round-trip Postgres để test.
// Kết quả RPC vẫn là nguồn sự thật (hàm này không thay thế nó), nhưng giữ 2 bên đồng bộ logic
// là điều đáng unit test — kế thừa vai trò của queueStats.ts/othersWaiting() cũ (tách khỏi
// quickMatch.ts để test đơn lẻ không cần import supabase client).
export type LobbyDecision = 'stay' | 'activate' | 'extend' | 'expire' | 'close'

export function decideLobby(input: {
  memberCount: number
  capacity: number
  now: number
  lobbyExpiresAt: number | null
  graceExtended: boolean
}): LobbyDecision {
  const { memberCount, capacity, now, lobbyExpiresAt, graceExtended } = input
  if (memberCount === 0) return 'close'
  if (memberCount >= capacity) return 'activate'
  if (lobbyExpiresAt !== null && now >= lobbyExpiresAt) {
    if (memberCount >= 2) return 'activate'
    if (!graceExtended) return 'extend'
    return 'expire'
  }
  return 'stay'
}

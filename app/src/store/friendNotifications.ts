import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { RoomInviteRow } from '../lib/friends'

// Store toàn app cho 2 loại thông báo của hệ bạn bè (xem plan Giai đoạn 10):
// - pendingRequestCount: chỉ cần tăng badge trên icon "Bạn bè" ở Dashboard.
// - incomingInvite: lời mời vào room mới nhất còn pending — đủ khẩn để bật popup
//   gián đoạn (RoomInvitePopup), nên được mount 1 lần ở App.tsx thay vì theo route.
type FriendNotificationsState = {
  pendingRequestCount: number
  incomingInvite: RoomInviteRow | null
}

export const useFriendStore = create<FriendNotificationsState>(() => ({
  pendingRequestCount: 0,
  incomingInvite: null,
}))

export function dismissIncomingInvite() {
  useFriendStore.setState({ incomingInvite: null })
}

let channels: ReturnType<typeof supabase.channel>[] = []

async function refreshPendingCount(userId: string) {
  const { count } = await supabase
    .from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('addressee_id', userId)
    .eq('status', 'pending')
  useFriendStore.setState({ pendingRequestCount: count ?? 0 })
}

async function loadInvite(inviteId: string) {
  const { data } = await supabase.from('room_invites_view').select('*').eq('id', inviteId).maybeSingle()
  if (data) useFriendStore.setState({ incomingInvite: data as RoomInviteRow })
}

// Gọi 1 lần khi user đăng nhập (App.tsx). event:'*' trên friend_requests cố tình bắt cả
// UPDATE/DELETE, không chỉ INSERT — Realtime cũng phát lại sự kiện cho chính người vừa
// đồng ý/xoá lời mời của mình, nên badge tự cập nhật mà FriendsPanel không cần gọi refresh
// tay sau mỗi thao tác.
export function initFriendRealtime(userId: string) {
  teardownFriendRealtime()
  void refreshPendingCount(userId)

  const requestsChannel = supabase
    .channel('friend-requests-' + userId)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'friend_requests', filter: `addressee_id=eq.${userId}` },
      () => void refreshPendingCount(userId),
    )
    .subscribe()

  const invitesChannel = supabase
    .channel('room-invites-' + userId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'room_invites', filter: `invitee_id=eq.${userId}` },
      (payload) => void loadInvite((payload.new as { id: string }).id),
    )
    .subscribe()

  channels = [requestsChannel, invitesChannel]
}

export function teardownFriendRealtime() {
  channels.forEach((c) => c.unsubscribe())
  channels = []
  useFriendStore.setState({ pendingRequestCount: 0, incomingInvite: null })
}

import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import type { RoomInviteRow } from '../lib/friends'

// Store toàn app cho 3 loại thông báo của hệ bạn bè (xem plan Giai đoạn 10):
// - pendingRequestCount: badge trên icon "Bạn bè" ở Dashboard cho lời mời kết bạn.
// - pendingInviteCount: badge cho lời mời vào room — trước đây KHÔNG có, lời mời vào room
//   chỉ hiện đúng 1 lần qua popup gián đoạn (incomingInvite) lúc Realtime bắn INSERT; nếu
//   user không có app mở đúng lúc đó (hoặc lỡ tay bấm ra ngoài popup — backdrop cũng coi là
//   từ chối) thì lời mời biến mất không dấu vết. Giờ đếm + liệt kê lại được trong FriendsPanel.
// - incomingInvite: lời mời vào room mới nhất còn pending — đủ khẩn để bật popup gián đoạn
//   (RoomInvitePopup), nên được mount 1 lần ở App.tsx thay vì theo route.
type FriendNotificationsState = {
  pendingRequestCount: number
  pendingInviteCount: number
  incomingInvite: RoomInviteRow | null
}

export const useFriendStore = create<FriendNotificationsState>(() => ({
  pendingRequestCount: 0,
  pendingInviteCount: 0,
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

async function refreshPendingInviteCount(userId: string) {
  const { count } = await supabase
    .from('room_invites')
    .select('id', { count: 'exact', head: true })
    .eq('invitee_id', userId)
    .eq('status', 'pending')
  useFriendStore.setState({ pendingInviteCount: count ?? 0 })
}

async function loadInvite(inviteId: string) {
  const { data } = await supabase.from('room_invites_view').select('*').eq('id', inviteId).maybeSingle()
  if (data) useFriendStore.setState({ incomingInvite: data as RoomInviteRow })
}

// Gọi 1 lần khi user đăng nhập (App.tsx). event:'*' trên friend_requests/room_invites cố
// tình bắt cả UPDATE/DELETE, không chỉ INSERT — Realtime cũng phát lại sự kiện cho chính
// người vừa đồng ý/xoá lời mời của mình, nên badge tự cập nhật mà FriendsPanel không cần
// gọi refresh tay sau mỗi thao tác.
export function initFriendRealtime(userId: string) {
  teardownFriendRealtime()
  void refreshPendingCount(userId)
  void refreshPendingInviteCount(userId)

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
      { event: '*', schema: 'public', table: 'room_invites', filter: `invitee_id=eq.${userId}` },
      (payload) => {
        void refreshPendingInviteCount(userId)
        if (payload.eventType === 'INSERT') void loadInvite((payload.new as { id: string }).id)
      },
    )
    .subscribe()

  channels = [requestsChannel, invitesChannel]
}

export function teardownFriendRealtime() {
  channels.forEach((c) => c.unsubscribe())
  channels = []
  useFriendStore.setState({ pendingRequestCount: 0, pendingInviteCount: 0, incomingInvite: null })
}

import { supabase } from './supabase'

// ============================================================
// Hệ thống kết bạn — handle kiểu Discord "name#1234". Các hàm ở đây chỉ là wrapper
// mỏng quanh RPC/query Supabase (không có React), cùng khuôn với quickMatch.ts.
// ============================================================

export type FoundProfile = {
  id: string
  name: string
  tag: string
  avatar_url: string | null
}

export type FriendStatus = 'pending' | 'accepted'

// Một dòng friend_requests_view (0016_friends.sql) — đã join sẵn tên/tag 2 phía vì
// profiles bị RLS chặn select-own-only, không join thẳng từ client được.
export type FriendRequestRow = {
  id: string
  requester_id: string
  addressee_id: string
  status: FriendStatus
  created_at: string
  responded_at: string | null
  requester_name: string
  requester_tag: string
  requester_avatar_url: string | null
  addressee_name: string
  addressee_tag: string
  addressee_avatar_url: string | null
}

export type RoomInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

// Một dòng room_invites_view (0016_friends.sql).
export type RoomInviteRow = {
  id: string
  room_id: string
  inviter_id: string
  invitee_id: string
  status: RoomInviteStatus
  created_at: string
  responded_at: string | null
  inviter_name: string
  inviter_tag: string
  room_name: string
  room_code: string
}

// "hana#3364" → { name: 'hana', tag: '3364' }; null nếu sai định dạng (thiếu '#',
// tag không phải 1-4 chữ số). Không tự pad — người dùng phải gõ đúng tag họ thấy.
export function parseFriendHandle(input: string): { name: string; tag: string } | null {
  const trimmed = input.trim()
  const hashIndex = trimmed.lastIndexOf('#')
  if (hashIndex <= 0 || hashIndex === trimmed.length - 1) return null
  const name = trimmed.slice(0, hashIndex).trim()
  const tag = trimmed.slice(hashIndex + 1).trim()
  if (!name || !/^\d{1,4}$/.test(tag)) return null
  return { name, tag: tag.padStart(4, '0') }
}

export function formatFriendHandle(name: string, tag: string) {
  return `${name}#${tag}`
}

export async function findProfileByTag(name: string, tag: string): Promise<FoundProfile | null> {
  const { data, error } = await supabase.rpc('find_profile_by_tag', { p_name: name, p_code: tag })
  if (error) throw error
  return (data?.[0] as FoundProfile) ?? null
}

export type SendFriendRequestResult = 'sent' | 'already_sent' | 'already_friends' | 'accepted'

export async function sendFriendRequest(targetId: string): Promise<SendFriendRequestResult> {
  const { data, error } = await supabase.rpc('send_friend_request', { p_target_id: targetId })
  if (error) throw error
  return data?.[0]?.status as SendFriendRequestResult
}

export async function listFriendRequests(): Promise<FriendRequestRow[]> {
  const { data, error } = await supabase
    .from('friend_requests_view')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as FriendRequestRow[]) ?? []
}

export async function acceptFriendRequest(id: string) {
  const { error } = await supabase
    .from('friend_requests')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Xoá dòng — dùng chung cho huỷ lời mời đã gửi, từ chối lời mời đến, và huỷ kết bạn.
export async function removeFriendRequest(id: string) {
  const { error } = await supabase.from('friend_requests').delete().eq('id', id)
  if (error) throw error
}

export type InviteFriendToRoomResult = 'sent' | 'already_member' | 'already_invited'

export async function inviteFriendToRoom(roomId: string, friendId: string): Promise<InviteFriendToRoomResult> {
  const { data, error } = await supabase.rpc('invite_friend_to_room', { p_room_id: roomId, p_friend_id: friendId })
  if (error) throw error
  return data?.[0]?.status as InviteFriendToRoomResult
}

export async function listRoomInvitesForRoom(roomId: string): Promise<RoomInviteRow[]> {
  const { data, error } = await supabase
    .from('room_invites_view')
    .select('*')
    .eq('room_id', roomId)
    .eq('status', 'pending')
  if (error) throw error
  return (data as RoomInviteRow[]) ?? []
}

export async function cancelRoomInvite(id: string) {
  const { error } = await supabase
    .from('room_invites')
    .update({ status: 'cancelled', responded_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function declineRoomInvite(id: string) {
  const { error } = await supabase
    .from('room_invites')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export type AcceptRoomInviteResult = { status: 'joined' | 'full' | 'room_closed'; room_code: string | null }

export async function acceptRoomInvite(id: string): Promise<AcceptRoomInviteResult> {
  const { data, error } = await supabase.rpc('accept_room_invite', { p_invite_id: id })
  if (error) throw error
  return data?.[0] as AcceptRoomInviteResult
}

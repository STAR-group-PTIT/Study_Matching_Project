import { supabase } from './supabase';

// Room trong room_public_list -- view công khai, khách cũng đọc được
export type PublicRoom = {
  id: string;
  code: string;
  name: string;
  room_type: string;
  duration_minutes: number | null;
  language: string;
  capacity: number;
  host_name: string;
  member_count: number;
};

// Thành viên qua room_members_view -- chỉ trả dòng nếu mình là participant
export type RoomMember = {
  id: string;
  room_id: string;
  user_id: string;
  status: 'member' | 'pending';
  joined_at: string;
  name: string;
  avatar_url: string | null;
};

export type JoinRoomStatus = 'joined' | 'pending' | 'full' | 'already_in_another_room' | 'not_found';

export type JoinRoomResult = {
  status: JoinRoomStatus;
  roomId?: string;
  otherRoomCode?: string;
};

export async function fetchPublicRooms(): Promise<PublicRoom[]> {
  const { data, error } = await supabase
    .from('room_public_list')
    .select('*')
    .order('name');
  if (error) throw error;
  return (data ?? []) as PublicRoom[];
}

export async function fetchRoomByCode(code: string): Promise<PublicRoom | null> {
  const { data, error } = await supabase
    .from('room_public_list')
    .select('*')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return data as PublicRoom | null;
}

export async function fetchRoomMembers(roomId: string): Promise<RoomMember[]> {
  const { data, error } = await supabase
    .from('room_members_view')
    .select('*')
    .eq('room_id', roomId);
  if (error) throw error;
  return (data ?? []) as RoomMember[];
}

// join_room_by_code -- RPC có sẵn từ backend (0002/0024), tự áp admit_mode
export async function joinRoomByCode(code: string): Promise<JoinRoomResult> {
  const { data, error } = await supabase.rpc('join_room_by_code', { p_code: code });
  if (error) {
    if (error.code === 'PGRST116') return { status: 'not_found' };
    throw error;
  }
  const row = data as { status: string; room_id: string; member_status: string; other_room_code: string | null };
  if (row.status === 'already_in_another_room') {
    return { status: 'already_in_another_room', otherRoomCode: row.other_room_code ?? undefined };
  }
  if (row.status === 'full') return { status: 'full' };
  return { status: row.member_status === 'pending' ? 'pending' : 'joined', roomId: row.room_id };
}
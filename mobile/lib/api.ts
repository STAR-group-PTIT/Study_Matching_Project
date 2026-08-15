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

// ---------- Pomodoro (P2 home) ----------

// profiles — defaults Pomodoro cá nhân (mirror web Dashboard.tsx effect load profile)
export type ProfilePomodoro = {
  focus_minutes: number;
  break_minutes: number;
  session_count: number;
  auto_start_next: boolean;
};

export async function fetchProfilePomodoro(userId: string): Promise<ProfilePomodoro> {
  const { data, error } = await supabase
    .from('profiles')
    .select('focus_minutes, break_minutes, session_count, auto_start_next')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data as ProfilePomodoro;
}

// ghi focus_sessions — mirror đúng rule web (phase, minutes thực tế, completed chỉ khi
// hoàn thành tự nhiên hết giờ, started_at là mốc bắt đầu phase đó)
export async function logFocusSession(input: {
  userId: string;
  phase: 'focus' | 'break';
  minutes: number;
  startedAt: string;
  completed: boolean;
}): Promise<void> {
  const { error } = await supabase.from('focus_sessions').insert({
    user_id: input.userId,
    phase: input.phase,
    minutes: input.minutes,
    started_at: input.startedAt,
    completed: input.completed,
  });
  if (error) console.error('log focus_session failed', error);
}

// ---------- Room thật (P4 call) ----------

// rooms — chỉ participant/host/pending đọc được (RLS), chứa timer + status để đồng bộ
export type RoomDetail = {
  id: string;
  code: string;
  name: string;
  host_id: string;
  room_type: string;
  capacity: number;
  duration_minutes: number;
  break_minutes: number;
  session_count: number;
  timer_phase: 'focus' | 'break';
  timer_round: number;
  timer_running: boolean;
  timer_done: boolean;
  timer_remaining_seconds: number | null;
  timer_updated_at: string;
  status: 'lobby' | 'active' | 'expired';
};

export async function fetchRoomDetail(code: string): Promise<RoomDetail | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select(
      'id, code, name, host_id, room_type, capacity, duration_minutes, break_minutes, session_count, timer_phase, timer_round, timer_running, timer_done, timer_remaining_seconds, timer_updated_at, status',
    )
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return data as RoomDetail | null;
}

// Rời phòng — xoá row room_members của mình (host xử lý đóng/chuyển quyền ở web; mobile
// bản đầu chỉ rời thẳng, phòng tự dọn qua heartbeat/cleanup 0024).
export async function leaveRoom(userId: string, roomId: string): Promise<void> {
  await supabase.from('room_members').delete().eq('room_id', roomId).eq('user_id', userId);
}

// ---------- Profile (P5) ----------

export type ProfileData = {
  name: string;
  tag: string;
  avatar_url: string | null;
  focus_minutes: number;
  break_minutes: number;
  session_count: number;
  auto_start_next: boolean;
};

export async function fetchProfile(userId: string): Promise<ProfileData | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'name, tag, avatar_url, focus_minutes, break_minutes, session_count, auto_start_next',
    )
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileData | null;
}

// Sửa tên hiển thị — catch riêng 23505 (trùng index (lower(name), tag)) để báo rõ ràng.
export async function updateProfileName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ name }).eq('id', userId);
  if (error) {
    if (error.code === '23505') throw new Error('name_taken');
    throw error;
  }
}

export async function updateProfilePomodoro(
  userId: string,
  prefs: { focus_minutes: number; break_minutes: number; session_count: number; auto_start_next: boolean },
): Promise<void> {
  const { error } = await supabase.from('profiles').update(prefs).eq('id', userId);
  if (error) throw error;
}

// Rút path bên trong bucket `avatars` từ public URL đã lưu — để xoá file cũ khi đổi ảnh.
function pathFromAvatarUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = '/avatars/';
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
}

// Upload avatar (uri đã được resize ở màn hình) lên bucket `avatars` (public), cập nhật
// profiles.avatar_url, xoá file cũ — mirror ChangeAvatarModal web (0002/0021).
export async function uploadAvatar(
  userId: string,
  uri: string,
  currentAvatarUrl: string | null,
): Promise<string> {
  const res = await fetch(uri);
  const blob = await res.blob();
  const path = `${userId}/avatar-${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (upErr) throw upErr;
  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
  const { error: updErr } = await supabase
    .from('profiles')
    .update({ avatar_url: pub.publicUrl })
    .eq('id', userId);
  if (updErr) throw updErr;
  const oldPath = pathFromAvatarUrl(currentAvatarUrl);
  if (oldPath && oldPath !== path) void supabase.storage.from('avatars').remove([oldPath]);
  return pub.publicUrl;
}
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

// ============================================================
// Ghép ngẫu nhiên (lobby) — port từ web app/src/lib/quickMatch.ts (0019).
//
// Cơ chế: tạo/tham gia 1 lobby THẬT (rooms.status='lobby' + room_members thật) qua edge
// function match-room → find_or_create_lobby. Thấy người khác vào live qua Realtime; lobby
// tự chốt thành phòng học khi đủ 5 người hoặc hết giờ ân hạn (≥2 người). Không có pg_cron
// nên mỗi client trong lobby tự lên lịch gọi finalize_lobby đúng lúc hết giờ — gọi trùng
// nhau an toàn (RPC idempotent, `for update`).
//
// Cấu hình cố định cứng 25 phút + tiếng Việt (giống web — tránh phân mảnh pool ghép).
// ============================================================

export const RANDOM_MATCH_CONFIG = { focus_minutes: 25, language: 'vi' as const };

export type QuickMatchStage = 'idle' | 'lobby' | 'matched' | 'expired';

export type LobbyMember = {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
};

type LobbyResult = {
  status: 'lobby' | 'active' | 'expired' | 'already_in_another_room';
  room_id: string;
  room_code: string;
  member_count: number;
  capacity: number;
  lobby_expires_at: string | null;
  other_room_code: string | null;
};

export function useQuickMatch() {
  const [stage, setStage] = useState<QuickMatchStage>('idle');
  const [matchError, setMatchError] = useState('');
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [capacity, setCapacity] = useState(5);
  const [lobbyExpiresAt, setLobbyExpiresAt] = useState<Date | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [lobbyMembers, setLobbyMembers] = useState<LobbyMember[]>([]);

  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const membersChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const finalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearFinalizeTimer() {
    if (finalizeTimeoutRef.current !== null) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
  }

  // Lên lịch gọi finalize_lobby đúng lúc hết giờ ân hạn — mọi client trong lobby đều tự làm.
  // Đọc THẲNG kết quả RPC trả về để tự áp dụng/lên lịch tiếp, KHÔNG chỉ trông cậy Realtime
  // vọng lại cho chính mình (bug cũ trên web: miss event → kẹt lobby vĩnh viễn).
  function scheduleFinalize(targetRoomId: string, expiresAt: Date, uid: string) {
    clearFinalizeTimer();
    const delay = Math.max(0, expiresAt.getTime() - Date.now());
    finalizeTimeoutRef.current = setTimeout(() => {
      void supabase.rpc('finalize_lobby', { p_room_id: targetRoomId }).then(({ data }) => {
        const result = data?.[0] as LobbyResult | undefined;
        if (!result) return;
        if (result.status === 'active') {
          unsubscribeAll();
          setRoomCode(result.room_code);
          setStage('matched');
        } else if (result.status === 'expired') {
          unsubscribeAll();
          setStage('expired');
        } else if (result.lobby_expires_at) {
          const next = new Date(result.lobby_expires_at);
          setLobbyExpiresAt(next);
          scheduleFinalize(targetRoomId, next, uid);
        }
      });
    }, delay);
  }

  function unsubscribeAll() {
    roomChannelRef.current?.unsubscribe();
    roomChannelRef.current = null;
    membersChannelRef.current?.unsubscribe();
    membersChannelRef.current = null;
    clearFinalizeTimer();
  }

  useEffect(() => () => unsubscribeAll(), []);

  // Đếm ngược hiển thị — dẫn xuất thuần từ lobbyExpiresAt.
  useEffect(() => {
    if (!lobbyExpiresAt || stage !== 'lobby') {
      setSecondsRemaining(null);
      return;
    }
    const tick = () =>
      setSecondsRemaining(Math.max(0, Math.round((lobbyExpiresAt.getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lobbyExpiresAt, stage]);

  async function loadOthers(targetRoomId: string, uid: string): Promise<LobbyMember[]> {
    const { data: members } = await supabase
      .from('room_members_view')
      .select('user_id, name, avatar_url')
      .eq('room_id', targetRoomId)
      .neq('user_id', uid);
    return (members ?? []) as LobbyMember[];
  }

  function subscribeLobby(targetRoomId: string, uid: string) {
    const roomChannel = supabase
      .channel('lobby-room-' + targetRoomId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${targetRoomId}` },
        (payload) => {
          const row = payload.new as {
            status: 'lobby' | 'active' | 'expired';
            code: string;
            lobby_expires_at: string | null;
          };
          if (row.status === 'active') {
            unsubscribeAll();
            setRoomCode(row.code);
            setStage('matched');
          } else if (row.status === 'expired') {
            unsubscribeAll();
            setStage('expired');
          } else if (row.lobby_expires_at) {
            const next = new Date(row.lobby_expires_at);
            setLobbyExpiresAt(next);
            scheduleFinalize(targetRoomId, next, uid);
          }
        },
      )
      .subscribe();
    roomChannelRef.current = roomChannel;

    const membersChannel = supabase
      .channel('lobby-members-' + targetRoomId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${targetRoomId}` },
        () => {
          void loadOthers(targetRoomId, uid).then((members) => {
            setLobbyMembers(members);
            setMemberCount(members.length + 1);
          });
        },
      )
      .subscribe();
    membersChannelRef.current = membersChannel;
  }

  // Trả về true nếu bắt đầu được (đã đăng nhập), false nếu chưa (caller tự xử lý điều hướng).
  async function start(isRetry = false): Promise<boolean> {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (!user) return false;
    setMatchError('');
    if (!isRetry) {
      setRoomId(null);
      setRoomCode(null);
      setLobbyMembers([]);
      setMemberCount(0);
      setCapacity(5);
      setLobbyExpiresAt(null);
      setStage('lobby');
    }

    const { data: fnData, error } = await supabase.functions.invoke('match-room', {
      body: {
        duration_minutes: RANDOM_MATCH_CONFIG.focus_minutes,
        language: RANDOM_MATCH_CONFIG.language,
      },
    });

    if (error) {
      setMatchError('matchServiceDown');
      setStage('expired');
      return true;
    }
    const result = (fnData?.result ?? null) as LobbyResult | null;
    if (!result) {
      setMatchError('matchGeneric');
      setStage('expired');
      return true;
    }

    if (result.status === 'already_in_another_room') {
      setMatchError('alreadyInRoom');
      setStage('expired');
    } else if (result.status === 'active') {
      setRoomCode(result.room_code);
      setStage('matched');
    } else if (result.status === 'lobby') {
      setRoomId(result.room_id);
      setRoomCode(result.room_code);
      setMemberCount(result.member_count);
      setCapacity(result.capacity);
      setLobbyExpiresAt(result.lobby_expires_at ? new Date(result.lobby_expires_at) : null);
      setStage('lobby');
      const memberStats = await loadOthers(result.room_id, user.id);
      setLobbyMembers(memberStats);
      subscribeLobby(result.room_id, user.id);
      if (result.lobby_expires_at)
        scheduleFinalize(result.room_id, new Date(result.lobby_expires_at), user.id);
    } else if (!isRetry) {
      return start(true);
    } else {
      setStage('expired');
    }
    return true;
  }

  // Rời lobby: xoá row room_members của mình rồi tự gọi finalize_lobby — nếu mình là người
  // cuối cùng rời, không còn client nào khác để dọn phòng nên chính người rời phải kích hoạt.
  async function cancel() {
    const targetRoomId = roomId;
    if (targetRoomId) {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (uid) {
        void supabase
          .from('room_members')
          .delete()
          .eq('room_id', targetRoomId)
          .eq('user_id', uid)
          .then(() => {
            void supabase.rpc('finalize_lobby', { p_room_id: targetRoomId });
          });
      }
    }
    unsubscribeAll();
    setMatchError('');
    setRoomId(null);
    setRoomCode(null);
    setLobbyMembers([]);
    setMemberCount(0);
    setLobbyExpiresAt(null);
    setStage('idle');
  }

  function reset() {
    unsubscribeAll();
    setMatchError('');
    setRoomId(null);
    setRoomCode(null);
    setLobbyMembers([]);
    setMemberCount(0);
    setLobbyExpiresAt(null);
    setStage('idle');
  }

  return {
    stage,
    matchError,
    roomCode,
    memberCount,
    capacity,
    secondsRemaining,
    lobbyMembers,
    start,
    cancel,
    reset,
  };
}
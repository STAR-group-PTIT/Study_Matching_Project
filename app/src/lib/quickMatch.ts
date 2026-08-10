import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuthStore } from '../store/auth'
import { levelFromTotalMinutes } from './levels'

// ============================================================
// Cấu hình ghép ngẫu nhiên — dùng cho nút "Ghép ngẫu nhiên" ở Dashboard.
//
// Cố định cứng 'vi' + 25 phút (GĐ10 tiếp) — trước đó cho chọn ngôn ngữ/thời lượng nhưng đó
// chính là nguồn phân mảnh khiến pool ghép bị chia nhỏ (2 người "giống ý định" vẫn không gặp
// nhau chỉ vì khác lựa chọn, hoặc khác ngôn ngữ trình duyệt suy ra mặc định khác nhau), làm
// giảm tỉ lệ ghép thành công. Ai cần tuỳ chỉnh thật (thời lượng khác, loại phòng khác, ngôn
// ngữ khác) thì dùng "Duyệt phòng đang mở" (Matching.tsx) — vốn đã có đủ bộ lọc + tạo phòng
// tuỳ ý, không cần lặp lại ở đây.
// ============================================================

export type MatchConfig = {
  focus_minutes: number
  language: 'vi' | 'en'
}

export const RANDOM_MATCH_CONFIG: MatchConfig = { focus_minutes: 25, language: 'vi' }

// Stats công khai của người vừa match — lấy từ RPC public_profile_stats (0010),
// chỉ chứa aggregate, không lộ dữ liệu phiên thô.
export type PublicProfileStats = {
  name: string
  avatar_url: string | null
  accent_hue: number
  weekly_minutes: number
  total_minutes: number
  total_sessions: number
  likes_received: number
}

// 'lobby': đang ngồi trong 1 phòng thật (rooms.status='lobby'), thấy người khác vào live.
// 'matched': lobby đã chốt 'active', vào phòng thật được rồi.
// 'expired': hết giờ ân hạn mà không đủ ≥2 người, hoặc lỗi gọi dịch vụ ghép — user cần bấm
// thử lại chứ không tự động lặp vô hạn.
export type QuickMatchStage = 'idle' | 'lobby' | 'matched' | 'expired'

export { levelFromTotalMinutes }

type LobbyResult = {
  status: 'lobby' | 'active' | 'expired' | 'already_in_another_room'
  room_id: string
  room_code: string
  member_count: number
  capacity: number
  lobby_expires_at: string | null
  other_room_code: string | null
}

// Hook ghép ngẫu nhiên (0019): thay vì xếp hàng vô hình rồi chờ đủ 5 mới hiện phòng, giờ
// tạo/tham gia 1 lobby THẬT ngay từ đầu (rooms.status='lobby' + room_members thật) — thấy
// ngay người khác vào qua Realtime thay vì spinner trắng + số đếm ước lượng. Lobby tự chốt
// thành phòng học thật khi đủ 5 người hoặc hết giờ ân hạn (≥2 người); không có pg_cron nên
// mỗi client đang ngồi trong lobby tự lên lịch gọi finalize_lobby khi hết giờ (xem
// scheduleFinalize bên dưới) — gọi trùng nhau là an toàn, RPC tự idempotent.
export function useQuickMatch() {
  const [stage, setStage] = useState<QuickMatchStage>('idle')
  const [matchError, setMatchError] = useState('')
  const [roomId, setRoomId] = useState<string | null>(null)
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [memberCount, setMemberCount] = useState(0)
  const [capacity, setCapacity] = useState(5)
  const [lobbyExpiresAt, setLobbyExpiresAt] = useState<Date | null>(null)
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null)
  const [lobbyMembers, setLobbyMembers] = useState<PublicProfileStats[]>([])
  const [partners, setPartners] = useState<PublicProfileStats[]>([])

  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const membersChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const finalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function clearFinalizeTimer() {
    if (finalizeTimeoutRef.current !== null) {
      clearTimeout(finalizeTimeoutRef.current)
      finalizeTimeoutRef.current = null
    }
  }

  // Lên lịch gọi finalize_lobby đúng lúc hết giờ ân hạn — mọi client trong lobby đều tự làm
  // việc này (không ai "được phân công"), nên gọi trùng nhau giữa nhiều client là bình
  // thường; finalize_lobby dùng `for update` (không skip locked) để đảm bảo lệnh gọi sau
  // luôn thấy trạng thái đã chốt bởi lệnh trước, không bỏ sót.
  //
  // Đọc THẲNG kết quả RPC trả về để tự áp dụng/lên lịch tiếp, KHÔNG chỉ trông cậy Realtime
  // "vọng" lại UPDATE cho chính mình — trước đây bug: bỏ qua kết quả (`void rpc(...)`), nếu
  // event Realtime bị trễ/miss đúng lúc đó thì client không biết deadline mới (VD sau khi
  // được gia hạn ân hạn), không hẹn giờ lại được, kẹt ở "lobby" mãi dù server đã chốt đúng.
  function scheduleFinalize(targetRoomId: string, expiresAt: Date, uid: string) {
    clearFinalizeTimer()
    const delay = Math.max(0, expiresAt.getTime() - Date.now())
    finalizeTimeoutRef.current = setTimeout(() => {
      void supabase.rpc('finalize_lobby', { p_room_id: targetRoomId }).then(({ data }) => {
        const result = data?.[0] as LobbyResult | undefined
        if (!result) return
        if (result.status === 'active') {
          unsubscribeAll()
          void loadOthers(targetRoomId, uid).then((stats) => {
            setPartners(stats)
            setRoomCode(result.room_code)
            setStage('matched')
          })
        } else if (result.status === 'expired') {
          unsubscribeAll()
          setStage('expired')
        } else if (result.lobby_expires_at) {
          const next = new Date(result.lobby_expires_at)
          setLobbyExpiresAt(next)
          scheduleFinalize(targetRoomId, next, uid)
        }
      })
    }, delay)
  }

  function unsubscribeAll() {
    roomChannelRef.current?.unsubscribe()
    roomChannelRef.current = null
    membersChannelRef.current?.unsubscribe()
    membersChannelRef.current = null
    clearFinalizeTimer()
  }

  useEffect(() => () => unsubscribeAll(), [])

  // Đếm ngược hiển thị — dẫn xuất thuần từ lobbyExpiresAt (nguồn sự thật vẫn là RPC/DB),
  // chỉ để UI có con số giây chạy mượt giữa 2 lần cập nhật Realtime.
  useEffect(() => {
    if (!lobbyExpiresAt || stage !== 'lobby') {
      setSecondsRemaining(null)
      return
    }
    const tick = () => setSecondsRemaining(Math.max(0, Math.round((lobbyExpiresAt.getTime() - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lobbyExpiresAt, stage])

  async function loadOthers(targetRoomId: string, uid: string): Promise<PublicProfileStats[]> {
    const { data: members } = await supabase
      .from('room_members_view')
      .select('user_id')
      .eq('room_id', targetRoomId)
      .neq('user_id', uid)
    const otherIds = (members ?? []).map((m) => m.user_id)
    if (otherIds.length === 0) return []
    const results = await Promise.all(
      otherIds.map((id) => supabase.rpc('public_profile_stats', { p_user_id: id })),
    )
    return results.map((r) => r.data?.[0] as PublicProfileStats).filter((s): s is PublicProfileStats => !!s)
  }

  function subscribeLobby(targetRoomId: string, uid: string) {
    const roomChannel = supabase
      .channel('lobby-room-' + targetRoomId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${targetRoomId}` },
        (payload) => {
          const row = payload.new as { status: 'lobby' | 'active' | 'expired'; code: string; lobby_expires_at: string | null }
          if (row.status === 'active') {
            unsubscribeAll()
            void loadOthers(targetRoomId, uid).then((stats) => {
              setPartners(stats)
              setRoomCode(row.code)
              setStage('matched')
            })
          } else if (row.status === 'expired') {
            unsubscribeAll()
            setStage('expired')
          } else if (row.lobby_expires_at) {
            const next = new Date(row.lobby_expires_at)
            setLobbyExpiresAt(next)
            scheduleFinalize(targetRoomId, next, uid)
          }
        },
      )
      .subscribe()
    roomChannelRef.current = roomChannel

    const membersChannel = supabase
      .channel('lobby-members-' + targetRoomId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_members', filter: `room_id=eq.${targetRoomId}` },
        () => {
          void loadOthers(targetRoomId, uid).then((stats) => {
            setLobbyMembers(stats)
            setMemberCount(stats.length + 1)
          })
        },
      )
      .subscribe()
    membersChannelRef.current = membersChannel
  }

  // Trả về true nếu bắt đầu tìm kiếm được, false nếu chưa đăng nhập (caller tự xử lý điều
  // hướng sang /auth). `isRetry` chỉ dùng nội bộ: nếu vừa join phải 1 lobby đã hết hạn từ
  // trước (hiếm — VD tự bấm lại đúng lúc lobby cũ của mình vừa hết ân hạn lần 2), thử tạo
  // lobby mới đúng 1 lần thay vì hiện ngay trạng thái "hết hạn" gây khó hiểu ngay sau khi
  // user vừa bấm bắt đầu.
  async function start(isRetry = false): Promise<boolean> {
    const user = useAuthStore.getState().user
    if (!user) return false
    setMatchError('')
    if (!isRetry) {
      setRoomId(null)
      setRoomCode(null)
      setPartners([])
      setLobbyMembers([])
      setMemberCount(0)
      setCapacity(5)
      setLobbyExpiresAt(null)
      setStage('lobby')
    }

    const { data, error } = await supabase.functions.invoke('match-room', {
      body: { duration_minutes: RANDOM_MATCH_CONFIG.focus_minutes, language: RANDOM_MATCH_CONFIG.language },
    })

    if (error) {
      setMatchError('matchServiceDown')
      setStage('expired')
      return true
    }
    const result = data?.result as LobbyResult | null
    if (!result) {
      setMatchError('matchGeneric')
      setStage('expired')
      return true
    }

    if (result.status === 'already_in_another_room') {
      // Chặn hẳn (GĐ10 tiếp) thay vì tự rời phòng cũ giùm user — tái dùng đúng khung 'expired'
      // sẵn có (matchError hiện message + nút Huỷ), không cần thêm stage/UI riêng.
      setMatchError('alreadyInRoom')
      setStage('expired')
    } else if (result.status === 'active') {
      const partnerStats = await loadOthers(result.room_id, user.id)
      setPartners(partnerStats)
      setRoomCode(result.room_code)
      setStage('matched')
    } else if (result.status === 'lobby') {
      setRoomId(result.room_id)
      setRoomCode(result.room_code)
      setMemberCount(result.member_count)
      setCapacity(result.capacity)
      setLobbyExpiresAt(result.lobby_expires_at ? new Date(result.lobby_expires_at) : null)
      setStage('lobby')
      const memberStats = await loadOthers(result.room_id, user.id)
      setLobbyMembers(memberStats)
      subscribeLobby(result.room_id, user.id)
      if (result.lobby_expires_at) scheduleFinalize(result.room_id, new Date(result.lobby_expires_at), user.id)
    } else if (!isRetry) {
      return start(true)
    } else {
      setStage('expired')
    }
    return true
  }

  // Rời lobby: xoá row room_members của mình rồi tự gọi finalize_lobby ngay sau đó — nếu
  // mình là người cuối cùng rời, không còn client nào khác đang ngồi đó để tự phát hiện
  // member_count=0 và dọn phòng, nên chính người rời phải kích hoạt lần chốt cuối này.
  function cancel() {
    const user = useAuthStore.getState().user
    const targetRoomId = roomId
    if (user && targetRoomId) {
      supabase
        .from('room_members')
        .delete()
        .eq('room_id', targetRoomId)
        .eq('user_id', user.id)
        .then(() => {
          void supabase.rpc('finalize_lobby', { p_room_id: targetRoomId })
        })
    }
    unsubscribeAll()
    setMatchError('')
    setRoomId(null)
    setRoomCode(null)
    setLobbyMembers([])
    setMemberCount(0)
    setLobbyExpiresAt(null)
    setStage('idle')
  }

  function reset() {
    unsubscribeAll()
    setMatchError('')
    setRoomId(null)
    setRoomCode(null)
    setPartners([])
    setLobbyMembers([])
    setMemberCount(0)
    setLobbyExpiresAt(null)
    setStage('idle')
  }

  function dismissMatch() {
    setStage('idle')
    setPartners([])
  }

  return {
    stage,
    matchError,
    roomCode,
    memberCount,
    capacity,
    secondsRemaining,
    lobbyMembers,
    partners,
    start,
    cancel,
    reset,
    dismissMatch,
  }
}

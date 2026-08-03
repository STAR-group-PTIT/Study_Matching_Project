import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuthStore } from '../store/auth'
import { levelFromTotalMinutes } from './levels'

// ============================================================
// Cấu hình ghép ngẫu nhiên — dùng chung cho cả nút "Ghép ngay"
// (Dashboard) lẫn màn Matching đầy đủ. Lưu localStorage để lần sau
// vào lại không phải chọn lại từ đầu (Giai đoạn 9).
// ============================================================

export type MatchConfig = {
  room_type: string
  focus_minutes: number
  break_minutes: number
  session_count: number
  language: 'vi' | 'en'
}

const STORAGE_KEY = 'ff-quickmatch-config'

export function loadSavedMatchConfig(): MatchConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MatchConfig>
    if (
      !parsed.room_type ||
      typeof parsed.focus_minutes !== 'number' ||
      typeof parsed.break_minutes !== 'number' ||
      typeof parsed.session_count !== 'number' ||
      !parsed.language
    ) {
      return null
    }
    return parsed as MatchConfig
  } catch {
    return null
  }
}

export function saveMatchConfig(cfg: MatchConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    // localStorage không khả dụng — chỉ mất tính năng nhớ lựa chọn, không lỗi.
  }
}

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

export type QuickMatchStage = 'idle' | 'waiting' | 'matched'

export { levelFromTotalMinutes }

// Hook ghép ngẫu nhiên dùng chung: gọi edge function match-room, theo dõi hàng chờ qua
// Realtime, và tải stats của người cùng học khi khớp thành công — đúng logic đã proven
// trong Matching.tsx từ GĐ4, tách ra để Dashboard cũng dùng được mà không nhân đôi code.
export function useQuickMatch() {
  const [stage, setStage] = useState<QuickMatchStage>('idle')
  const [waited, setWaited] = useState(0)
  const [matchError, setMatchError] = useState('')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [partner, setPartner] = useState<PublicProfileStats | null>(null)

  const stageRef = useRef(stage)
  stageRef.current = stage
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      if (stageRef.current === 'waiting') setWaited((w) => w + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => () => void channelRef.current?.unsubscribe(), [])

  async function loadPartner(roomId: string, uid: string): Promise<PublicProfileStats | null> {
    const { data: members } = await supabase
      .from('room_members_view')
      .select('user_id')
      .eq('room_id', roomId)
      .neq('user_id', uid)
    const partnerId = members?.[0]?.user_id
    if (!partnerId) return null
    const { data } = await supabase.rpc('public_profile_stats', { p_user_id: partnerId })
    return (data?.[0] as PublicProfileStats) ?? null
  }

  function subscribeQueue(userId: string) {
    const channel = supabase
      .channel('matching-queue-' + userId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matching_queue', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { matched_room_id: string | null; matched_room_code: string | null }
          const code = row.matched_room_code
          if (!code) return
          channel.unsubscribe()
          channelRef.current = null
          supabase.from('matching_queue').delete().eq('user_id', userId).then(() => {})
          void loadPartner(row.matched_room_id ?? '', userId).then((partnerStats) => {
            setPartner(partnerStats)
            setRoomCode(code)
            setStage('matched')
          })
        },
      )
      .subscribe()
    channelRef.current = channel
  }

  // Trả về true nếu bắt đầu tìm kiếm được, false nếu chưa đăng nhập (caller tự xử lý
  // điều hướng sang /auth) — lỗi mạng thì giữ stage 'waiting' + matchError để overlay
  // hiện đúng thông báo (giống hành vi màn searching cũ của Matching).
  async function start(cfg: MatchConfig): Promise<boolean> {
    const user = useAuthStore.getState().user
    if (!user) return false
    saveMatchConfig(cfg)
    setMatchError('')
    setRoomCode(null)
    setPartner(null)
    setWaited(0)
    setStage('waiting')

    const { data, error } = await supabase.functions.invoke('match-room', {
      body: { room_type: cfg.room_type, duration_minutes: cfg.focus_minutes, language: cfg.language },
    })

    if (error) {
      setMatchError('matchServiceDown')
      return true
    }
    const result = data?.result as { status: string; room_id: string; room_code: string } | null
    if (result?.status === 'matched' && result.room_code) {
      const partnerStats = await loadPartner(result.room_id, user.id)
      setPartner(partnerStats)
      setRoomCode(result.room_code)
      setStage('matched')
    } else if (result?.status === 'queued') {
      subscribeQueue(user.id)
    } else {
      setMatchError('matchGeneric')
    }
    return true
  }

  function cancel() {
    const user = useAuthStore.getState().user
    if (user) supabase.from('matching_queue').delete().eq('user_id', user.id).then(() => {})
    channelRef.current?.unsubscribe()
    channelRef.current = null
    setMatchError('')
    setWaited(0)
    setStage('idle')
  }

  function reset() {
    setMatchError('')
    setWaited(0)
    setRoomCode(null)
    setPartner(null)
    setStage('idle')
  }

  return { stage, waited, matchError, roomCode, partner, start, cancel, reset }
}

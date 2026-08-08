import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useAuthStore } from '../store/auth'
import { levelFromTotalMinutes } from './levels'
import { othersWaiting } from './queueStats'

// ============================================================
// Cấu hình ghép ngẫu nhiên — dùng cho tab "Ghép ngẫu nhiên" gộp mới ở Dashboard (GĐ10 tiếp).
// Lưu localStorage để lần sau vào lại không phải chọn lại từ đầu (Giai đoạn 9).
//
// Rút gọn còn đúng 2 trường (0018): loại phòng giờ luôn cố định 'chill' phía server, không
// còn cho chọn — random match là để giao lưu chứ không phải học nghiêm túc kiểu hardcore/
// silent, ai muốn phòng kiểu đó thì tự tạo/join qua danh sách phòng công khai ở Matching.tsx.
// ============================================================

export type MatchConfig = {
  focus_minutes: number
  language: 'vi' | 'en'
}

const STORAGE_KEY = 'ff-quickmatch-config'

export function loadSavedMatchConfig(): MatchConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MatchConfig>
    if (typeof parsed.focus_minutes !== 'number' || !parsed.language) {
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
export { othersWaiting }

// Hook ghép ngẫu nhiên: gọi edge function match-room, theo dõi hàng chờ qua Realtime, tải
// stats của cả nhóm khi khớp thành công. Từ 0018, ghép theo NHÓM 5 người (chờ đủ 5 mới tạo
// phòng — không ai bị ghép xong rồi ngồi 1 mình), nên `partners` giờ là mảng tối đa 4 người
// thay vì 1 partner như bản ghép cặp cũ.
export function useQuickMatch() {
  const [stage, setStage] = useState<QuickMatchStage>('idle')
  const [waited, setWaited] = useState(0)
  const [matchError, setMatchError] = useState('')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [partners, setPartners] = useState<PublicProfileStats[]>([])
  // Số người đang chờ cùng bộ lọc (bao gồm chính mình) — poll matching_queue_stats (0010)
  // mỗi 5s trong lúc tìm, dùng làm tiến trình "X người đang chờ, cần 5 để bắt đầu".
  const [waitingCount, setWaitingCount] = useState<number | null>(null)
  const cfgRef = useRef<MatchConfig | null>(null)

  const stageRef = useRef(stage)
  stageRef.current = stage
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  useEffect(() => {
    const id = setInterval(() => {
      if (stageRef.current === 'waiting') setWaited((w) => w + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (stage !== 'waiting') return
    let cancelled = false
    const poll = async () => {
      const cfg = cfgRef.current
      if (!cfg) return
      const { data } = await supabase
        .from('matching_queue_stats')
        .select('waiting_count')
        .eq('room_type', 'chill')
        .eq('duration_minutes', cfg.focus_minutes)
        .eq('language', cfg.language)
        .limit(1)
      if (!cancelled) setWaitingCount(data && data.length > 0 ? data[0].waiting_count : null)
    }
    void poll()
    const id = setInterval(poll, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [stage])

  useEffect(() => () => void channelRef.current?.unsubscribe(), [])

  async function loadPartners(roomId: string, uid: string): Promise<PublicProfileStats[]> {
    const { data: members } = await supabase
      .from('room_members_view')
      .select('user_id')
      .eq('room_id', roomId)
      .neq('user_id', uid)
    const partnerIds = (members ?? []).map((m) => m.user_id)
    if (partnerIds.length === 0) return []
    const results = await Promise.all(
      partnerIds.map((id) => supabase.rpc('public_profile_stats', { p_user_id: id })),
    )
    return results.map((r) => r.data?.[0] as PublicProfileStats).filter((s): s is PublicProfileStats => !!s)
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
          void loadPartners(row.matched_room_id ?? '', userId).then((partnerStats) => {
            setPartners(partnerStats)
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
    cfgRef.current = cfg
    setMatchError('')
    setRoomCode(null)
    setPartners([])
    setWaited(0)
    setWaitingCount(null)
    setStage('waiting')

    const { data, error } = await supabase.functions.invoke('match-room', {
      body: { duration_minutes: cfg.focus_minutes, language: cfg.language },
    })

    if (error) {
      setMatchError('matchServiceDown')
      return true
    }
    const result = data?.result as { status: string; room_id: string; room_code: string } | null
    if (result?.status === 'matched' && result.room_code) {
      const partnerStats = await loadPartners(result.room_id, user.id)
      setPartners(partnerStats)
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
    setWaitingCount(null)
    setStage('idle')
  }

  function reset() {
    setMatchError('')
    setWaited(0)
    setRoomCode(null)
    setPartners([])
    setWaitingCount(null)
    setStage('idle')
  }

  function dismissMatch() {
    setStage('idle')
    setPartners([])
  }

  return { stage, waited, matchError, roomCode, partners, waitingCount, start, cancel, reset, dismissMatch }
}

import type { RoomTypeKey } from './roomTypeRules'

export type RoomRow = {
  id: string
  code: string
  name: string
  host_id: string
  admit_mode: 'auto' | 'manual'
  capacity: number
  room_type: RoomTypeKey
  created_at: string
  duration_minutes: number
  break_minutes: number
  session_count: number
  timer_phase: 'focus' | 'break'
  timer_round: number
  timer_running: boolean
  timer_done: boolean
  timer_remaining_seconds: number | null
  timer_updated_at: string
}

export function phaseTotalSeconds(r: RoomRow, phase: 'focus' | 'break') {
  return (phase === 'focus' ? r.duration_minutes : r.break_minutes) * 60
}

export function computeLeftFromRoom(r: RoomRow) {
  const base = r.timer_remaining_seconds ?? phaseTotalSeconds(r, r.timer_phase)
  if (!r.timer_running) return Math.max(0, base)
  const elapsed = Math.floor((Date.now() - new Date(r.timer_updated_at).getTime()) / 1000)
  return Math.max(0, base - elapsed)
}

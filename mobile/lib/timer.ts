import type { RoomDetail } from './api';

export function phaseTotalSeconds(r: RoomDetail, phase: 'focus' | 'break') {
  return (phase === 'focus' ? r.duration_minutes : r.break_minutes) * 60;
}

export function computeLeftFromRoom(r: RoomDetail) {
  const base = r.timer_remaining_seconds ?? phaseTotalSeconds(r, r.timer_phase);
  if (!r.timer_running) return Math.max(0, base);
  const elapsed = Math.floor((Date.now() - new Date(r.timer_updated_at).getTime()) / 1000);
  return Math.max(0, base - elapsed);
}

export function formatClock(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
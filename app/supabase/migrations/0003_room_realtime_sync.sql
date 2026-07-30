-- FocusFlow — Giai đoạn 5: Pomodoro/nhạc đồng bộ trong phòng + chat có tên người gửi
-- Run this in Supabase SQL Editor after 0001/0002 (safe to re-run any time).

-- ============================================================
-- 1. ROOMS — server-authoritative timer + music state
-- ============================================================

alter table public.rooms add column if not exists timer_phase text not null default 'focus' check (timer_phase in ('focus', 'break'));
alter table public.rooms add column if not exists timer_round int not null default 1;
alter table public.rooms add column if not exists timer_running boolean not null default true;
-- null = "not started yet, use duration_minutes*60 as the fallback" (avoids needing a
-- trigger to compute a per-room default that depends on another column).
alter table public.rooms add column if not exists timer_remaining_seconds int;
alter table public.rooms add column if not exists timer_updated_at timestamptz not null default now();
alter table public.rooms add column if not exists music_on boolean not null default true;
alter table public.rooms add column if not exists music_track_index int not null default 0;

-- Only the host can write to `rooms` (existing "rooms: update by host" policy from 0001
-- already covers the whole row, including these new columns) — members observe via
-- Realtime, already enabled for `public.rooms` since 0001.

-- ============================================================
-- 2. CHAT — messages + sender display name
-- ============================================================

-- Same pattern as room_members_view: not security_invoker because it needs to join
-- `profiles` (select-own-only by RLS); the `is_room_participant()` check in the WHERE
-- clause is the real security boundary.
create or replace view public.room_messages_view as
select rmsg.id, rmsg.room_id, rmsg.user_id, rmsg.text, rmsg.created_at, p.name
from public.room_messages rmsg
join public.profiles p on p.id = rmsg.user_id
where public.is_room_participant(rmsg.room_id);

grant select on public.room_messages_view to authenticated;

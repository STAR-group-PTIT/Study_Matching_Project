-- FocusFlow — migration 0010 (đã gộp 2 file trùng version 0010 thành 1):
--   • GĐ8 phần 10: loại phòng free/together + nới check constraint room_type
--   • GĐ9: session_ratings + public_profile_stats + matching_queue_stats
-- Cả 2 phần đều đã chạy trên DB thật (GĐ8 db push + GĐ9 Management API) — file này
-- chỉ là bản ghi gộp để CLI migration state khớp, idempotent nên chạy lại vô hại.

-- FocusFlow — thêm 2 loại phòng mới: 'free' (Tự do — đồng hồ đếm tăng liên tục, không
-- chia phiên học/nghỉ) và 'together' (Đồng hành — mỗi người tự chạy Pomodoro riêng theo
-- cài đặt cá nhân, chỉ chia sẻ video/chat). Không cần cột mới — cả 2 loại đều dùng lại
-- các cột room hiện có (Room.tsx tự quyết định cách hiển thị theo room_type ở client),
-- chỉ cần nới check constraint. An toàn chạy lại nhiều lần.

alter table public.rooms drop constraint if exists rooms_room_type_check;
alter table public.rooms
  add constraint rooms_room_type_check
  check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch', 'free', 'together'));

alter table public.matching_queue drop constraint if exists matching_queue_room_type_check;
alter table public.matching_queue
  add constraint matching_queue_room_type_check
  check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch', 'free', 'together'));
-- FocusFlow — Giai đoạn 9: session ratings + public profile stats + queue stats
-- Run this in Supabase SQL Editor after 0009_default_youtube_url.sql
-- (idempotent — safe to re-run any time).

-- ============================================================
-- 1. SESSION RATINGS TABLE
-- ============================================================

-- One like per (giver, rated, room): you can appreciate each person you studied
-- with once per room, and re-rate them again in a future room.
create table if not exists public.session_ratings (
  id uuid primary key default gen_random_uuid(),
  giver_id uuid not null references auth.users (id) on delete cascade,
  rated_user_id uuid not null references auth.users (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint session_ratings_one_per_room unique (giver_id, rated_user_id, room_id),
  constraint session_ratings_no_self check (giver_id <> rated_user_id)
);

create index if not exists session_ratings_rated_idx
  on public.session_ratings (rated_user_id);

alter table public.session_ratings enable row level security;

-- Insert only your own rating, and only for a room you're a real member of,
-- targeting someone who is also a real member of that same room (both must be
-- status 'member' — pending waiters can't rate).
drop policy if exists "session_ratings: insert own" on public.session_ratings;
create policy "session_ratings: insert own" on public.session_ratings
  for insert with check (
    giver_id = auth.uid()
    and giver_id <> rated_user_id
    and exists (
      select 1 from public.room_members m
      where m.room_id = session_ratings.room_id
        and m.user_id = auth.uid()
        and m.status = 'member'
    )
    and exists (
      select 1 from public.room_members m
      where m.room_id = session_ratings.room_id
        and m.user_id = session_ratings.rated_user_id
        and m.status = 'member'
    )
  );

-- You can see ratings you gave or received (used to dedupe the UI and show count).
drop policy if exists "session_ratings: select own" on public.session_ratings;
create policy "session_ratings: select own" on public.session_ratings
  for select using (giver_id = auth.uid() or rated_user_id = auth.uid());

-- ============================================================
-- 2. PUBLIC PROFILE STATS RPC
-- ============================================================

-- Aggregates-only view of another user's study profile, used for the "match found"
-- celebration card. Security definer (reads across `profiles`/`focus_sessions`/
-- `session_ratings` regardless of RLS) but returns ONLY aggregates + the display
-- fields the matched partner would see anyway in the room — no raw session data.
create or replace function public.public_profile_stats(p_user_id uuid)
returns table (
  name text,
  avatar_url text,
  accent_hue int,
  weekly_minutes int,
  total_minutes int,
  total_sessions int,
  likes_received int
)
language plpgsql
security definer
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return query
  select
    p.name,
    p.avatar_url,
    p.accent_hue,
    coalesce((
      select sum(f.minutes)::int from public.focus_sessions f
      where f.user_id = p_user_id
        and f.phase = 'focus'
        and f.started_at >= date_trunc('week', now())
    ), 0) as weekly_minutes,
    coalesce((
      select sum(f.minutes)::int from public.focus_sessions f
      where f.user_id = p_user_id
        and f.phase = 'focus'
    ), 0) as total_minutes,
    coalesce((
      select count(*)::int from public.focus_sessions f
      where f.user_id = p_user_id
        and f.phase = 'focus'
    ), 0) as total_sessions,
    coalesce((
      select count(*)::int from public.session_ratings r
      where r.rated_user_id = p_user_id
    ), 0) as likes_received
  from public.profiles p
  where p.id = p_user_id;
end;
$$;

grant execute on function public.public_profile_stats(uuid) to authenticated;

-- ============================================================
-- 3. QUEUE STATS VIEW (who is waiting, anonymously)
-- ============================================================

-- Same "NOT security_invoker, WHERE is the boundary" pattern as room_public_list:
-- exposes only COUNTS per filter combo so the waiting screen can say "N người đang
-- chờ cùng nhịp" — never any user identity. Queue rows are deleted on match, so this
-- always reflects live waiters only.
create or replace view public.matching_queue_stats as
select
  room_type,
  duration_minutes,
  language,
  count(*)::int as waiting_count
from public.matching_queue
where matched_room_code is null
group by room_type, duration_minutes, language;

grant select on public.matching_queue_stats to anon, authenticated;

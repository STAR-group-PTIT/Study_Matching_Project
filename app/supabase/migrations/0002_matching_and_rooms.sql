-- FocusFlow — Giai đoạn 4: matching queue + room join/list helpers
-- Run this in Supabase SQL Editor after 0001_init.sql (safe to re-run any time).

-- ============================================================
-- 1. TABLES
-- ============================================================

create table if not exists public.matching_queue (
  user_id uuid primary key references auth.users (id) on delete cascade,
  room_type text not null check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch')),
  duration_minutes int not null,
  language text not null,
  matched_room_id uuid references public.rooms (id) on delete set null,
  matched_room_code text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. FUNCTIONS
-- ============================================================

-- Atomically pair the caller with a compatible waiting user, or enqueue the caller.
-- `for update skip locked` guarantees two concurrent callers can never grab the same
-- waiting partner, so this is safe to call from multiple simultaneous requests.
create or replace function public.match_or_queue(
  p_room_type text,
  p_duration_minutes int,
  p_language text
)
returns table (status text, room_id uuid, room_code text)
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_candidate record;
  v_room_id uuid;
  v_room_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- re-entry is idempotent: drop any stale queue row of our own first
  delete from public.matching_queue where user_id = v_uid;

  select * into v_candidate
  from public.matching_queue q
  where q.room_type = p_room_type
    and q.duration_minutes = p_duration_minutes
    and q.language = p_language
    and q.user_id <> v_uid
  order by q.created_at asc
  for update skip locked
  limit 1;

  if found then
    loop
      v_room_code := '';
      for v_i in 1..6 loop
        v_room_code := v_room_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
      end loop;
      exit when not exists (select 1 from public.rooms r where r.code = v_room_code);
    end loop;

    insert into public.rooms (code, name, host_id, room_type, duration_minutes, language, capacity, visibility, admit_mode)
    values (v_room_code, 'Phòng ghép ngẫu nhiên', v_candidate.user_id, p_room_type, p_duration_minutes, p_language, 2, 'private', 'auto')
    returning id into v_room_id;

    insert into public.room_members (room_id, user_id, status) values
      (v_room_id, v_candidate.user_id, 'member'),
      (v_room_id, v_uid, 'member');

    -- tell the waiting party (candidate) where to go via their queue row; they're
    -- listening on Realtime for this UPDATE and will clean up their own row after navigating.
    update public.matching_queue
    set matched_room_id = v_room_id, matched_room_code = v_room_code
    where user_id = v_candidate.user_id;

    return query select 'matched'::text, v_room_id, v_room_code;
  else
    insert into public.matching_queue (user_id, room_type, duration_minutes, language)
    values (v_uid, p_room_type, p_duration_minutes, p_language);

    return query select 'queued'::text, null::uuid, null::text;
  end if;
end;
$$;

-- Preview a room by its 6-char join code, bypassing RLS — knowing the exact code is
-- the "password" for private rooms, same pattern as any invite-link based product.
create or replace function public.get_room_by_code(p_code text)
returns table (
  id uuid,
  code text,
  name text,
  room_type text,
  duration_minutes int,
  language text,
  capacity int,
  visibility text,
  admit_mode text,
  member_count bigint
)
language sql
security definer
stable
as $$
  select
    r.id, r.code, r.name, r.room_type, r.duration_minutes, r.language, r.capacity, r.visibility, r.admit_mode,
    (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'member') as member_count
  from public.rooms r
  where r.code = upper(p_code);
$$;

-- Join a room by code: enforces capacity and applies the room's admit_mode
-- (auto → straight to 'member', manual → 'pending' until the host approves).
create or replace function public.join_room_by_code(p_code text)
returns table (status text, room_id uuid, member_status text)
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_room record;
  v_existing record;
  v_member_count int;
  v_new_status text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_room from public.rooms where code = upper(p_code);
  if not found then
    return query select 'not_found'::text, null::uuid, null::text;
    return;
  end if;

  select * into v_existing from public.room_members where room_id = v_room.id and user_id = v_uid;
  if found then
    return query select 'already_joined'::text, v_room.id, v_existing.status;
    return;
  end if;

  select count(*) into v_member_count from public.room_members where room_id = v_room.id and status = 'member';
  if v_member_count >= v_room.capacity then
    return query select 'full'::text, v_room.id, null::text;
    return;
  end if;

  v_new_status := case when v_room.admit_mode = 'auto' then 'member' else 'pending' end;
  insert into public.room_members (room_id, user_id, status) values (v_room.id, v_uid, v_new_status);

  return query select 'joined'::text, v_room.id, v_new_status;
end;
$$;

-- ============================================================
-- 3. ROW LEVEL SECURITY (matching_queue)
-- ============================================================

alter table public.matching_queue enable row level security;

drop policy if exists "matching_queue: select own" on public.matching_queue;
create policy "matching_queue: select own" on public.matching_queue
  for select using (auth.uid() = user_id);
drop policy if exists "matching_queue: insert own" on public.matching_queue;
create policy "matching_queue: insert own" on public.matching_queue
  for insert with check (auth.uid() = user_id);
drop policy if exists "matching_queue: delete own" on public.matching_queue;
create policy "matching_queue: delete own" on public.matching_queue
  for delete using (auth.uid() = user_id);
-- no update policy for plain users — only match_or_queue() (security definer) updates
-- another user's row, to notify them they've been matched.

-- Widen the GĐ3 "rooms: select visible" policy so a user who's still 'pending'
-- approval on a *private* room can load basic room info for the waiting screen
-- (they already know the secret code — this isn't a new information leak).
drop policy if exists "rooms: select visible" on public.rooms;
create policy "rooms: select visible" on public.rooms
  for select using (
    visibility = 'public'
    or host_id = auth.uid()
    or exists (
      select 1 from public.room_members m
      where m.room_id = rooms.id and m.user_id = auth.uid() and m.status in ('pending', 'member')
    )
  );

-- ============================================================
-- 4. PUBLIC ROOM LIST VIEW
-- ============================================================

-- Intentionally NOT security_invoker: this view is owned by the migration role and
-- reads across `rooms`/`profiles`/`room_members` regardless of the caller's RLS, but the
-- `where visibility = 'public'` clause is the actual security boundary — private rooms and
-- non-public profile data never leak through it. Readable by guests too (browsing the
-- public room list doesn't require login; joining does).
create or replace view public.room_public_list as
select
  r.id, r.code, r.name, r.room_type, r.duration_minutes, r.language, r.capacity,
  p.name as host_name,
  (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'member') as member_count
from public.rooms r
join public.profiles p on p.id = r.host_id
where r.visibility = 'public';

grant select on public.room_public_list to anon, authenticated;

-- Members + display name for the Room screen's "Quản lý" tab. Also NOT security_invoker
-- (needs to join `profiles`, which is select-own-only by RLS) — the `where` clause below
-- is the real security boundary: a caller only sees rows for rooms they participate in
-- (host/member), or their own row even while still 'pending' approval.
create or replace view public.room_members_view as
select rm.id, rm.room_id, rm.user_id, rm.status, rm.joined_at, p.name
from public.room_members rm
join public.profiles p on p.id = rm.user_id
where public.is_room_participant(rm.room_id) or rm.user_id = auth.uid();

grant select on public.room_members_view to authenticated;

-- ============================================================
-- 5. REALTIME
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matching_queue'
  ) then
    alter publication supabase_realtime add table public.matching_queue;
  end if;
end $$;

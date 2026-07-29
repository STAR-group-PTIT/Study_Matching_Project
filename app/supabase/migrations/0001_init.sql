-- FocusFlow — initial schema + RLS
-- Run this in Supabase SQL Editor (Run the whole file — safe to re-run any time).

create extension if not exists pgcrypto;

-- ============================================================
-- 1. TABLES (all created first — policies below may reference
--    any of them regardless of declaration order)
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Người dùng mới',
  avatar_url text,
  accent_hue int not null default 195,
  focus_minutes int not null default 25,
  break_minutes int not null default 5,
  auto_start_next boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  meta text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  room_id uuid, -- FK added after `rooms` exists, see below
  phase text not null check (phase in ('focus', 'break')),
  minutes int not null,
  started_at timestamptz not null,
  ended_at timestamptz not null default now()
);

create table if not exists public.wallpapers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  storage_path text not null, -- path inside the `wallpapers` storage bucket
  created_at timestamptz not null default now()
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  storage_path text not null, -- path inside the `tracks` storage bucket
  duration_seconds int,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- 6-char join code, e.g. G32TZU
  name text not null,
  host_id uuid not null references auth.users (id) on delete cascade,
  room_type text not null check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch')),
  duration_minutes int not null default 25,
  language text not null default 'vi',
  capacity int not null default 4,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  admit_mode text not null default 'auto' check (admit_mode in ('auto', 'manual')),
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'member')),
  joined_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

-- focus_sessions.room_id → rooms.id (added here since `rooms` didn't exist yet above)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'focus_sessions_room_id_fkey'
  ) then
    alter table public.focus_sessions
      add constraint focus_sessions_room_id_fkey
      foreign key (room_id) references public.rooms (id) on delete set null;
  end if;
end $$;

-- ============================================================
-- 2. FUNCTIONS & TRIGGERS
-- ============================================================

-- auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', 'Người dùng mới'))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- helper: is the current user host or an accepted member of this room?
create or replace function public.is_room_participant(target_room_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.rooms r
    where r.id = target_room_id and r.host_id = auth.uid()
  ) or exists (
    select 1 from public.room_members m
    where m.room_id = target_room_id and m.user_id = auth.uid() and m.status = 'member'
  );
$$ language sql security definer stable;

-- ============================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles enable row level security;
alter table public.todos enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.wallpapers enable row level security;
alter table public.tracks enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;

-- profiles
drop policy if exists "profiles: select own" on public.profiles;
create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id);
drop policy if exists "profiles: insert own" on public.profiles;
create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);

-- todos
drop policy if exists "todos: crud own" on public.todos;
create policy "todos: crud own" on public.todos
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- focus_sessions
drop policy if exists "focus_sessions: select own" on public.focus_sessions;
create policy "focus_sessions: select own" on public.focus_sessions
  for select using (auth.uid() = user_id);
drop policy if exists "focus_sessions: insert own" on public.focus_sessions;
create policy "focus_sessions: insert own" on public.focus_sessions
  for insert with check (auth.uid() = user_id);

-- wallpapers
drop policy if exists "wallpapers: crud own" on public.wallpapers;
create policy "wallpapers: crud own" on public.wallpapers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- tracks
drop policy if exists "tracks: crud own" on public.tracks;
create policy "tracks: crud own" on public.tracks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- rooms — anyone signed in can see public rooms; host and members can also see private ones they belong to
drop policy if exists "rooms: select visible" on public.rooms;
create policy "rooms: select visible" on public.rooms
  for select using (
    visibility = 'public'
    or host_id = auth.uid()
    or exists (
      select 1 from public.room_members m
      where m.room_id = rooms.id and m.user_id = auth.uid() and m.status = 'member'
    )
  );
drop policy if exists "rooms: insert as host" on public.rooms;
create policy "rooms: insert as host" on public.rooms
  for insert with check (host_id = auth.uid());
drop policy if exists "rooms: update by host" on public.rooms;
create policy "rooms: update by host" on public.rooms
  for update using (host_id = auth.uid());
drop policy if exists "rooms: delete by host" on public.rooms;
create policy "rooms: delete by host" on public.rooms
  for delete using (host_id = auth.uid());

-- room_members
drop policy if exists "room_members: select if participant or self" on public.room_members;
create policy "room_members: select if participant or self" on public.room_members
  for select using (
    user_id = auth.uid() or public.is_room_participant(room_id)
  );
drop policy if exists "room_members: insert self (join request)" on public.room_members;
create policy "room_members: insert self (join request)" on public.room_members
  for insert with check (user_id = auth.uid());
drop policy if exists "room_members: update by host (approve) or self (leave)" on public.room_members;
create policy "room_members: update by host (approve) or self (leave)" on public.room_members
  for update using (
    user_id = auth.uid()
    or exists (select 1 from public.rooms r where r.id = room_id and r.host_id = auth.uid())
  );
drop policy if exists "room_members: delete by host (kick) or self (leave)" on public.room_members;
create policy "room_members: delete by host (kick) or self (leave)" on public.room_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.rooms r where r.id = room_id and r.host_id = auth.uid())
  );

-- room_messages
drop policy if exists "room_messages: select if participant" on public.room_messages;
create policy "room_messages: select if participant" on public.room_messages
  for select using (public.is_room_participant(room_id));
drop policy if exists "room_messages: insert if participant" on public.room_messages;
create policy "room_messages: insert if participant" on public.room_messages
  for insert with check (user_id = auth.uid() and public.is_room_participant(room_id));

-- ============================================================
-- 4. REALTIME — broadcast changes the Room screen needs live
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_members'
  ) then
    alter publication supabase_realtime add table public.room_members;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_messages'
  ) then
    alter publication supabase_realtime add table public.room_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rooms'
  ) then
    alter publication supabase_realtime add table public.rooms;
  end if;
end $$;

-- FocusFlow — Giai đoạn 10: hệ thống kết bạn (name#tag) + mời bạn vào room đang học.
-- Run this in Supabase SQL Editor after 0015_focus_session_completed.sql (safe to re-run any time).

-- ============================================================
-- 1. profiles.tag — handle kiểu Discord "name#1234"
-- ============================================================

alter table public.profiles add column if not exists tag text;

-- Sinh 1 mã 4 số chưa bị trùng với (name, tag) hiện có, thử lại tới khi trống chỗ.
-- Không phải security definer riêng — luôn được gọi từ bên trong handle_new_user()
-- (đã security definer) hoặc trực tiếp trong migration này, nên thừa hưởng quyền đó.
create or replace function public.generate_unique_tag(p_name text)
returns text
language plpgsql
as $$
declare
  v_tag text;
begin
  loop
    v_tag := lpad(floor(random() * 10000)::int::text, 4, '0');
    exit when not exists (
      select 1 from public.profiles where lower(name) = lower(p_name) and tag = v_tag
    );
  end loop;
  return v_tag;
end;
$$;

-- Backfill 1 lần cho các tài khoản đã tồn tại trước migration này (cột sắp thành not null).
do $$
declare
  r record;
begin
  for r in select id, name from public.profiles where tag is null loop
    update public.profiles set tag = public.generate_unique_tag(r.name) where id = r.id;
  end loop;
end $$;

alter table public.profiles alter column tag set not null;

create unique index if not exists profiles_name_tag_key on public.profiles (lower(name), tag);

-- Mở rộng handle_new_user() (0001_init.sql) để gán luôn tag lúc tạo tài khoản mới.
-- Đổi tên sau khi đã có tag KHÔNG được hỗ trợ ở migration này (xem ghi chú trong plan) —
-- tag chỉ gán 1 lần ở đây rồi giữ nguyên.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_name text := coalesce(new.raw_user_meta_data->>'name', 'Người dùng mới');
begin
  insert into public.profiles (id, name, tag)
  values (new.id, v_name, public.generate_unique_tag(v_name))
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- ============================================================
-- 2. friend_requests — 1 dòng / 1 cặp user, chiều chỉ còn ý nghĩa lúc pending
-- ============================================================

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);

-- Unique theo cặp không phân biệt chiều — mỗi 2 user chỉ có đúng 1 dòng trong suốt lịch sử.
create unique index if not exists friend_requests_pair_key
  on public.friend_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

alter table public.friend_requests enable row level security;

drop policy if exists "friend_requests: select if participant" on public.friend_requests;
create policy "friend_requests: select if participant" on public.friend_requests
  for select using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Chấp nhận lời mời: chỉ bên nhận, chỉ khi đang pending. Client chỉ được set status='accepted'
-- (with check ràng buộc rõ), giống mức tin tưởng của approveReal() trong Room.tsx.
drop policy if exists "friend_requests: accept as addressee" on public.friend_requests;
create policy "friend_requests: accept as addressee" on public.friend_requests
  for update using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');

-- Huỷ lời mời đã gửi / từ chối lời mời đến / huỷ kết bạn — đều là xoá dòng, cả 2 bên đều được.
drop policy if exists "friend_requests: delete if participant" on public.friend_requests;
create policy "friend_requests: delete if participant" on public.friend_requests
  for delete using (requester_id = auth.uid() or addressee_id = auth.uid());

-- Không có policy insert thường — tạo dòng chỉ qua send_friend_request() bên dưới,
-- vì cần kiểm tra case "bên kia đã gửi trước" (auto chấp nhận) mà 1 câu insert của
-- client không tự làm an toàn/atomic được.

create or replace function public.send_friend_request(p_target_id uuid)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_target_id = v_uid then
    raise exception 'cannot friend yourself';
  end if;

  select * into v_existing from public.friend_requests
    where least(requester_id, addressee_id) = least(v_uid, p_target_id)
      and greatest(requester_id, addressee_id) = greatest(v_uid, p_target_id);

  if found then
    if v_existing.status = 'accepted' then
      return query select 'already_friends'::text;
      return;
    end if;
    -- pending
    if v_existing.requester_id = v_uid then
      return query select 'already_sent'::text;
      return;
    else
      -- họ đã gửi lời mời cho mình trước — coi như 2 bên đều muốn, chấp nhận luôn.
      update public.friend_requests
        set status = 'accepted', responded_at = now()
        where id = v_existing.id;
      return query select 'accepted'::text;
      return;
    end if;
  end if;

  insert into public.friend_requests (requester_id, addressee_id) values (v_uid, p_target_id);
  return query select 'sent'::text;
end;
$$;

grant execute on function public.send_friend_request(uuid) to authenticated;

-- Client cần hiện tên/tag của NGƯỜI KIA trong mỗi lời mời/tình bạn, nhưng "profiles: select
-- own" (0001_init.sql) chỉ cho xem row của chính mình — join thẳng sẽ bị RLS chặn phía bên
-- kia. Dùng view join profiles bất chấp RLS (giống room_members_view, 0002_matching_and_rooms.sql),
-- ranh giới bảo mật thật sự nằm ở where-clause "chỉ trả về dòng mình có tham gia".
create or replace view public.friend_requests_view as
select
  fr.id, fr.requester_id, fr.addressee_id, fr.status, fr.created_at, fr.responded_at,
  rp.name as requester_name, rp.tag as requester_tag, rp.avatar_url as requester_avatar_url,
  ap.name as addressee_name, ap.tag as addressee_tag, ap.avatar_url as addressee_avatar_url
from public.friend_requests fr
join public.profiles rp on rp.id = fr.requester_id
join public.profiles ap on ap.id = fr.addressee_id
where fr.requester_id = auth.uid() or fr.addressee_id = auth.uid();

grant select on public.friend_requests_view to authenticated;

-- Tìm đúng 1 người theo handle chính xác "name#tag" — CHỈ khớp chính xác (không tìm mờ/tiền
-- tố), đây là ranh giới bảo mật giữ nó khỏi thành công cụ dò toàn bộ danh sách user. Cần
-- security definer vì "profiles: select own" (0001_init.sql) chỉ cho xem row của chính mình.
create or replace function public.find_profile_by_tag(p_name text, p_code text)
returns table (id uuid, name text, tag text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.name, p.tag, p.avatar_url
  from public.profiles p
  where lower(p.name) = lower(trim(p_name))
    and p.tag = p_code
    and p.id <> auth.uid()
  limit 1;
$$;

grant execute on function public.find_profile_by_tag(text, text) to authenticated;

-- ============================================================
-- 3. room_invites — mời bạn bè vào room đang học, vào thẳng bỏ qua duyệt của host
-- ============================================================

create table if not exists public.room_invites (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  inviter_id uuid not null references auth.users (id) on delete cascade,
  invitee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

alter table public.room_invites enable row level security;

drop policy if exists "room_invites: select if participant" on public.room_invites;
create policy "room_invites: select if participant" on public.room_invites
  for select using (inviter_id = auth.uid() or invitee_id = auth.uid());

-- Người được mời tự từ chối (đổi status, không có side effect nên không cần RPC).
drop policy if exists "room_invites: decline as invitee" on public.room_invites;
create policy "room_invites: decline as invitee" on public.room_invites
  for update using (invitee_id = auth.uid() and status = 'pending')
  with check (invitee_id = auth.uid() and status = 'declined');

-- Người mời tự huỷ lời mời đã gửi (chưa được phản hồi).
drop policy if exists "room_invites: cancel as inviter" on public.room_invites;
create policy "room_invites: cancel as inviter" on public.room_invites
  for update using (inviter_id = auth.uid() and status = 'pending')
  with check (inviter_id = auth.uid() and status = 'cancelled');

-- Không có policy insert thường — tạo dòng chỉ qua invite_friend_to_room() (cần kiểm tra
-- chéo: người mời có đang ở trong room không, 2 người có phải bạn bè không).

-- Cùng lý do với friend_requests_view ở trên: popup mời vào room cần hiện tên người mời
-- + tên/mã room, cả hai đều nằm ngoài quyền xem RLS mặc định của người được mời.
create or replace view public.room_invites_view as
select
  ri.id, ri.room_id, ri.inviter_id, ri.invitee_id, ri.status, ri.created_at, ri.responded_at,
  p.name as inviter_name, p.tag as inviter_tag,
  r.name as room_name, r.code as room_code
from public.room_invites ri
join public.profiles p on p.id = ri.inviter_id
join public.rooms r on r.id = ri.room_id
where ri.inviter_id = auth.uid() or ri.invitee_id = auth.uid();

grant select on public.room_invites_view to authenticated;

create or replace function public.invite_friend_to_room(p_room_id uuid, p_friend_id uuid)
returns table (status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room record;
  v_is_member boolean;
  v_is_friend boolean;
  v_already_member boolean;
  v_existing_invite record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  if not found or v_room.closed_at is not null then
    raise exception 'room not found or closed';
  end if;

  select exists(
    select 1 from public.room_members
    where room_id = p_room_id and user_id = v_uid and status = 'member'
  ) into v_is_member;
  if not v_is_member then
    raise exception 'you are not a member of this room';
  end if;

  select exists(
    select 1 from public.friend_requests
    where status = 'accepted'
      and least(requester_id, addressee_id) = least(v_uid, p_friend_id)
      and greatest(requester_id, addressee_id) = greatest(v_uid, p_friend_id)
  ) into v_is_friend;
  if not v_is_friend then
    raise exception 'not friends with this user';
  end if;

  select exists(
    select 1 from public.room_members where room_id = p_room_id and user_id = p_friend_id
  ) into v_already_member;
  if v_already_member then
    return query select 'already_member'::text;
    return;
  end if;

  select * into v_existing_invite from public.room_invites
    where room_id = p_room_id and invitee_id = p_friend_id and status = 'pending';
  if found then
    return query select 'already_invited'::text;
    return;
  end if;

  insert into public.room_invites (room_id, inviter_id, invitee_id)
    values (p_room_id, v_uid, p_friend_id);
  return query select 'sent'::text;
end;
$$;

grant execute on function public.invite_friend_to_room(uuid, uuid) to authenticated;

-- Chấp nhận lời mời vào room — insert thẳng vào room_members làm 'member', BỎ QUA
-- admit_mode của room (đây chính là đặc quyền của lời mời cá nhân mà join_room_by_code
-- thường không có). Vẫn phải check phòng chưa đóng/chưa đầy chỗ, cùng logic
-- join_room_by_code() (0002_matching_and_rooms.sql).
create or replace function public.accept_room_invite(p_invite_id uuid)
returns table (status text, room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_room record;
  v_member_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_invite from public.room_invites
    where id = p_invite_id and invitee_id = v_uid and status = 'pending';
  if not found then
    raise exception 'invite not found';
  end if;

  select * into v_room from public.rooms where id = v_invite.room_id;
  if not found or v_room.closed_at is not null then
    update public.room_invites set status = 'declined', responded_at = now() where id = p_invite_id;
    return query select 'room_closed'::text, null::text;
    return;
  end if;

  select count(*) into v_member_count from public.room_members
    where room_id = v_room.id and status = 'member';
  if v_member_count >= v_room.capacity then
    return query select 'full'::text, null::text;
    return;
  end if;

  insert into public.room_members (room_id, user_id, status)
    values (v_room.id, v_uid, 'member')
    on conflict (room_id, user_id) do update set status = 'member';

  update public.room_invites set status = 'accepted', responded_at = now() where id = p_invite_id;

  return query select 'joined'::text, v_room.code;
end;
$$;

grant execute on function public.accept_room_invite(uuid) to authenticated;

-- ============================================================
-- 4. REALTIME
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'friend_requests'
  ) then
    alter publication supabase_realtime add table public.friend_requests;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_invites'
  ) then
    alter publication supabase_realtime add table public.room_invites;
  end if;
end $$;

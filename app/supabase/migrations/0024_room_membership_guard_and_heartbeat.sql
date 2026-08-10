-- Fix 2 bug user báo sau khi tự dùng bản thật: (1) phòng đã bỏ tab từ lâu (không bấm "Rời
-- phòng") vẫn còn hiện trong danh sách công khai mãi — room_public_list (0017) chỉ ẩn phòng khi
-- 0 hàng room_members status='member', nhưng 1 hàng "ma" (tab đóng, không ai xoá hộ) đủ giữ
-- phòng sống mãi; (2) 1 user có thể vào được 2 phòng cùng lúc — không điểm insert
-- room_members nào (join_room_by_code, find_or_create_lobby, accept_room_invite, và
-- createRoom() insert thẳng từ client) từng kiểm tra user đã có hàng active ở phòng khác chưa.
--
-- Cách fix: thêm "nhịp tim" — room_members.last_seen_at, client (Room.tsx) tự cập nhật mỗi
-- ~45s trong lúc còn mở phòng thật, CHỈ dừng khi tab thực sự đóng (không dừng khi chuyển tab
-- nền/mất focus — user để tab mở rồi làm việc khác là bình thường). Hàng "tươi" (last_seen_at
-- trong 3 phút) mới được tính là "đang thực sự ở phòng" cho các quyết định hiển thị/capacity/
-- chặn; hàng quá 10 phút không nhịp tim bị dọn hẳn (tự chuyển host cho người còn lại sớm nhất,
-- hoặc tự đóng phòng nếu trống — tái dùng đúng logic đã có ở finalize_lobby 0019/0020 và
-- "đóng phòng" ở 0014). Dọn kiểu lười (lazy TTL, không cần pg_cron) — gọi cleanup ngay trong
-- các RPC join/tạo/ghép phòng, đúng pattern đã dùng cho matching_queue ở 0011.
--
-- Chặn 2 phòng cùng lúc: helper find_other_active_room() dùng chung cho join_room_by_code,
-- find_or_create_lobby, accept_room_invite, create_room mới — nếu user đã có phòng active
-- khác (tươi), trả status 'already_in_another_room' kèm mã phòng đó thay vì cho vào phòng mới.
-- Chủ động CHẶN thay vì tự rời phòng cũ giùm user (user muốn hành động rõ ràng, không muốn bị
-- âm thầm đá khỏi phòng đang mở ở tab khác).

-- ============================================================
-- 1. SCHEMA
-- ============================================================

alter table public.room_members
  add column if not exists last_seen_at timestamptz not null default now();

create or replace view public.room_public_list as
select
  r.id, r.code, r.name, r.room_type, r.duration_minutes, r.language, r.capacity,
  p.name as host_name,
  (select count(*) from public.room_members m
     where m.room_id = r.id and m.status = 'member'
       and m.last_seen_at > now() - interval '3 minutes') as member_count
from public.rooms r
join public.profiles p on p.id = r.host_id
where r.visibility = 'public'
  and r.closed_at is null
  and exists (
    select 1 from public.room_members m
    where m.room_id = r.id and m.status = 'member'
      and m.last_seen_at > now() - interval '3 minutes'
  );

grant select on public.room_public_list to anon, authenticated;

-- ============================================================
-- 2. HELPERS — dùng chung cho mọi điểm insert room_members
-- ============================================================

-- Phòng active (tươi) khác mà user đang gọi hàm đã ở trong, nếu có — p_exclude_room_id để
-- không tự chặn khi thao tác đúng target room đang xét (vd re-join đúng phòng mình đã ở).
create or replace function public.find_other_active_room(p_exclude_room_id uuid default null)
returns table (room_id uuid, room_code text, room_name text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.code, r.name
  from public.room_members m
  join public.rooms r on r.id = m.room_id
  where m.user_id = auth.uid()
    and m.status in ('member', 'pending')
    and r.closed_at is null
    and m.last_seen_at > now() - interval '3 minutes'
    and (p_exclude_room_id is null or r.id <> p_exclude_room_id)
  order by m.joined_at desc
  limit 1;
$$;

grant execute on function public.find_other_active_room(uuid) to authenticated;

-- Dọn hàng room_members quá 10 phút không nhịp tim (tab đã đóng từ lâu, không ai xoá hộ).
-- Nếu hàng bị xoá là của host, tự chuyển host cho người vào sớm nhất còn lại (giống hệt cách
-- finalize_lobby xử lý host bỏ đi giữa chừng), hoặc tự đóng phòng nếu không còn ai — không xoá
-- cứng hàng rooms vì session_ratings tham chiếu on delete cascade (lý do đã ghi ở 0014).
create or replace function public.cleanup_stale_room_members()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_earliest uuid;
begin
  for v_row in
    select m.id, m.room_id, m.user_id, r.host_id
    from public.room_members m
    join public.rooms r on r.id = m.room_id
    where m.last_seen_at < now() - interval '10 minutes'
      and r.closed_at is null
  loop
    delete from public.room_members where id = v_row.id;

    if v_row.user_id = v_row.host_id then
      select user_id into v_earliest from public.room_members
        where room_id = v_row.room_id and status = 'member'
        order by joined_at asc limit 1;
      if v_earliest is not null then
        update public.rooms set host_id = v_earliest where id = v_row.room_id;
      else
        update public.rooms set closed_at = now() where id = v_row.room_id;
      end if;
    end if;
  end loop;
end;
$$;

grant execute on function public.cleanup_stale_room_members() to authenticated;

-- ============================================================
-- 3. join_room_by_code — thêm guard + freshness + dọn lười. Đổi returns table (thêm cột) nên
--    phải drop trước khi tạo lại.
-- ============================================================

drop function if exists public.join_room_by_code(text);

create function public.join_room_by_code(p_code text)
returns table (status text, room_id uuid, member_status text, other_room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room record;
  v_existing record;
  v_member_count int;
  v_new_status text;
  v_other record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.cleanup_stale_room_members();

  select * into v_room from public.rooms where code = upper(p_code);
  if not found then
    return query select 'not_found'::text, null::uuid, null::text, null::text;
    return;
  end if;

  select * into v_existing from public.room_members
    where room_members.room_id = v_room.id and room_members.user_id = v_uid;
  if found then
    return query select 'already_joined'::text, v_room.id, v_existing.status, null::text;
    return;
  end if;

  select * into v_other from public.find_other_active_room(v_room.id);
  if found then
    return query select 'already_in_another_room'::text, v_room.id, null::text, v_other.room_code;
    return;
  end if;

  select count(*) into v_member_count from public.room_members
    where room_members.room_id = v_room.id and room_members.status = 'member'
      and room_members.last_seen_at > now() - interval '3 minutes';
  if v_member_count >= v_room.capacity then
    return query select 'full'::text, v_room.id, null::text, null::text;
    return;
  end if;

  v_new_status := case when v_room.admit_mode = 'auto' then 'member' else 'pending' end;
  insert into public.room_members (room_id, user_id, status) values (v_room.id, v_uid, v_new_status);

  perform public.finalize_lobby(v_room.id);

  return query select 'joined'::text, v_room.id, v_new_status, null::text;
end;
$$;

grant execute on function public.join_room_by_code(text) to authenticated;

-- ============================================================
-- 4. find_or_create_lobby / finalize_lobby — guard trên find_or_create_lobby (trước khi tìm/
--    tạo lobby), freshness filter trên mọi chỗ đếm member ở cả 2 hàm. find_or_create_lobby
--    đổi returns table (thêm cột) nên phải drop; finalize_lobby giữ nguyên chữ ký.
-- ============================================================

drop function if exists public.find_or_create_lobby(int, text);

create function public.find_or_create_lobby(
  p_duration_minutes int,
  p_language text
)
returns table (
  status text, room_id uuid, room_code text,
  member_count int, capacity int, lobby_expires_at timestamptz,
  other_room_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_room_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i int;
  v_already_member boolean;
  v_other record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.cleanup_stale_room_members();

  select * into v_other from public.find_other_active_room(null);
  if found then
    return query select 'already_in_another_room'::text, null::uuid, null::text,
      null::int, null::int, null::timestamptz, v_other.room_code;
    return;
  end if;

  loop
    v_room_id := null;

    select r.id into v_room_id
    from public.rooms r
    where r.status = 'lobby'
      and r.closed_at is null
      and r.duration_minutes = p_duration_minutes
      and r.language = p_language
      and (select count(*) from public.room_members m
           where m.room_id = r.id and m.status = 'member'
             and m.last_seen_at > now() - interval '3 minutes') < r.capacity
    order by r.created_at asc
    for update skip locked
    limit 1;

    exit when v_room_id is not null;

    begin
      loop
        v_room_code := '';
        for v_i in 1..6 loop
          v_room_code := v_room_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
        end loop;
        exit when not exists (select 1 from public.rooms r2 where r2.code = v_room_code);
      end loop;

      insert into public.rooms (
        code, name, host_id, room_type, duration_minutes, language, capacity,
        visibility, admit_mode, status, lobby_expires_at, timer_running
      )
      values (
        v_room_code, 'Phòng ghép ngẫu nhiên', v_uid, 'chill', p_duration_minutes, p_language, 5,
        'private', 'auto', 'lobby', now() + interval '75 seconds', false
      )
      returning id into v_room_id;

      exit;
    exception when unique_violation then
      v_room_id := null;
    end;
  end loop;

  select exists(
    select 1 from public.room_members
    where room_members.room_id = v_room_id and room_members.user_id = v_uid
  ) into v_already_member;

  if not v_already_member then
    insert into public.room_members (room_id, user_id, status) values (v_room_id, v_uid, 'member');
  end if;

  return query
    select f.status, f.room_id, f.room_code, f.member_count, f.capacity, f.lobby_expires_at, null::text
    from public.finalize_lobby(v_room_id) f;
end;
$$;

grant execute on function public.find_or_create_lobby(int, text) to authenticated;

create or replace function public.finalize_lobby(p_room_id uuid)
returns table (
  status text, room_id uuid, room_code text,
  member_count int, capacity int, lobby_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_member_count int;
  v_earliest uuid;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    return;
  end if;

  if v_room.status <> 'lobby' or v_room.closed_at is not null then
    select count(*) into v_member_count from public.room_members
      where room_members.room_id = v_room.id and room_members.status = 'member'
        and room_members.last_seen_at > now() - interval '3 minutes';
    return query select v_room.status, v_room.id, v_room.code, v_member_count, v_room.capacity, v_room.lobby_expires_at;
    return;
  end if;

  select count(*) into v_member_count from public.room_members
    where room_members.room_id = v_room.id and room_members.status = 'member'
      and room_members.last_seen_at > now() - interval '3 minutes';

  if v_member_count = 0 then
    update public.rooms set closed_at = now() where id = v_room.id;
    return query select 'lobby'::text, v_room.id, v_room.code, 0, v_room.capacity, v_room.lobby_expires_at;
    return;
  end if;

  if not exists (
    select 1 from public.room_members
    where room_members.room_id = v_room.id and room_members.user_id = v_room.host_id and room_members.status = 'member'
  ) then
    select user_id into v_earliest from public.room_members
      where room_members.room_id = v_room.id and room_members.status = 'member' order by joined_at asc limit 1;
    update public.rooms set host_id = v_earliest where id = v_room.id;
  end if;

  if v_member_count >= v_room.capacity then
    update public.rooms
      set status = 'active', timer_running = true, timer_updated_at = now(), lobby_expires_at = null
      where id = v_room.id;
    return query select 'active'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, null::timestamptz;
    return;
  end if;

  if now() >= v_room.lobby_expires_at then
    if v_member_count >= 2 then
      update public.rooms
        set status = 'active', timer_running = true, timer_updated_at = now(), lobby_expires_at = null
        where id = v_room.id;
      return query select 'active'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, null::timestamptz;
      return;
    elsif v_member_count = 1 and not v_room.grace_extended then
      update public.rooms
        set lobby_expires_at = now() + interval '75 seconds', grace_extended = true
        where id = v_room.id;
      return query select 'lobby'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, now() + interval '75 seconds';
      return;
    else
      update public.rooms set status = 'expired', closed_at = now() where id = v_room.id;
      return query select 'expired'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, v_room.lobby_expires_at;
      return;
    end if;
  end if;

  return query select 'lobby'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, v_room.lobby_expires_at;
end;
$$;

-- ============================================================
-- 5. accept_room_invite (0016) — thêm guard + dọn lười + freshness filter capacity. Chữ ký
--    (status, room_code) giữ nguyên — status mới 'already_in_another_room' tái dùng cột
--    room_code sẵn có để trả về mã phòng KHÁC mà user đang ở (không phải phòng vừa mời).
-- ============================================================

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
  v_other record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.cleanup_stale_room_members();

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

  select * into v_other from public.find_other_active_room(v_room.id);
  if found then
    return query select 'already_in_another_room'::text, v_other.room_code;
    return;
  end if;

  select count(*) into v_member_count from public.room_members
    where room_id = v_room.id and status = 'member'
      and last_seen_at > now() - interval '3 minutes';
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

-- ============================================================
-- 6. create_room — RPC mới thay cho 2 insert riêng lẻ (rooms rồi room_members) mà Matching.tsx
--    đang làm thẳng từ client. Gộp guard + cả 2 insert vào 1 transaction — tiện thể tránh
--    trường hợp insert rooms xong mà insert room_members lỗi giữa chừng để lại phòng mồ côi
--    không ai làm host thật. Vẫn giữ cách sinh mã 6 ký tự + retry khi trùng ở phía client
--    (unique_violation propagate ra như insert cũ, client bắt y hệt qua error.code 23505).
-- ============================================================

create or replace function public.create_room(
  p_code text,
  p_name text,
  p_room_type text,
  p_duration_minutes int,
  p_break_minutes int,
  p_language text,
  p_capacity int,
  p_visibility text
)
returns table (status text, room_id uuid, room_code text, other_room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_other record;
  v_room_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  perform public.cleanup_stale_room_members();

  select * into v_other from public.find_other_active_room(null);
  if found then
    return query select 'already_in_another_room'::text, null::uuid, null::text, v_other.room_code;
    return;
  end if;

  insert into public.rooms (
    code, name, host_id, room_type, duration_minutes, break_minutes, language, capacity, visibility
  ) values (
    p_code, p_name, v_uid, p_room_type, p_duration_minutes, p_break_minutes, p_language, p_capacity, p_visibility
  )
  returning id into v_room_id;

  insert into public.room_members (room_id, user_id, status) values (v_room_id, v_uid, 'member');

  return query select 'created'::text, v_room_id, p_code, null::text;
end;
$$;

grant execute on function public.create_room(text, text, text, int, int, text, int, text) to authenticated;

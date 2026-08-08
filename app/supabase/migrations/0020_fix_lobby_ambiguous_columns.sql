-- Fix: find_or_create_lobby/finalize_lobby (0019) tham chiếu cột room_members.room_id và
-- room_members.status không kèm tên bảng — Postgres báo "column reference is ambiguous" vì
-- returns table(status, room_id, ...) khiến plpgsql tự tạo biến cục bộ trùng tên 2 cột đó,
-- đụng độ với cột thật của room_members trong WHERE. Phát hiện qua lỗi 500 thật khi user bấm
-- "Ghép ngẫu nhiên" lần đầu (0019 chưa từng test bằng tài khoản thật trước khi push).
-- Fix bằng cách gắn tiền tố room_members. vào mọi chỗ bị mập mờ — logic giữ nguyên 100%.

create or replace function public.find_or_create_lobby(
  p_duration_minutes int,
  p_language text
)
returns table (
  status text, room_id uuid, room_code text,
  member_count int, capacity int, lobby_expires_at timestamptz
)
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid;
  v_room_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_i int;
  v_already_member boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
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
           where m.room_id = r.id and m.status = 'member') < r.capacity
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

  -- Fix: room_id -> room_members.room_id (đụng biến OUT room_id của hàm này)
  select exists(
    select 1 from public.room_members
    where room_members.room_id = v_room_id and room_members.user_id = v_uid
  ) into v_already_member;

  if not v_already_member then
    insert into public.room_members (room_id, user_id, status) values (v_room_id, v_uid, 'member');
  end if;

  return query select * from public.finalize_lobby(v_room_id);
end;
$$;

create or replace function public.finalize_lobby(p_room_id uuid)
returns table (
  status text, room_id uuid, room_code text,
  member_count int, capacity int, lobby_expires_at timestamptz
)
language plpgsql
security definer
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
    -- Fix: room_id/status -> room_members.room_id/room_members.status (đụng biến OUT
    -- status/room_id của hàm này)
    select count(*) into v_member_count from public.room_members
      where room_members.room_id = v_room.id and room_members.status = 'member';
    return query select v_room.status, v_room.id, v_room.code, v_member_count, v_room.capacity, v_room.lobby_expires_at;
    return;
  end if;

  -- Fix: cùng lỗi như trên
  select count(*) into v_member_count from public.room_members
    where room_members.room_id = v_room.id and room_members.status = 'member';

  if v_member_count = 0 then
    update public.rooms set closed_at = now() where id = v_room.id;
    return query select 'lobby'::text, v_room.id, v_room.code, 0, v_room.capacity, v_room.lobby_expires_at;
    return;
  end if;

  -- Fix: cùng lỗi như trên (2 chỗ trong khối if này)
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

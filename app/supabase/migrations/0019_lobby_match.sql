-- FocusFlow — Giai đoạn 10 tiếp: thay ghép ngẫu nhiên "chờ đủ 5 mới tạo phòng, hàng chờ vô
-- hình" (0018, matching_queue + match_or_queue) bằng mô hình LOBBY hiện hình: user thấy ngay
-- 1 phòng đang hình thành và những ai đã vào, thay vì spinner trắng + số đếm ước lượng qua
-- poll 5s. Phòng lobby là 1 hàng `rooms` + `room_members` THẬT ngay từ đầu, không còn bảng
-- hàng chờ riêng biệt.
--
-- Không có pg_cron (free tier) nên việc "chốt" lobby (đủ 5 người, hoặc hết giờ ân hạn) được
-- kích hoạt LƯỜI bởi chính client: mỗi lần có người tạo/tham gia lobby (find_or_create_lobby)
-- VÀ mỗi khi 1 client đang ngồi trong lobby phát hiện đã quá lobby_expires_at (gọi thẳng
-- finalize_lobby từ quickMatch.ts) đều thử chốt — không đợi ai đó "đang xem" đúng khoảnh khắc
-- hết giờ. finalize_lobby dùng `for update` (không skip locked) vì nhiều lệnh gọi cùng lúc là
-- BÌNH THƯỜNG ở đây (mọi client trong lobby đều tự lên lịch gọi), nên lệnh gọi sau phải đợi
-- lệnh trước commit rồi đọc lại trạng thái đã chốt (no-op idempotent) thay vì bỏ qua.

-- ============================================================
-- 1. SCHEMA
-- ============================================================

-- Default hằng số nên add column backfill toàn bộ hàng cũ về 'active' trong cùng lệnh,
-- không cần UPDATE riêng.
alter table public.rooms
  add column if not exists status text not null default 'active'
    check (status in ('lobby', 'active', 'expired')),
  add column if not exists lobby_expires_at timestamptz,
  add column if not exists grace_extended boolean not null default false;

-- Tối đa 1 lobby đang mở cho mỗi (duration_minutes, language) tại một thời điểm — chốt chặn
-- concurrency chính cho race "2 người bấm ghép cùng lúc, cùng bộ lọc, tạo 2 lobby 1-người
-- song song thay vì thấy nhau". Lobby đã chốt (active/expired) hoặc đóng (closed_at) tự nhả
-- chỗ cho lobby mới của cùng tổ hợp.
create unique index if not exists rooms_open_lobby_unique_idx
  on public.rooms (duration_minutes, language)
  where status = 'lobby' and closed_at is null;

-- ============================================================
-- 2. FUNCTIONS
-- ============================================================

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

    -- 1) Tìm lobby đang mở còn chỗ, cũ nhất trước — for update skip locked cùng pattern với
    --    match_or_queue cũ: nếu 1 caller khác đang xử lý đúng hàng này thì bỏ qua thay vì
    --    chờ, để không nghẽn nhau.
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

    -- 2) Không có lobby nào khớp/lock được — thử tạo mới. Unique index (mục 1) đảm bảo chỉ 1
    --    lobby mở cho mỗi tổ hợp; nếu thua race tạo phòng, rơi vào unique_violation → quay
    --    lại bước 1 để tham gia đúng lobby người kia vừa tạo, thay vì tạo 2 lobby 1-người.
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

  -- Idempotent re-entry (double-click, hoặc gọi lại sau reconnect) — không insert trùng nếu
  -- đã là member của đúng lobby này.
  select exists(
    select 1 from public.room_members where room_id = v_room_id and user_id = v_uid
  ) into v_already_member;

  if not v_already_member then
    insert into public.room_members (room_id, user_id, status) values (v_room_id, v_uid, 'member');
  end if;

  -- Chốt luôn nếu vừa đủ 5, hoặc lobby này vốn đã hết giờ ân hạn từ trước khi ta join (VD
  -- người đến muộn join đúng lúc lobby hết hạn — cho họ "lọt" vào nhóm luôn thay vì bị hụt
  -- vì timing).
  return query select * from public.finalize_lobby(v_room_id);
end;
$$;

grant execute on function public.find_or_create_lobby(int, text) to authenticated;

-- Chuyển trạng thái lobby: đủ 5 → 'active'; hết giờ ân hạn mà ≥2 người → 'active' (không ai
-- bị ghép "ngồi 1 mình" — giữ đúng bất biến mà 0018 đã đặt ra); hết giờ mà đúng 1 người →
-- gia hạn thêm 1 lần (grace_extended) rồi mới 'expired' nếu vẫn chỉ 1 người; 0 người còn lại
-- (mọi người rời trước khi ai khác vào) → đóng bằng closed_at, không để lại "phòng ma".
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

  -- Đã chốt rồi (active/expired) hoặc đã đóng — idempotent no-op, trả trạng thái hiện tại.
  if v_room.status <> 'lobby' or v_room.closed_at is not null then
    select count(*) into v_member_count from public.room_members
      where room_id = v_room.id and status = 'member';
    return query select v_room.status, v_room.id, v_room.code, v_member_count, v_room.capacity, v_room.lobby_expires_at;
    return;
  end if;

  select count(*) into v_member_count from public.room_members
    where room_id = v_room.id and status = 'member';

  -- Mọi người đã rời trước khi kịp ai khác vào — đóng ngay (xem cancel() trong quickMatch.ts,
  -- người rời cuối cùng tự gọi finalize_lobby vì không còn ai khác ngồi đó để phát hiện).
  if v_member_count = 0 then
    update public.rooms set closed_at = now() where id = v_room.id;
    return query select 'lobby'::text, v_room.id, v_room.code, 0, v_room.capacity, v_room.lobby_expires_at;
    return;
  end if;

  -- Host ghi trong rooms.host_id đã rời lobby — chuyển cho người vào sớm nhất còn lại, để khi
  -- lobby chốt 'active' luôn có host hợp lệ điều khiển Pomodoro/nhạc.
  if not exists (
    select 1 from public.room_members
    where room_id = v_room.id and user_id = v_room.host_id and status = 'member'
  ) then
    select user_id into v_earliest from public.room_members
      where room_id = v_room.id and status = 'member' order by joined_at asc limit 1;
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
      -- Đúng 1 người, hết giờ lần đầu — cho thêm 1 lần ân hạn thay vì huỷ ngay, vì rất có
      -- thể có người thứ 2 chỉ vừa trễ vài giây.
      update public.rooms
        set lobby_expires_at = now() + interval '75 seconds', grace_extended = true
        where id = v_room.id;
      return query select 'lobby'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, now() + interval '75 seconds';
      return;
    else
      -- Vẫn chỉ 1 người sau khi đã gia hạn 1 lần — không ép ghép "1 mình", báo hết hạn rõ
      -- ràng để client hiện "chưa tìm được ai, thử lại" thay vì treo màn hình chờ mãi.
      update public.rooms set status = 'expired', closed_at = now() where id = v_room.id;
      return query select 'expired'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, v_room.lobby_expires_at;
      return;
    end if;
  end if;

  -- Chưa đủ, chưa hết giờ — vẫn đang mở.
  return query select 'lobby'::text, v_room.id, v_room.code, v_member_count, v_room.capacity, v_room.lobby_expires_at;
end;
$$;

grant execute on function public.finalize_lobby(uuid) to authenticated;

-- Join bằng mã tay vẫn có thể trúng đúng 1 lobby đang hình thành (ghép ngẫu nhiên) — thử
-- chốt luôn sau khi join, tránh phòng kẹt ở đủ capacity mà không ai chuyển 'active' được vì
-- không đi qua find_or_create_lobby.
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

  select * into v_existing from public.room_members
    where room_members.room_id = v_room.id and room_members.user_id = v_uid;
  if found then
    return query select 'already_joined'::text, v_room.id, v_existing.status;
    return;
  end if;

  select count(*) into v_member_count from public.room_members
    where room_members.room_id = v_room.id and room_members.status = 'member';
  if v_member_count >= v_room.capacity then
    return query select 'full'::text, v_room.id, null::text;
    return;
  end if;

  v_new_status := case when v_room.admit_mode = 'auto' then 'member' else 'pending' end;
  insert into public.room_members (room_id, user_id, status) values (v_room.id, v_uid, v_new_status);

  perform public.finalize_lobby(v_room.id);

  return query select 'joined'::text, v_room.id, v_new_status;
end;
$$;

-- ============================================================
-- 3. RETIRE matching_queue — find_or_create_lobby/finalize_lobby thay thế toàn bộ luồng ghép,
--    không còn ai gọi match_or_queue/matching_queue_stats. Dọn sạch thay vì để 2 cơ chế song
--    song (đã grep xác nhận không còn tham chiếu nào khác ngoài code phía client đang được
--    viết lại cùng migration này).
-- ============================================================

drop function if exists public.match_or_queue(int, text);
drop view if exists public.matching_queue_stats;
drop table if exists public.matching_queue;

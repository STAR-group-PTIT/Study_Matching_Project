-- 0018 — Ghép ngẫu nhiên chuyển từ ghép cặp (2 người) sang ghép nhóm cố định 5 người,
-- CHỜ ĐỦ 5 mới tạo phòng (không tạo phòng dở dang rồi để 1 người ngồi chờ mãi — trade-off
-- đã chốt với user: chấp nhận chờ lâu hơn khi vắng người, đổi lại không ai bị "ghép xong
-- ngồi 1 mình"). Loại phòng cũng cố định luôn 'chill' (cam/mic/nhạc tự do) — random match
-- giờ là để giao lưu, không còn cho chọn loại phòng nghiêm túc (hardcore/silent/...) như
-- trước; ai muốn phòng kiểu đó thì tự tạo/join qua danh sách phòng công khai (trang Matching
-- đã có filter riêng cho việc này, không cần nhân đôi qua random nữa).
--
-- Bỏ tham số p_room_type khỏi chữ ký (client không còn gửi lên, tránh tin client cho 1 giá
-- trị giờ đã cố định phía server) — match-room/index.ts (Edge Function) đổi theo tương ứng.

create or replace function public.match_or_queue(
  p_duration_minutes int,
  p_language text
)
returns table (status text, room_id uuid, room_code text)
language plpgsql
security definer
as $$
declare
  v_uid uuid := auth.uid();
  v_group_size constant int := 5;
  v_candidate_ids uuid[];
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

  -- Bắt tối đa (group_size - 1) người đang chờ lâu nhất, khoá đúng các dòng đó — cùng
  -- pattern `for update skip locked` an toàn concurrent như bản ghép cặp cũ (0011),
  -- chỉ khác limit 1 -> limit 4.
  select array_agg(user_id) into v_candidate_ids
  from (
    select user_id
    from public.matching_queue q
    where q.room_type = 'chill'
      and q.duration_minutes = p_duration_minutes
      and q.language = p_language
      and q.user_id <> v_uid
      and q.created_at > now() - interval '15 minutes'
    order by q.created_at asc
    for update skip locked
    limit v_group_size - 1
  ) sub;

  if coalesce(array_length(v_candidate_ids, 1), 0) = v_group_size - 1 then
    loop
      v_room_code := '';
      for v_i in 1..6 loop
        v_room_code := v_room_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1);
      end loop;
      exit when not exists (select 1 from public.rooms r where r.code = v_room_code);
    end loop;

    -- Người chờ lâu nhất trong nhóm làm host (v_candidate_ids đã theo thứ tự created_at asc
    -- từ subquery, array_agg giữ nguyên thứ tự đó) — cùng quy ước "người chờ trước thành
    -- host" như bản ghép cặp cũ.
    insert into public.rooms (code, name, host_id, room_type, duration_minutes, language, capacity, visibility, admit_mode)
    values (v_room_code, 'Phòng ghép ngẫu nhiên', v_candidate_ids[1], 'chill', p_duration_minutes, p_language, v_group_size, 'private', 'auto')
    returning id into v_room_id;

    insert into public.room_members (room_id, user_id, status)
    select v_room_id, uid, 'member' from unnest(v_candidate_ids || v_uid) as uid;

    -- Báo cho 4 người đang chờ (candidate) qua UPDATE dòng matching_queue của họ — họ đang
    -- lắng nghe Realtime, tự dọn dòng của mình sau khi nhận được (cùng cơ chế cũ, TTL 15
    -- phút vẫn là lưới an toàn nếu ai đó mất kết nối đúng lúc, không cần thêm gì mới).
    update public.matching_queue
    set matched_room_id = v_room_id, matched_room_code = v_room_code
    where user_id = any(v_candidate_ids);

    return query select 'matched'::text, v_room_id, v_room_code;
  else
    insert into public.matching_queue (user_id, room_type, duration_minutes, language)
    values (v_uid, 'chill', p_duration_minutes, p_language);

    return query select 'queued'::text, null::uuid, null::text;
  end if;
end;
$$;

-- Chữ ký hàm đã đổi (3 tham số -> 2) — drop bản cũ để khỏi tồn tại song song 2 overload
-- (1 cái chết, không ai gọi tới nữa vì Edge Function/client đã đổi theo bản mới).
drop function if exists public.match_or_queue(text, int, text);

-- 0011 — Ghost-proof the random-match queue (GĐ9 fix).
-- Two changes:
--   1. match_or_queue only pairs with waiting users who enqueued within the last
--      15 minutes. Anyone who clicked "Ghép ngẫu nhiên"/"Ghép ngay" and then closed
--      the tab leaves a queue row forever (no TTL, no cleanup job); that stale row
--      used to be picked up by the next real user → instantly "matched" into an
--      empty room ("phòng ảo"). An age filter makes stale rows harmless forever.
--   2. One-time cleanup of existing stale rows (idempotent, safe to re-run).
-- The queue still grows with abandoned rows over time, but they are invisible to
-- matching — no pg_cron needed on Supabase free tier.

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
    and q.created_at > now() - interval '15 minutes'
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

-- One-time sweep: clear queue rows abandoned more than 15 minutes ago.
delete from public.matching_queue where created_at < now() - interval '15 minutes';

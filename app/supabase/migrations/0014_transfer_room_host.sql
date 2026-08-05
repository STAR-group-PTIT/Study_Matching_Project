-- 0014 — Host leaving a room now has to choose: close the room, or hand it to someone
-- else (Giai đoạn 9 phần 6). Previously the host leaving just silently deleted their own
-- `room_members` row, leaving `rooms.host_id` pointing at someone who's gone — nobody
-- left in the room could control the Pomodoro or admit queue anymore ("mồ côi" room).
--
-- "Close room" is implemented as: delete every `room_members` row for that room (RLS
-- "room_members: delete by host" from 0001 already allows this) + stamp `closed_at`.
-- We deliberately do NOT delete the `rooms` row itself — `session_ratings`/`matching_queue`
-- reference it `on delete cascade`, so hard-deleting would also wipe out any ratings the
-- host just gave in the leave flow (SessionRating runs right before this). Keeping the row
-- around (just closed) needs `room_public_list` to stop listing it, and the join-request
-- policy to stop letting new people in — otherwise it becomes exactly the kind of ghost
-- row already fixed once for matching_queue (0011/0012).
--
-- "Transfer host" needs a new RPC: `update rooms set host_id = <someone else>` cannot be
-- done directly by the client because "rooms: update by host" (0001) only declares a
-- USING clause. Postgres defaults WITH CHECK to the same expression as USING for UPDATE
-- policies when none is given, so the *new* row would also have to satisfy
-- `host_id = auth.uid()` — which is false the moment you hand the room to someone else.
-- A security-definer RPC bypasses RLS and validates the same invariants by hand instead.

alter table public.rooms add column if not exists closed_at timestamptz;

create or replace view public.room_public_list as
select
  r.id, r.code, r.name, r.room_type, r.duration_minutes, r.language, r.capacity,
  p.name as host_name,
  (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'member') as member_count
from public.rooms r
join public.profiles p on p.id = r.host_id
where r.visibility = 'public' and r.closed_at is null;

grant select on public.room_public_list to anon, authenticated;

-- Chặn join (kể cả bằng mã) vào phòng đã đóng — trước đây policy chỉ kiểm tra
-- user_id = auth.uid(), không quan tâm phòng còn sống hay không.
drop policy if exists "room_members: insert self (join request)" on public.room_members;
create policy "room_members: insert self (join request)" on public.room_members
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.rooms r where r.id = room_id and r.closed_at is null)
  );

create or replace function public.transfer_room_host(target_room_id uuid, new_host_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current_host uuid;
  v_closed timestamptz;
  v_is_member boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select host_id, closed_at into v_current_host, v_closed from public.rooms where id = target_room_id;
  if v_current_host is null then
    raise exception 'room not found';
  end if;
  if v_closed is not null then
    raise exception 'room is closed';
  end if;
  if v_current_host <> v_uid then
    raise exception 'only the current host can transfer the room';
  end if;
  if new_host_id = v_uid then
    raise exception 'already the host';
  end if;

  select exists(
    select 1 from public.room_members
    where room_id = target_room_id and user_id = new_host_id and status = 'member'
  ) into v_is_member;
  if not v_is_member then
    raise exception 'target user is not a member of this room';
  end if;

  update public.rooms set host_id = new_host_id where id = target_room_id;
  -- Chủ cũ rời hẳn khỏi phòng (đúng ngữ nghĩa "Rời phòng" — không ở lại làm member
  -- thường), xoá luôn hàng room_members của họ trong cùng transaction.
  delete from public.room_members where room_id = target_room_id and user_id = v_uid;
end;
$$;

grant execute on function public.transfer_room_host(uuid, uuid) to authenticated;

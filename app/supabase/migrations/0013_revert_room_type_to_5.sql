-- 0013 — Revert room_type back to the original 5 types (Giai đoạn 9 phần 4).
-- 'free' and 'together' (added in 0010) are being dropped: they lived on a different
-- axis (session/timer structure) than the other 5 (cam/mic/music discipline rules), and
-- the app is going back to a simpler, single-axis room type list per user's decision.
-- Convert any existing rows first so the stricter constraint below never fails —
-- idempotent, safe to re-run.

update public.rooms set room_type = 'chill' where room_type in ('free', 'together');
update public.matching_queue set room_type = 'chill' where room_type in ('free', 'together');

alter table public.rooms drop constraint if exists rooms_room_type_check;
alter table public.rooms
  add constraint rooms_room_type_check
  check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch'));

alter table public.matching_queue drop constraint if exists matching_queue_room_type_check;
alter table public.matching_queue
  add constraint matching_queue_room_type_check
  check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch'));

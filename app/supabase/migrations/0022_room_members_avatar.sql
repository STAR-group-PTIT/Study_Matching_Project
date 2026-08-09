-- FocusFlow — Giai đoạn 10 (tiếp): room_members_view thiếu avatar_url nên tab Members/Manage
-- trong Room luôn hiện chữ cái đầu thay vì ảnh đại diện đã đổi ở Settings.
-- Run this in Supabase SQL Editor after 0021_avatars_storage.sql (safe to re-run any time).

create or replace view public.room_members_view as
select rm.id, rm.room_id, rm.user_id, rm.status, rm.joined_at, p.name, p.avatar_url
from public.room_members rm
join public.profiles p on p.id = rm.user_id
where public.is_room_participant(rm.room_id) or rm.user_id = auth.uid();

grant select on public.room_members_view to authenticated;

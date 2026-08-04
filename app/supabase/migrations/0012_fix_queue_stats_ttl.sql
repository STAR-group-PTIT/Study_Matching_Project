-- 0012 — Keep matching_queue_stats consistent with the 15-minute TTL.
-- The view previously counted EVERY queued row (matched_room_code is null) regardless
-- of age. match_or_queue (0011) only pairs with rows younger than 15 minutes, but the
-- view kept counting abandoned "ghost" rows forever, so the displayed "N người cũng
-- đang chờ" slowly drifted upward with no real waiters. Same age filter, same boundary
-- as 0011 — a single `create or replace` keeps the number truthful on every query
-- (no cron needed).

create or replace view public.matching_queue_stats as
select
  room_type,
  duration_minutes,
  language,
  count(*)::int as waiting_count
from public.matching_queue
where matched_room_code is null
  and created_at > now() - interval '15 minutes'
group by room_type, duration_minutes, language;

grant select on public.matching_queue_stats to anon, authenticated;

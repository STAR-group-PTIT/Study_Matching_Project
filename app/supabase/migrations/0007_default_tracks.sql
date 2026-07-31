-- FocusFlow — Nhạc mặc định cho phòng + nghe nhạc host chọn trong phòng
-- Run this in Supabase SQL Editor. Idempotent — an toàn chạy lại nhiều lần.

-- ============================================================
-- 1. tracks.is_default — track do chính chủ đánh dấu "dùng làm nhạc mặc định",
--    ai cũng xem/nghe được (không chỉ chủ track). Không có khái niệm admin riêng —
--    mỗi user tự quyết định track nào của mình public hoá thành mặc định chung.
-- ============================================================

alter table public.tracks add column if not exists is_default boolean not null default false;

-- helper: caller có đang là member thật (status='member') của 1 phòng mà host là
-- `owner_id` không? Dùng để cho phép cả phòng nghe track riêng (chưa đánh dấu default)
-- mà host đã chọn — đúng tinh thần "host chọn nhạc, cả phòng nghe" đã có từ Giai đoạn 5.
create or replace function public.shares_room_with_host(owner_id uuid)
returns boolean as $$
  select exists (
    select 1 from public.rooms r
    join public.room_members m on m.room_id = r.id
    where r.host_id = owner_id and m.user_id = auth.uid() and m.status = 'member'
  );
$$ language sql security definer stable;

-- tách policy "crud own" cũ thành 4 policy riêng — insert/update/delete vẫn chỉ chủ
-- track được làm (kể cả bật/tắt is_default, vì đó cũng chỉ là 1 update on chính row
-- của mình); select mở rộng thêm cho track mặc định + track của host phòng mình đang ở.
drop policy if exists "tracks: crud own" on public.tracks;

drop policy if exists "tracks: select own or shared" on public.tracks;
create policy "tracks: select own or shared" on public.tracks
  for select using (
    auth.uid() = user_id
    or is_default = true
    or public.shares_room_with_host(user_id)
  );

drop policy if exists "tracks: insert own" on public.tracks;
create policy "tracks: insert own" on public.tracks
  for insert with check (auth.uid() = user_id);

drop policy if exists "tracks: update own" on public.tracks;
create policy "tracks: update own" on public.tracks
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "tracks: delete own" on public.tracks;
create policy "tracks: delete own" on public.tracks
  for delete using (auth.uid() = user_id);

-- ============================================================
-- 2. storage.objects (bucket `tracks`) — cùng logic mở rộng ở phía file thật, vì
--    createSignedUrl() vẫn bị chặn bởi RLS của storage.objects dù bảng tracks đã
--    cho đọc metadata.
-- ============================================================

drop policy if exists "tracks: crud own" on storage.objects;
create policy "tracks: crud own" on storage.objects
  for all using (
    bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "tracks: read default" on storage.objects;
create policy "tracks: read default" on storage.objects
  for select using (
    bucket_id = 'tracks' and exists (
      select 1 from public.tracks tr
      where tr.storage_path = storage.objects.name and tr.is_default = true
    )
  );

drop policy if exists "tracks: read room host" on storage.objects;
create policy "tracks: read room host" on storage.objects
  for select using (
    bucket_id = 'tracks' and exists (
      select 1 from public.tracks tr
      where tr.storage_path = storage.objects.name
        and public.shares_room_with_host(tr.user_id)
    )
  );

-- ============================================================
-- 3. rooms — vị trí phát nhạc, để mọi client tự tính lại "đang phát tới giây thứ mấy"
--    bằng cách cộng thời gian trôi qua từ music_updated_at (đang running) hoặc đứng
--    yên tại music_position_seconds (đang pause) — cùng cơ chế elapsed-time đã dùng
--    cho timer_remaining_seconds/timer_updated_at ở Giai đoạn 5, không ghi DB liên tục.
-- ============================================================

alter table public.rooms add column if not exists music_updated_at timestamptz not null default now();
alter table public.rooms add column if not exists music_position_seconds numeric not null default 0;

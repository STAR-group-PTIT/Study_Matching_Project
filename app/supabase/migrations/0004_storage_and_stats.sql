-- FocusFlow — Giai đoạn 7: Storage buckets (wallpaper/nhạc) + completed_at cho todos
-- Run this in Supabase SQL Editor. Idempotent — an toàn chạy lại nhiều lần.

-- ============================================================
-- 1. STORAGE BUCKETS — private, mỗi user chỉ đọc/ghi trong thư mục của mình
--    Object path convention: `${auth.uid()}/${filename}`
-- ============================================================

insert into storage.buckets (id, name, public)
values ('wallpapers', 'wallpapers', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('tracks', 'tracks', false)
on conflict (id) do nothing;

drop policy if exists "wallpapers: crud own" on storage.objects;
create policy "wallpapers: crud own" on storage.objects
  for all using (
    bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'wallpapers' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "tracks: crud own" on storage.objects;
create policy "tracks: crud own" on storage.objects
  for all using (
    bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'tracks' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- 2. todos.completed_at — mốc thời gian hoàn thành thật, để Stats hiển thị
--    đúng ngày/giờ trong "Việc đã hoàn thành gần đây" (created_at là ngày tạo,
--    không phải ngày xong).
-- ============================================================

alter table public.todos add column if not exists completed_at timestamptz;

-- FocusFlow — Giai đoạn 10 (tiếp): storage bucket cho avatar tự upload.
-- Run this in Supabase SQL Editor after 0020_fix_lobby_ambiguous_columns.sql (safe to re-run any time).

-- Khác với wallpapers/tracks (private, đọc qua signed URL) — avatar_url được hiển thị thẳng
-- bằng <img src={p.avatar_url}> ở nhiều nơi (MatchFound, LobbyWaiting) cho CẢ những user khác
-- xem, không chỉ chủ sở hữu, nên bucket này phải public để URL không hết hạn.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Object path convention: `${auth.uid()}/${filename}` — chỉ chủ mới được ghi/xoá trong thư
-- mục của mình (đọc thì bucket public đã mở sẵn, không cần policy select riêng).
drop policy if exists "avatars: crud own" on storage.objects;
create policy "avatars: crud own" on storage.objects
  for all using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

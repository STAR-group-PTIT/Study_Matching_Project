-- FocusFlow — Nhạc nền qua link YouTube (bên cạnh nhạc thư viện đã có từ 0007)
-- Run this in Supabase SQL Editor. Idempotent — an toàn chạy lại nhiều lần.

-- 'library' = playlist mp3 đã có (mặc định + nhạc host tự upload); 'youtube' = host dán
-- link, phát qua YouTube IFrame Player API chính chủ (không tách audio, không vi phạm ToS).
alter table public.rooms add column if not exists music_source text not null default 'library' check (music_source in ('library', 'youtube'));
alter table public.rooms add column if not exists youtube_url text;

-- Không cần policy RLS mới: "rooms: update by host" (từ 0001) đã cho phép host ghi mọi
-- cột của rooms, bao gồm 2 cột mới này; member vẫn chỉ đọc qua Realtime như cũ.

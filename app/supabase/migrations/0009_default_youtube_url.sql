-- FocusFlow — cho phép mỗi tài khoản đặt link YouTube mặc định riêng cho nhạc nền solo
-- (Dashboard). Null = dùng DEFAULT_YOUTUBE_URL hardcode trong code.
-- Run this in Supabase SQL Editor (safe to re-run any time).

alter table public.profiles
  add column if not exists default_youtube_url text;

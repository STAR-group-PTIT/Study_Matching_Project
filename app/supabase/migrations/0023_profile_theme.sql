-- FocusFlow — Giai đoạn 10 (tiếp): dark mode. Lưu theme đã chọn theo tài khoản (đồng bộ
-- qua các thiết bị), giống accent_hue. Khách chưa đăng nhập chỉ lưu ở localStorage.
-- Run this in Supabase SQL Editor (safe to re-run any time).

alter table public.profiles
  add column if not exists theme text not null default 'light';

alter table public.profiles
  drop constraint if exists profiles_theme_check;
alter table public.profiles
  add constraint profiles_theme_check check (theme in ('light', 'dark'));

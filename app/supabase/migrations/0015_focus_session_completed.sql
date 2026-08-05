-- FocusFlow — đánh dấu 1 dòng focus_sessions là hoàn thành trọn vẹn (hết giờ tự nhiên)
-- hay chỉ là phần thời gian đã trôi qua trước khi bị Huỷ/Bỏ qua. Cần cho tab "Tiến độ"
-- kiểu GitHub contribution graph đếm đúng số Pomodoro đã hoàn thành theo loại (25:5/50:10)
-- thay vì đếm nhầm cả phiên bị huỷ giữa chừng.
-- Run this in Supabase SQL Editor (safe to re-run any time).

alter table public.focus_sessions
  add column if not exists completed boolean not null default false;

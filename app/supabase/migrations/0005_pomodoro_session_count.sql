-- FocusFlow — Pomodoro: số phiên tuỳ chỉnh (cá nhân + phòng) + break_minutes cho phòng
-- Run this in Supabase SQL Editor after 0001-0004 (safe to re-run any time).

-- Cá nhân: mỗi user chọn số phiên focus muốn chạy trước khi dừng hẳn (mặc định 4).
alter table public.profiles add column if not exists session_count int not null default 4;

-- Phòng: trước đây break luôn hardcode 5 phút phía client — giờ host chọn được, và
-- cũng cần session_count để biết khi nào cả phòng dừng hẳn (giống logic cá nhân).
-- timer_done: đánh dấu cả phòng đã học đủ session_count phiên — cần cột riêng (thay vì suy
-- ra từ timer_running=false) vì host cũng có thể tạm dừng (pause) giữa chừng, và tất cả
-- thành viên phải thấy đúng trạng thái "hoàn thành" qua Realtime, không chỉ host.
alter table public.rooms add column if not exists break_minutes int not null default 5;
alter table public.rooms add column if not exists session_count int not null default 4;
alter table public.rooms add column if not exists timer_done boolean not null default false;

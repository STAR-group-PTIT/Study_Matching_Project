-- FocusFlow — thêm 2 loại phòng mới: 'free' (Tự do — đồng hồ đếm tăng liên tục, không
-- chia phiên học/nghỉ) và 'together' (Đồng hành — mỗi người tự chạy Pomodoro riêng theo
-- cài đặt cá nhân, chỉ chia sẻ video/chat). Không cần cột mới — cả 2 loại đều dùng lại
-- các cột room hiện có (Room.tsx tự quyết định cách hiển thị theo room_type ở client),
-- chỉ cần nới check constraint. An toàn chạy lại nhiều lần.

alter table public.rooms drop constraint if exists rooms_room_type_check;
alter table public.rooms
  add constraint rooms_room_type_check
  check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch', 'free', 'together'));

alter table public.matching_queue drop constraint if exists matching_queue_room_type_check;
alter table public.matching_queue
  add constraint matching_queue_room_type_check
  check (room_type in ('chill', 'hardcore', 'silent', 'discuss', 'watch', 'free', 'together'));

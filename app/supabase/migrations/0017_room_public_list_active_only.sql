-- FocusFlow — Giai đoạn 10 (tiếp): danh sách "Phòng công khai" hiện cả phòng 0 thành viên
-- ("phòng ma"). Nguyên nhân: room_public_list (0014) chỉ lọc theo rooms.closed_at, nhưng
-- closed_at CHỈ được set khi host chủ động bấm "Rời phòng" → xác nhận đóng phòng (xem
-- 0014_transfer_room_host.sql). Nếu host chỉ đóng tab/mất mạng mà không qua luồng đó,
-- phòng rỗng vẫn nằm mãi trong danh sách công khai — đúng loại "ghost row" đã fix 1 lần
-- cho matching_queue (0011/0012), nhưng ở rooms thì không dùng TTL theo thời gian được vì
-- phòng hợp lệ có thể để mở rất lâu mà không ai vào lại vẫn là chuyện bình thường; điều
-- kiện đúng để ẩn khỏi danh sách là "hiện không còn ai" chứ không phải "đã lâu".
--
-- Fix: chỉ liệt kê phòng có ít nhất 1 room_members với status='member'. Đây là thay đổi
-- thuần view — không đụng tới dữ liệu rooms/room_members, nên các phòng rỗng đang hiện
-- (0/4) sẽ tự biến mất khỏi danh sách ngay sau khi chạy migration này, không cần xoá tay.
-- Nếu sau này có người join lại bằng đúng mã phòng, phòng đó tự xuất hiện lại trong danh
-- sách công khai (member_count > 0 trở lại).
create or replace view public.room_public_list as
select
  r.id, r.code, r.name, r.room_type, r.duration_minutes, r.language, r.capacity,
  p.name as host_name,
  (select count(*) from public.room_members m where m.room_id = r.id and m.status = 'member') as member_count
from public.rooms r
join public.profiles p on p.id = r.host_id
where r.visibility = 'public'
  and r.closed_at is null
  and exists (select 1 from public.room_members m where m.room_id = r.id and m.status = 'member');

grant select on public.room_public_list to anon, authenticated;

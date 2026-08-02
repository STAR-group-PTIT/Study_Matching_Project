# Nhạc nền built-in

Thả file nhạc vào thư mục này (`.mp3`, `.wav`, `.ogg`, hoặc `.m4a`) — không cần sửa code gì cả,
bài sẽ tự động xuất hiện trong popup "Nhạc nền" > tab Thư viện ở Dashboard cho **mọi tài khoản**
(kể cả khách chưa đăng nhập), xếp trước nhạc riêng của từng tài khoản (upload qua Settings).

- Đặt tên file có số thứ tự nếu muốn kiểm soát thứ tự hiển thị, vd `01-lofi-rain.mp3`,
  `02-piano-focus.mp3` (danh sách sắp xếp theo tên file). Tên hiển thị trong popup tự bỏ số thứ
  tự đứng trước và đuôi mở rộng — `01-lofi-rain.mp3` hiện thành `lofi-rain`.
- File nhạc này bundle thẳng vào app (tải ngay khi mở Dashboard), nên nên nén hợp lý, tránh file
  quá nặng (khuyến nghị dưới ~5-8 MB/bài).
- Cần chạy lại `npm run dev` (hoặc để Vite tự hot-reload) sau khi thêm file mới để thấy trong popup.

File trong thư mục này không tính vào thư viện nhạc riêng của từng tài khoản (mục "Nhạc của tôi" ở
Settings, upload qua UI, lưu Supabase Storage) — 2 nguồn được gộp chung lại khi hiển thị ở
Dashboard, nhưng built-in ở đây là chung cho tất cả, còn Settings vẫn là riêng từng người. Built-in
cũng không có nút "Đặt làm mặc định" (tính năng đó chỉ áp dụng cho nhạc upload qua Settings) vì bản
thân nó đã mặc định hiện cho mọi người rồi.

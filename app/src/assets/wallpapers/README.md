# Hình nền built-in

Thả file ảnh/video vào thư mục này (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, hoặc `.mp4`) — không
cần sửa code gì cả, sẽ tự động xuất hiện trong popup "Đổi hình nền" ở Dashboard cho **mọi tài
khoản** (kể cả khách chưa đăng nhập), xếp sau 6 hình gradient có sẵn. `.gif` chạy động (hoạt hình)
bình thường vì nền chỉ render qua CSS `background-image`; `.mp4` được render riêng bằng thẻ
`<video autoPlay loop muted>` (không gán được qua `background-image` như ảnh/gif).

- Đặt tên file có số thứ tự nếu muốn kiểm soát thứ tự hiển thị, vd `01-forest.jpg`, `02-cafe.mp4`
  (danh sách sắp xếp theo tên file).
- Khuyến nghị ảnh: ngang (16:9 hoặc tương tự), tối thiểu ~1600×900px để không bị vỡ hạt trên màn
  hình lớn, nhưng nên nén dưới ~500 KB/ảnh — ảnh này tải ngay khi mở app nên càng nhẹ càng tốt.
- Khuyến nghị video: ngắn (vài giây, loop mượt đầu-cuối), nén H.264, dưới ~3-5 MB — video nặng hơn
  ảnh nhiều nên cần nén kỹ hơn để không làm app tải chậm lúc mở.
- Cần chạy lại `npm run dev` (hoặc để Vite tự hot-reload) sau khi thêm file mới để thấy trong popup.

File trong thư mục này không tính vào thư viện wallpaper riêng của từng tài khoản (mục "Wallpaper
của tôi" ở Settings, upload qua UI, lưu Supabase Storage) — 2 nguồn được gộp chung lại khi hiển thị
ở Dashboard, nhưng built-in ở đây là chung cho tất cả, còn Settings vẫn là riêng từng người.

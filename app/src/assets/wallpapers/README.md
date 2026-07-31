# Hình nền built-in

Thả file ảnh vào thư mục này (`.jpg`, `.jpeg`, `.png`, hoặc `.webp`) — không cần sửa code gì cả,
ảnh sẽ tự động xuất hiện trong popup "Đổi hình nền" ở Dashboard cho **mọi tài khoản** (kể cả khách
chưa đăng nhập), xếp sau 6 hình gradient có sẵn.

- Đặt tên file có số thứ tự nếu muốn kiểm soát thứ tự hiển thị, vd `01-forest.jpg`, `02-cafe.jpg`
  (danh sách sắp xếp theo tên file).
- Khuyến nghị: ảnh ngang (16:9 hoặc tương tự), tối thiểu ~1600×900px để không bị vỡ hạt trên màn
  hình lớn, nhưng nên nén dưới ~500 KB/ảnh — ảnh này tải ngay khi mở app nên càng nhẹ càng tốt.
- Cần chạy lại `npm run dev` (hoặc để Vite tự hot-reload) sau khi thêm ảnh mới để thấy trong popup.

File trong thư mục này không tính vào thư viện wallpaper riêng của từng tài khoản (mục "Wallpaper
của tôi" ở Settings, upload qua UI, lưu Supabase Storage) — 2 nguồn được gộp chung lại khi hiển thị
ở Dashboard, nhưng built-in ở đây là chung cho tất cả, còn Settings vẫn là riêng từng người.

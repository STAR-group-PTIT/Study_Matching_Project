# FocusFlow — Implementation Plan

Nguồn thiết kế: [README.md](README.md) (handoff doc) + [design/](design/) (6 prototype `.dc.html` + canvas tổng).

## Stack đã chốt
- Frontend: **React + TypeScript + Tailwind CSS + Vite**
- State: **Zustand**
- Router: **react-router**
- i18n: **i18next** (vi mặc định, en sau)
- Chart: **Recharts**
- Backend/Infra: **Supabase** (Auth email+Google, Postgres, Realtime, Storage, Edge Functions)
- Video call: **LiveKit** (SFU service)

## Quyết định đã hỏi & chốt với user (2026-07-29)
- Backend: Supabase (thay vì tự viết Node/Express) — giảm công auth/DB/realtime.
- Video: LiveKit SDK (thay vì P2P mesh tự dựng) — ổn định hơn với phòng tới 12 người.

---

## Giai đoạn 0 — Khởi tạo nền tảng
- [ ] Scaffold Vite + React + TS
- [ ] Cấu hình Tailwind theo design tokens (màu OKLCH, spacing, radius, shadow, font Nunito/IBM Plex Mono)
- [ ] ESLint/Prettier
- [ ] react-router: `/auth`, `/`, `/matching`, `/room/:id`, `/stats`, `/settings`
- [ ] i18next skeleton (vi mặc định)
- [ ] Git init + commit đầu tiên
- [ ] Tạo project Supabase (lấy URL + anon key, chưa cần schema)

## Giai đoạn 1 — Dựng UI tĩnh pixel-perfect (mock data) ✅ Hoàn tất 2026-07-29
Đối chiếu từng file `.dc.html` tương ứng, dựng bằng React component + Tailwind, dùng mock data cứng. Tất cả đã có state/logic client-side đầy đủ (không chỉ tĩnh) — xem chi tiết ở CONTEXT.md:
- [x] Auth (`design/FocusFlow Auth.dc.html`) → [app/src/routes/Auth.tsx](app/src/routes/Auth.tsx)
- [x] Dashboard (`design/FocusFlow.dc.html`) → [app/src/routes/Dashboard.tsx](app/src/routes/Dashboard.tsx)
- [x] Matching — 3 state filters/searching/rooms + modal tạo phòng (`design/FocusFlow Matching.dc.html`) → [app/src/routes/Matching.tsx](app/src/routes/Matching.tsx)
- [x] Study Room — video grid, Pomodoro nổi, panel phải 3 tab, control bar (`design/FocusFlow Room.dc.html`) → [app/src/routes/Room.tsx](app/src/routes/Room.tsx)
- [x] Stats — KPI, bar chart, heatmap, to-do list (`design/FocusFlow Stats.dc.html`) → [app/src/routes/Stats.tsx](app/src/routes/Stats.tsx)
- [x] Settings — profile, wallpaper grid, nhạc, slider Pomodoro (`design/FocusFlow Settings.dc.html`) → [app/src/routes/Settings.tsx](app/src/routes/Settings.tsx)

## Giai đoạn 2 — Logic & state phía client
- [ ] Pomodoro timer (setInterval, phase focus↔break, session count, cleanup)
- [ ] Fade transitions giữa state trong màn (200ms + translateY 8px)
- [ ] Panel trượt (440ms cubic-bezier(0.22,1,0.36,1))
- [ ] Zustand store: Dashboard state, Matching state, Room state (theo bảng State Management trong README)
- [ ] To-do CRUD local, đổi wallpaper/nhạc local

## Giai đoạn 3 — Supabase Auth & schema ✅ Hoàn tất 2026-07-29
- [x] Bật Auth email + Google OAuth
- [x] Schema: `profiles`, `todos`, `focus_sessions`, `rooms`, `room_members`, `room_messages`, `tracks`, `wallpapers`
- [x] RLS policies theo user/room membership
- [x] Nối màn Auth thật + route guard theo session (guard áp dụng `/stats`, `/settings`; `/`, `/matching`, `/room/:id` vẫn cho khách dùng được)
- [x] (thêm ngoài kế hoạch, làm sớm vì đã có Auth) Nối Dashboard to-do + Settings profile/Pomodoro defaults với dữ liệu thật

## Giai đoạn 4 — Matching & quản lý phòng ✅ Code xong 2026-07-29, chờ user chạy migration + deploy Edge Function
- [x] Tạo phòng (mã 6 ký tự, capacity, public/private)
- [x] Danh sách phòng công khai, join theo mã
- [x] Ghép ngẫu nhiên (matching queue, qua Edge Function `match-room`)
- [x] Chế độ duyệt auto/manual, hàng chờ, kick (Supabase Realtime Postgres changes)

## Giai đoạn 5 — Đồng bộ realtime trong phòng ✅ Verify xong bằng test thật 2 tài khoản 2026-07-30
- [x] Pomodoro đồng bộ (host = nguồn thời gian, broadcast)
- [x] Chat realtime
- [x] Trạng thái nhạc đồng bộ theo phòng (host điều khiển phát, member chỉnh volume riêng) — **đổi lại thành nhạc hoàn toàn cá nhân ở Giai đoạn 8 (phần 9)**, xem CONTEXT.md
- [x] Presence (ai đang online trong phòng)

## Giai đoạn 6 — Video call (LiveKit) ✅ Code xong 2026-07-30, chờ user tạo project LiveKit + deploy
- [x] Edge Function cấp token LiveKit theo room/user
- [x] Tích hợp LiveKit SDK (`livekit-client`, không dùng `@livekit/components-react` vì UI đã tự dựng pixel-perfect từ GĐ1) vào lưới video đã dựng ở GĐ1
- [x] Toggle cam/mic thật, badge trạng thái theo track state thật

## Giai đoạn 7 — Stats, Settings, Storage ✅ Hoàn tất + verify xong 2026-07-30
- [x] Tính KPI thật từ `focus_sessions`
- [x] Upload wallpaper/nhạc lên Supabase Storage
- [x] Lưu Pomodoro defaults vào `profiles` (đã làm sớm ở GĐ3; GĐ7 nối tiếp: Dashboard giờ thực sự dùng các giá trị đó cho timer)

## Giai đoạn 8 — Responsive, polish, deploy
- [x] Bottom sheet cho panel phải trên mobile — xong 2026-07-30
- [x] QA toàn luồng: Auth → Dashboard → Matching → Room → Rời phòng → Stats/Settings — xong 2026-07-30 (phát hiện + fix thêm vài lỗi tràn màn hình mobile ngoài kế hoạch, xem CONTEXT.md)
- [ ] Deploy frontend (Vercel/Netlify) + Supabase production — **frontend đã chuẩn bị xong** (`vercel.json`, `main` đồng bộ, 2026-07-31), còn thiếu: user tự tạo project Vercel + set env vars, và quyết định Supabase production
- [x] Kiểm tra i18n vi/en đầy đủ — xong 2026-07-30 (chi tiết CONTEXT.md)
- [x] (thêm ngoài kế hoạch) Settings 2 tab (Hồ sơ/Cài đặt), accent color preset, camera/mic mặc định, âm thanh hết giờ — xong 2026-07-31
- [x] (thêm ngoài kế hoạch) Hình nền built-in gộp với thư viện riêng — xong 2026-07-31
- [x] (thêm ngoài kế hoạch) Nhạc nền thật — thư viện mp3 (mặc định + riêng từng người) và YouTube (Room đồng bộ cả phòng + Dashboard solo) — xong 2026-07-31, xem CONTEXT.md "Giai đoạn 8 (phần 7)" (**nhạc trong Room đổi lại thành cá nhân ở phần 9, không đồng bộ cả phòng nữa**)
- [x] (thêm ngoài kế hoạch) Sửa bug nhạc nền Dashboard (mất nhạc khi chuyển tab Thư viện/YouTube, camera tự bật lại, YouTube mất link mặc định), thư viện nhạc built-in (`assets/music`), mini-player + âm lượng trên main UI, Settings đổi từ route sang overlay — xong 2026-08-02, xem CONTEXT.md "Giai đoạn 8 (phần 8)"
- [x] (thêm ngoài kế hoạch) Matching layout 2 cột (room list + filters sticky), lọc/phân trang room list, Room nhạc cá nhân hoá, bỏ "Số phiên" khỏi tạo/ghép phòng — xong 2026-08-03, xem CONTEXT.md "Giai đoạn 8 (phần 9)"
- [x] (thêm ngoài kế hoạch) Bỏ free-drag slider thời lượng (chỉ 2 preset), thêm loại phòng "Tự do" (đồng hồ đếm tăng) và "Đồng hành" (Pomodoro cá nhân riêng từng người) — xong 2026-08-03 (**2 loại này bị bỏ lại ở Giai đoạn 9 phần 4, quay về đúng 5 loại gốc**, xem CONTEXT.md "Giai đoạn 8 (phần 10)")
- [x] (thêm ngoài kế hoạch) Popup chọn loại phòng thay hàng chip (7 loại giờ gọn thành 1 nút + popup) — xong 2026-08-03, xem CONTEXT.md "Giai đoạn 8 (phần 11)"

## Giai đoạn 9 — "Match experience" & polish sau đó (ngoài kế hoạch gốc, bắt đầu 2026-08-03)
- [x] Match experience: card profile sau khi ghép (MatchFound), rating cảm ơn bạn cùng học, nút "Ghép ngay" 1-chạm, màn kiểm tra cam/mic (DeviceCheck), CI/CD + test tự động — xong 2026-08-03, xem CONTEXT.md "Giai đoạn 9"
- [x] Fix ghost queue (TTL 15 phút), dọn dữ liệu test, responsive 3 overlay mới, trả lại lối vào Matching thủ công — xong 2026-08-03, xem CONTEXT.md "Giai đoạn 9 (phần 2)"
- [x] Fix số "N người đang chờ" sai (đếm cả row hết hạn + đếm cả chính mình) — xong 2026-08-04, xem CONTEXT.md "Giai đoạn 9 (phần 3)"
- [x] Bỏ loại phòng "Tự do"/"Đồng hành" (theo góp ý giảng viên, quay về đúng 5 loại gốc), enforce thật luật cam/mic/nhạc theo từng loại phòng (trước chỉ là text mô tả) — xong 2026-08-04, xem CONTEXT.md "Giai đoạn 9 (phần 4)"
- [x] Nhạc trong Room lên ngang bằng Dashboard (thư viện built-in dùng chung `musicLibrary.ts`, YouTube 3 tầng ưu tiên) — xong 2026-08-04, xem CONTEXT.md "Giai đoạn 9 (phần 5)"
- [x] Room: thẻ mã phòng, bỏ hiển thị số phiên ở Pomodoro chung, host rời phòng phải chọn đóng phòng hoặc chuyển quyền chủ — xong 2026-08-05, xem CONTEXT.md "Giai đoạn 9 (phần 6)" — **user cần chạy migration `0014_transfer_room_host.sql`**
- [x] Fix bug nhạc Thư viện tự tắt khi chỉ xem (chưa chốt) tab YouTube, thêm điều khiển thật (trước/sau/tua) vào tab Nhạc > Thư viện — xong 2026-08-05, xem CONTEXT.md "Giai đoạn 9 (phần 7)"
- [x] Fix bug phải bấm 2 lần nhạc Thư viện mới chạy khi mới vào phòng (autoplay bị trình duyệt chặn nhưng state không đồng bộ lại) — xong 2026-08-05, xem CONTEXT.md "Giai đoạn 9 (phần 8)"
- [x] Tab "Tiến độ" kiểu GitHub contribution graph (thời gian học + Pomodoro 25:5/50:10 đã hoàn thành theo ngày/năm) + thêm entry point "Thống kê" ở Dashboard — xong 2026-08-05, xem CONTEXT.md "Giai đoạn 9 (phần 9)"
- [x] Polish theo góp ý user: gộp "Tiến độ" vào "Tổng quan" thành 1 view, màu lưới đổi sang oklch bão hoà cao hơn, biến toàn bộ Stats từ route `/stats` thành popup mở từ Dashboard (đúng pattern Settings) — xong 2026-08-05, xem CONTEXT.md "Giai đoạn 9 (phần 10)"
- [x] Polish đồng hồ Pomodoro (ẩn nút mũi tên khi không hover, sửa lệch tâm Work/Break), bỏ bar chart tuần ở Stats (trùng `ContributionGraph`), nút "Thống kê" thành icon cạnh Cài đặt, khung video YouTube co giãn theo màn hình, gộp player Thư viện + YouTube thành 1 widget thu gọn/mở rộng có điều khiển thật (play/pause/mute/volume) — xong 2026-08-06, xem CONTEXT.md "Giai đoạn 9 (phần 11)"
- [x] Sửa lại panel nhạc nền: không tự đóng về icon khi đổi nguồn (hiểu nhầm yêu cầu ở phần 11) + thêm tự mở panel khi đổi nguồn lúc đang thu gọn — xong 2026-08-06, xem CONTEXT.md "Giai đoạn 9 (phần 12)"
- [x] Polish Dashboard theo loạt góp ý user: gom rồi bỏ hẳn Hide UI/VI-EN khỏi top bar, camera chuyển vị trí 2 lần (cột phải riêng → icon ngang hàng Stats/Settings → không tự ẩn/mất khi bật), nổi bật link "Duyệt phòng thủ công"; sửa bug nhạc YouTube bị chặn autoplay im lặng; wallpaper hỗ trợ GIF động + video MP4 (kèm tự resize ảnh tĩnh khi upload, sửa bug video giải mã trùng lặp/đứng hình) — xong 2026-08-06, xem CONTEXT.md "Giai đoạn 9 (phần 13)"
- [x] Pomodoro tự ẩn UI + fullscreen khi bấm Bắt đầu (toggle mới ở Settings), sửa bug wallpaper/nhạc mới upload ở Settings không hiện ngay ở Dashboard (thiếu refetch khi đóng overlay) — xong 2026-08-07, xem CONTEXT.md "Giai đoạn 9 (phần 14)"

## Giai đoạn 10 — Hệ thống kết bạn (ngoài kế hoạch gốc, bắt đầu 2026-08-07)
- [x] Handle `username#tag` cố định mỗi tài khoản (cột `profiles.tag`, unique theo cặp `(name, tag)`) — code xong 2026-08-07, **user cần chạy migration `0016_friends.sql`**
- [x] Kết bạn 2 chiều: tìm theo đúng handle, gửi/chấp nhận/từ chối/huỷ lời mời, danh sách bạn bè (panel "Bạn bè" mở từ icon taskbar mới) — xem CONTEXT.md "Giai đoạn 10"
- [x] Mời bạn bè vào thẳng room đang học, bỏ qua duyệt của host khi bạn đó đồng ý (vẫn check sức chứa phòng) — xem CONTEXT.md "Giai đoạn 10"
- [x] Tab "Thành viên" trong Room (mọi người xem được, khác tab "Quản lý" chỉ host) — badge chủ phòng + nút kết bạn ngay tại đó — xem CONTEXT.md "Giai đoạn 10"
- [ ] User chạy migration `0016_friends.sql` + tự test luồng 2 chiều thật với ≥2 tài khoản

---
Xem tiến độ & quyết định chi tiết trong [CONTEXT.md](CONTEXT.md).

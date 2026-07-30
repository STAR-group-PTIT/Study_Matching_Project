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

## Giai đoạn 5 — Đồng bộ realtime trong phòng ✅ Code xong 2026-07-29, chờ user chạy migration 0003
- [x] Pomodoro đồng bộ (host = nguồn thời gian, broadcast)
- [x] Chat realtime
- [x] Trạng thái nhạc đồng bộ (host điều khiển phát, member chỉnh volume riêng)
- [x] Presence (ai đang online trong phòng)

## Giai đoạn 6 — Video call (LiveKit)
- [ ] Edge Function cấp token LiveKit theo room/user
- [ ] Tích hợp LiveKit React SDK vào lưới video đã dựng ở GĐ1
- [ ] Toggle cam/mic thật, badge trạng thái theo track state thật

## Giai đoạn 7 — Stats, Settings, Storage
- [ ] Tính KPI thật từ `focus_sessions`
- [ ] Upload wallpaper/nhạc lên Supabase Storage
- [ ] Lưu Pomodoro defaults vào `profiles`

## Giai đoạn 8 — Responsive, polish, deploy
- [ ] Bottom sheet cho panel phải trên mobile
- [ ] QA toàn luồng: Auth → Dashboard → Matching → Room → Rời phòng → Stats/Settings
- [ ] Deploy frontend (Vercel/Netlify) + Supabase production
- [ ] Kiểm tra i18n vi/en đầy đủ

---
Xem tiến độ & quyết định chi tiết trong [CONTEXT.md](CONTEXT.md).

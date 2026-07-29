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

## Giai đoạn 1 — Dựng UI tĩnh pixel-perfect (mock data)
Đối chiếu từng file `.dc.html` tương ứng, dựng bằng React component + Tailwind, dùng mock data cứng:
- [ ] Auth (`design/FocusFlow Auth.dc.html`)
- [ ] Dashboard (`design/FocusFlow.dc.html`)
- [ ] Matching — 3 state filters/searching/rooms + modal tạo phòng (`design/FocusFlow Matching.dc.html`)
- [ ] Study Room — video grid, Pomodoro nổi, panel phải 3 tab, control bar (`design/FocusFlow Room.dc.html`)
- [ ] Stats — KPI, bar chart, heatmap, to-do list (`design/FocusFlow Stats.dc.html`)
- [ ] Settings — profile, wallpaper grid, nhạc, slider Pomodoro (`design/FocusFlow Settings.dc.html`)

## Giai đoạn 2 — Logic & state phía client
- [ ] Pomodoro timer (setInterval, phase focus↔break, session count, cleanup)
- [ ] Fade transitions giữa state trong màn (200ms + translateY 8px)
- [ ] Panel trượt (440ms cubic-bezier(0.22,1,0.36,1))
- [ ] Zustand store: Dashboard state, Matching state, Room state (theo bảng State Management trong README)
- [ ] To-do CRUD local, đổi wallpaper/nhạc local

## Giai đoạn 3 — Supabase Auth & schema
- [ ] Bật Auth email + Google OAuth
- [ ] Schema: `profiles`, `todos`, `focus_sessions`, `rooms`, `room_members`, `room_messages`, `tracks`, `wallpapers`
- [ ] RLS policies theo user/room membership
- [ ] Nối màn Auth thật + route guard theo session

## Giai đoạn 4 — Matching & quản lý phòng
- [ ] Tạo phòng (mã 6 ký tự, capacity, public/private)
- [ ] Danh sách phòng công khai, join theo mã
- [ ] Ghép ngẫu nhiên (matching queue)
- [ ] Chế độ duyệt auto/manual, hàng chờ, kick (Supabase Realtime Postgres changes)

## Giai đoạn 5 — Đồng bộ realtime trong phòng
- [ ] Pomodoro đồng bộ (host = nguồn thời gian, broadcast)
- [ ] Chat realtime
- [ ] Trạng thái nhạc đồng bộ (host điều khiển phát, member chỉnh volume riêng)
- [ ] Presence (ai đang online trong phòng)

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

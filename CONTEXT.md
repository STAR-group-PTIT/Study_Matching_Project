# FocusFlow — Context & Progress Log

Theo dõi tiến độ, quyết định kỹ thuật, và những gì đã/chưa làm. Đọc kèm [PLAN.md](PLAN.md) và [README.md](README.md).

## Trạng thái hiện tại
**Giai đoạn đang làm:** Giai đoạn 3 (Supabase Auth & schema) — đã chuẩn bị xong schema/RLS + code kết nối, **đang chờ user tạo project Supabase và cung cấp URL + anon key** trước khi nối Auth thật vào màn Auth.tsx.

## Nhật ký
- **2026-07-29** — Đọc README.md + toàn bộ design/*.dc.html, thống nhất plan 9 giai đoạn (0-8) với user. Chốt stack: React+TS+Tailwind+Vite, Supabase, LiveKit. Tạo PLAN.md + CONTEXT.md.
- **2026-07-29** — Hoàn tất Giai đoạn 0:
  - Scaffold Vite + React 19 + TS tại `app/` (template mới dùng **oxlint** thay ESLint mặc định — giữ nguyên, nhanh hơn).
  - Tailwind **v4** dùng `@tailwindcss/vite` plugin (không cần postcss/config file riêng) — design tokens định nghĩa trong `app/src/index.css` qua `:root` + `@theme inline` (map sang `--color-*`, `--radius-*`, `--shadow-*`, `--font-*`). Đã test: font Nunito, `text-primary #2c3f55`, `page-bg #eef6f8` render đúng.
  - react-router 6 route (`/auth`, `/`, `/matching`, `/room/:id`, `/stats`, `/settings`) với placeholder page, test điều hướng OK.
  - i18next skeleton: `vi` (default) + `en`, namespace `common`, resource JSON tại `app/src/i18n/locales/`.
  - Prettier + `prettier-plugin-tailwindcss` (không dấu `;`, single quote).
  - Git repo khởi tạo tại project root (không phải trong `app/`), `.gitignore` loại `node_modules`/`dist`/`.env`. Commit đầu tiên: `4561912`.
  - Tạo `.claude/launch.json` (config `focusflow-app`, `npm run dev --prefix app`, port 5173) để dùng Browser preview sau này.
  - **Lưu ý:** `npm audit` báo 2 high severity trên `react-router-dom@7.18.2` (GHSA-qwww-vcr4-c8h2 — CSRF bypass trong **RSC Mode**). Không áp dụng vì dự án là Vite SPA thuần, không dùng RSC. Không downgrade (bản fix là hạ về 7.11.0, cũ hơn). Theo dõi lại khi có bản vá mới trong 7.x.
- **2026-07-29** — Giai đoạn 1 (đang làm), đã xong 2/6 màn:
  - **Auth** ([app/src/routes/Auth.tsx](app/src/routes/Auth.tsx)) — test tab login/signup, toggle hiện mật khẩu, đều hoạt động đúng, khớp thiết kế.
  - **Dashboard** ([app/src/routes/Dashboard.tsx](app/src/routes/Dashboard.tsx)) — đồng hồ Pomodoro (setInterval + phase focus/break tự chuyển), Ẩn UI, Focus/Dashboard mode, camera toggle, 3 popup (wallpaper/nhạc/to-do), to-do CRUD local. Timer dùng pattern: 1 effect đếm giây (ref để tránh stale closure với `running`), 1 effect riêng theo dõi đổi `phase` để set lại `left` đúng theo tổng giây phase mới (tránh nhấp nháy giá trị sai khi chuyển phase). Pattern timer này lặp lại y hệt ở Room.tsx.
  - **Matching** ([app/src/routes/Matching.tsx](app/src/routes/Matching.tsx)) — 3 state (filters/searching/rooms) chuyển bằng fade 200ms, modal tạo phòng sinh mã 6 ký tự ngẫu nhiên + copy clipboard (timeout 1.8s reset label), danh sách phòng công khai mock với phòng đầy bị disable. Nút "Tham gia"/"Vào phòng" điều hướng sang `/room/:id` (id tạm là tên phòng/mã phòng, chưa có backend thật).
  - **Study Room** ([app/src/routes/Room.tsx](app/src/routes/Room.tsx)) — màn phức tạp nhất: lưới video tự tính `cols/rows` theo `Math.ceil(Math.sqrt(n))`, panel phải 3 tab (chat/nhạc/quản lý — quản lý chỉ hiện khi `IS_HOST=true`, hardcode), toggle demo 2/5 người đổi lại `members` mock, hàng chờ duyệt + kick. `IS_HOST` là hằng số hardcode true, cần thay bằng giá trị thật khi có backend room membership.
  - **Stats** ([app/src/routes/Stats.tsx](app/src/routes/Stats.tsx)) — dựng bằng div thuần (không dùng Recharts) vì file thiết kế gốc cũng chỉ dùng CSS bar/grid, không phải chart library thật — pixel-perfect hơn là ép Recharts vào shape tuỳ biến này. Recharts vẫn có trong `package.json` cho nhu cầu chart phức tạp hơn sau này nếu cần. Heatmap 12 tuần dùng hàm density giả-ngẫu-nhiên xác định (deterministic pseudo-random) y hệt bản gốc để mock data ổn định giữa các lần render.
  - **Settings** ([app/src/routes/Settings.tsx](app/src/routes/Settings.tsx)) — wallpaper grid + nhạc list CRUD local, 2 slider Pomodoro dùng class CSS riêng `ff-range-lg` (thumb 24px, khác `ff-range` 18px dùng ở Room cho slider volume). Toggle "tự động bắt đầu phiên" tự viết switch component (không dùng input checkbox) để khớp pixel thiết kế.
  - Tất cả 6 màn đã test tương tác qua browser preview (state transitions, popup/modal, toggle, timer) — xem mục "Lưu ý công cụ" bên dưới về cách test đáng tin cậy.
  - **Việc còn để mock/hardcode, cần thay khi nối backend:** accent color (hardcode preset mint `--ff-accent`, chưa có 4-preset switcher như thiết kế đề cập), `IS_HOST` ở Room, tên phòng dùng làm room id tạm, toàn bộ dữ liệu (tasks, messages, members, tracks, wallpapers, stats) đều là mock cứng trong từng component, chưa có i18n thật (dùng chuỗi tiếng Việt cứng dù đã setup i18next skeleton ở GĐ0).

## Quyết định kỹ thuật quan trọng
| Quyết định | Lý do | Ngày |
|---|---|---|
| Supabase thay vì Node/Express tự viết | Có sẵn Auth, Realtime, Storage — giảm ~60% công backend | 2026-07-29 |
| LiveKit thay vì P2P mesh (simple-peer) | Ổn định hơn cho phòng tới 12 người, đỡ lo TURN/NAT | 2026-07-29 |
| Không port `support.js` | README ghi rõ đây chỉ là runtime cho prototype chạy, không cần cho production | — |

## Ghi chú kỹ thuật khi đọc file `.dc.html`
- Markup trong `<x-dc>`, logic trong `class Component extends DCLogic { state, renderVals() }`.
- `renderVals()` trả về giá trị markup dùng qua `{{ }}`.
- `<sc-for list as>` = `.map()`, `<sc-if value>` = render có điều kiện.
- Style inline camelCase = tương đương React style object.

## Design tokens tóm tắt (xem đầy đủ ở README.md#design-tokens)
- Accent mint: `oklch(0.74 0.085 195)` — biến cấu hình, 4 preset màu (195 mint / 235 xanh dương / 170 xanh lá / 260 tím)
- Page bg: `#eef6f8`; gradient nền Auth/Matching/Room: `linear-gradient(160deg, #dff1f4 0%, #cfe6f2 45%, #e6f4ee 100%)`
- Font: Nunito (400-800), mono: IBM Plex Mono (webcam placeholder only)
- Radius: chip/nút nhỏ 14-19px, input 18-20px, card 24-26px, panel lớn 30-34px, pill 999px
- Easing: `cubic-bezier(0.22,1,0.36,1)` cho chuyển động

## Lưu ý công cụ (tooling quirk)
- Browser pane preview (`mcp__Claude_Browser__resize_window`) có bug: sau khi resize viewport (vd 1280x800), `computer` click theo toạ độ pixel và `screenshot` không đồng bộ với kích thước mới (chỉ vẽ/nhận click đúng trong vùng ~viewport mặc định ban đầu, phần còn lại "chết"). **Không phải lỗi code.** Đã verify bằng `getBoundingClientRect()` qua `javascript_tool` — layout DOM luôn đúng 100%. Cách kiểm tra tin cậy khi cần verify UI ở kích thước lớn: dùng `javascript_tool` để `.click()` trực tiếp lên element + đọc `getComputedStyle`/`getBoundingClientRect`, thay vì dựa vào `computer` coordinate-click hay `screenshot` sau resize.

## Giai đoạn 3 — chuẩn bị xong, chờ key thật
- **2026-07-29** — Đã viết sẵn (chưa chạy được vì chưa có project thật):
  - [app/supabase/migrations/0001_init.sql](app/supabase/migrations/0001_init.sql) — schema đầy đủ: `profiles` (+ trigger tự tạo khi signup), `todos`, `focus_sessions`, `wallpapers`, `tracks`, `rooms`, `room_members`, `room_messages`, RLS cho từng bảng, hàm helper `is_room_participant()`, bật Realtime cho `rooms`/`room_members`/`room_messages`.
  - [app/src/lib/supabase.ts](app/src/lib/supabase.ts) — client init từ `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, throw lỗi rõ ràng nếu thiếu env.
  - [app/.env.example](app/.env.example) — template biến môi trường.
  - [app/src/vite-env.d.ts](app/src/vite-env.d.ts) — type augmentation cho `import.meta.env`.
- **Đang chờ user:** tạo project tại supabase.com, dán URL + anon key vào `app/.env` (copy từ `.env.example`, file này đã nằm trong `.gitignore`). Sau khi có key: chạy migration SQL trong Supabase SQL Editor, bật Google OAuth provider trong Authentication → Providers, rồi mình sẽ nối màn Auth.tsx với `supabase.auth.signInWithPassword`/`signInWithOAuth` thật.

## Việc cần quyết định sau (chưa chốt)
- Chọn provider Google OAuth cụ thể (credentials) — cần user cung cấp khi tới Giai đoạn 3.
- Chọn plan LiveKit (Cloud free tier vs self-host) — quyết định khi tới Giai đoạn 6.
- Domain/hosting production — quyết định khi tới Giai đoạn 8.

## Cấu trúc thư mục dự kiến (sau Giai đoạn 0)
```
Study_Matching/
  design/              (giữ nguyên — tài liệu tham chiếu)
  README.md            (giữ nguyên — handoff gốc)
  PLAN.md
  CONTEXT.md
  app/                 (source code thật)
    src/
      routes/
      components/
      store/
      lib/
      i18n/
      styles/
    ...
```

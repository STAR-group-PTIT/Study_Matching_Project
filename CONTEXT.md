# FocusFlow — Context & Progress Log

Theo dõi tiến độ, quyết định kỹ thuật, và những gì đã/chưa làm. Đọc kèm [PLAN.md](PLAN.md) và [README.md](README.md).

## Trạng thái hiện tại
**Giai đoạn 3 hoàn tất.** Auth thật, route guard, Dashboard to-do và Settings profile/Pomodoro defaults đều đã nối Supabase. Còn lại cho các giai đoạn sau: Stats vẫn dùng data mock (đúng kế hoạch — Giai đoạn 7), wallpapers/tracks CRUD vẫn local-only vì cần Supabase Storage (Giai đoạn 7), Matching/Room chưa nối bảng `rooms`/`room_members`/`room_messages` (Giai đoạn 4-5).

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
- **2026-07-29** — User tạo project Supabase (ref `hycyrfwynqmvawobixhx`), điền `app/.env`. Dùng **Publishable key** (format mới `sb_publishable_...`, thay cho anon JWT key cũ — vẫn tương thích 100% với `@supabase/supabase-js`, chỉ khác định dạng hiển thị trong dashboard).
- **Sự cố migration đã gặp & fix:** file gốc tạo policy cho `rooms` tham chiếu bảng `room_members` trước khi bảng đó được khai báo — Postgres validate schema ngay lúc `CREATE POLICY`, không cho tham chiếu bảng chưa tồn tại → lỗi `42P01: relation "room_members" does not exist`. **Fix:** viết lại migration theo 4 phase rõ ràng (1. tất cả bảng → 2. functions/triggers → 3. RLS + policies → 4. realtime), và toàn bộ file giờ **idempotent** (an toàn chạy lại nhiều lần): `drop policy if exists` trước mỗi `create policy`, guard FK constraint và `alter publication add table` bằng existence check, trigger dùng `on conflict do nothing`.
- **Đã nối Auth thật vào [Auth.tsx](app/src/routes/Auth.tsx):**
  - Form controlled (name/email/password state), `supabase.auth.signInWithPassword` cho đăng nhập, `supabase.auth.signUp` cho đăng ký, `supabase.auth.signInWithOAuth({provider:'google'})` cho nút Google.
  - **Quan trọng:** project mặc định bật **"Confirm email"** → sau `signUp`, `data.session` là `null` cho tới khi user bấm link xác nhận trong email. Code đã xử lý đúng: chỉ `navigate('/')` khi có session thật; nếu không có session thì hiện thông báo xanh "Đã gửi email xác nhận tới ... ". (Lúc đầu code cũ điều hướng thẳng vào Dashboard bất kể có session hay không — đã sửa, xem lỗi test bên dưới.)
  - `translateAuthError()` dịch các lỗi Supabase phổ biến sang tiếng Việt (sai mật khẩu, email đã tồn tại, mật khẩu ngắn, email không hợp lệ, rate limit).
  - Test qua browser: đăng ký với domain `@example.com` bị Supabase chặn ("Email address is invalid" — example.com là domain reserved, Supabase block sẵn); đăng ký với domain thật (`@mailinator.com`) → thành công, điều hướng đúng; đăng nhập sai mật khẩu → hiện "Sai email hoặc mật khẩu." đúng như thiết kế lỗi. Test nhiều lần liên tiếp từng bị Supabase trả `over_email_send_rate_limit` (429) — đây là giới hạn phía Supabase (chống spam), không phải bug, cần tránh test signup dồn dập.
  - [Settings.tsx](app/src/routes/Settings.tsx) nút "Đăng xuất" giờ gọi `supabase.auth.signOut()` thật trước khi điều hướng `/auth`.
  - [store/auth.ts](app/src/store/auth.ts) — zustand store theo dõi `session`/`user`/`loading`, tự sync qua `supabase.auth.onAuthStateChange`, import 1 lần ở `main.tsx` để khởi tạo sớm.
- **2026-07-29 — Route guard + nối dữ liệu thật (nốt Giai đoạn 3):**
  - [components/RequireAuth.tsx](app/src/components/RequireAuth.tsx) — layout route dùng `<Outlet/>`, redirect `/auth` nếu chưa đăng nhập, hiện "Đang tải…" khi store còn `loading`. Áp dụng cho `/stats` và `/settings` trong [App.tsx](app/src/App.tsx). **Cố tình không guard** `/`, `/matching`, `/room/:id` — README nêu rõ chế độ khách phải dùng được Pomodoro không cần đăng nhập.
  - [Dashboard.tsx](app/src/routes/Dashboard.tsx): to-do giờ có 2 chế độ — đã đăng nhập thì đọc/ghi bảng `todos` thật (load qua effect theo `user`, thêm/toggle gọi Supabase và cập nhật state lạc quan); khách (`user` null) vẫn dùng `INITIAL_TASKS` mock y như cũ, không đổi hành vi. Đổi `Task.id` từ `number` sang `string` để chứa được cả uuid thật lẫn id mock (`'g1'`, `'g'+Date.now()`).
  - [Settings.tsx](app/src/routes/Settings.tsx): tên/email hiển thị thật từ `profiles`/session; slider Pomodoro load giá trị thật khi mount, nút "Lưu thay đổi" ghi `focus_minutes`/`break_minutes`/`auto_start_next` vào `profiles` (có feedback "Đã lưu ✓" 1.8s). Do route đã guard nên component luôn có `user` hợp lệ, không cần xử lý trường hợp null phức tạp. Wallpaper/nhạc **vẫn mock** (chưa có Storage — đúng theo PLAN.md, đó là việc của Giai đoạn 7). "Streak 12 ngày · 34 phiên tuần này" cũng còn hardcode, chờ Giai đoạn 7 tính từ `focus_sessions`.
  - **Verify:** typecheck sạch; test qua browser xác nhận `/settings` và `/stats` redirect đúng về `/auth` khi chưa đăng nhập. **Chưa test được** luồng ghi dữ liệu khi đã đăng nhập (todos/profile save) trực tiếp qua UI vì project đang bật email confirmation và không có cách nào xác nhận email trong sandbox này (thử qua Mailinator public inbox nhưng bị rate-limit "Personal use limit triggered"). Logic đã review kỹ và dùng đúng pattern đã proven ở Auth.tsx (cùng 1 `supabase` client, cùng RLS đã verify hoạt động). **Nên tự test lại bằng tay**: đăng ký tài khoản thật (hoặc tắt tạm "Confirm email" trong Supabase → Authentication → Providers → Email để test nhanh), thêm/tick to-do ở Dashboard và đổi Pomodoro defaults ở Settings, kiểm tra dữ liệu có lưu qua Supabase Table Editor không.

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

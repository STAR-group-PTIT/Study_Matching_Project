# FocusFlow — Context & Progress Log

Theo dõi tiến độ, quyết định kỹ thuật, và những gì đã/chưa làm. Đọc kèm [PLAN.md](PLAN.md) và [README.md](README.md).

## Trạng thái hiện tại
**Giai đoạn đang làm:** Giai đoạn 0 hoàn tất → tiếp theo là Giai đoạn 1 (dựng UI tĩnh pixel-perfect)

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
  - **Dashboard** ([app/src/routes/Dashboard.tsx](app/src/routes/Dashboard.tsx)) — đồng hồ Pomodoro (setInterval + phase focus/break tự chuyển), Ẩn UI, Focus/Dashboard mode, camera toggle, 3 popup (wallpaper/nhạc/to-do), to-do CRUD local. Timer dùng pattern: 1 effect đếm giây (ref để tránh stale closure với `running`), 1 effect riêng theo dõi đổi `phase` để set lại `left` đúng theo tổng giây phase mới (tránh nhấp nháy giá trị sai khi chuyển phase).

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

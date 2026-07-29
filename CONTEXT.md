# FocusFlow — Context & Progress Log

Theo dõi tiến độ, quyết định kỹ thuật, và những gì đã/chưa làm. Đọc kèm [PLAN.md](PLAN.md) và [README.md](README.md).

## Trạng thái hiện tại
**Giai đoạn đang làm:** Giai đoạn 0 — Khởi tạo nền tảng

## Nhật ký
- **2026-07-29** — Đọc README.md + toàn bộ design/*.dc.html, thống nhất plan 9 giai đoạn (0-8) với user. Chốt stack: React+TS+Tailwind+Vite, Supabase, LiveKit. Tạo PLAN.md + CONTEXT.md.

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

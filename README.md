# Handoff: FocusFlow — nền tảng học tập Pomodoro + phòng học chung

## Overview
FocusFlow là web app học tập theo phương pháp Pomodoro, kết hợp học nhóm qua video. Người dùng đặt đồng hồ tập trung, quản lý to-do, ghép cặp/tạo phòng học online với người khác, xem thống kê tiến độ và tuỳ chỉnh hồ sơ (wallpaper, nhạc nền, thời lượng Pomodoro).

Gói này gồm 6 màn hình hoàn chỉnh dạng prototype HTML + 1 canvas tổng hợp để xem tất cả cùng lúc.

## About the Design Files
Các file trong thư mục `design/` là **tài liệu tham chiếu thiết kế viết bằng HTML** — prototype thể hiện giao diện và hành vi mong muốn, **không phải production code để copy trực tiếp**.

Nhiệm vụ: **dựng lại các thiết kế này trong codebase đích** (React/Next.js, Vue, React Native, SwiftUI…) theo pattern và thư viện sẵn có của dự án. Nếu dự án chưa có codebase, hãy chọn stack phù hợp (gợi ý: **React + TypeScript + Tailwind CSS + Vite**, backend Node/Express hoặc Supabase, WebRTC cho video, WebSocket cho đồng bộ Pomodoro) rồi triển khai theo mô tả bên dưới.

Lưu ý kỹ thuật khi đọc file: mỗi `.dc.html` là một component tự chạy — phần markup nằm trong `<x-dc>`, phần logic là `class Component extends DCLogic { state, renderVals() }` trong thẻ `<script data-dc-script>`. `renderVals()` trả về đúng những giá trị mà markup dùng qua `{{ }}`; `<sc-for list as>` = `.map()`, `<sc-if value>` = render có điều kiện. Style viết inline bằng camelCase (tương đương React style object). `support.js` chỉ là runtime để prototype chạy được — **không cần port**.

## Fidelity
**High-fidelity.** Màu, typography, spacing, bo góc, shadow, animation đều là giá trị cuối. Hãy dựng lại pixel-perfect bằng thư viện của codebase (Tailwind class hoặc CSS-in-JS đều được, miễn giữ đúng token bên dưới). Toàn bộ dữ liệu hiện là mock — cần thay bằng API thật.

Ngôn ngữ UI: **tiếng Việt** (có toggle Tiếng Việt / English ở màn Matching nhưng chưa i18n thật — nên dựng bằng i18n library ngay từ đầu).

---

## Design Tokens

### Colors
| Token | Value | Dùng cho |
|---|---|---|
| Accent (mint) | `oklch(0.74 0.085 195)` | màu nhấn chính, vòng tiến trình, nút chính |
| Accent soft | `color-mix(in oklab, <accent> 62%, white)` | nền nút chính |
| Accent chip active | `color-mix(in oklab, <accent> 32%, white)` | chip đang chọn |
| Accent border | `color-mix(in oklab, <accent> 60%, white)` | viền chip đang chọn |
| Page bg | `#eef6f8` | nền body |
| Page gradient | `linear-gradient(160deg, #dff1f4 0%, #cfe6f2 45%, #e6f4ee 100%)` | nền Auth / Matching / Room |
| Text primary | `#2c3f55` | tiêu đề, số liệu |
| Text body | `#33475e` | chữ thường |
| Text muted | `rgba(51,71,94,0.5)` | label, caption |
| Text on accent | `#1e3549` / `#22483f` | chữ trên nền mint |
| Surface | `rgba(255,255,255,0.62 → 0.86)` + `backdrop-filter: blur(16–22px)` | card kính mờ |
| Surface solid | `#ffffff` | modal, nút phụ |
| Neutral fill | `rgba(238,246,248,0.85)` | hàng danh sách, track slider |
| Danger / rời phòng | `oklch(0.86 0.055 45)` nền, `#7a3f2c` chữ | nút Rời phòng, Kick |
| Warning / hàng chờ | `rgba(255,246,238,0.9)` nền, `oklch(0.87 0.075 55)` badge, `#7a4a2c` chữ | hàng chờ duyệt |
| Video tile bg | `repeating-linear-gradient(135deg, #e3eef2 0 12px, #dae8ee 12px 24px)` | placeholder webcam |
| Room-type hues (badge) | nền `oklch(0.93 0.045 H)`, chữ `oklch(0.42 0.08 H)` với H = Chill 195, Hardcore 45, Im lặng 265, Thảo luận 235, Giám sát 150 | badge loại phòng |

Accent là biến cấu hình (4 preset: 195 mint, 235 xanh dương, 170 xanh lá, 260 tím) — nên đưa thành CSS variable / theme token.

### Typography
- Font: **Nunito** (400/500/600/700/800), Google Fonts. Fallback `system-ui, sans-serif`.
- Mono (chỉ dùng cho placeholder webcam): **IBM Plex Mono** 400/500.
- Scale: display số đồng hồ `clamp(44px, 9.5vh, 82px)/800/letter-spacing -3px`; h1 `26px/800/-0.5px`; h2 `23px/800/-0.4px`; h3 `20px/800`; title card `15–16px/800`; body `13.5–14.5px/600–650`; label uppercase `12–12.5px/800/letter-spacing 0.8–1.2px`; caption `11.5–12px/650–700`.
- Số liệu đồng hồ dùng `font-variant-numeric: tabular-nums`.

### Spacing / radius / shadow
- Gap chuẩn: 7 / 8 / 10 / 14 / 16 / 20 / 24px. Padding card: 18–34px.
- Radius: chip & nút nhỏ 14–19px, input 18–20px, card 24–26px, panel lớn 30–34px, pill `999px`.
- Shadow: card nhẹ `0 10px 28px rgba(58,98,126,0.1)`; card nổi `0 18px 46px rgba(58,98,126,0.15)`; panel lớn `0 22px 56px rgba(58,98,126,0.13)`; modal `0 30px 70px rgba(38,66,86,0.28)`.
- Easing chuẩn: `cubic-bezier(0.22,1,0.36,1)` cho chuyển động, `ease` cho opacity. Thời lượng: 200–240ms (hover/nút), 420–520ms (panel trượt, fade màn hình), 620ms (scale đồng hồ).
- Hover pattern: `transform: translateY(-1px | -2px)` + shadow đậm hơn, hoặc nền trắng đặc hơn.

---

## Screens / Views

### 1. Dashboard — `design/FocusFlow.dc.html`
**Purpose:** màn hình chính, chạy Pomodoro cá nhân.

**Layout:** full-viewport (`100vh`), nền wallpaper (gradient preset) + lớp phủ `rgba(255,255,255,0.14)` blur 2px. 4 vùng absolute: top bar (26px trên, 32px hai bên), cột widget trái (top 96px, left 32px, width 232px), cột phải (top 96px, right 32px, width 248px), taskbar dưới (bottom 34px, căn giữa). Đồng hồ nằm giữa bằng flex column.

**Components**
- **Top bar:** logo pill (chấm gradient 20px radius 8px + "FocusFlow" 16px/800 + "· Dashboard mode" muted). Bên phải: segmented `Focus | Dashboard` (pill trắng 0.66 alpha, item active nền trắng + shadow) và nút "Ẩn UI" (icon mắt + label).
- **Đồng hồ:** vòng SVG 330px (viewBox 330, r=146, stroke-width 14, `stroke-dasharray 917.3`, `stroke-dashoffset` theo % còn lại, xoay -90°), phía sau là đĩa trắng `min(380px,46vh)` blur 18px. Giữa: label phase uppercase 13px, số `mm:ss`, "Phiên n / 4". Dưới: 3 nút Bắt đầu/Tạm dừng · Reset · Nghỉ ngắn (pill trắng, nút chính nền accent soft).
- **Widget trái:** card "Hôm nay" (số phút 34px/800 + 4 chấm tiến trình phiên) và card "Đang làm" (tên task + "n việc còn lại · m đã xong").
- **Cột phải (mới):** card camera self-view — khung 148px cao, gradient mint-xanh, badge "Bạn" + chấm trạng thái (`#4bbf9a` khi bật), nút "Bật/Tắt camera" full-width. Dưới cùng: card link **"Học cùng nhau"** (icon 2 người, tiêu đề + phụ đề "Tìm bạn học online") → điều hướng sang Matching.
- **Taskbar:** 3 nút Hình nền / Nhạc nền / To-do (To-do có badge số việc). Bấm mở popup tương ứng (bottom 108px, căn giữa): grid wallpaper 4 ô, danh sách nhạc + thanh phát 62%, panel To-do trượt từ phải (width 352px) với checkbox tròn và ô thêm việc.

**Behavior:** "Ẩn UI" fade toàn bộ chrome (opacity 0, translateY 8–24px) chỉ để lại wallpaper + đồng hồ. Chuyển Focus mode: ẩn widget, scale đồng hồ lớn hơn. Timer đếm ngược mỗi giây, hết phiên tự chuyển focus↔break và tăng số phiên.

### 2. Auth — `design/FocusFlow Auth.dc.html`
Card đăng nhập/đăng ký trong cùng một khung (segmented toggle ở đầu card), nút Google, input email/password bo 18px, nút chính accent soft, link "Dùng thử không cần đăng nhập". Cột phải là panel lý do nên đăng nhập (3 gạch đầu dòng có icon). Màn hẹp: 2 cột xếp dọc.

### 3. Matching — `design/FocusFlow Matching.dc.html`
**Purpose:** chọn tiêu chí rồi ghép cặp / tạo phòng / vào phòng công khai. Card max-width 560px (danh sách phòng 660px), 3 state chuyển bằng fade + translateY 8px.

- **State `filters`**
  - **Loại phòng** — 5 chip **chọn 1**, mỗi chip có icon 17px stroke 1.9: Chill (nốt nhạc), Hardcore (ngọn lửa), Im lặng (mặt trăng), Thảo luận (2 bong bóng chat), Giám sát (con mắt). Dưới lưới chip là hộp luật phòng (nền trắng 0.66, icon info màu theo hue của loại) hiển thị mô tả của chip đang chọn:
    - Chill → "Bật nhạc, tự do bật/tắt cam và mic."
    - Hardcore → "Bắt buộc bật cam, tắt nhạc và mic."
    - Im lặng → "Không nhạc, không cam, không mic — chỉ đồng hồ chung."
    - Thảo luận → "Bật cam và mic để trao đổi, không nhạc."
    - Giám sát → "Bắt buộc bật cam để giám sát nhau, tắt nhạc và mic."
  - **Thời lượng phiên**: 25 phút / 50 phút. **Ngôn ngữ**: Tiếng Việt / English. (2 cột `flex: 1 1 200px`, tự xuống dòng.)
  - **3 nút ngang hàng** (`flex: 1 1 180px`, xuống dòng khi hẹp): "Ghép ngẫu nhiên" (nền accent soft), "Tạo phòng mới" (nền trắng, viền accent), "Danh sách phòng" (nền trắng, viền `rgba(51,71,94,0.16)`).
- **Modal Tạo phòng** (overlay `rgba(38,66,86,0.28)` + blur 6px, card trắng 400px, animation `ffPop` 320ms): dòng meta "Host: <tên tài khoản> · Loại phòng: <tên>"; input **Tên phòng**; **Số người tối đa** chip 2/4/6/8/12 (mặc định 4) + nhãn "N người (gồm bạn)"; **Quyền riêng tư** Công khai/Riêng tư + dòng giải thích; nút "Tạo phòng". Sau khi tạo → state thành công: icon check tròn, tiêu đề `Đã tạo "<tên>"`, dòng meta "Công khai · tối đa N người", ô mã phòng **6 ký tự** (bảng chữ `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, letter-spacing 3px) + nút "Sao chép" (đổi thành "Đã chép ✓" 1.8s), nút "Đóng" và "Vào phòng".
- **State `searching`**: chip tóm tắt tiêu chí, 3 vòng ripple (`ffRipple` 3.4s, delay 0 / 1.13 / 2.26s) + đĩa trắng thở (`ffBreathe`) + bộ đếm giây; gợi ý đổi mỗi 8 giây (4 câu); nút "Huỷ tìm" và "Sửa bộ lọc".
- **State `rooms`**: danh sách phòng công khai (6 mock), mỗi hàng: tên phòng, badge loại phòng (màu theo hue), "Host <tên> · <thời lượng>", số người `now/max` (icon 2 người), nút "Tham gia" → Study Room. Phòng đầy: nút chuyển "Đầy", disabled, xám.

### 4. Study Room — `design/FocusFlow Room.dc.html`
**Purpose:** phòng học chung với video, Pomodoro đồng bộ, chat, nhạc, quản lý phòng.

- **Header (z 42, wrap khi hẹp):** logo pill + "· Phòng học chung"; bên phải segmented demo **2 người / 5 người** (chỉ để minh hoạ lưới, bỏ khi nối API) và pill "Đồng bộ với …".
- **Lưới video (Google-Meet style):** vùng nền sọc chéo `repeating-linear-gradient(135deg,#dbe9ef 0 14px,#d2e3ea 14px 28px)`, radius 34px, padding 16px; `display:grid`, `gap:14px`, `grid-template-columns: repeat(ceil(√n), minmax(0,1fr))`, `grid-template-rows: repeat(ceil(n/cols), minmax(0,1fr))`. Mỗi ô: `aspect-ratio 16/9`, `max-width/height:100%`, `margin:auto`, radius 24px, viền `2px rgba(140,205,196,0.45)`. Ô của mình: viền `2.5px rgba(126,201,198,0.95)`, shadow đậm hơn, badge "Bạn" + chấm `oklch(0.72 0.11 165)` góc trên phải — **kích thước bằng mọi ô khác**. Trong ô: placeholder mono "webcam · <Tên>" (hoặc "camera đang tắt") ở giữa; badge góc trên trái = avatar vuông bo 10px 2 chữ cái + tên 13px/800 + trạng thái ("đang tập trung" / "mic tắt" / "cam tắt").
- **Pomodoro nổi (z 40):** card kính mờ `rgba(255,255,255,0.62)` blur 18px, giữa-trên (top 106px), vòng SVG 92px (r=43, dasharray 270.2), số 21px/800, "Phiên n / 4 · cả hai cùng chạy", nút Tạm dừng/Tiếp tục + Reset. Nổi trên lưới và trên panel.
- **Panel phải (z 28, width 340px, top 84 → bottom 112, trượt ngang 380px khi đóng)** — **3 tab** trong 1 segmented + nút "Thu gọn":
  1. **Chat** — bong bóng tin nhắn (của mình canh phải, nền accent 26%; của người khác canh trái, nền `rgba(238,246,248,0.95)`), tên người gửi 11.5px phía trên, ô nhập + nút "Gửi" (Enter để gửi).
  2. **Nhạc** — card đang phát (3 thanh equalizer animation `ffEq` 900ms lệch pha 300/600ms, tên bài, "đang phát · <mood>" / "đã tạm dừng", nút play/pause 40px), slider âm lượng 0–100 (thumb trắng viền mint 3.5px) + % , danh sách 5 track (bài đang phát: nền accent 20% + viền inset), dòng chú thích: host → "nhạc phát đồng bộ cho cả phòng", thành viên → "chỉ chỉnh âm lượng của mình".
  3. **Quản lý** *(chỉ hiện khi `isHost`)* — badge "HOST"; **Chế độ vào phòng**: segmented `Tự động duyệt` / `Duyệt thủ công` + dòng giải thích; **Hàng chờ duyệt** (chỉ ở chế độ thủ công): hàng nền cam nhạt, avatar, tên, "chờ <thời gian>", nút "Duyệt" / "Bỏ", link "Duyệt tất cả" khi ≥2 người, empty state "Chưa có ai đang chờ."; **Trong phòng · N người**: danh sách thành viên + nút **Kick** (không hiện với chính host). Tab có badge số người đang chờ; badge này cũng hiện trên nút "Quản lý" ở thanh dưới.
- **Thanh điều khiển dưới (z 30):** Camera · Mic · Chat · Nhạc · Quản lý | Rời phòng. Nút tắt: nền `rgba(206,222,232,0.85)`, icon có gạch chéo. Chat/Nhạc/Quản lý mở panel ở đúng tab; bấm lại nút của tab đang mở thì thu gọn panel. Rời phòng → Dashboard.
- Vùng lưới có `padding-right: 392px` khi panel mở, `26px` khi đóng (transition 420ms).

### 5. Personal Stats — `design/FocusFlow Stats.dc.html`
3 KPI lớn (tổng phút, chuỗi ngày, số phiên), bar chart phút/ngày, heatmap 12 tuần tông mint 5 mức, danh sách to-do đã hoàn thành. Prototype dùng **Recharts**; codebase có thư viện chart riêng thì dùng thư viện đó, giữ nguyên bảng màu.

### 6. Settings & Profile — `design/FocusFlow Settings.dc.html`
Avatar + tên + email, lưới wallpaper (mỗi ô có nút xoá, ô "+" để thêm), danh sách nhạc (đổi tên / xoá), slider mặc định Pomodoro (thời lượng focus, nghỉ ngắn, số phiên), nút Đăng xuất.

### Canvas tổng — `design/FocusFlow Screens.dc.html`
Trang canvas nhúng cả 6 màn hình bằng iframe kèm chú thích — dùng để xem tổng thể, **không phải màn hình sản phẩm**.

---

## Interactions & Behavior
- **Điều hướng:** Dashboard → Matching (card "Học cùng nhau"); Matching → Room (Ghép ngẫu nhiên / Tham gia / Vào phòng); Room → Dashboard (Rời phòng); mọi màn có link "← Về màn hình học".
- **Chuyển state trong màn:** set `fade = 0` (opacity 0, translateY 8px) → sau 200ms đổi state → fade lại về 1.
- **Panel trượt:** `transform: translateX(...)` + `opacity` + `pointer-events: none` khi đóng, 440ms `cubic-bezier(0.22,1,0.36,1)`.
- **Timer:** `setInterval` 1s; hết giờ tự đổi phase focus↔break (break 5 phút) và tăng số phiên; nhớ `clearInterval` khi unmount.
- **Responsive:** mọi hàng chip/nút dùng flex-wrap với `flex: 1 1 <min>px`; lưới video tự tính cột theo số người; panel phải nên chuyển thành bottom sheet ở mobile (chưa thiết kế — cần bổ sung).

## State Management
| Màn | State |
|---|---|
| Dashboard | `mode` (dashboard/focus), `hidden`, `running`, `phase`, `left`, `round`, `focusedMinutes`, `wp`, `panel` (wp/music/todo/null), `track`, `playing`, `tasks[]`, `cameraOn` |
| Matching | `stage` (filters/searching/rooms), `fade`, `roomType`, `duration`, `language`, `waited`, `modal`, `created`, `roomName`, `capacity`, `visibility`, `roomId`, `copied` |
| Room | `running`, `phase`, `left`, `round`, `cam`, `mic`, `chat` (panel mở), `tab` (chat/music/host), `musicOn`, `trackIndex`, `volume`, `admit` (auto/manual), `pending[]`, `members[]`, `demo`, `messages[]`, `draft` |

**Cần API/backend thật cho:** auth (email + Google OAuth), CRUD to-do, thống kê phiên học, matching queue, phòng học (tạo/join theo mã, danh sách công khai, capacity, hàng chờ duyệt, kick), **WebRTC** cho video/audio, **WebSocket** để đồng bộ Pomodoro + chat + trạng thái nhạc trong phòng, upload wallpaper/nhạc.

## Assets
Không có ảnh binary. Wallpaper và khung video hiện là CSS gradient / repeating-linear-gradient placeholder — thay bằng ảnh thật và `<video>` stream khi triển khai. Icon đều là **inline SVG stroke 1.9, linecap round, viewBox 24** (không dùng icon font); có thể thay bằng Lucide (bộ icon cùng phong cách). Font từ Google Fonts: Nunito, IBM Plex Mono.

## Files
```
design/FocusFlow.dc.html            → 1. Dashboard (Pomodoro, to-do, camera, Học cùng nhau)
design/FocusFlow Auth.dc.html       → 2. Đăng nhập / Đăng ký
design/FocusFlow Matching.dc.html   → 3. Matching + tạo phòng + danh sách phòng
design/FocusFlow Room.dc.html       → 4. Phòng học chung (lưới video, chat/nhạc/quản lý)
design/FocusFlow Stats.dc.html      → 5. Thống kê cá nhân
design/FocusFlow Settings.dc.html   → 6. Cài đặt & hồ sơ
design/FocusFlow Screens.dc.html    → canvas xem tất cả màn hình
design/support.js                   → runtime của prototype, KHÔNG cần port
```
Mở bất kỳ file `.dc.html` nào trực tiếp trong trình duyệt để xem và bấm thử.

# Study matching — Mobile (Expo / React Native)

Module mobile riêng của **Study Matching** (React Native + Expo), dùng chung
backend Supabase với web app (`../app/`) — cùng project, cùng anon key, cùng
RLS. Được scaffold theo cấu trúc workshop React Native (login → list → CRUD →
local cache), nối dữ liệu thật thay vì mock backend.

## Cấu trúc

- `app/` — routes (Expo Router):
  - `_layout.tsx` — root Stack + load font Nunito (`@expo-google-fonts/nunito`)
  - `login.tsx` — màn đăng nhập/đăng ký theo đúng thiết kế web (gradient + glass card + tab switcher)
  - `(tabs)/_layout.tsx` — gate đăng nhập: chưa có session thì `<Redirect href="/login" />`
  - `(tabs)/index.tsx` — danh sách phòng công khai (`room_public_list`) + cache AsyncStorage (render offline), card theo đúng `Matching.tsx` web
  - `room/[id].tsx` — chi tiết phòng (theo mã), nút Tham gia (`join_room_by_code` RPC), **xin quyền camera/mic + preview video** (`expo-camera`), danh sách thành viên (`room_members_view`)
- `lib/supabase.ts` — client từ `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY`, session persist qua AsyncStorage
- `lib/api.ts` — wrapper query `room_public_list`/`room_members_view` + RPC `join_room_by_code`
- `lib/auth.ts` — signIn/signUp/signOut + dịch lỗi tiếng Việt; `signUp` xử lý trường hợp project bật "Confirm email" (báo gửi mail xác nhận thay vì vào app)
- `theme.ts` — design tokens mirror web app (`app/src/index.css`): gradient, accent/soft, text tiers, border, radius, shadow, bảng `roomTypes` (badge màu theo hue từng loại phòng)

## Chạy

```bash
npm install
npx expo start
# quét QR bằng Expo Go (điện thoại cùng mạng LAN), hoặc bấm a/w cho emulator/web
```

## Biến môi trường

Copy từ `../app/.env` (đổi prefix `VITE_` → `EXPO_PUBLIC_`) vào `.env.local`
(đã gitignore):

```bash
EXPO_PUBLIC_SUPABASE_URL=...
EXPO_PUBLIC_SUPABASE_ANON_KEY=...
```

## Verify

```bash
npx tsc --noEmit
npx expo lint
npx expo export --platform android   # bundle Hermes compile
```

## Ghi chú

- Web export dùng `output: "single"` (SPA) — tránh SSR render vỡ ở
  `@supabase/supabase-js` (window is not defined); mục tiêu chính vẫn là
  Android/iOS qua Expo Go.
- `room_members_view` chỉ trả dòng khi user là participant (RLS bên view) —
  màn chi tiết phòng khi chưa vào sẽ hiện list thành viên rỗng, đúng hành vi.
- Quyền camera/mic được xin qua `expo-camera` (`useCameraPermissions`/
  `useMicrophonePermissions`) ngay trong màn phòng; config plugin trong
  `app.json` (message iOS + `recordAudioAndroid`). Sau lần bị từ chối vĩnh
  viễn, có link mở Cài đặt hệ thống (`Linking.openSettings()`).
- Nút "Đăng nhập với Google" hiện chỉ hiện thông báo "chưa cấu hình trên
  mobile" — OAuth mobile cần cấu hình scheme deep-link + redirect URL trong
  Supabase Dashboard, để làm khi tới bước đó.
- Bước tiếp theo tự nhiên: màn tạo phòng (`create_room` RPC), ghép ngẫu nhiên
  (lobby), chat realtime, video call (LiveKit như web) — backend web app đã có
  sẵn tất cả.
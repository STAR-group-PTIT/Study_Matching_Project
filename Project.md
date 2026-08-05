# Group: STARS - KADA PROGRAM PTITHCM

## Team members: 
+ Nguyễn Thanh Tâm - BA
+ Phạm Thanh Nhựt Trọng - Tester
+ Nguyễn Võ Phi Long - Leader
+ Nguyễn Ngọc Hoàng - FE
+ Nguyễn Thanh Cường - BE

## Project's information:

FocusFlow is a web-based learning app that combines the Pomodoro method with group video-based learning. Users can set focus timers, manage to-do lists, pair up/create online study rooms with others, view progress statistics, and customize their profiles (wallpaper, background music, Pomodoro duration).

---

## Current Progress

### ✅ Completed
- All 6 screens implemented (Dashboard, Auth, Matching, Room, Stats, Settings)
- Supabase backend: 12 migrations, RLS, Realtime
- Edge Functions: `livekit-token`, `match-room`
- LiveKit video/audio integration in Room
- i18n (Vietnamese & English)
- Pomodoro timer with focus/break phases
- Quick match + room creation + public room list
- YouTube & local music playback
- Wallpaper upload & selection
- Unit tests for `levels`, `timer`, `youtube`, `queueStats`

### 🔧 Remaining Work
- Settings not routed as a standalone page (currently opened as modal from Dashboard)
- Mobile/responsive: panel → bottom sheet (Room screen, not yet designed)
- Google OAuth setup (code exists, needs provider config)
- End-to-end testing
- Performance & accessibility audit
- Deployment to Vercel (production)

---

## Task Assignments

### Nguyễn Võ Phi Long — Leader
- [ ] Coordinate sprint planning and task tracking across the team
- [ ] Review and merge pull requests from all members
- [ ] Set up Vercel deployment pipeline (connect repo, configure `VITE_*` env vars, verify builds)
- [ ] Configure Supabase Auth providers (Email + Google OAuth credentials)
- [ ] Set up Supabase Edge Function secrets (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`)
- [ ] Ensure all migrations are applied in order on the production Supabase project
- [ ] Final integration testing before release

### Nguyễn Thanh Tâm — BA
- [ ] Write user stories and acceptance criteria for remaining features (Settings page routing, mobile responsive)
- [ ] Create test scenarios document for Tester (happy paths + edge cases per screen)
- [ ] Design the mobile/responsive bottom sheet layout for Room panel (Chat/Music/Manage)
- [ ] Document API contracts: list all Supabase tables, RLS policies, and Edge Function endpoints
- [ ] Prepare demo script and presentation materials for project showcase
- [ ] Maintain project documentation (README.md, SETUP.md, Project.md) as features evolve

### Nguyễn Ngọc Hoàng — FE
- [ ] Route Settings as a standalone page (`/settings`) with auth guard, keep modal usage from Dashboard as well
- [ ] Implement mobile responsive layout for Room screen (convert right panel to bottom sheet)
- [ ] Add responsive breakpoints for Matching screen (card stacking on narrow viewports)
- [ ] Improve accessibility: keyboard navigation, ARIA labels on interactive elements, focus management
- [ ] Add loading skeletons / error boundaries for all data-fetching screens (Stats, Matching room list)
- [ ] Polish UI transitions: verify all fade/slide animations match design spec timing

### Nguyễn Thanh Cường — BE
- [ ] Review and optimize RLS policies for performance (check query plans on `rooms`, `room_members`)
- [ ] Add database indexes if needed for frequent queries (e.g. `room_members` by `room_id`, `focus_sessions` by `user_id`)
- [ ] Implement server-side validation in Edge Functions (input sanitization, rate limiting)
- [ ] Set up Supabase Storage buckets and policies for wallpaper/music uploads (if not done)
- [ ] Add cleanup logic: expired rooms, stale queue entries beyond TTL
- [ ] Monitor and test Realtime subscriptions under load (rooms, room_members, room_messages)

### Phạm Thanh Nhựt Trọng — Tester
- [ ] Write and run E2E test cases for Auth flow (sign up, login, logout, Google OAuth)
- [ ] Write and run E2E test cases for Dashboard (timer start/pause/reset, to-do CRUD, wallpaper/music selection)
- [ ] Write and run E2E test cases for Matching (filter selection, room creation, join by code, public room list)
- [ ] Write and run E2E test cases for Room (video toggle, chat send/receive, music controls, host management)
- [ ] Write and run E2E test cases for Stats (data display, chart rendering, date range filters)
- [ ] Expand unit test coverage: add tests for `quickMatch.ts`, `sound.ts`, `supabase.ts`
- [ ] Report bugs with reproduction steps via GitHub Issues

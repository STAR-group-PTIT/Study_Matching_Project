# FocusFlow — Project Walkthrough & Setup Guide

## Project Overview

FocusFlow is a **Pomodoro-based study web app** with live video study rooms. Users can run focus timers, manage to-dos, match with study partners or create/join rooms, view personal stats, and customise their profile (wallpaper, music, timer durations).

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | **React 19** + **TypeScript** + **Vite 8** + **Tailwind CSS 4** |
| State | **Zustand** (auth store, etc.) |
| Routing | **React Router DOM 7** |
| Backend / DB | **Supabase** (Postgres + Auth + Realtime + Storage + Edge Functions) |
| Video/Audio | **LiveKit** (WebRTC via `livekit-client` on frontend, token minted by Supabase Edge Function using `livekit-server-sdk`) |
| i18n | **i18next** + browser language detector (Vietnamese & English) |
| Charts | **Recharts** (stats screen) |
| Linting | **OxLint** |
| Formatting | **Prettier** (with Tailwind plugin) |
| Testing | **Vitest** |
| Hosting | **Vercel** (SPA rewrite configured in `vercel.json`) |

---

## Folder Structure

```
Study_Matching_Project/
├── README.md                  # Design spec & handoff doc (Vietnamese)
├── SETUP.md                   # ← You are here
├── .gitignore
│
├── design/                    # HTML prototypes (reference only, not production code)
│   ├── FocusFlow.dc.html              # Dashboard
│   ├── FocusFlow Auth.dc.html         # Auth screen
│   ├── FocusFlow Matching.dc.html     # Matching / room creation / room list
│   ├── FocusFlow Room.dc.html         # Study room (video grid, chat, music, host panel)
│   ├── FocusFlow Stats.dc.html        # Personal stats
│   ├── FocusFlow Settings.dc.html     # Settings & profile
│   ├── FocusFlow Screens.dc.html      # Canvas overview (all screens)
│   └── support.js                     # Prototype runtime — ignore
│
└── app/                       # The actual application
    ├── package.json
    ├── vite.config.ts
    ├── vercel.json            # SPA rewrite for Vercel deploy
    ├── index.html             # Vite entry
    ├── .env.example           # Required env vars template
    │
    ├── src/
    │   ├── main.tsx           # App entry (React root)
    │   ├── App.tsx            # Router setup — routes: /, /auth, /matching, /room/:id, /stats
    │   ├── index.css          # Global styles (Tailwind)
    │   │
    │   ├── routes/            # Page-level components
    │   │   ├── Auth.tsx       # Login / Sign-up
    │   │   ├── Dashboard.tsx  # Pomodoro timer, to-do, camera, widgets
    │   │   ├── Matching.tsx   # Filter → search → room list flow
    │   │   ├── Room.tsx       # Live study room (video, chat, music, host controls)
    │   │   ├── Stats.tsx      # Personal stats & charts
    │   │   └── Settings.tsx   # Profile, wallpaper, music, timer prefs (not yet routed)
    │   │
    │   ├── components/        # Shared components
    │   │   ├── RequireAuth.tsx    # Auth guard (wraps protected routes)
    │   │   ├── DeviceCheck.tsx    # Camera/mic permission check
    │   │   ├── MatchFound.tsx     # Match animation
    │   │   └── SessionRating.tsx  # Post-session rating
    │   │
    │   ├── store/
    │   │   └── auth.ts        # Zustand auth store (session, user, loading)
    │   │
    │   ├── lib/               # Utility modules
    │   │   ├── supabase.ts    # Supabase client singleton
    │   │   ├── quickMatch.ts  # Matching queue logic
    │   │   ├── timer.ts       # Pomodoro timer helpers
    │   │   ├── levels.ts      # User level/XP calculation
    │   │   ├── sound.ts       # Audio playback helpers
    │   │   ├── youtube.ts     # YouTube music integration
    │   │   └── __tests__/     # Vitest test files
    │   │
    │   ├── i18n/
    │   │   ├── index.ts       # i18next config
    │   │   └── locales/
    │   │       ├── vi/        # Vietnamese translations
    │   │       └── en/        # English translations
    │   │
    │   └── assets/
    │       ├── wallpapers/    # Built-in wallpaper images
    │       └── music/         # Local music files (git-ignored, see .gitignore)
    │
    └── supabase/
        ├── functions/         # Supabase Edge Functions (Deno)
        │   ├── livekit-token/ # Mints LiveKit access tokens (verifies room membership via RLS)
        │   └── match-room/    # Matching queue / room assignment logic
        │
        └── migrations/        # SQL migrations (run in order)
            ├── 0001_init.sql                  # Core schema: profiles, todos, focus_sessions,
            │                                  #   wallpapers, tracks, rooms, room_members,
            │                                  #   room_messages + RLS + Realtime
            ├── 0002_matching_and_rooms.sql
            ├── 0003_room_realtime_sync.sql
            ├── 0004_storage_and_stats.sql
            ├── 0005_pomodoro_session_count.sql
            ├── 0006_profile_prefs.sql
            ├── 0007_default_tracks.sql
            ├── 0008_youtube_music.sql
            ├── 0009_default_youtube_url.sql
            ├── 0010_room_type_free_together.sql
            └── 0011_queue_ttl_and_cleanup.sql
```

---

## Prerequisites

- **Node.js** ≥ 20 (for Vite 8 / React 19)
- **npm** (ships with Node)
- A **Supabase** project (free tier works) → [supabase.com](https://supabase.com)
- A **LiveKit** account (free tier works) → [livekit.io](https://livekit.io) — needed for video rooms
- (Optional) **Supabase CLI** — for local dev, edge functions, and running migrations from CLI
- (Optional) **Vercel CLI** — for deployment

---

## Setup Steps

### 1. Clone the repo

```bash
git clone https://github.com/STAR-group-PTIT/Study_Matching_Project.git
cd Study_Matching_Project
```

### 2. Install frontend dependencies

```bash
cd app
npm install
```

### 3. Create your `.env` file

Create a file named `.env` inside the `app/` folder with the following content:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
VITE_LIVEKIT_URL=wss://YOUR_LIVEKIT_HOST
```

Replace the placeholder values with your real credentials.

**Where to find these:**
- **Supabase URL & Anon Key** → Supabase Dashboard → Project Settings → API
- **LiveKit URL** → LiveKit Cloud dashboard → your project's WebSocket URL

### 4. Set up the database

Run the SQL migration files **in order** in the Supabase SQL Editor (Dashboard → SQL Editor → New Query):

1. Paste and run `app/supabase/migrations/0001_init.sql`
2. Then `0002_matching_and_rooms.sql`
3. Continue through `0011_queue_ttl_and_cleanup.sql`

**Or** if you have the Supabase CLI linked:

```bash
supabase db push
```

### 5. Configure Supabase Auth

In Supabase Dashboard → Authentication → Providers:
- Enable **Email** sign-up
- (Optional) Enable **Google OAuth** and set your OAuth credentials

### 6. Deploy Edge Functions

The two edge functions need these **secrets** set in your Supabase project (Dashboard → Edge Functions → Manage Secrets, or via CLI):

| Secret | Description |
|---|---|
| `LIVEKIT_API_KEY` | From LiveKit dashboard |
| `LIVEKIT_API_SECRET` | From LiveKit dashboard |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are auto-injected by Supabase.

Deploy via CLI:

```bash
supabase functions deploy livekit-token
supabase functions deploy match-room
```

### 7. Start the dev server

```bash
cd app
npm run dev
```

Opens at **http://localhost:5173** by default.

### 8. (Optional) Run tests / lint / format

```bash
npm test          # vitest
npm run lint      # oxlint
npm run format    # prettier
```

---

## Key Concepts

### Routing

| Path | Component | Auth required? |
|---|---|---|
| `/` | Dashboard | No (limited without login) |
| `/auth` | Auth | No |
| `/matching` | Matching | **Yes** |
| `/room/:id` | Room | No (but needs room membership for video) |
| `/stats` | Stats | **Yes** |

### Database (Supabase / Postgres)

Core tables: `profiles`, `todos`, `focus_sessions`, `rooms`, `room_members`, `room_messages`, `wallpapers`, `tracks`. All protected by Row Level Security — users can only access their own data, public rooms, and rooms they're members of.

### Real-time

`rooms`, `room_members`, and `room_messages` are published to Supabase Realtime for live updates in study rooms.

### Video (LiveKit)

1. User joins a room → frontend calls the `livekit-token` edge function with the room code
2. Edge function verifies the user is an admitted `room_member` (via RLS), then mints a LiveKit JWT
3. Frontend connects to LiveKit using `livekit-client` with that token

### Music

The app supports both local audio files (in `app/src/assets/music/`, git-ignored) and YouTube URLs. Drop `.mp3`/`.wav`/`.ogg`/`.m4a` files into the music folder for local playback during dev.

---

## Deployment (Vercel)

The `app/vercel.json` has SPA rewrites already configured. Connect the repo to Vercel, set the root directory to `app`, and add the three `VITE_*` env vars in Vercel's project settings. Builds use `npm run build` (`tsc -b && vite build`).

-- FocusFlow — profile preferences: preferred camera/mic device, timer-end sound
-- Run this in Supabase SQL Editor (safe to re-run any time).

alter table public.profiles
  add column if not exists preferred_camera_id text,
  add column if not exists preferred_mic_id text,
  add column if not exists notification_sound boolean not null default true;

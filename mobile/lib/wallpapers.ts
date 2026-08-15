// Hình nền gradient built-in — mirror 6 gradient của web (app/src/routes/Settings.tsx
// GRADIENTS + app/src/index.css --c-*). Mỗi gradient có cặp light/dark giống web.
// React Native không có radial-gradient (web wallpaper #5 là radial) — xấp xỉ bằng
// linear 135deg cùng màu cho nhất quán với các loại còn lại.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { useTheme } from '@/theme';

export type WallpaperGradient = {
  id: string;
  name: string;
  light: string[];
  dark: string[];
};

export const WALLPAPERS: WallpaperGradient[] = [
  {
    id: 'ff-gradient-1',
    name: 'Mint dốc',
    light: ['#dff1f4', '#cfe6f2', '#e6f4ee'],
    dark: ['#0b1d20', '#0d2430', '#0b1913'],
  },
  {
    id: 'ff-gradient-2',
    name: 'Ngọc nhạt',
    light: ['#e8f4f0', '#d5e9f4'],
    dark: ['#0b1713', '#0b1f2a'],
  },
  {
    id: 'ff-gradient-3',
    name: 'Mây hồ',
    light: ['#d9ecf5', '#eaf5f1', '#dceef0'],
    dark: ['#0a1d26', '#0a1511', '#0f2123'],
  },
  {
    id: 'ff-gradient-4',
    name: 'Băng',
    light: ['#eef3f8', '#dbeaf0', '#cfe4e6'],
    dark: ['#070c11', '#0f1e24', '#192e30'],
  },
  {
    id: 'ff-gradient-5',
    name: 'Cỏ ven hồ',
    light: ['#e9f6f2', '#d3e6f0'],
    dark: ['#091612', '#0f222c'],
  },
  {
    id: 'ff-gradient-6',
    name: 'Kem bạc hà',
    light: ['#f0f6f7', '#d8eaf0', '#cde5df'],
    dark: ['#080e0f', '#0f2127', '#1a322c'],
  },
];

const WALLPAPER_KEY = 'ff-mobile-wallpaper-id';

export function getWallpaper(id: string | null): WallpaperGradient {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0];
}

export async function loadWallpaperId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(WALLPAPER_KEY);
  } catch {
    return null;
  }
}

export async function saveWallpaperId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(WALLPAPER_KEY, id);
  } catch {
    // lưu không được thì chỉ mất lựa chọn sau khi thoát app — không nghiêm trọng
  }
}

// Store dùng chung (module-level): nhiều màn (home, profile) cùng đọc 1 id —
// nếu mỗi component tự useState thì đổi wallpaper ở profile không cập nhật home.
const listeners = new Set<() => void>();
let currentId: string | null = null;
let hydrating: Promise<string | null> | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return currentId;
}

// Đọc id đã lưu 1 lần (chạy chậm ở nền); không ghi đè lựa chọn vừa đổi khi đang hydrate.
export function hydrateWallpaperId(): void {
  if (!hydrating) {
    hydrating = loadWallpaperId().then((stored) => {
      if (stored && currentId === null) {
        currentId = stored;
        emit();
      }
      return stored;
    });
  }
}

// Hook dùng chung: trả gradient theo theme hiện tại (light/dark),
// setWallpaper lưu ngay + cập nhật mọi component đang theo dõi (P5).
export function useWallpaper(): {
  wallpaper: WallpaperGradient;
  setWallpaper: (id: string) => void;
} {
  const { isDark } = useTheme();
  useEffect(hydrateWallpaperId, []);
  const id = useSyncExternalStore(subscribe, getSnapshot);
  const base = getWallpaper(id);
  return { wallpaper: base, setWallpaper: setWallpaperId };
}

export function setWallpaperId(id: string): void {
  currentId = id;
  emit();
  saveWallpaperId(id).catch(() => {});
}

// Màu gradient thực tế cho theme hiện tại — dùng khi vẽ nền màn hình.
export function wallpaperColorsFor(wp: WallpaperGradient, isDark: boolean): [string, string, ...string[]] {
  return (isDark ? wp.dark : wp.light) as [string, string, ...string[]];
}
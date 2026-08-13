// Design tokens mobile — mirror web app CSS tokens (app/src/index.css) cho cả light + dark.
// Màu oklch của web được chuyển sang hex/rgba gần đúng cho React Native; dark theme đọc
// thẳng từ khối :root[data-theme='dark'] của web (page-bg, elevation ladder, borders...).
// Accent có 4 preset hue giống web (195 mint / 235 xanh dương / 170 xanh lá / 260 tím) —
// các biến thể accent/dark/soft/tint được quay hue trong oklch từ giá trị mint gốc.

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
} as const;

// ---------- Accent presets (hue oklch, mirror web --ff-accent-h) ----------

export const ACCENT_PRESETS = [
  { hue: 195, name: 'Mint' },
  { hue: 235, name: 'Xanh dương' },
  { hue: 170, name: 'Xanh lá' },
  { hue: 260, name: 'Tím' },
] as const;

export type AccentHue = (typeof ACCENT_PRESETS)[number]['hue'];

// Quay hue trong oklch từ anchor mint (giá trị đã chốt của app) → giữ nguyên L/C nên
// cả 4 preset nhìn đồng nhất. Giá trị tính bằng script oklch→hex (xem CONTEXT GĐ mobile P1).
type AccentShades = {
  accent: string;
  accentDark: string;
  accentSoft: string;
  accentTint: string;
};

const ACCENT_ANCHOR: Record<AccentHue, AccentShades> = {
  195: { accent: '#54cfb8', accentDark: '#2fa08a', accentSoft: '#cdeee6', accentTint: '#f0faf7' },
  235: { accent: '#66c3f6', accentDark: '#4195c2', accentSoft: '#cfeafb', accentTint: '#f1f9fe' },
  170: { accent: '#60cfac', accentDark: '#3aa082', accentSoft: '#cfeee2', accentTint: '#f0faf6' },
  260: { accent: '#8cb8ff', accentDark: '#658ccb', accentSoft: '#d8e7fe', accentTint: '#f3f8ff' },
};

// ---------- Theme colors ----------

export type ThemeColors = {
  // nền trang + gradient auth/room (web: --ff-page-gradient)
  pageBg: string;
  pageGradient: readonly [string, string, ...string[]];
  // accent (web: --ff-accent) — giữ nguyên 2 theme vì accent-soft luôn là nền pastel
  accent: string;
  accentDark: string;
  accentSoft: string;
  accentTint: string;
  onAccent: string;
  onAccentSoft: string;
  logoGradient: readonly [string, string, ...string[]];
  // text tiers (web: --ff-text-primary / text-body / text-muted / text-2 / text-3)
  text: string;
  body: string;
  muted: string;
  faint: string;
  // surface (web: --ff-surface-1/2/3)
  surface: string;
  surface2: string;
  surface3: string;
  neutralFill: string;
  // glass cards (đã hardcode rgba trắng trong login/room — tách thành token cho dark)
  glassCard: string;
  glassPanel: string;
  glassTab: string;
  // borders
  border: string;
  borderStrong: string;
  // semantic
  danger: string;
  dangerBright: string;
  success: string;
};

export type ThemeShadows = {
  card: object;
  raised: object;
  button: object;
};

function lightColors(acc: AccentShades): ThemeColors {
  return {
    pageBg: '#eef6f8',
    pageGradient: ['#dff1f4', '#cfe6f2', '#e6f4ee'] as const,
    accent: acc.accent,
    accentDark: acc.accentDark,
    accentSoft: acc.accentSoft,
    accentTint: acc.accentTint,
    onAccent: '#1e3549',
    onAccentSoft: '#2c3f55',
    logoGradient: ['#54cfb8', '#4d9fc4'] as const,
    text: '#2c3f55',
    body: '#33475e',
    muted: 'rgba(51, 71, 94, 0.62)',
    faint: 'rgba(51, 71, 94, 0.45)',
    surface: '#ffffff',
    surface2: '#f3f7f8',
    surface3: '#e8eef0',
    neutralFill: 'rgba(238, 246, 248, 0.85)',
    glassCard: 'rgba(255, 255, 255, 0.75)',
    glassPanel: 'rgba(255, 255, 255, 0.62)',
    glassTab: 'rgba(238, 246, 248, 0.9)',
    border: 'rgba(51, 71, 94, 0.14)',
    borderStrong: 'rgba(51, 71, 94, 0.3)',
    danger: '#7a3f2c',
    dangerBright: '#e5484d',
    success: '#2f8f68',
  };
}

function darkColors(acc: AccentShades): ThemeColors {
  return {
    pageBg: '#0d1316',
    pageGradient: ['#0c1a1c', '#0a1621', '#0b1a15'] as const,
    accent: acc.accent,
    accentDark: acc.accentDark,
    accentSoft: acc.accentSoft,
    accentTint: acc.accentTint,
    onAccent: '#1e3549',
    onAccentSoft: '#2c3f55',
    logoGradient: ['#001c0f', '#00233f'] as const,
    text: '#e6edef',
    body: '#c3d2e0',
    muted: 'rgba(159, 176, 181, 0.65)',
    faint: '#98a8ae',
    surface: '#151e22',
    surface2: '#1d282d',
    surface3: '#263338',
    neutralFill: 'rgba(255, 255, 255, 0.05)',
    glassCard: 'rgba(21, 30, 34, 0.75)',
    glassPanel: 'rgba(21, 30, 34, 0.66)',
    glassTab: 'rgba(21, 30, 34, 0.9)',
    border: '#2c3a3f',
    borderStrong: '#3d4e54',
    danger: '#ff7a6b',
    dangerBright: '#ff7a72',
    success: '#4ec9a0',
  };
}

export function buildColors(isDark: boolean, accentHue: AccentHue): ThemeColors {
  const acc = ACCENT_ANCHOR[accentHue] ?? ACCENT_ANCHOR[195];
  return isDark ? darkColors(acc) : lightColors(acc);
}

export function buildShadows(isDark: boolean): ThemeShadows {
  if (isDark) {
    // web dark: shadow đen đậm hơn (--ff-shadow-card/panel/modal)
    return {
      card: {
        shadowColor: 'rgba(0, 0, 0, 0.32)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 28,
        elevation: 4,
      },
      raised: {
        shadowColor: 'rgba(0, 0, 0, 0.45)',
        shadowOffset: { width: 0, height: 18 },
        shadowOpacity: 1,
        shadowRadius: 46,
        elevation: 8,
      },
      button: {
        shadowColor: 'rgba(0, 0, 0, 0.4)',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 1,
        shadowRadius: 24,
        elevation: 6,
      },
    };
  }
  return {
    card: {
      shadowColor: 'rgba(58, 98, 126, 0.12)',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 1,
      shadowRadius: 20,
      elevation: 4,
    },
    raised: {
      shadowColor: 'rgba(58, 98, 126, 0.18)',
      shadowOffset: { width: 0, height: 18 },
      shadowOpacity: 1,
      shadowRadius: 40,
      elevation: 8,
    },
    button: {
      shadowColor: 'rgba(58, 98, 126, 0.22)',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 1,
      shadowRadius: 24,
      elevation: 6,
    },
  };
}

// ---------- Loại phòng (giữ nguyên 2 theme — chip màu tự thân, giống web giữ nguyên oklch) ----------

export const roomTypes: Record<
  string,
  { name: string; rule: string; badgeBg: string; badgeText: string }
> = {
  chill: {
    name: 'Chill',
    rule: 'Bật nhạc, tự do bật/tắt cam và mic.',
    badgeBg: '#d8f1ec',
    badgeText: '#2e7a6d',
  },
  hardcore: {
    name: 'Hardcore',
    rule: 'Bắt buộc bật cam, tắt nhạc và mic.',
    badgeBg: '#f8eeda',
    badgeText: '#8a6f26',
  },
  silent: {
    name: 'Im lặng',
    rule: 'Không nhạc, không cam, không mic — chỉ đồng hồ chung.',
    badgeBg: '#e8e3f6',
    badgeText: '#5d548e',
  },
  discuss: {
    name: 'Thảo luận',
    rule: 'Bật cam và mic để trao đổi, không nhạc.',
    badgeBg: '#e0e6f5',
    badgeText: '#4d5f9b',
  },
  watch: {
    name: 'Giám sát',
    rule: 'Bắt buộc bật cam để giám sát nhau, tắt nhạc và mic.',
    badgeBg: '#dff2e6',
    badgeText: '#2e7a55',
  },
};

// ---------- Kích thước (không đổi theo theme) ----------

export const radius = {
  sm: 12,
  input: 18,
  button: 22,
  card: 24,
  panel: 32,
  pill: 999,
} as const;

export const fontSize = {
  xs: 12.5,
  sm: 13.5,
  base: 15,
  md: 16,
  lg: 18,
  xl: 22,
  xxl: 26,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

// ---------- ThemeProvider + useTheme ----------

export type ThemeMode = 'light' | 'dark';

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  accentHue: AccentHue;
  colors: ThemeColors;
  shadows: ThemeShadows;
  setMode: (mode: ThemeMode) => void;
  setAccentHue: (hue: AccentHue) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'light',
  isDark: false,
  accentHue: 195,
  colors: lightColors(ACCENT_ANCHOR[195]),
  shadows: buildShadows(false),
  setMode: () => {},
  setAccentHue: () => {},
});

const MODE_KEY = 'ff-mobile-theme';
const ACCENT_KEY = 'ff-mobile-accent-hue';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(system === 'dark' ? 'dark' : 'light');
  const [accentHue, setAccentHueState] = useState<AccentHue>(195);

  // 1. đọc lựa chọn cục bộ đã lưu (chạy trước mọi thứ để không flash theme cũ)
  useEffect(() => {
    (async () => {
      const [savedMode, savedAccent] = await Promise.all([
        AsyncStorage.getItem(MODE_KEY),
        AsyncStorage.getItem(ACCENT_KEY),
      ]);
      if (savedMode === 'light' || savedMode === 'dark') setModeState(savedMode);
      if (savedAccent) {
        const hue = Number(savedAccent) as AccentHue;
        if (ACCENT_PRESETS.some((p) => p.hue === hue)) setAccentHueState(hue);
      }
    })();
  }, []);

  // 2. đã đăng nhập → server wins (profiles.theme / profiles.accent_hue, đúng pattern web App.tsx)
  useEffect(() => {
    const syncFromProfile = async (userId: string) => {
      const { data } = await supabase
        .from('profiles')
        .select('theme, accent_hue')
        .eq('id', userId)
        .maybeSingle();
      if (!data) return;
      if (data.theme === 'light' || data.theme === 'dark') {
        setModeState(data.theme);
        AsyncStorage.setItem(MODE_KEY, data.theme).catch(() => {});
      }
      if (data.accent_hue != null) {
        const hue = Number(data.accent_hue) as AccentHue;
        if (ACCENT_PRESETS.some((p) => p.hue === hue)) {
          setAccentHueState(hue);
          AsyncStorage.setItem(ACCENT_KEY, String(hue)).catch(() => {});
        }
      }
    };
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void syncFromProfile(data.session.user.id);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void syncFromProfile(session.user.id);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const isDark = mode === 'dark';
    return {
      mode,
      isDark,
      accentHue,
      colors: buildColors(isDark, accentHue),
      shadows: buildShadows(isDark),
      setMode: (next) => {
        setModeState(next);
        AsyncStorage.setItem(MODE_KEY, next).catch(() => {});
      },
      setAccentHue: (hue) => {
        setAccentHueState(hue);
        AsyncStorage.setItem(ACCENT_KEY, String(hue)).catch(() => {});
      },
    };
  }, [mode, accentHue]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

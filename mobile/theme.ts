// Design tokens — mirror web app CSS tokens (app/src/index.css) cho light theme
// Màu oklch của web đã được chuyển sẵn sang hex/rgba gần đúng cho React Native.

export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
} as const;

export const colors = {
  // nền trang + gradient auth/room (web: --ff-page-gradient)
  pageBg: '#eef6f8',
  pageGradient: ['#dff1f4', '#cfe6f2', '#e6f4ee'] as const,
  // accent (web: --ff-accent oklch(0.74 0.085 195))
  accent: '#54cfb8',
  accentDark: '#2fa08a',
  accentSoft: '#cdeee6',
  accentTint: '#f0faf7',
  onAccent: '#1e3549',
  onAccentSoft: '#2c3f55',
  logoGradient: ['#54cfb8', '#4d9fc4'] as const,
  // text tiers (web: --ff-text-primary / text-2 / text-3)
  text: '#2c3f55',
  body: '#33475e',
  muted: 'rgba(51, 71, 94, 0.62)',
  faint: 'rgba(51, 71, 94, 0.45)',
  // surface (web: --ff-surface-1/2/3)
  surface: '#ffffff',
  surface2: '#f3f7f8',
  surface3: '#e8eef0',
  neutralFill: 'rgba(238, 246, 248, 0.85)',
  // borders
  border: 'rgba(51, 71, 94, 0.14)',
  borderStrong: 'rgba(51, 71, 94, 0.3)',
  // semantic
  danger: '#7a3f2c',
  dangerBright: '#e5484d',
  success: '#2f8f68',
} as const;

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

// shadows (web: rgba(58,98,126,...))
export const shadows = {
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
} as const;
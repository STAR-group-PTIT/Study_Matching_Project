// i18n nhẹ cho mobile — chưa cần react-i18next, chỉ cần dict vi/en + persist.
// Mặc định theo ngôn ngữ thiết bị (expo-localization), fallback 'vi' như web.

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';

export type Lang = 'vi' | 'en';

type Dict = Record<string, string>;

const vi: Dict = {
  'common.loading': 'Đang tải…',
  'common.cancel': 'Huỷ',
  'common.close': 'Đóng',
  'common.logout': 'Đăng xuất',
  'auth.login': 'Đăng nhập',
  'auth.signup': 'Đăng ký',
  'auth.welcomeBack': 'Chào bạn trở lại',
  'auth.createAccount': 'Tạo tài khoản mới',
  'auth.loginSubtitle': 'Đăng nhập để tìm phòng học và kết nối bạn học cùng.',
  'auth.signupSubtitle': 'Vài giây để tạo tài khoản, sau đó vào phòng học ngay.',
  'auth.name': 'Tên của bạn',
  'auth.namePlaceholder': 'VD: Minh Anh',
  'auth.email': 'Email',
  'auth.emailPlaceholder': 'ban@email.com',
  'auth.password': 'Mật khẩu',
  'auth.passwordPlaceholder': 'Tối thiểu 6 ký tự',
  'auth.show': 'Hiện',
  'auth.hide': 'Ẩn',
  'auth.requiredFields': 'Vui lòng nhập email và mật khẩu.',
  'auth.loginButton': 'Đăng nhập',
  'auth.signupButton': 'Tạo tài khoản',
  'auth.googleLogin': 'Đăng nhập với Google',
  'auth.googleSignup': 'Đăng ký với Google',
  'auth.googleNotConfigured': 'Đăng nhập Google chưa được cấu hình trên mobile — hãy dùng email và mật khẩu.',
  'auth.terms': 'Bằng cách tiếp tục, bạn đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư của chúng tôi.',
  'auth.or': 'hoặc',
  'rooms.openCount': '{{count}} phòng đang mở',
  'rooms.offline': 'dữ liệu ngoại tuyến',
  'rooms.empty': 'Chưa có phòng nào đang mở.',
  'rooms.hostLine': 'Host {{name}} · {{minutes}} phút · {{lang}}',
  'rooms.full': 'Đầy',
  'rooms.join': 'Tham gia',
  'rooms.title': 'Phòng học',
};

const en: Dict = {
  'common.loading': 'Loading…',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.logout': 'Log out',
  'auth.login': 'Log in',
  'auth.signup': 'Sign up',
  'auth.welcomeBack': 'Welcome back',
  'auth.createAccount': 'Create a new account',
  'auth.loginSubtitle': 'Log in to find study rooms and connect with study buddies.',
  'auth.signupSubtitle': 'A few seconds to create an account, then join a room right away.',
  'auth.name': 'Your name',
  'auth.namePlaceholder': 'e.g. Minh Anh',
  'auth.email': 'Email',
  'auth.emailPlaceholder': 'you@email.com',
  'auth.password': 'Password',
  'auth.passwordPlaceholder': 'At least 6 characters',
  'auth.show': 'Show',
  'auth.hide': 'Hide',
  'auth.requiredFields': 'Please enter your email and password.',
  'auth.loginButton': 'Log in',
  'auth.signupButton': 'Create account',
  'auth.googleLogin': 'Continue with Google',
  'auth.googleSignup': 'Sign up with Google',
  'auth.googleNotConfigured': 'Google login is not configured on mobile yet — use email and password instead.',
  'auth.terms': 'By continuing, you agree to our Terms of Service and Privacy Policy.',
  'auth.or': 'or',
  'rooms.openCount': '{{count}} rooms open',
  'rooms.offline': 'offline data',
  'rooms.empty': 'No rooms are open right now.',
  'rooms.hostLine': 'Host {{name}} · {{minutes}} min · {{lang}}',
  'rooms.full': 'Full',
  'rooms.join': 'Join',
  'rooms.title': 'Rooms',
};

const DICTS: Record<Lang, Dict> = { vi, en };
const LANG_KEY = 'ff-mobile-lang';

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}

type I18nContextValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue>({
  lang: 'vi',
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('vi');

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(LANG_KEY);
        if (saved === 'vi' || saved === 'en') {
          setLangState(saved);
          return;
        }
        const device = getLocales()[0]?.languageCode;
        setLangState(device === 'en' ? 'en' : 'vi');
      } catch {
        const device = getLocales()[0]?.languageCode;
        setLangState(device === 'en' ? 'en' : 'vi');
      }
    })();
  }, []);

  const value = useMemo<I18nContextValue>(() => {
    const dict = DICTS[lang];
    return {
      lang,
      setLang: (next) => {
        setLangState(next);
        AsyncStorage.setItem(LANG_KEY, next).catch(() => {});
      },
      t: (key, vars) => interpolate(dict[key] ?? vi[key] ?? key, vars),
    };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
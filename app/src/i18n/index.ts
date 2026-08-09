import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import viCommon from './locales/vi/common.json'
import enCommon from './locales/en/common.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      vi: { common: viCommon },
      en: { common: enCommon },
    },
    ns: ['common'],
    defaultNS: 'common',
    fallbackLng: 'vi',
    supportedLngs: ['vi', 'en'],
    interpolation: { escapeValue: false },
    // Chỉ đọc lựa chọn đã lưu (khi user tự đổi ở Settings) — KHÔNG tự dò ngôn ngữ trình
    // duyệt/hệ điều hành, nếu không khách máy để tiếng Anh sẽ thấy UI tiếng Anh ngay từ đầu
    // dù fallbackLng đã đặt 'vi' (fallback chỉ chạy khi detector không tìm thấy gì cả).
    detection: {
      order: ['localStorage'],
      caches: ['localStorage'],
    },
  })

export default i18n

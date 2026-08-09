import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { markOnboardingSeen } from '../lib/onboarding'

// Chào mừng khách lần đầu mở app — hiện đúng 1 lần (nhớ qua localStorage), giải thích ngắn
// gọn cái gì dùng được ngay vs cái gì cần đăng nhập, thay vì để khách tự khám phá bằng cách
// bấm nhầm rồi bị đá sang /auth (xem useRequireAuth ở store/auth.ts — cùng 1 policy, đây chỉ
// là màn giới thiệu cho policy đó).
export default function GuestOnboarding({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  function dismiss() {
    markOnboardingSeen()
    onClose()
  }

  function goToAuth() {
    markOnboardingSeen()
    navigate('/auth')
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-6"
      style={{ background: 'rgba(20,32,42,0.42)', backdropFilter: 'blur(2px)' }}
    >
      <div
        className="relative flex w-full max-w-[400px] flex-col gap-5 rounded-[30px] px-7 pt-7 pb-6"
        style={{
          background: 'var(--ff-surface-1)',
          boxShadow: '0 30px 70px rgba(38,66,86,0.3)',
          animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="flex flex-col gap-1">
          <h3 className="m-0 text-xl font-extrabold tracking-[-0.3px]" style={{ color: 'var(--ff-text-primary)' }}>
            {t('onboarding.title')}
          </h3>
          <p className="m-0 text-[13.5px] font-semibold" style={{ color: 'var(--ff-text-body)' }}>
            {t('onboarding.subtitle')}
          </p>
        </div>

        <div className="flex flex-col gap-[10px]">
          <div className="flex items-start gap-3 rounded-[18px] px-4 py-3" style={{ background: 'var(--ff-surface-2)' }}>
            <span className="mt-[1px] text-[15px]">✅</span>
            <div className="flex flex-col gap-[2px]">
              <span className="text-[13.5px] font-extrabold" style={{ color: 'var(--ff-text-primary)' }}>
                {t('onboarding.freeTitle')}
              </span>
              <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ff-text-body)' }}>
                {t('onboarding.freeBody')}
              </span>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-[18px] px-4 py-3" style={{ background: 'var(--ff-surface-2)' }}>
            <span className="mt-[1px] text-[15px]">🔒</span>
            <div className="flex flex-col gap-[2px]">
              <span className="text-[13.5px] font-extrabold" style={{ color: 'var(--ff-text-primary)' }}>
                {t('onboarding.lockedTitle')}
              </span>
              <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ff-text-body)' }}>
                {t('onboarding.lockedBody')}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-[9px]">
          <button
            onClick={goToAuth}
            className="w-full rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: 'var(--ff-btn-primary-bg)', color: 'var(--ff-btn-primary-fg)' }}
          >
            {t('onboarding.loginCta')}
          </button>
          <button
            onClick={dismiss}
            className="w-full rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-bold"
            style={{ background: 'var(--ff-surface-2)', color: 'var(--ff-text-body)' }}
          >
            {t('onboarding.guestCta')}
          </button>
        </div>
      </div>
    </div>
  )
}

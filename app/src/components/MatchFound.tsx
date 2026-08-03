import { useTranslation } from 'react-i18next'
import { levelFromTotalMinutes, type PublicProfileStats } from '../lib/quickMatch'

// Overlay "Đã ghép cặp!" — card hồ sơ người cùng học (tên, avatar, phút tuần này,
// cấp độ, lượt yêu thích) hiển thị khi ghép ngẫu nhiên thành công, dùng chung cho
// cả Dashboard (nút Ghép ngay) lẫn màn Matching (Giai đoạn 9).
export default function MatchFound({
  partner,
  roomCode,
  roomLabel,
  onEnter,
  onClose,
}: {
  partner: PublicProfileStats | null
  roomCode: string
  roomLabel: string
  onEnter: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  const name = partner?.name || t('matchFound.unknownName')
  const hue = partner?.accent_hue ?? 195
  const level = levelFromTotalMinutes(partner?.total_minutes ?? 0)
  const weekly = partner?.weekly_minutes ?? 0
  const likes = partner?.likes_received ?? 0

  const LEVEL_HUES = [170, 195, 45, 265]
  const levelHue = LEVEL_HUES[level]

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'rgba(38,66,86,0.32)', backdropFilter: 'blur(7px)' }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative flex max-h-[90svh] w-full max-w-[400px] flex-col items-center gap-[18px] overflow-y-auto rounded-[30px] bg-white px-7 pt-8 pb-6 text-center"
        style={{ boxShadow: '0 30px 70px rgba(38,66,86,0.3)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        {/* ring + avatar */}
        <div className="relative flex h-[110px] w-[110px] items-center justify-center">
          <div
            className="absolute h-[110px] w-[110px] rounded-full"
            style={{ border: `2.5px solid oklch(0.82 0.09 ${hue})`, animation: 'ffRipple 3s cubic-bezier(0.24,0.6,0.3,1) infinite' }}
          />
          <div
            className="absolute h-[88px] w-[88px] rounded-full"
            style={{ background: `oklch(0.92 0.05 ${hue})`, animation: 'ffBreathe 3s ease-in-out infinite' }}
          />
          {partner?.avatar_url ? (
            <img
              src={partner.avatar_url}
              alt={name}
              className="relative h-[68px] w-[68px] rounded-full object-cover"
              style={{ boxShadow: '0 8px 20px rgba(58,98,126,0.2)' }}
            />
          ) : (
            <span
              className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full text-[26px] font-extrabold"
              style={{
                background: `oklch(0.85 0.06 ${hue})`,
                color: `oklch(0.4 0.09 ${hue})`,
                boxShadow: '0 8px 20px rgba(58,98,126,0.2)',
              }}
            >
              {name.trim().charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-[7px]">
          <h3 className="m-0 text-[23px] font-extrabold tracking-[-0.4px] text-[#2c3f55]">
            {t('matchFound.title')}
          </h3>
          <p className="m-0 text-[14px] leading-[1.55] font-semibold text-[rgba(51,71,94,0.58)]">
            {t('matchFound.subtitle', { name })}
          </p>
          <span
            className="mx-auto mt-1 rounded-full px-[13px] py-[6px] text-[12px] font-extrabold tracking-[0.3px] text-[#35566b]"
            style={{ background: 'rgba(240,248,250,0.95)', boxShadow: 'inset 0 0 0 1.5px rgba(51,71,94,0.08)' }}
          >
            {roomLabel} · {roomCode}
          </span>
        </div>

        {/* 3 stats */}
        <div className="grid w-full grid-cols-3 gap-[9px]">
          <div className="flex flex-col items-center gap-[4px] rounded-[18px] py-[13px]">
            <span className="text-[18px] leading-none font-extrabold text-[#2c5b53] tabular-nums">{weekly}</span>
            <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.52)]">
              {t('matchFound.stats.weekly')}
            </span>
          </div>
          <div
            className="flex flex-col items-center gap-[4px] rounded-[18px] py-[13px]"
            style={{ background: `oklch(0.94 0.04 ${levelHue})` }}
          >
            <span className="text-[13px] leading-none font-extrabold" style={{ color: `oklch(0.42 0.08 ${levelHue})` }}>
              {t(`matchFound.levels.l${level}`)}
            </span>
            <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.52)]">{t('matchFound.stats.level')}</span>
          </div>
          <div className="flex flex-col items-center gap-[4px] rounded-[18px] py-[13px]">
            <span className="flex items-center gap-[5px] text-[18px] leading-none font-extrabold text-[#b4577a] tabular-nums">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 20.3l-1.5-1.36C5.6 14.4 2.8 11.9 2.8 8.8 2.8 6.2 4.8 4.2 7.4 4.2c1.5 0 2.9.7 3.8 1.9a4.7 4.7 0 013.8-1.9c2.6 0 4.6 2 4.6 4.6 0 3.1-2.8 5.6-7.7 10.1z" />
              </svg>
              {likes}
            </span>
            <span className="text-[11.5px] font-bold text-[rgba(51,71,94,0.52)]">{t('matchFound.stats.likes')}</span>
          </div>
        </div>

        <div className="flex w-full gap-[9px]">
          <button
            onClick={onClose}
            className="flex-1 rounded-[20px] border-[1.5px] border-[rgba(51,71,94,0.16)] bg-white py-[13px] font-sans text-[14.5px] font-extrabold text-[#43596f] hover:!bg-[rgba(240,248,250,0.8)]"
          >
            {t('matchFound.close')}
          </button>
          <button
            onClick={onEnter}
            className="flex-[1.4] rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: 'var(--ff-accent-soft)', boxShadow: '0 10px 22px rgba(58,98,126,0.16)' }}
          >
            {t('matchFound.enter')}
          </button>
        </div>
      </div>
    </div>
  )
}

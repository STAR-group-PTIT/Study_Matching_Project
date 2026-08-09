import { useTranslation } from 'react-i18next'
import { levelFromTotalMinutes, type PublicProfileStats } from '../lib/quickMatch'

const LEVEL_HUES = [170, 195, 45, 265]

// Overlay "Đã ghép nhóm!" — hiện sau khi ghép ngẫu nhiên thành công. Từ 0018, ghép theo
// NHÓM 5 người (chờ đủ 5 mới tạo phòng) nên hiện danh sách tối đa 4 người cùng vào phòng,
// thay vì 1 card chi tiết cho đúng 1 partner như bản ghép cặp cũ.
export default function MatchFound({
  partners,
  roomCode,
  roomLabel,
  onEnter,
  onClose,
}: {
  partners: PublicProfileStats[]
  roomCode: string
  roomLabel: string
  onEnter: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'var(--c-a8smro)', backdropFilter: 'blur(7px)' }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative flex max-h-[90svh] w-full max-w-[400px] flex-col items-center gap-[18px] overflow-y-auto rounded-[30px] bg-white px-7 pt-8 pb-6 text-center"
        style={{ boxShadow: '0 30px 70px var(--c-13a6mpo)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        {/* ring + icon nhóm (không còn avatar 1 người vì giờ ghép nhiều người cùng lúc) */}
        <div className="relative flex h-[110px] w-[110px] items-center justify-center">
          <div
            className="absolute h-[110px] w-[110px] rounded-full"
            style={{ border: '2.5px solid var(--c-1feykz6)', animation: 'ffRipple 3s cubic-bezier(0.24,0.6,0.3,1) infinite' }}
          />
          <div
            className="absolute h-[88px] w-[88px] rounded-full"
            style={{ background: 'var(--c-1fnms9h)', animation: 'ffBreathe 3s ease-in-out infinite' }}
          />
          <span className="relative flex h-[68px] w-[68px] items-center justify-center rounded-full text-[var(--c-1j1jqr4)]" style={{ boxShadow: '0 8px 20px var(--c-1w98bv5)', background: 'var(--c-vvd254)' }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="3" />
              <circle cx="16.5" cy="9" r="2.4" />
              <path d="M2.3 19c.6-3.3 2.8-5 5.7-5s5.1 1.7 5.7 5" />
              <path d="M14.5 14.3c2.2.3 3.7 1.8 4.2 4.2" />
            </svg>
          </span>
        </div>

        <div className="flex flex-col gap-[7px]">
          <h3 className="m-0 text-[23px] font-extrabold tracking-[-0.4px] text-[var(--c-3bsl4p)]">
            {t('matchFound.title')}
          </h3>
          <p className="m-0 text-[14px] leading-[1.55] font-semibold text-[var(--c-1kei8ee)]">
            {t('matchFound.subtitleGroup', { count: partners.length })}
          </p>
          <span
            className="mx-auto mt-1 rounded-full px-[13px] py-[6px] text-[12px] font-extrabold tracking-[0.3px] text-[var(--c-33jyo4)]"
            style={{ background: 'var(--c-9zmnnf)', boxShadow: 'inset 0 0 0 1.5px var(--c-dhk645)' }}
          >
            {roomLabel} · {roomCode}
          </span>
        </div>

        {/* danh sách người cùng nhóm */}
        <div className="flex w-full flex-col gap-[8px]">
          {partners.length === 0 && (
            <span className="text-[12.5px] font-semibold text-[var(--c-1kei7l4)]">
              {t('matchFound.noPartnersYet')}
            </span>
          )}
          {partners.map((p, i) => {
            const name = p.name || t('matchFound.unknownName')
            const hue = p.accent_hue ?? 195
            const level = levelFromTotalMinutes(p.total_minutes ?? 0)
            const levelHue = LEVEL_HUES[level]
            return (
              <div
                key={i}
                className="flex items-center gap-[10px] rounded-[18px] px-[13px] py-[9px]"
                style={{ background: 'var(--c-1h0taas)' }}
              >
                {p.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt={name}
                    className="h-8 w-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold"
                    style={{ background: `oklch(0.85 0.06 ${hue})`, color: `oklch(0.4 0.09 ${hue})` }}
                  >
                    {name.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="flex-1 truncate text-left text-sm font-bold text-[var(--c-3bsl4p)]">{name}</span>
                <span
                  className="shrink-0 rounded-full px-[9px] py-[3px] text-[11px] font-extrabold"
                  style={{ background: `oklch(0.94 0.04 ${levelHue})`, color: `oklch(0.42 0.08 ${levelHue})` }}
                >
                  {t(`matchFound.levels.l${level}`)}
                </span>
              </div>
            )
          })}
        </div>

        <div className="flex w-full gap-[9px]">
          <button
            onClick={onClose}
            className="flex-1 rounded-[20px] border-[1.5px] border-[var(--c-1kei5dw)] bg-white py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-3ji23s)] hover:!bg-[var(--c-1h0tabn)]"
          >
            {t('matchFound.close')}
          </button>
          <button
            onClick={onEnter}
            className="flex-[1.4] rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5"
            style={{ background: 'var(--ff-accent-soft)', boxShadow: '0 10px 22px var(--c-1k1wm4q)' }}
          >
            {t('matchFound.enter')}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { levelFromTotalMinutes, type PublicProfileStats } from '../lib/quickMatch'

const LEVEL_HUES = [170, 195, 45, 265]

// Overlay "đang trong lobby" — thay cho spinner trắng + số đếm ước lượng cũ (GĐ9). Hiện phòng
// đang hình thành THẬT: ai đã vào (Realtime, sống), còn thiếu bao nhiêu, và đếm ngược ân hạn.
// Cùng 1 component xử lý luôn trạng thái 'expired' (hết giờ mà không đủ ≥2 người) — chung
// khung hình/card với MatchFound.tsx (copy JSX thẻ thành viên), chỉ khác phần chân trang.
export default function LobbyWaiting({
  members,
  memberCount,
  capacity,
  secondsRemaining,
  expired,
  matchError,
  onCancel,
  onRetry,
}: {
  members: PublicProfileStats[]
  memberCount: number
  capacity: number
  secondsRemaining: number | null
  expired: boolean
  matchError: string
  onCancel: () => void
  onRetry: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'var(--c-a8smro)', backdropFilter: 'blur(7px)' }}
    >
      {!expired && <div className="absolute inset-0" onClick={onCancel} />}
      <div
        className="relative flex max-h-[90svh] w-full max-w-[400px] flex-col items-center gap-[18px] overflow-y-auto rounded-[30px] bg-white px-7 pt-8 pb-6 text-center"
        style={{ boxShadow: '0 30px 70px var(--c-13a6mpo)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        <div className="relative flex h-[100px] w-[100px] items-center justify-center">
          {!expired && (
            <div
              className="absolute h-[100px] w-[100px] rounded-full"
              style={{ border: '2px solid var(--c-1bxn7i6)', animation: 'ffRipple 3.4s cubic-bezier(0.24,0.6,0.3,1) infinite' }}
            />
          )}
          <div
            className="absolute h-[76px] w-[76px] rounded-full"
            style={{ background: 'var(--c-1h0taci)', boxShadow: '0 10px 26px var(--c-1k1wm25)' }}
          />
          <span className="relative text-xl font-extrabold text-[var(--c-3bsl4p)] tabular-nums">
            {memberCount}/{capacity}
          </span>
        </div>

        <div className="flex flex-col gap-[6px]">
          <span className="text-[17px] font-extrabold tracking-[-0.2px] text-[var(--c-3bsl4p)]">
            {matchError ? t('lobby.errorTitle') : expired ? t('lobby.expiredTitle') : t('lobby.title')}
          </span>
          <span className="text-[13px] leading-[1.5] font-semibold text-[var(--c-1kei8bt)]">
            {matchError
              ? t('matching.errors.' + matchError)
              : expired
                ? t('lobby.expiredHint')
                : secondsRemaining !== null
                  ? t('lobby.countdown', { seconds: secondsRemaining })
                  : t('lobby.progress', { count: memberCount, capacity })}
          </span>
        </div>

        {members.length > 0 && (
          <div className="flex w-full flex-col gap-[8px]">
            {members.map((p, i) => {
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
                    <img src={p.avatar_url} alt={name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
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
        )}

        {expired ? (
          <div className="flex w-full gap-[9px]">
            <button
              onClick={onCancel}
              className="flex-1 rounded-[20px] border-[1.5px] border-[var(--c-1kei5dw)] bg-white py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-3ji23s)] hover:!bg-[var(--c-1h0tabn)]"
            >
              {t('lobby.cancel')}
            </button>
            <button
              onClick={onRetry}
              className="flex-[1.4] rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5"
              style={{ background: 'var(--ff-accent-soft)', boxShadow: '0 10px 22px var(--c-1k1wm4q)' }}
            >
              {t('lobby.retry')}
            </button>
          </div>
        ) : (
          <button
            onClick={onCancel}
            className="rounded-[20px] border-none px-[26px] py-[12px] font-sans text-[14px] font-extrabold text-[var(--c-3ji23s)] hover:!bg-[var(--c-9zmnnf)]"
            style={{ background: 'var(--c-1h0taci)' }}
          >
            {t('lobby.cancel')}
          </button>
        )}
      </div>
    </div>
  )
}

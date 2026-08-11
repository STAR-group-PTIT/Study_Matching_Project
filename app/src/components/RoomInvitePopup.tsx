import { useTranslation } from 'react-i18next'
import type { RoomInviteRow } from '../lib/friends'

// Popup gián đoạn màn hình khi được bạn bè mời vào room đang học — cố tình khẩn hơn
// FriendsPanel (chỉ hiện badge) vì tính chất "vào học cùng ngay". Cùng khuôn hiển thị
// với MatchFound.tsx (backdrop + card, dumb component, không tự subscribe/giữ state).
export default function RoomInvitePopup({
  invite,
  pending,
  onAccept,
  onDecline,
}: {
  invite: RoomInviteRow
  pending: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  const { t } = useTranslation()

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-6"
      style={{ background: 'var(--c-a8smro)', backdropFilter: 'blur(7px)' }}
    >
      <div className="absolute inset-0" onClick={onDecline} />
      <div
        className="relative flex max-h-[85svh] w-full max-w-[380px] flex-col items-center gap-[16px] overflow-y-auto rounded-[30px] bg-white px-7 pt-8 pb-6 text-center"
        style={{ boxShadow: '0 30px 70px var(--c-13a6mpo)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        <span
          className="flex h-[64px] w-[64px] items-center justify-center rounded-full text-[24px] font-extrabold"
          style={{ background: 'var(--c-vvd254)', color: 'var(--c-1j1jqr4)' }}
        >
          {invite.inviter_name.trim().charAt(0).toUpperCase()}
        </span>

        <div className="flex flex-col gap-[7px]">
          <h3 className="m-0 text-[20px] font-extrabold tracking-[-0.3px] text-[var(--c-3bsl4p)]">
            {t('roomInvite.title')}
          </h3>
          <p className="m-0 text-[14px] leading-[1.55] font-semibold text-[var(--c-1kei8ee)]">
            {t('roomInvite.subtitle', {
              name: `${invite.inviter_name}#${invite.inviter_tag}`,
              room: invite.room_name,
            })}
          </p>
        </div>

        <div className="flex w-full gap-[9px]">
          <button
            onClick={onDecline}
            disabled={pending}
            className="flex-1 rounded-[20px] border-[1.5px] border-[var(--c-1kei5dw)] bg-white py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-3ji23s)] disabled:opacity-50 hover:!bg-[var(--c-1h0tabn)]"
          >
            {t('roomInvite.decline')}
          </button>
          <button
            onClick={onAccept}
            disabled={pending}
            className="flex-[1.4] rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 disabled:opacity-50 hover:-translate-y-0.5"
            style={{ background: 'var(--ff-accent-soft)', boxShadow: '0 10px 22px var(--c-1k1wm4q)' }}
          >
            {t('roomInvite.accept')}
          </button>
        </div>
      </div>
    </div>
  )
}

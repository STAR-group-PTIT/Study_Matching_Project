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
      style={{ background: 'rgba(38,66,86,0.32)', backdropFilter: 'blur(7px)' }}
    >
      <div className="absolute inset-0" onClick={onDecline} />
      <div
        className="relative flex w-full max-w-[380px] flex-col items-center gap-[16px] rounded-[30px] bg-white px-7 pt-8 pb-6 text-center"
        style={{ boxShadow: '0 30px 70px rgba(38,66,86,0.3)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        <span
          className="flex h-[64px] w-[64px] items-center justify-center rounded-full text-[24px] font-extrabold"
          style={{ background: 'oklch(0.85 0.06 195)', color: 'oklch(0.4 0.09 195)' }}
        >
          {invite.inviter_name.trim().charAt(0).toUpperCase()}
        </span>

        <div className="flex flex-col gap-[7px]">
          <h3 className="m-0 text-[20px] font-extrabold tracking-[-0.3px] text-[#2c3f55]">
            {t('roomInvite.title')}
          </h3>
          <p className="m-0 text-[14px] leading-[1.55] font-semibold text-[rgba(51,71,94,0.58)]">
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
            className="flex-1 rounded-[20px] border-[1.5px] border-[rgba(51,71,94,0.16)] bg-white py-[13px] font-sans text-[14.5px] font-extrabold text-[#43596f] disabled:opacity-50 hover:!bg-[rgba(240,248,250,0.8)]"
          >
            {t('roomInvite.decline')}
          </button>
          <button
            onClick={onAccept}
            disabled={pending}
            className="flex-[1.4] rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[#1e3549] transition-transform duration-200 disabled:opacity-50 hover:-translate-y-0.5"
            style={{ background: 'var(--ff-accent-soft)', boxShadow: '0 10px 22px rgba(58,98,126,0.16)' }}
          >
            {t('roomInvite.accept')}
          </button>
        </div>
      </div>
    </div>
  )
}

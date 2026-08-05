import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// GĐ9: khi chủ phòng bấm "Rời phòng" mà vẫn còn người khác trong phòng, trước đây chủ chỉ
// lặng lẽ rời còn `rooms.host_id` vẫn trỏ tới người đã đi mất — phòng bị "mồ côi", không ai
// điều khiển được Pomodoro/duyệt thành viên nữa. Modal này bắt chủ chọn 1 trong 2: đóng hẳn
// phòng (kick tất cả), hoặc chuyển quyền cho 1 người khác rồi mới rời.
export default function HostLeaveModal({
  members,
  error,
  onClose,
  onCloseRoom,
  onTransfer,
}: {
  members: { id: string; name: string }[]
  error?: boolean
  onClose: () => void
  onCloseRoom: () => void
  onTransfer: (newHostId: string) => void
}) {
  const { t } = useTranslation()
  const [step, setStep] = useState<'choose' | 'pick'>('choose')

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'rgba(38,66,86,0.32)', backdropFilter: 'blur(7px)' }}
    >
      <div className="absolute inset-0" onClick={onClose} />
      <div
        className="relative flex max-h-[85svh] w-full max-w-[380px] flex-col gap-[16px] overflow-y-auto rounded-[30px] bg-white px-7 pt-7 pb-6"
        style={{ boxShadow: '0 30px 70px rgba(38,66,86,0.3)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        {step === 'choose' ? (
          <>
            <div className="flex flex-col gap-[5px]">
              <h3 className="m-0 text-xl font-extrabold tracking-[-0.3px] text-[#2c3f55]">
                {t('room.hostLeave.title')}
              </h3>
              <p className="m-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
                {t('room.hostLeave.desc')}
              </p>
            </div>
            {error && (
              <p className="m-0 rounded-[16px] px-[13px] py-[10px] text-[12.5px] font-semibold text-[#7a3f2c]" style={{ background: 'oklch(0.93 0.04 45)' }}>
                {t('room.hostLeave.transferFailed')}
              </p>
            )}
            <div className="flex flex-col gap-[9px]">
              <button
                onClick={onCloseRoom}
                className="flex flex-col gap-[3px] rounded-[20px] border-none px-[16px] py-[13px] text-left font-sans transition-transform duration-200 hover:-translate-y-0.5"
                style={{ background: 'oklch(0.9 0.045 45)' }}
              >
                <span className="text-[14.5px] font-extrabold text-[#7a3f2c]">{t('room.hostLeave.closeTitle')}</span>
                <span className="text-[12.5px] font-semibold text-[rgba(122,63,44,0.75)]">{t('room.hostLeave.closeDesc')}</span>
              </button>
              <button
                onClick={() => setStep('pick')}
                disabled={members.length === 0}
                className="flex flex-col gap-[3px] rounded-[20px] border-none px-[16px] py-[13px] text-left font-sans transition-transform duration-200 hover:enabled:-translate-y-0.5 disabled:opacity-50"
                style={{ background: 'var(--ff-accent-soft)' }}
              >
                <span className="text-[14.5px] font-extrabold text-[#1e3549]">{t('room.hostLeave.transferTitle')}</span>
                <span className="text-[12.5px] font-semibold text-[rgba(30,53,73,0.7)]">
                  {members.length === 0 ? t('room.hostLeave.transferNoOne') : t('room.hostLeave.transferDesc')}
                </span>
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-full rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[#43596f] hover:!bg-[rgba(240,248,250,0.9)]"
              style={{ background: 'rgba(240,248,250,0.9)' }}
            >
              {t('room.hostLeave.cancel')}
            </button>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-[5px]">
              <h3 className="m-0 text-xl font-extrabold tracking-[-0.3px] text-[#2c3f55]">
                {t('room.hostLeave.pickTitle')}
              </h3>
              <p className="m-0 text-[13.5px] font-semibold text-[rgba(51,71,94,0.55)]">
                {t('room.hostLeave.pickDesc')}
              </p>
            </div>
            <div className="flex flex-col gap-[9px]">
              {members.map((m, i) => {
                const hue = (195 + i * 42) % 360
                return (
                  <button
                    key={m.id}
                    onClick={() => onTransfer(m.id)}
                    className="flex items-center gap-[10px] rounded-[18px] border-none px-[14px] py-[10px] text-left font-sans transition-colors duration-200 hover:!bg-[rgba(240,248,250,1)]"
                    style={{ background: 'rgba(240,248,250,0.9)', boxShadow: 'inset 0 0 0 1.5px rgba(51,71,94,0.07)' }}
                  >
                    <span
                      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold"
                      style={{ background: `oklch(0.9 0.05 ${hue})`, color: `oklch(0.42 0.08 ${hue})` }}
                    >
                      {m.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate text-[14px] font-extrabold text-[#2c3f55]">{m.name}</span>
                  </button>
                )
              })}
            </div>
            <button
              onClick={() => setStep('choose')}
              className="w-full rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[#43596f] hover:!bg-[rgba(240,248,250,0.9)]"
              style={{ background: 'rgba(240,248,250,0.9)' }}
            >
              {t('room.hostLeave.back')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

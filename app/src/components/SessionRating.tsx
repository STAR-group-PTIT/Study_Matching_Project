import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

// Card đánh giá sau buổi học: thích (1 lần/người/phòng, ghi bảng session_ratings 0010)
// các thành viên đã học cùng. Hiện ở 2 lúc: phòng học xong đủ phiên (timer_done) và
// khi bấm "Rời phòng" sau khi đã có ít nhất 1 phiên focus (Giai đoạn 9).
export default function SessionRating({
  roomId,
  members,
  pendingLeave,
  onLeave,
  onClose,
}: {
  roomId: string
  members: { id: string; name: string }[]
  pendingLeave: boolean
  onLeave: () => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [ratedIds, setRatedIds] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    supabase
      .from('session_ratings')
      .select('rated_user_id')
      .eq('giver_id', user.id)
      .eq('room_id', roomId)
      .then(({ data }) => {
        if (cancelled || !data) return
        setRatedIds(new Set(data.map((r) => r.rated_user_id)))
      })
    return () => {
      cancelled = true
    }
  }, [user, roomId])

  async function like(memberId: string) {
    if (!user || ratedIds.has(memberId)) return
    setSaving(memberId)
    const { error } = await supabase.from('session_ratings').insert({
      giver_id: user.id,
      rated_user_id: memberId,
      room_id: roomId,
    })
    setSaving(null)
    if (!error) setRatedIds((prev) => new Set(prev).add(memberId))
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'var(--c-a8smro)', backdropFilter: 'blur(7px)' }}
    >
      <div className="absolute inset-0" onClick={pendingLeave ? onLeave : onClose} />
      <div
        className="relative flex max-h-[85svh] w-full max-w-[380px] flex-col gap-[16px] overflow-y-auto rounded-[30px] bg-white px-7 pt-7 pb-6"
        style={{ boxShadow: '0 30px 70px var(--c-13a6mpo)', animation: 'ffPop 380ms cubic-bezier(0.22,1,0.36,1)' }}
      >
        <div className="flex flex-col gap-[5px]">
          <h3 className="m-0 text-xl font-extrabold tracking-[-0.3px] text-[var(--c-3bsl4p)]">
            {t('room.rating.title')}
          </h3>
          <p className="m-0 text-[13.5px] font-semibold text-[var(--c-1kei8bt)]">
            {t('room.rating.subtitle')}
          </p>
        </div>

        {members.length === 0 ? (
          <p className="m-0 text-[13.5px] font-semibold text-[var(--c-1kei7l4)]">
            {t('room.rating.noOne')}
          </p>
        ) : (
          <div className="flex flex-col gap-[9px]">
            {members.map((m, i) => {
              const rated = ratedIds.has(m.id)
              const hue = (195 + i * 42) % 360
              return (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 rounded-[18px] px-[14px] py-[10px]"
                  style={{ background: 'var(--c-1h0taci)', boxShadow: 'inset 0 0 0 1.5px var(--c-dhk63a)' }}
                >
                  <div className="flex min-w-0 items-center gap-[10px]">
                    <span
                      className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold"
                      style={{ background: `oklch(0.9 0.05 ${hue})`, color: `oklch(0.42 0.08 ${hue})` }}
                    >
                      {m.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate text-[14px] font-extrabold text-[var(--c-3bsl4p)]">{m.name}</span>
                  </div>
                  <button
                    onClick={() => void like(m.id)}
                    disabled={rated || saving === m.id}
                    title={rated ? t('room.rating.liked') : t('room.rating.like')}
                    className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full border-none transition-transform duration-200 hover:enabled:-translate-y-0.5 disabled:cursor-default"
                    style={
                      rated
                        ? { background: 'var(--c-vukw3w)', color: 'var(--c-pc4fdf)' }
                        : { background: 'var(--c-6rf20v)', color: 'var(--c-mfvyic)' }
                    }
                  >
                    {rated ? (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 20.3l-1.5-1.36C5.6 14.4 2.8 11.9 2.8 8.8 2.8 6.2 4.8 4.2 7.4 4.2c1.5 0 2.9.7 3.8 1.9a4.7 4.7 0 013.8-1.9c2.6 0 4.6 2 4.6 4.6 0 3.1-2.8 5.6-7.7 10.1z" />
                      </svg>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
                        <path d="M12 20.3l-1.5-1.36C5.6 14.4 2.8 11.9 2.8 8.8 2.8 6.2 4.8 4.2 7.4 4.2c1.5 0 2.9.7 3.8 1.9a4.7 4.7 0 013.8-1.9c2.6 0 4.6 2 4.6 4.6 0 3.1-2.8 5.6-7.7 10.1z" />
                      </svg>
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {pendingLeave ? (
          <button
            onClick={onLeave}
            className="w-full rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-3ji23s)] hover:!bg-[var(--c-1h0taci)]"
            style={{ background: 'var(--c-1h0taci)' }}
          >
            {t('room.rating.leave')}
          </button>
        ) : (
          <button
            onClick={onClose}
            className="w-full rounded-[20px] border-none py-[13px] font-sans text-[14.5px] font-extrabold text-[var(--c-3ji23s)] hover:!bg-[var(--c-1h0taci)]"
            style={{ background: 'var(--c-1h0taci)' }}
          >
            {t('room.rating.close')}
          </button>
        )}
      </div>
    </div>
  )
}

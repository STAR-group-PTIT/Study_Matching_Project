import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

const MAX_NAME_LENGTH = 40

export default function EditInfoModal({
  currentName,
  onClose,
  onSaved,
}: {
  currentName: string
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!user) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('settings.editInfoModal.nameRequired'))
      return
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      setError(t('settings.editInfoModal.nameTooLong'))
      return
    }
    setSaving(true)
    setError(null)
    const { error: updErr } = await supabase.from('profiles').update({ name: trimmed }).eq('id', user.id)
    setSaving(false)
    if (updErr) {
      // unique_violation trên (lower(name), tag) — cực hiếm vì tag ngẫu nhiên 4 số, nhưng vẫn
      // có thể trùng đúng lúc đổi tên. Xem 0016_friends.sql.
      setError(updErr.code === '23505' ? t('settings.editInfoModal.nameTaken') : t('settings.editInfoModal.saveFailed'))
      return
    }
    onSaved(trimmed)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'var(--c-a8smro)', backdropFilter: 'blur(7px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex w-full max-w-[380px] flex-col gap-5 rounded-[30px] bg-white px-7 pt-7 pb-6"
        style={{ boxShadow: '0 30px 70px var(--c-13a6mpo)' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[18px] font-extrabold text-[var(--c-3bsl4p)]">{t('settings.editInfoModal.title')}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-[var(--c-rucw5u)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <label className="flex flex-col gap-[6px]">
          <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
            {t('settings.editInfoModal.nameLabel')}
          </span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave()
            }}
            placeholder={t('settings.editInfoModal.namePlaceholder')}
            maxLength={MAX_NAME_LENGTH}
            autoFocus
            className="rounded-[16px] border-none px-4 py-3 font-sans text-sm font-bold text-[var(--c-3bsl4p)] outline-none"
            style={{ background: 'var(--c-rucw5u)' }}
          />
        </label>

        {error && <span className="text-[12.5px] font-semibold text-[var(--c-otf3yh)]">{error}</span>}

        <div className="flex justify-end gap-[9px]">
          <button
            onClick={onClose}
            className="rounded-[20px] border-[1.5px] border-[var(--c-1kei5c6)] bg-[var(--c-ijr2vy)] px-5 py-[12px] font-sans text-sm font-bold text-[var(--c-3k2pts)] transition-colors duration-200 hover:!bg-white"
          >
            {t('settings.editInfoModal.cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-[20px] border-none px-5 py-[12px] font-sans text-sm font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
            style={{ background: 'var(--ff-accent-soft)' }}
          >
            {saving ? t('settings.editInfoModal.saving') : t('settings.editInfoModal.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

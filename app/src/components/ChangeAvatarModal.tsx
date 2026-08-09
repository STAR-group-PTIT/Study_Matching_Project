import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'

const MAX_AVATAR_BYTES = 5 * 1024 * 1024
const MAX_AVATAR_EDGE = 480
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

// Avatar chỉ hiển thị nhỏ (vòng tròn ~80px lớn nhất) nhưng ảnh chụp điện thoại thường
// 3000px+ cạnh dài — co về tối đa 480px trước khi upload, đủ nét cho mọi chỗ dùng trong app
// (kể cả retina) mà nhẹ hơn nhiều so với ảnh gốc.
async function resizeAvatar(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  if (bitmap.width <= MAX_AVATAR_EDGE && bitmap.height <= MAX_AVATAR_EDGE) {
    bitmap.close()
    return file
  }
  const scale = MAX_AVATAR_EDGE / Math.max(bitmap.width, bitmap.height)
  const targetWidth = Math.round(bitmap.width * scale)
  const targetHeight = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, file.type, 0.9))
  if (!blob) return file
  return new File([blob], file.name, { type: blob.type })
}

// Rút path bên trong bucket `avatars` từ 1 public URL đã lưu ở avatar_url, để xoá file cũ khi
// đổi ảnh mới — tránh rác tích luỹ trong storage mỗi lần user đổi avatar.
function pathFromAvatarUrl(url: string): string | null {
  const marker = '/avatars/'
  const i = url.indexOf(marker)
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split('?')[0])
}

export default function ChangeAvatarModal({
  currentAvatarUrl,
  displayName,
  onClose,
  onUploaded,
}: {
  currentAvatarUrl: string | null
  displayName: string
  onClose: () => void
  onUploaded: (url: string) => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  function pickFile(file: File | undefined) {
    if (!file) return
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError(t('settings.avatarModal.invalidType'))
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError(t('settings.avatarModal.tooLarge'))
      return
    }
    setError(null)
    setPendingFile(file)
    setPreview(URL.createObjectURL(file))
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0])
    e.target.value = ''
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    pickFile(e.dataTransfer.files?.[0])
  }

  async function handleSave() {
    if (!pendingFile || !user) return
    setUploading(true)
    setError(null)
    try {
      const file = await resizeAvatar(pendingFile).catch(() => pendingFile)
      const path = `${user.id}/${crypto.randomUUID()}-${file.name}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file)
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
      const { error: updErr } = await supabase.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', user.id)
      if (updErr) throw updErr
      const oldPath = currentAvatarUrl ? pathFromAvatarUrl(currentAvatarUrl) : null
      if (oldPath) void supabase.storage.from('avatars').remove([oldPath])
      onUploaded(pub.publicUrl)
      onClose()
    } catch (err) {
      console.error('avatar upload failed', err)
      setError(t('settings.avatarModal.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const shownUrl = preview ?? currentAvatarUrl

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'rgba(38,66,86,0.32)', backdropFilter: 'blur(7px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex w-full max-w-[380px] flex-col gap-5 rounded-[30px] bg-white px-7 pt-7 pb-6"
        style={{ boxShadow: '0 30px 70px rgba(38,66,86,0.3)' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[18px] font-extrabold text-[#2c3f55]">{t('settings.avatarModal.title')}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-[rgba(238,246,248,0.9)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center gap-3 rounded-[24px] border-2 border-dashed px-6 py-7 text-center transition-colors duration-200"
          style={{
            borderColor: dragOver ? 'rgba(126,201,198,0.9)' : 'rgba(51,71,94,0.18)',
            background: 'rgba(238,246,248,0.6)',
          }}
        >
          {shownUrl ? (
            <img src={shownUrl} alt={displayName} className="h-24 w-24 rounded-full object-cover" style={{ boxShadow: '0 8px 22px rgba(58,98,126,0.18)' }} />
          ) : (
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full text-[26px] font-extrabold text-[#294a5f]"
              style={{ background: 'linear-gradient(140deg, rgba(140,205,196,0.6), rgba(160,200,225,0.6))' }}
            >
              {(displayName.trim()[0] ?? '?').toUpperCase()}
            </div>
          )}
          <span className="text-[13px] font-bold text-[rgba(51,71,94,0.55)]">{t('settings.avatarModal.dropHint')}</span>
        </div>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handleInputChange} />

        {error && <span className="text-[12.5px] font-semibold text-[#a13f2c]">{error}</span>}

        <div className="flex justify-end gap-[9px]">
          <button
            onClick={onClose}
            className="rounded-[20px] border-[1.5px] border-[rgba(51,71,94,0.14)] bg-[rgba(255,255,255,0.8)] px-5 py-[12px] font-sans text-sm font-bold text-[#445c74] transition-colors duration-200 hover:!bg-white"
          >
            {t('settings.avatarModal.cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!pendingFile || uploading}
            className="rounded-[20px] border-none px-5 py-[12px] font-sans text-sm font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
            style={{ background: 'var(--ff-accent-soft)' }}
          >
            {uploading ? t('settings.avatarModal.saving') : t('settings.avatarModal.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

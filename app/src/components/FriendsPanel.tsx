import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useFriendStore } from '../store/friendNotifications'
import {
  acceptFriendRequest,
  findProfileByTag,
  formatFriendHandle,
  listFriendRequests,
  parseFriendHandle,
  removeFriendRequest,
  sendFriendRequest,
  type FriendRequestRow,
} from '../lib/friends'

type SendState = 'idle' | 'sending' | 'invalid' | 'not_found' | 'error' | 'sent' | 'already_sent' | 'already_friends' | 'accepted'

function otherSideOf(row: FriendRequestRow, myId: string) {
  return row.requester_id === myId
    ? { name: row.addressee_name, tag: row.addressee_tag }
    : { name: row.requester_name, tag: row.requester_tag }
}

// Overlay "Bạn bè" mở từ icon taskbar mới ở Dashboard — cùng khuôn backdrop+card với
// Settings.tsx/Stats.tsx. Gồm: handle của chính mình (để chia sẻ), ô thêm bạn bằng
// name#tag, lời mời đến/đã gửi, và danh sách bạn bè.
export default function FriendsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const pendingRequestCount = useFriendStore((s) => s.pendingRequestCount)

  const [myHandle, setMyHandle] = useState<{ name: string; tag: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [rows, setRows] = useState<FriendRequestRow[]>([])
  const [handleInput, setHandleInput] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')

  const refresh = useCallback(() => {
    if (!user) return
    listFriendRequests().then(setRows).catch(() => {})
  }, [user])

  useEffect(() => {
    if (!user) return
    supabase
      .from('profiles')
      .select('name, tag')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setMyHandle({ name: data.name, tag: data.tag })
      })
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh, pendingRequestCount])

  if (!user) return null

  function copyHandle() {
    if (!myHandle) return
    if (navigator.clipboard) navigator.clipboard.writeText(formatFriendHandle(myHandle.name, myHandle.tag)).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function handleSend() {
    const parsed = parseFriendHandle(handleInput)
    if (!parsed) {
      setSendState('invalid')
      return
    }
    setSendState('sending')
    try {
      const found = await findProfileByTag(parsed.name, parsed.tag)
      if (!found) {
        setSendState('not_found')
        return
      }
      const result = await sendFriendRequest(found.id)
      setSendState(result)
      setHandleInput('')
      refresh()
    } catch {
      setSendState('error')
    }
  }

  async function handleAccept(id: string) {
    await acceptFriendRequest(id).catch(() => {})
    refresh()
  }

  async function handleRemove(id: string) {
    await removeFriendRequest(id).catch(() => {})
    refresh()
  }

  const incoming = rows.filter((r) => r.status === 'pending' && r.addressee_id === user.id)
  const outgoing = rows.filter((r) => r.status === 'pending' && r.requester_id === user.id)
  const friends = rows.filter((r) => r.status === 'accepted')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(20,32,42,0.42)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-[32px] font-sans text-[#33475e] antialiased"
        style={{
          maxHeight: '88vh',
          background: 'linear-gradient(170deg, #e4f1f4 0%, #dbeaf2 50%, #e6f4ee 100%)',
          boxShadow: '0 30px 80px rgba(20,32,42,0.35)',
        }}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[560px] flex-col gap-[18px] px-7 pt-11 pb-[50px]">
            <div className="flex items-center gap-[11px]">
              <div
                className="h-[22px] w-[22px] rounded-[9px]"
                style={{ background: 'linear-gradient(135deg, oklch(0.82 0.09 175), oklch(0.76 0.08 235))' }}
              />
              <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[#2f4459]">{t('app.name')}</span>
              <span className="text-sm font-semibold text-[rgba(51,71,94,0.5)]">· {t('friends.headerTag')}</span>
              <button
                onClick={onClose}
                title={t('friends.close')}
                aria-label={t('friends.close')}
                className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'rgba(255,255,255,0.7)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* handle của chính mình */}
            <div
              className="flex flex-wrap items-center justify-between gap-[14px] rounded-[26px] px-6 py-5"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <div className="flex flex-col gap-[2px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  {t('friends.yourHandle')}
                </span>
                <span className="text-[19px] font-extrabold text-[#2c3f55] tabular-nums">
                  {myHandle ? formatFriendHandle(myHandle.name, myHandle.tag) : '···'}
                </span>
              </div>
              <button
                onClick={copyHandle}
                disabled={!myHandle}
                className="shrink-0 rounded-[16px] border-none px-5 py-3 font-sans text-sm font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50"
                style={{ background: 'var(--ff-accent-soft)' }}
              >
                {copied ? t('friends.copied') : t('friends.copy')}
              </button>
            </div>

            {/* thêm bạn */}
            <div
              className="flex flex-col gap-[10px] rounded-[26px] px-6 py-5"
              style={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px rgba(58,98,126,0.1)' }}
            >
              <span className="text-[15px] font-extrabold text-[#2c3f55]">{t('friends.addTitle')}</span>
              <div className="flex flex-wrap gap-[7px]">
                <input
                  value={handleInput}
                  onChange={(e) => {
                    setHandleInput(e.target.value)
                    setSendState('idle')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSend()
                  }}
                  placeholder={t('friends.addPlaceholder')}
                  className="min-w-0 flex-1 rounded-[16px] border-none px-4 py-3 font-sans text-sm font-semibold text-[#2c3f55] outline-none"
                  style={{ background: 'rgba(238,246,248,0.9)' }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={sendState === 'sending' || !handleInput.trim()}
                  className="shrink-0 rounded-[16px] border-none px-5 py-3 font-sans text-sm font-extrabold text-[#1e3549] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50"
                  style={{ background: 'var(--ff-accent-soft)' }}
                >
                  {t('friends.addButton')}
                </button>
              </div>
              {sendState !== 'idle' && sendState !== 'sending' && (
                <span
                  className="text-[12.5px] font-semibold"
                  style={{ color: sendState === 'sent' || sendState === 'accepted' ? '#2c5b53' : '#a13f2c' }}
                >
                  {t(`friends.sendState.${sendState}`)}
                </span>
              )}
            </div>

            {/* lời mời đến */}
            {incoming.length > 0 && (
              <div className="flex flex-col gap-[10px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  {t('friends.incomingTitle', { count: incoming.length })}
                </span>
                {incoming.map((r) => {
                  const other = otherSideOf(r, user.id)
                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] px-5 py-[13px]"
                      style={{ background: 'rgba(255,255,255,0.8)' }}
                    >
                      <span className="text-sm font-bold text-[#2c3f55]">{formatFriendHandle(other.name, other.tag)}</span>
                      <div className="flex gap-[7px]">
                        <button
                          onClick={() => void handleRemove(r.id)}
                          className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-bold text-[#7a3f2c]"
                          style={{ background: 'oklch(0.93 0.03 45)' }}
                        >
                          {t('friends.decline')}
                        </button>
                        <button
                          onClick={() => void handleAccept(r.id)}
                          className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-extrabold text-[#1e3549]"
                          style={{ background: 'var(--ff-accent-soft)' }}
                        >
                          {t('friends.accept')}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* lời mời đã gửi */}
            {outgoing.length > 0 && (
              <div className="flex flex-col gap-[10px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                  {t('friends.outgoingTitle', { count: outgoing.length })}
                </span>
                {outgoing.map((r) => {
                  const other = otherSideOf(r, user.id)
                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] px-5 py-[13px]"
                      style={{ background: 'rgba(255,255,255,0.8)' }}
                    >
                      <span className="text-sm font-bold text-[#2c3f55]">{formatFriendHandle(other.name, other.tag)}</span>
                      <button
                        onClick={() => void handleRemove(r.id)}
                        className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-bold text-[#43596f]"
                        style={{ background: 'rgba(238,246,248,0.9)' }}
                      >
                        {t('friends.cancel')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* danh sách bạn bè */}
            <div className="flex flex-col gap-[10px]">
              <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[rgba(51,71,94,0.5)] uppercase">
                {t('friends.listTitle', { count: friends.length })}
              </span>
              {friends.length === 0 ? (
                <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.45)]">{t('friends.noFriends')}</span>
              ) : (
                friends.map((r) => {
                  const other = otherSideOf(r, user.id)
                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] px-5 py-[13px]"
                      style={{ background: 'rgba(255,255,255,0.8)' }}
                    >
                      <span className="text-sm font-bold text-[#2c3f55]">{formatFriendHandle(other.name, other.tag)}</span>
                      <button
                        onClick={() => void handleRemove(r.id)}
                        className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-bold text-[#7a3f2c]"
                        style={{ background: 'oklch(0.93 0.03 45)' }}
                      >
                        {t('friends.remove')}
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

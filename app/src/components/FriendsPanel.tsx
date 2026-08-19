import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/auth'
import { useFriendStore } from '../store/friendNotifications'
import {
  acceptFriendRequest,
  acceptRoomInvite,
  declineRoomInvite,
  findProfileByTag,
  formatFriendHandle,
  listFriendRequests,
  listMyRoomInvites,
  parseFriendHandle,
  removeFriendRequest,
  sendFriendRequest,
  type FriendRequestRow,
  type RoomInviteRow,
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
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const pendingRequestCount = useFriendStore((s) => s.pendingRequestCount)
  const pendingInviteCount = useFriendStore((s) => s.pendingInviteCount)

  const [myHandle, setMyHandle] = useState<{ name: string; tag: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [rows, setRows] = useState<FriendRequestRow[]>([])
  const [handleInput, setHandleInput] = useState('')
  const [sendState, setSendState] = useState<SendState>('idle')

  // Lời mời vào room đang chờ — xem lại được ở đây (trước đó chỉ hiện đúng 1 lần qua popup
  // gián đoạn lúc mới tới, dễ bị lỡ nếu không có app mở đúng lúc hoặc lỡ tay bấm ra ngoài).
  const [invites, setInvites] = useState<RoomInviteRow[]>([])
  const [inviteActionId, setInviteActionId] = useState<string | null>(null)
  const [inviteResultMsg, setInviteResultMsg] = useState<{ id: string; key: string } | null>(null)

  const refresh = useCallback(() => {
    if (!user) return
    listFriendRequests().then(setRows).catch(() => {})
  }, [user])

  const refreshInvites = useCallback(() => {
    if (!user) return
    listMyRoomInvites().then(setInvites).catch(() => {})
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

  useEffect(() => {
    refreshInvites()
  }, [refreshInvites, pendingInviteCount])

  if (!user) return null

  async function handleAcceptInvite(inv: RoomInviteRow) {
    setInviteActionId(inv.id)
    setInviteResultMsg(null)
    try {
      const result = await acceptRoomInvite(inv.id)
      if (result.status === 'joined' && result.room_code) {
        onClose()
        navigate('/room/' + result.room_code)
        return
      }
      setInviteResultMsg({
        id: inv.id,
        key:
          result.status === 'full'
            ? 'roomInviteFull'
            : result.status === 'already_in_another_room'
              ? 'roomInviteAlreadyInRoom'
              : 'roomInviteClosed',
      })
      refreshInvites()
    } catch {
      setInviteResultMsg({ id: inv.id, key: 'roomInviteFull' })
    } finally {
      setInviteActionId(null)
    }
  }

  async function handleDeclineInvite(id: string) {
    setInviteActionId(id)
    try {
      await declineRoomInvite(id)
      refreshInvites()
    } catch {
      // ignore
    } finally {
      setInviteActionId(null)
    }
  }

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
  const incomingRoomInvites = invites.filter((i) => i.invitee_id === user.id)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--c-1klvacf)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex w-full max-w-[560px] flex-col overflow-hidden rounded-[32px] font-sans text-[var(--c-32fr7s)] antialiased"
        style={{
          maxHeight: '88vh',
          background: 'linear-gradient(170deg, var(--c-1fqdrzz) 0%, var(--c-1fyn1i5) 50%, var(--c-1frhffa) 100%)',
          boxShadow: '0 30px 80px var(--c-1klv9ob)',
        }}
      >
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-[560px] flex-col gap-[18px] px-7 pt-11 pb-[50px]">
            <div className="flex items-center gap-[11px]">
              <div
                className="h-[22px] w-[22px] rounded-[9px]"
                style={{ background: 'linear-gradient(135deg, var(--c-1feyjhs), var(--c-yr829))' }}
              />
              <span className="text-[18px] font-extrabold tracking-[-0.2px] text-[var(--c-3dfktp)]">{t('app.name')}</span>
              <span className="text-sm font-semibold text-[var(--c-mfvyic)]">· {t('friends.headerTag')}</span>
              <button
                onClick={onClose}
                title={t('friends.close')}
                aria-label={t('friends.close')}
                className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-none text-[var(--c-48t3yk)] transition-colors duration-200 hover:!bg-white"
                style={{ background: 'var(--c-ijr2v3)' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* handle của chính mình */}
            <div
              className="flex flex-wrap items-center justify-between gap-[14px] rounded-[26px] px-6 py-5"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <div className="flex flex-col gap-[2px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                  {t('friends.yourHandle')}
                </span>
                <span className="text-[19px] font-extrabold text-[var(--c-3bsl4p)] tabular-nums">
                  {myHandle ? formatFriendHandle(myHandle.name, myHandle.tag) : '···'}
                </span>
              </div>
              <button
                onClick={copyHandle}
                disabled={!myHandle}
                className="shrink-0 rounded-[16px] border-none px-5 py-3 font-sans text-sm font-extrabold text-[var(--ff-btn-soft-fg)] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50"
                style={{ background: 'var(--ff-btn-soft-bg)' }}
              >
                {copied ? t('friends.copied') : t('friends.copy')}
              </button>
            </div>

            {/* thêm bạn */}
            <div
              className="flex flex-col gap-[10px] rounded-[26px] px-6 py-5"
              style={{ background: 'var(--c-ijr2vy)', backdropFilter: 'blur(18px)', boxShadow: '0 14px 36px var(--c-1w98bua)' }}
            >
              <span className="text-[15px] font-extrabold text-[var(--c-3bsl4p)]">{t('friends.addTitle')}</span>
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
                  className="min-w-0 flex-1 rounded-[16px] border-none px-4 py-3 font-sans text-base font-semibold text-[var(--c-3bsl4p)] outline-none"
                  style={{ background: 'var(--c-rucw5u)' }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={sendState === 'sending' || !handleInput.trim()}
                  className="shrink-0 rounded-[16px] border-none px-5 py-3 font-sans text-sm font-extrabold text-[var(--c-2vtjkg)] transition-transform duration-200 hover:-translate-y-0.5 disabled:opacity-50"
                  style={{ background: 'var(--ff-accent-soft)' }}
                >
                  {t('friends.addButton')}
                </button>
              </div>
              {sendState !== 'idle' && sendState !== 'sending' && (
                <span
                  className="text-[12.5px] font-semibold"
                  style={{ color: sendState === 'sent' || sendState === 'accepted' ? 'var(--c-3bts4x)' : 'var(--c-otf3yh)' }}
                >
                  {t(`friends.sendState.${sendState}`)}
                </span>
              )}
            </div>

            {/* lời mời vào room — trước đây KHÔNG có chỗ nào xem lại, chỉ hiện đúng 1 lần qua
                popup gián đoạn (RoomInvitePopup) lúc Realtime bắn INSERT; lỡ không có app mở
                đúng lúc đó, hoặc lỡ tay bấm ra ngoài popup (= tự động từ chối), là mất luôn
                không dấu vết. Giờ liệt kê lại ở đây, đếm vào cùng badge với lời mời kết bạn. */}
            {incomingRoomInvites.length > 0 && (
              <div className="flex flex-col gap-[10px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                  {t('friends.roomInvitesTitle', { count: incomingRoomInvites.length })}
                </span>
                {incomingRoomInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] px-5 py-[13px]"
                    style={{ background: 'var(--c-ijr2vy)' }}
                  >
                    <div className="flex flex-col gap-[2px]">
                      <span className="text-sm font-bold text-[var(--c-3bsl4p)]">
                        {formatFriendHandle(inv.inviter_name, inv.inviter_tag)}
                      </span>
                      <span className="text-[12px] font-semibold text-[var(--c-mfvyic)]">
                        {t('friends.roomInviteSubtitle', { room: inv.room_name })}
                      </span>
                      {inviteResultMsg?.id === inv.id && (
                        <span className="text-[12px] font-bold text-[var(--c-otf3yh)]">
                          {t(`friends.${inviteResultMsg.key}`)}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-[7px]">
                      <button
                        onClick={() => void handleDeclineInvite(inv.id)}
                        disabled={inviteActionId === inv.id}
                        className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-bold text-[var(--c-5nx3vn)] disabled:opacity-50"
                        style={{ background: 'var(--c-11c6fho)' }}
                      >
                        {t('roomInvite.decline')}
                      </button>
                      <button
                        onClick={() => void handleAcceptInvite(inv)}
                        disabled={inviteActionId === inv.id}
                        className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-extrabold text-[var(--c-2vtjkg)] disabled:opacity-50"
                        style={{ background: 'var(--ff-accent-soft)' }}
                      >
                        {t('roomInvite.accept')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* lời mời đến */}
            {incoming.length > 0 && (
              <div className="flex flex-col gap-[10px]">
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                  {t('friends.incomingTitle', { count: incoming.length })}
                </span>
                {incoming.map((r) => {
                  const other = otherSideOf(r, user.id)
                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] px-5 py-[13px]"
                      style={{ background: 'var(--c-ijr2vy)' }}
                    >
                      <span className="text-sm font-bold text-[var(--c-3bsl4p)]">{formatFriendHandle(other.name, other.tag)}</span>
                      <div className="flex gap-[7px]">
                        <button
                          onClick={() => void handleRemove(r.id)}
                          className="rounded-[14px] border-none px-4 py-[13px] font-sans text-[12.5px] font-bold text-[var(--c-5nx3vn)]"
                          style={{ background: 'var(--c-11c6fho)' }}
                        >
                          {t('friends.decline')}
                        </button>
                        <button
                          onClick={() => void handleAccept(r.id)}
                          className="rounded-[14px] border-none px-4 py-[13px] font-sans text-[12.5px] font-extrabold text-[var(--c-2vtjkg)]"
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
                <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                  {t('friends.outgoingTitle', { count: outgoing.length })}
                </span>
                {outgoing.map((r) => {
                  const other = otherSideOf(r, user.id)
                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] px-5 py-[13px]"
                      style={{ background: 'var(--c-ijr2vy)' }}
                    >
                      <span className="text-sm font-bold text-[var(--c-3bsl4p)]">{formatFriendHandle(other.name, other.tag)}</span>
                      <button
                        onClick={() => void handleRemove(r.id)}
                        className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-bold text-[var(--c-3ji23s)]"
                        style={{ background: 'var(--c-rucw5u)' }}
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
              <span className="text-[12.5px] font-extrabold tracking-[0.8px] text-[var(--c-mfvyic)] uppercase">
                {t('friends.listTitle', { count: friends.length })}
              </span>
              {friends.length === 0 ? (
                <span className="text-[13px] font-semibold text-[var(--c-1kei7l4)]">{t('friends.noFriends')}</span>
              ) : (
                friends.map((r) => {
                  const other = otherSideOf(r, user.id)
                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center justify-between gap-[10px] rounded-[20px] px-5 py-[13px]"
                      style={{ background: 'var(--c-ijr2vy)' }}
                    >
                      <span className="text-sm font-bold text-[var(--c-3bsl4p)]">{formatFriendHandle(other.name, other.tag)}</span>
                      <button
                        onClick={() => void handleRemove(r.id)}
                        className="rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-bold text-[var(--c-5nx3vn)]"
                        style={{ background: 'var(--c-11c6fho)' }}
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

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../store/auth'
import {
  formatFriendHandle,
  inviteFriendToRoom,
  listFriendRequests,
  listRoomInvitesForRoom,
  type FriendRequestRow,
  type RoomInviteRow,
} from '../lib/friends'

function otherSideOf(row: FriendRequestRow, myId: string) {
  return row.requester_id === myId
    ? { id: row.addressee_id, name: row.addressee_name, tag: row.addressee_tag }
    : { id: row.requester_id, name: row.requester_name, tag: row.requester_tag }
}

// Modal nhỏ mở từ nút "Mời bạn bè" trong Room.tsx — liệt kê bạn bè đã kết bạn chưa
// có trong room này, mỗi dòng có nút Mời gọi invite_friend_to_room (RPC bỏ qua duyệt
// của host, xem 0016_friends.sql).
export default function InviteFriendModal({
  roomId,
  memberIds,
  onClose,
}: {
  roomId: string
  memberIds: string[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)
  const [friends, setFriends] = useState<FriendRequestRow[]>([])
  const [invited, setInvited] = useState<RoomInviteRow[]>([])
  const [sendingId, setSendingId] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    listFriendRequests().then(setFriends).catch(() => {})
    listRoomInvitesForRoom(roomId).then(setInvited).catch(() => {})
  }, [user, roomId])

  if (!user) return null

  const invitedIds = new Set(invited.map((i) => i.invitee_id))
  const candidates = friends
    .filter((r) => r.status === 'accepted')
    .map((r) => otherSideOf(r, user.id))
    .filter((f) => !memberIds.includes(f.id))

  async function handleInvite(friendId: string) {
    setSendingId(friendId)
    try {
      const result = await inviteFriendToRoom(roomId, friendId)
      if (result === 'sent') setInvited(await listRoomInvitesForRoom(roomId))
    } catch {
      // im lặng — nút không đổi trạng thái "đã mời" nên user bấm lại được ngay
    } finally {
      setSendingId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6"
      style={{ background: 'rgba(38,66,86,0.32)', backdropFilter: 'blur(7px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="relative flex max-h-[80svh] w-full max-w-[400px] flex-col gap-[14px] overflow-y-auto rounded-[30px] bg-white px-7 pt-7 pb-6"
        style={{ boxShadow: '0 30px 70px rgba(38,66,86,0.3)' }}
      >
        <div className="flex items-center justify-between">
          <h3 className="m-0 text-[18px] font-extrabold text-[#2c3f55]">{t('friends.inviteTitle')}</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none text-[#4a637d] transition-colors duration-200 hover:!bg-[rgba(238,246,248,0.9)]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {candidates.length === 0 ? (
          <span className="text-[13px] font-semibold text-[rgba(51,71,94,0.5)]">{t('friends.noInvitable')}</span>
        ) : (
          candidates.map((f) => {
            const alreadyInvited = invitedIds.has(f.id)
            return (
              <div
                key={f.id}
                className="flex items-center justify-between gap-[10px] rounded-[18px] px-4 py-3"
                style={{ background: 'rgba(238,246,248,0.9)' }}
              >
                <span className="text-sm font-bold text-[#2c3f55]">{formatFriendHandle(f.name, f.tag)}</span>
                <button
                  onClick={() => void handleInvite(f.id)}
                  disabled={alreadyInvited || sendingId === f.id}
                  className="shrink-0 rounded-[14px] border-none px-4 py-2 font-sans text-[12.5px] font-extrabold text-[#1e3549] disabled:opacity-50"
                  style={{ background: 'var(--ff-accent-soft)' }}
                >
                  {alreadyInvited ? t('friends.invited') : t('friends.invite')}
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'

import RequireAuth from './components/RequireAuth'
import RoomInvitePopup from './components/RoomInvitePopup'
import Auth from './routes/Auth'
import Dashboard from './routes/Dashboard'
import Matching from './routes/Matching'
import Room from './routes/Room'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/auth'
import { acceptRoomInvite, declineRoomInvite } from './lib/friends'
import { dismissIncomingInvite, initFriendRealtime, teardownFriendRealtime, useFriendStore } from './store/friendNotifications'

export default function App() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const incomingInvite = useFriendStore((s) => s.incomingInvite)
  const [respondingInvite, setRespondingInvite] = useState(false)

  // accent color is a per-user preference (Settings → tab Cài đặt) but applies app-wide via
  // the --ff-accent-h CSS var, so it's set once here instead of duplicated per route.
  useEffect(() => {
    if (!user) {
      document.documentElement.style.removeProperty('--ff-accent-h')
      return
    }
    let cancelled = false
    supabase
      .from('profiles')
      .select('accent_hue')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (cancelled || !data) return
        document.documentElement.style.setProperty('--ff-accent-h', String(data.accent_hue))
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // Bạn bè + lời mời vào room: mount 1 lần ở đây, KHÔNG theo từng route, vì lời mời
  // phải làm gián đoạn người dùng bất kể họ đang ở Dashboard hay đang ở một room khác
  // (xem plan Giai đoạn 10 — cùng lý do accent color ở trên được đặt tại App.tsx).
  useEffect(() => {
    if (!user) {
      teardownFriendRealtime()
      return
    }
    initFriendRealtime(user.id)
    return () => teardownFriendRealtime()
  }, [user])

  async function handleAcceptInvite() {
    if (!incomingInvite) return
    setRespondingInvite(true)
    try {
      const result = await acceptRoomInvite(incomingInvite.id)
      if (result.status === 'joined' && result.room_code) navigate('/room/' + result.room_code)
    } finally {
      setRespondingInvite(false)
      dismissIncomingInvite()
    }
  }

  async function handleDeclineInvite() {
    if (!incomingInvite) return
    setRespondingInvite(true)
    try {
      await declineRoomInvite(incomingInvite.id)
    } finally {
      setRespondingInvite(false)
      dismissIncomingInvite()
    }
  }

  return (
    <>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<Dashboard />} />
        <Route path="/room/:id" element={<Room />} />
        <Route element={<RequireAuth />}>
          <Route path="/matching" element={<Matching />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {incomingInvite && (
        <RoomInvitePopup
          invite={incomingInvite}
          pending={respondingInvite}
          onAccept={() => void handleAcceptInvite()}
          onDecline={() => void handleDeclineInvite()}
        />
      )}
    </>
  )
}

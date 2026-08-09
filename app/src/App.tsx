import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'

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
  const location = useLocation()
  const incomingInvite = useFriendStore((s) => s.incomingInvite)
  const [respondingInvite, setRespondingInvite] = useState(false)

  // Dashboard (main UI) mounts ONCE and stays mounted across '/' <-> '/matching' — trước đây
  // 2 route này swap qua <Routes> bình thường, mỗi lần rời '/' sang '/matching' (chỉ để xem
  // danh sách phòng, chưa vào đâu cả) là unmount Dashboard, huỷ luôn audio/iframe YouTube
  // đang phát → mất nhạc oan. Matching giờ render ĐÈ LÊN Dashboard (đang ẩn) thay vì thay thế
  // nó. Vào Room hoặc /auth thì vẫn unmount bình thường — Room có hệ thống nhạc riêng, không
  // cần (và không nên) kế thừa nhạc của main UI.
  const onMatching = location.pathname === '/matching'
  const showDashboardLayer = location.pathname === '/' || onMatching

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
      {showDashboardLayer && (
        <div
          // Không dùng display:none/visibility:hidden — 2 kiểu đó có thể khiến trình duyệt
          // tạm dừng decode audio/video trong iframe YouTube đang nhúng bên trong. Co về
          // opacity 0 + pointer-events none (giống hệt cách widget mini-player YouTube đã ẩn
          // chính nó) để nhạc chạy liên tục, đồng thời `inert` chặn focus/đọc màn hình vào UI
          // đang ẩn.
          inert={onMatching || undefined}
          aria-hidden={onMatching || undefined}
          style={
            onMatching
              ? { position: 'fixed', inset: 0, opacity: 0, pointerEvents: 'none', zIndex: -1 }
              : undefined
          }
        >
          <Dashboard />
        </div>
      )}
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={null} />
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

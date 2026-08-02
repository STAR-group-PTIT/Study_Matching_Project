import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'

import RequireAuth from './components/RequireAuth'
import Auth from './routes/Auth'
import Dashboard from './routes/Dashboard'
import Matching from './routes/Matching'
import Room from './routes/Room'
import Stats from './routes/Stats'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/auth'

export default function App() {
  const user = useAuthStore((s) => s.user)

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

  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="/room/:id" element={<Room />} />
      <Route element={<RequireAuth />}>
        <Route path="/matching" element={<Matching />} />
        <Route path="/stats" element={<Stats />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

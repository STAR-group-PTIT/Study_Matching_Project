import { Routes, Route, Navigate } from 'react-router-dom'

import RequireAuth from './components/RequireAuth'
import Auth from './routes/Auth'
import Dashboard from './routes/Dashboard'
import Matching from './routes/Matching'
import Room from './routes/Room'
import Stats from './routes/Stats'
import Settings from './routes/Settings'

export default function App() {
  return (
    <Routes>
      <Route path="/auth" element={<Auth />} />
      <Route path="/" element={<Dashboard />} />
      <Route path="/room/:id" element={<Room />} />
      <Route element={<RequireAuth />}>
        <Route path="/matching" element={<Matching />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../store/auth'

export default function RequireAuth() {
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div
        className="flex min-h-svh w-full items-center justify-center font-sans text-sm font-semibold text-[rgba(51,71,94,0.55)]"
        style={{ background: 'var(--ff-page-bg)' }}
      >
        Đang tải…
      </div>
    )
  }

  if (!user) return <Navigate to="/auth" replace />

  return <Outlet />
}

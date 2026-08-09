import { Navigate, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../store/auth'

export default function RequireAuth() {
  const { t } = useTranslation()
  const { user, loading } = useAuthStore()

  if (loading) {
    return (
      <div
        className="flex min-h-svh w-full items-center justify-center font-sans text-sm font-semibold text-[var(--c-1kei8bt)]"
        style={{ background: 'var(--ff-page-bg)' }}
      >
        {t('common.loading')}
      </div>
    )
  }

  if (!user) return <Navigate to="/auth" replace />

  return <Outlet />
}

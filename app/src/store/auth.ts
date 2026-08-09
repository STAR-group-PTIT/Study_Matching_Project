import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type AuthState = {
  session: Session | null
  user: User | null
  loading: boolean
}

export const useAuthStore = create<AuthState>(() => ({
  session: null,
  user: null,
  loading: true,
}))

supabase.auth.getSession().then(({ data }) => {
  useAuthStore.setState({ session: data.session, user: data.session?.user ?? null, loading: false })
})

supabase.auth.onAuthStateChange((_event, session) => {
  useAuthStore.setState({ session, user: session?.user ?? null, loading: false })
})

// Guest policy — single source of truth for "does this need a real account". Whole pages
// (Matching) are gated at the route level by <RequireAuth> in App.tsx; this hook is for
// features gated INSIDE an otherwise guest-usable page (Dashboard's Settings/Stats/Friends/
// study-match icons) so both stay driven by the same "logged in, or bounce to /auth" rule
// instead of components each reimplementing their own `if (!user) navigate('/auth')` check
// — which used to drift out of sync (see CONTEXT.md, Matching.tsx used to carry its own
// dead copy of this after /matching became route-guarded).
export function useRequireAuth() {
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  return function requireAuth(onAuthed: () => void) {
    if (!user) {
      navigate('/auth')
      return
    }
    onAuthed()
  }
}

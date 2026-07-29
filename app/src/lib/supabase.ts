import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'Thiếu VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy app/.env.example thành app/.env và điền giá trị từ Supabase project của bạn (Settings → API).',
  )
}

export const supabase = createClient(url, anonKey)

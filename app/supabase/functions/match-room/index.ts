// FocusFlow — Edge Function: "Ghép ngẫu nhiên" entry point.
// Forwards the caller's JWT to find_or_create_lobby() (a security-definer Postgres function
// that atomically joins an open lobby or creates one, via `for update skip locked` + a
// partial unique index), so this function itself holds no elevated privileges — it's a
// thin, server-side gatekeeper for the matching RPC rather than exposing it directly to
// the client.
// room_type is intentionally NOT accepted here (0018) — random match is always 'chill',
// fixed server-side, not client-supplied.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: { duration_minutes?: number; language?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { duration_minutes, language } = body
  if (!duration_minutes || !language) {
    return new Response(JSON.stringify({ error: 'Missing duration_minutes/language' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()
  if (userError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await userClient.rpc('find_or_create_lobby', {
    p_duration_minutes: duration_minutes,
    p_language: language,
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ result: data?.[0] ?? null }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

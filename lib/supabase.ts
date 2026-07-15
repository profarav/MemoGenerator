import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Fail loudly at startup instead of surfacing cryptic "fetch failed" errors later.
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
    'must be set (locally in .env.local, and in your Vercel project environment variables).'
  )
}

// Client-side client (uses anon key)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

function createAdminClient(): SupabaseClient {
  if (!supabaseServiceKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Server-side routes require the service role key — ' +
      'add it to .env.local and to your Vercel project environment variables.'
    )
  }
  return createClient(supabaseUrl!, supabaseServiceKey)
}

// Server-side client (uses service role key — bypasses RLS).
// Only constructed on the server; in client bundles this export is unused and left undefined
// so a missing service key can never silently downgrade a server write to the anon key.
export const supabaseAdmin: SupabaseClient =
  typeof window === 'undefined' ? createAdminClient() : (undefined as unknown as SupabaseClient)

/**
 * Turn a raw Supabase/Postgres error message into something actionable.
 * Network-level failures ("fetch failed") almost always mean the free-tier
 * Supabase project auto-paused — surface that instead of a generic error.
 */
export function describeDbError(message: string | undefined): string {
  if (!message) return 'Unknown database error'
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return (
      'Database unreachable — the Supabase project may be paused (free tier pauses after ' +
      'inactivity). Check the Supabase dashboard and unpause it.'
    )
  }
  return message
}

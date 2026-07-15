import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// Keep-alive health check. Hit daily by the Vercel cron (see vercel.json) so the
// free-tier Supabase project never auto-pauses from inactivity.
export const dynamic = 'force-dynamic'

export async function GET() {
  const { error } = await supabaseAdmin
    .from('memo_requests')
    .select('id', { count: 'exact', head: true })

  if (error) {
    console.error('[health] Supabase check failed:', error.message)
    return NextResponse.json(
      { ok: false, database: 'unreachable', error: error.message },
      { status: 503 }
    )
  }

  return NextResponse.json({ ok: true, database: 'up' })
}

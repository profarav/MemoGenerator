import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const body = await req.json()

    const allowed = ['status', 'meeting_title', 'meeting_datetime', 'company_name',
      'company_website', 'meeting_type', 'attendees', 'known_context',
      'internal_context', 'memo_depth']

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const key of allowed) {
      if (key in body) {
        updates[key] = body[key]
      }
    }

    const { data, error } = await supabaseAdmin
      .from('memo_requests')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[memo-request PATCH] Error:', error)
      return NextResponse.json({ error: 'Failed to update memo request' }, { status: 500 })
    }

    return NextResponse.json({ memoRequest: data })
  } catch (err: unknown) {
    const error = err as { message?: string }
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params

  const { data, error } = await supabaseAdmin
    .from('memo_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Memo request not found' }, { status: 404 })
  }

  return NextResponse.json({ memoRequest: data })
}

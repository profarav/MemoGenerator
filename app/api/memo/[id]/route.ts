import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params
    const body = await req.json()

    const allowed = ['memo_markdown', 'review_status', 'patrick_feedback']
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

    for (const key of allowed) {
      if (key in body) {
        updates[key] = body[key]
      }
    }

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('generated_memos')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[memo PATCH] Error:', error)
      return NextResponse.json({ error: 'Failed to update memo' }, { status: 500 })
    }

    return NextResponse.json({ memo: data })
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
    .from('generated_memos')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Memo not found' }, { status: 404 })
  }

  return NextResponse.json({ memo: data })
}

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin, describeDbError } from '@/lib/supabase'
import { runMemoGenerationInBackground } from '@/lib/pipeline/runMemoGeneration'

// Allow the background pipeline (kept alive via waitUntil) to finish — full
// generation takes ~1-3 minutes. Requires Fluid Compute (default on current
// Vercel projects) or Pro; if the deploy rejects this value, lower it to 60.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const { memoRequestId } = await req.json()
    if (!memoRequestId) {
      return NextResponse.json({ error: 'memoRequestId is required' }, { status: 400 })
    }

    // Mark the request as generating so the memo page shows progress and polls.
    const { error: updateError } = await supabaseAdmin
      .from('memo_requests')
      .update({ status: 'generating', updated_at: new Date().toISOString() })
      .eq('id', memoRequestId)

    if (updateError) {
      console.error('[generate-memo] Failed to mark request as generating:', updateError)
      return NextResponse.json(
        { error: `Failed to start generation: ${describeDbError(updateError.message)}` },
        { status: 500 }
      )
    }

    // Run the pipeline in the background; failures mark the request as 'failed'.
    waitUntil(runMemoGenerationInBackground(memoRequestId))

    return NextResponse.json({ memoId: memoRequestId, status: 'generating' })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[generate-memo] Error:', err)
    return NextResponse.json(
      { error: describeDbError(error?.message) },
      { status: 500 }
    )
  }
}

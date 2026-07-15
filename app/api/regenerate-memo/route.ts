import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, describeDbError } from '@/lib/supabase'
import { summarizeSources } from '@/lib/agents/researchSummarizer'
import { mapRelevance } from '@/lib/agents/relevanceMapper'
import { generateMemo } from '@/lib/agents/memoGenerator'
import { MemoRequest, ResearchSource } from '@/types'

// Regeneration runs synchronously (the user watches an inline spinner); it
// skips web research but still makes three model calls, so give it headroom.
// Requires Fluid Compute or Pro; if the deploy rejects this, lower it to 60.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const { memoRequestId, feedback } = await req.json()

    if (!memoRequestId) {
      return NextResponse.json({ error: 'memoRequestId is required' }, { status: 400 })
    }

    // Fetch memo request and existing sources
    const [memoRes, sourcesRes] = await Promise.all([
      supabaseAdmin.from('memo_requests').select('*').eq('id', memoRequestId).single(),
      supabaseAdmin.from('research_sources').select('*').eq('memo_request_id', memoRequestId),
    ])

    if (memoRes.error || !memoRes.data) {
      return NextResponse.json({ error: 'Memo request not found' }, { status: 404 })
    }

    const mr = memoRes.data as MemoRequest
    const sources: ResearchSource[] = sourcesRes.data ?? []

    // Inject Patrick's feedback into internal context
    const enrichedRequest: MemoRequest = feedback
      ? {
          ...mr,
          internal_context: mr.internal_context
            ? `${mr.internal_context}\n\nPatrick's feedback for this regeneration: ${feedback}`
            : `Patrick's feedback for this regeneration: ${feedback}`,
        }
      : mr

    // Re-run summarize → relevance map → generate
    console.log('[regenerate-memo] Summarizing...')
    const researchSummary = await summarizeSources(enrichedRequest, sources)

    console.log('[regenerate-memo] Mapping relevance...')
    const relevanceMap = await mapRelevance(enrichedRequest, researchSummary)

    console.log('[regenerate-memo] Generating memo...')
    const memoMarkdown = await generateMemo(enrichedRequest, researchSummary, sources, relevanceMap)

    // Save new version
    const { data: savedMemo, error: memoError } = await supabaseAdmin
      .from('generated_memos')
      .insert({
        memo_request_id: memoRequestId,
        memo_markdown: memoMarkdown,
        confidence_level: 'medium',
        review_status: 'draft',
        patrick_feedback: feedback ?? null,
      })
      .select()
      .single()

    if (memoError) {
      console.error('[regenerate-memo] Failed to save:', memoError)
      return NextResponse.json(
        { error: `Failed to save regenerated memo: ${describeDbError(memoError.message)}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ memo: savedMemo })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[regenerate-memo] Unhandled error:', error?.message)
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { regenerateSection } from '@/lib/agents/sectionRegenerator'
import { findSectionSpec } from '@/lib/agents/memoGenerator'
import { parseMemoSections, replaceSectionBody } from '@/lib/memo/sections'
import { MemoRequest, ResearchSource, GeneratedMemo } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const { memoId, sectionNumber, focus } = await req.json()

    if (!memoId || typeof sectionNumber !== 'number') {
      return NextResponse.json(
        { error: 'memoId and sectionNumber are required' },
        { status: 400 }
      )
    }

    // Load the memo being revised
    const { data: memoData, error: memoFetchError } = await supabaseAdmin
      .from('generated_memos')
      .select('*')
      .eq('id', memoId)
      .single()

    if (memoFetchError || !memoData) {
      return NextResponse.json({ error: 'Memo not found' }, { status: 404 })
    }

    const currentMemo = memoData as GeneratedMemo

    const { sections } = parseMemoSections(currentMemo.memo_markdown)
    const section = sections.find((s) => s.number === sectionNumber)
    const spec = findSectionSpec(sectionNumber)

    if (!section || !spec) {
      return NextResponse.json(
        { error: `Section ${sectionNumber} not found in this memo` },
        { status: 400 }
      )
    }

    // Load the request + sources that back this memo
    const [requestRes, sourcesRes] = await Promise.all([
      supabaseAdmin
        .from('memo_requests')
        .select('*')
        .eq('id', currentMemo.memo_request_id)
        .single(),
      supabaseAdmin
        .from('research_sources')
        .select('*')
        .eq('memo_request_id', currentMemo.memo_request_id),
    ])

    if (requestRes.error || !requestRes.data) {
      return NextResponse.json({ error: 'Memo request not found' }, { status: 404 })
    }

    const memoRequest = requestRes.data as MemoRequest
    const sources: ResearchSource[] = sourcesRes.data ?? []

    console.log(
      `[regenerate-section] Rewriting section ${sectionNumber} (${section.title})` +
      `${focus ? ` with focus: "${focus}"` : ''}`
    )

    const newBody = await regenerateSection({
      memoRequest,
      currentMemo: currentMemo.memo_markdown,
      section,
      spec,
      sources,
      focus: focus?.trim() || undefined,
    })

    if (!newBody.trim()) {
      return NextResponse.json(
        { error: 'The model returned an empty section. Please try again.' },
        { status: 502 }
      )
    }

    const updatedMarkdown = replaceSectionBody(
      currentMemo.memo_markdown,
      sectionNumber,
      newBody
    )

    // Save as a new version so the previous memo stays recoverable
    const { data: savedMemo, error: saveError } = await supabaseAdmin
      .from('generated_memos')
      .insert({
        memo_request_id: currentMemo.memo_request_id,
        memo_markdown: updatedMarkdown,
        confidence_level: currentMemo.confidence_level ?? 'medium',
        review_status: 'draft',
        patrick_feedback: focus
          ? `Regenerated section ${sectionNumber} (${section.title}) with focus: ${focus}`
          : `Regenerated section ${sectionNumber} (${section.title})`,
      })
      .select()
      .single()

    if (saveError) {
      console.error('[regenerate-section] Failed to save:', saveError)
      return NextResponse.json(
        { error: `Failed to save revised memo: ${saveError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ memo: savedMemo })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[regenerate-section] Unhandled error:', err)
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

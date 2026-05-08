import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { generateResearchQueries } from '@/lib/agents/researchQueryGenerator'
import { extractPriorProductNames, buildProductQueries } from '@/lib/agents/priorProductExtractor'
import { summarizeSources } from '@/lib/agents/researchSummarizer'
import { mapRelevance } from '@/lib/agents/relevanceMapper'
import { generateMemo } from '@/lib/agents/memoGenerator'
import { searchWeb } from '@/lib/search/searchProvider'
import { MemoRequest, Attendee, ResearchSource } from '@/types'

async function runSearches(queries: string[]): Promise<Array<{
  title: string; url: string; snippet: string; sourceType: string
}>> {
  const results = await Promise.allSettled(queries.map((q) => searchWeb(q)))
  const flat: Array<{ title: string; url: string; snippet: string; sourceType: string }> = []
  const seenUrls = new Set<string>()
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const item of r.value) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url)
          flat.push(item)
        }
      }
    }
  }
  return flat
}

async function storeSources(
  memoRequestId: string,
  rawSources: Array<{ title: string; url: string; snippet: string; sourceType: string }>,
  existingUrls: Set<string>
): Promise<ResearchSource[]> {
  const newSources = rawSources.filter((s) => !existingUrls.has(s.url))
  if (newSources.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('research_sources')
    .insert(
      newSources.map((s) => ({
        memo_request_id: memoRequestId,
        source_type: s.sourceType,
        title: s.title,
        url: s.url,
        snippet: s.snippet,
      }))
    )
    .select()

  if (error) {
    console.error('[generate-memo] Failed to insert sources:', error.message)
    return []
  }

  for (const s of newSources) existingUrls.add(s.url)
  return (data ?? []) as ResearchSource[]
}

export async function POST(req: NextRequest) {
  try {
    const { memoRequestId } = await req.json()
    if (!memoRequestId) {
      return NextResponse.json({ error: 'memoRequestId is required' }, { status: 400 })
    }

    // 1. Fetch memo request
    const { data: memoRequest, error: fetchError } = await supabaseAdmin
      .from('memo_requests')
      .select('*')
      .eq('id', memoRequestId)
      .single()

    if (fetchError || !memoRequest) {
      return NextResponse.json({ error: 'Memo request not found' }, { status: 404 })
    }

    const mr = memoRequest as MemoRequest
    const attendees: Attendee[] = Array.isArray(mr.attendees) ? mr.attendees : []
    const attendeeNames = attendees.map((a) => a.name)
    const storedUrls = new Set<string>()

    // 2. First-pass search: person + company background
    console.log('[generate-memo] Pass 1: person + company search')
    const pass1Queries = generateResearchQueries({
      companyName: mr.company_name,
      companyWebsite: mr.company_website,
      attendees,
      meetingType: mr.meeting_type,
    })

    const pass1Raw = await runSearches(pass1Queries)
    const pass1Sources = await storeSources(memoRequestId, pass1Raw, storedUrls)
    console.log(`[generate-memo] Pass 1: ${pass1Sources.length} sources stored`)

    // 3. Extract prior product names from first-pass results
    console.log('[generate-memo] Extracting prior product names...')
    const discoveredProducts = await extractPriorProductNames(
      mr.company_name,
      attendeeNames,
      pass1Sources
    )
    console.log(`[generate-memo] Found ${discoveredProducts.length} prior products:`, discoveredProducts.map((p) => p.name))

    // 4. Second-pass search: targeted queries for each discovered prior product
    let pass2Sources: ResearchSource[] = []
    if (discoveredProducts.length > 0) {
      console.log('[generate-memo] Pass 2: targeted product searches')
      const pass2Queries = discoveredProducts
        .slice(0, 4) // cap at 4 products to avoid runaway API calls
        .flatMap(buildProductQueries)

      const pass2Raw = await runSearches(pass2Queries)
      pass2Sources = await storeSources(memoRequestId, pass2Raw, storedUrls)
      console.log(`[generate-memo] Pass 2: ${pass2Sources.length} additional sources stored`)
    }

    // 5. Summarize all sources (both passes combined)
    const allSources = [...pass1Sources, ...pass2Sources]
    console.log(`[generate-memo] Summarizing ${allSources.length} total sources...`)
    const researchSummary = await summarizeSources(mr, allSources)

    // 6. Map relevance with product scoring
    console.log('[generate-memo] Mapping relevance...')
    const relevanceMap = await mapRelevance(mr, researchSummary)

    // 7. Generate memo
    console.log('[generate-memo] Generating memo...')
    const memoMarkdown = await generateMemo(mr, researchSummary, allSources, relevanceMap)

    // 8. Save memo
    const { data: savedMemo, error: memoError } = await supabaseAdmin
      .from('generated_memos')
      .insert({
        memo_request_id: memoRequestId,
        memo_markdown: memoMarkdown,
        confidence_level: 'medium',
        review_status: 'draft',
      })
      .select()
      .single()

    if (memoError) {
      console.error('[generate-memo] Failed to save memo:', memoError.message)
      return NextResponse.json({ error: 'Failed to save generated memo' }, { status: 500 })
    }

    await supabaseAdmin
      .from('memo_requests')
      .update({ status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', memoRequestId)

    return NextResponse.json({ memo: savedMemo, sources: allSources })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[generate-memo] Unhandled error:', error?.message)
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

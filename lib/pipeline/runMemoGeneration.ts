/**
 * Shared memo generation pipeline.
 * Called by both /api/generate-memo and /api/quick-generate-memo.
 * Contains the exact same logic as the original generate-memo route — no behavior changes.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { generateResearchQueries } from '@/lib/agents/researchQueryGenerator'
import { extractPriorProductNames, buildProductQueries } from '@/lib/agents/priorProductExtractor'
import { summarizeSources } from '@/lib/agents/researchSummarizer'
import { mapRelevance } from '@/lib/agents/relevanceMapper'
import { generateMemo } from '@/lib/agents/memoGenerator'
import { searchWeb } from '@/lib/search/searchProvider'
import { MemoRequest, Attendee, ResearchSource, GeneratedMemo } from '@/types'

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
    console.error('[runMemoGeneration] Failed to insert sources:', error.message)
    return []
  }

  for (const s of newSources) existingUrls.add(s.url)
  return (data ?? []) as ResearchSource[]
}

export async function runMemoGeneration(memoRequestId: string): Promise<{
  memo: GeneratedMemo
  sources: ResearchSource[]
}> {
  // 1. Fetch memo request
  const { data: memoRequest, error: fetchError } = await supabaseAdmin
    .from('memo_requests')
    .select('*')
    .eq('id', memoRequestId)
    .single()

  if (fetchError || !memoRequest) {
    throw new Error(`Memo request not found: ${memoRequestId}`)
  }

  const mr = memoRequest as MemoRequest
  const attendees: Attendee[] = Array.isArray(mr.attendees) ? mr.attendees : []
  const attendeeNames = attendees.map((a) => a.name)
  const storedUrls = new Set<string>()

  // 2. Pass 1: person + company background
  console.log('[runMemoGeneration] Pass 1: person + company search')
  const pass1Queries = generateResearchQueries({
    companyName: mr.company_name,
    companyWebsite: mr.company_website,
    attendees,
    meetingType: mr.meeting_type,
  })
  const pass1Raw = await runSearches(pass1Queries)
  const pass1Sources = await storeSources(memoRequestId, pass1Raw, storedUrls)
  console.log(`[runMemoGeneration] Pass 1: ${pass1Sources.length} sources`)

  // 3. Extract prior product names
  console.log('[runMemoGeneration] Extracting prior products...')
  const discoveredProducts = await extractPriorProductNames(mr.company_name, attendeeNames, pass1Sources)
  console.log(`[runMemoGeneration] Found ${discoveredProducts.length} prior products:`, discoveredProducts.map((p) => p.name))

  // 4. Pass 2: targeted product searches
  let pass2Sources: ResearchSource[] = []
  if (discoveredProducts.length > 0) {
    console.log('[runMemoGeneration] Pass 2: targeted product searches')
    const pass2Queries = discoveredProducts.slice(0, 4).flatMap(buildProductQueries)
    const pass2Raw = await runSearches(pass2Queries)
    pass2Sources = await storeSources(memoRequestId, pass2Raw, storedUrls)
    console.log(`[runMemoGeneration] Pass 2: ${pass2Sources.length} sources`)
  }

  // 5. Summarize
  const allSources = [...pass1Sources, ...pass2Sources]
  console.log(`[runMemoGeneration] Summarizing ${allSources.length} sources...`)
  const researchSummary = await summarizeSources(mr, allSources)

  // 6. Map relevance
  console.log('[runMemoGeneration] Mapping relevance...')
  const relevanceMap = await mapRelevance(mr, researchSummary)

  // 7. Generate memo
  console.log('[runMemoGeneration] Generating memo...')
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
    throw new Error(`Failed to save generated memo: ${memoError.message}`)
  }

  // 9. Update request status
  await supabaseAdmin
    .from('memo_requests')
    .update({ status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', memoRequestId)

  return { memo: savedMemo as GeneratedMemo, sources: allSources }
}

/**
 * Background-safe wrapper: runs the pipeline and, on any failure, marks the
 * memo_request as 'failed' so the UI can show an error + retry instead of
 * spinning forever. Used with waitUntil() — never throws.
 */
export async function runMemoGenerationInBackground(memoRequestId: string): Promise<void> {
  try {
    await runMemoGeneration(memoRequestId)
    console.log(`[runMemoGeneration] Background generation complete for ${memoRequestId}`)
  } catch (err) {
    console.error(`[runMemoGeneration] Background generation failed for ${memoRequestId}:`, err)
    try {
      await supabaseAdmin
        .from('memo_requests')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', memoRequestId)
    } catch (updateErr) {
      // If even the status update fails (e.g. DB unreachable), all we can do is log.
      console.error(`[runMemoGeneration] Could not mark ${memoRequestId} as failed:`, updateErr)
    }
  }
}

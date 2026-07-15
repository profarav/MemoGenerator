import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin, describeDbError } from '@/lib/supabase'
import { resolveQuickMemoInput } from '@/lib/enrichment/resolveQuickMemoInput'
import { mapResolvedInputToMemoRequest } from '@/lib/enrichment/mapResolvedInputToMemoRequest'
import { runMemoGenerationInBackground } from '@/lib/pipeline/runMemoGeneration'
import { MeetingType, MemoDepth } from '@/types'

// Allow the background pipeline (kept alive via waitUntil) to finish — full
// generation takes ~1-3 minutes. Requires Fluid Compute (default on current
// Vercel projects) or Pro; if the deploy rejects this value, lower it to 60.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      rawInput,
      fallbackFirstName,
      fallbackLastName,
      fallbackCompanyDomain,
      meetingTitle,
      meetingType,
      meetingDatetime,
      memoDepth,
      knownContext,
      internalContext,
    } = body

    if (!rawInput?.trim()) {
      return NextResponse.json(
        { error: 'rawInput is required. Paste at least one email address or attendee identifier.' },
        { status: 400 }
      )
    }

    // 1. Resolve Apollo enrichment
    console.log('[quick-generate-memo] Resolving enrichment...')
    let resolved
    try {
      resolved = await resolveQuickMemoInput({
        rawInput,
        fallbackFirstName,
        fallbackLastName,
        fallbackCompanyDomain,
      })
    } catch (err: unknown) {
      const e = err as { message?: string }
      // Validation errors (unknown input type, missing key) → 422
      if (e?.message?.includes('Could not find') || e?.message?.includes('APOLLO_API_KEY')) {
        return NextResponse.json({ error: e.message }, { status: 422 })
      }
      throw err
    }

    console.log(
      `[quick-generate-memo] Resolved ${resolved.resolvedPeople.length} people, ` +
      `${resolved.resolvedOrganizations.length} orgs. ` +
      `Unresolved: ${resolved.unresolvedInputs.join(', ') || 'none'}`
    )

    // Guard: if we have no people and no org, we can't generate a useful memo
    if (resolved.resolvedPeople.length === 0 && !resolved.primaryOrganization) {
      return NextResponse.json(
        {
          error:
            'Apollo could not find any matching people or organizations. ' +
            'Try using the Manual Input form to enter the details directly.',
          unresolvedInputs: resolved.unresolvedInputs,
        },
        { status: 422 }
      )
    }

    // 2. Map to memo_request shape
    const memoRequestData = mapResolvedInputToMemoRequest(resolved, {
      meetingTitle,
      meetingType: meetingType as MeetingType | undefined,
      meetingDatetime,
      memoDepth: memoDepth as MemoDepth | undefined,
      knownContext,
      internalContext,
    })

    // 3. Save memo_request to DB with status 'generating' — the client redirects to
    // the memo page immediately and polls until the pipeline finishes.
    const { data: memoRequest, error: insertError } = await supabaseAdmin
      .from('memo_requests')
      .insert({ ...memoRequestData, status: 'generating' })
      .select()
      .single()

    if (insertError || !memoRequest) {
      console.error('[quick-generate-memo] Failed to insert memo_request:', insertError)
      return NextResponse.json(
        { error: `Failed to save memo request: ${describeDbError(insertError?.message)}` },
        { status: 500 }
      )
    }

    console.log(`[quick-generate-memo] Saved memo_request ${memoRequest.id}, dispatching pipeline...`)

    // 4. Run the pipeline in the background (waitUntil keeps the function alive
    // after the response is sent). Failures mark the request as 'failed'.
    waitUntil(runMemoGenerationInBackground(memoRequest.id))

    return NextResponse.json({
      memoId: memoRequest.id,
      status: 'generating',
      resolvedPeople: resolved.resolvedPeople,
      resolvedOrganizations: resolved.resolvedOrganizations,
      unresolvedInputs: resolved.unresolvedInputs,
    })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[quick-generate-memo] Unhandled error:', error?.message)

    // Surface Apollo key errors clearly
    if (error?.message?.includes('APOLLO_API_KEY')) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (error?.message?.includes('rate limit')) {
      return NextResponse.json({ error: error.message }, { status: 429 })
    }

    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

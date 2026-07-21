/**
 * Booking → memo pipeline, used by the Zapier webhook.
 *
 * The webhook inserts a placeholder memo_request and returns immediately, then
 * this runs in the background: Apollo enrichment → fill in the request →
 * generate the memo → export to Google Docs → comment on the ClickUp task.
 *
 * Never throws; failures mark the request 'failed' so they're visible in the app.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { resolveQuickMemoInput } from '@/lib/enrichment/resolveQuickMemoInput'
import { mapResolvedInputToMemoRequest } from '@/lib/enrichment/mapResolvedInputToMemoRequest'
import { runMemoGenerationInBackground } from '@/lib/pipeline/runMemoGeneration'

export interface BookingMemoParams {
  memoRequestId: string
  rawInput: string
  fallbackFirstName?: string
  fallbackLastName?: string
  fallbackCompanyDomain?: string
  clickupTaskId?: string
  /** Values from the booking payload that should win over enrichment guesses */
  overrides?: {
    meetingTitle?: string
    meetingDatetime?: string
    companyName?: string
  }
}

export async function runBookingMemoInBackground(params: BookingMemoParams): Promise<void> {
  const {
    memoRequestId,
    rawInput,
    fallbackFirstName,
    fallbackLastName,
    fallbackCompanyDomain,
    clickupTaskId,
    overrides = {},
  } = params

  try {
    // 1. Apollo enrichment
    console.log(`[runBookingMemo] Enriching for ${memoRequestId}: ${rawInput}`)
    const resolved = await resolveQuickMemoInput({
      rawInput,
      fallbackFirstName,
      fallbackLastName,
      fallbackCompanyDomain,
    })

    if (resolved.resolvedPeople.length === 0 && !resolved.primaryOrganization) {
      throw new Error(
        `Apollo could not resolve any person or organization from "${rawInput}"`
      )
    }

    // 2. Fill in the placeholder request with the enriched details.
    //    Booking payload values win over enrichment where provided.
    const mapped = mapResolvedInputToMemoRequest(resolved, {
      meetingTitle: overrides.meetingTitle,
      meetingDatetime: overrides.meetingDatetime,
      meetingType: 'prospect_intro',
    })

    const updates: Record<string, unknown> = {
      ...mapped,
      status: 'generating',
      updated_at: new Date().toISOString(),
    }
    if (overrides.companyName) updates.company_name = overrides.companyName
    if (overrides.meetingTitle) updates.meeting_title = overrides.meetingTitle

    const { error: updateError } = await supabaseAdmin
      .from('memo_requests')
      .update(updates)
      .eq('id', memoRequestId)

    if (updateError) {
      throw new Error(`Could not update memo request with enrichment: ${updateError.message}`)
    }

    console.log(
      `[runBookingMemo] Enriched ${memoRequestId} — ` +
      `${resolved.resolvedPeople.length} people, ${resolved.resolvedOrganizations.length} orgs`
    )

    // 3. Generate + deliver (Google Doc + ClickUp comment)
    await runMemoGenerationInBackground(memoRequestId, { clickupTaskId })
  } catch (err) {
    console.error(`[runBookingMemo] Failed for ${memoRequestId}:`, err)
    try {
      await supabaseAdmin
        .from('memo_requests')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', memoRequestId)
    } catch (updateErr) {
      console.error(`[runBookingMemo] Could not mark ${memoRequestId} failed:`, updateErr)
    }
  }
}

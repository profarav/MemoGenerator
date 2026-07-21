/**
 * Booking webhook — the entry point for Ayema's Zap.
 *
 * When a discovery call is booked, the Zap POSTs here. This responds in well
 * under a second (Zapier webhook steps time out around 30s, and generation
 * takes ~2 minutes), then does the work in the background: Apollo enrichment →
 * memo generation → Google Doc → ClickUp comment.
 *
 * Auth: send the shared secret as an `X-Webhook-Secret` header or a `?secret=`
 * query param. Set BOOKING_WEBHOOK_SECRET in the environment.
 *
 * Request body (JSON) — only an attendee email (or name + company domain) is
 * strictly required:
 * {
 *   "attendeeEmail":   "jenna@hipcamp.com",
 *   "attendeeName":    "Jenna Valdespino",          // optional
 *   "companyDomain":   "hipcamp.com",               // optional fallback
 *   "companyName":     "Hipcamp",                   // optional
 *   "meetingTitle":    "Discovery Call — Hipcamp",  // optional
 *   "meetingDatetime": "2026-07-25T15:00:00Z",      // optional, ISO 8601
 *   "clickupTaskId":   "86a1b2c3d",                 // optional; needed to comment
 *   "focus":           "They asked about paid media" // optional
 * }
 *
 * Response (immediate):
 * { "memoId": "...", "status": "generating", "memoUrl": "https://.../memo/..." }
 */
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin, describeDbError } from '@/lib/supabase'
import { runBookingMemoInBackground } from '@/lib/pipeline/runBookingMemo'

// Background work is kept alive past the response via waitUntil.
export const maxDuration = 300

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  try {
    // --- Auth ---
    const expected = process.env.BOOKING_WEBHOOK_SECRET
    if (!expected) {
      console.error('[booking] BOOKING_WEBHOOK_SECRET is not set — refusing all requests')
      return NextResponse.json(
        { error: 'Webhook not configured (BOOKING_WEBHOOK_SECRET missing)' },
        { status: 500 }
      )
    }
    const provided =
      req.headers.get('x-webhook-secret') ??
      req.nextUrl.searchParams.get('secret') ??
      ''
    if (provided !== expected) return unauthorized()

    // --- Payload ---
    const body = await req.json().catch(() => ({}))
    const {
      attendeeEmail,
      attendeeName,
      companyDomain,
      companyName,
      meetingTitle,
      meetingDatetime,
      clickupTaskId,
      focus,
    } = body as Record<string, string | undefined>

    // Apollo resolves best from an email; name + domain is the fallback path.
    const rawInput = [attendeeEmail, attendeeName].filter(Boolean).join('\n').trim()
    const hasFallback = Boolean(attendeeName && companyDomain)

    if (!attendeeEmail && !hasFallback) {
      return NextResponse.json(
        {
          error:
            'Need either attendeeEmail, or attendeeName plus companyDomain, to identify who the meeting is with.',
        },
        { status: 400 }
      )
    }

    const [firstName, ...restName] = (attendeeName ?? '').trim().split(/\s+/)

    // --- Insert a placeholder so the memo is trackable immediately ---
    const placeholderCompany =
      companyName ?? companyDomain ?? attendeeEmail?.split('@')[1] ?? 'Pending enrichment'

    const { data: memoRequest, error: insertError } = await supabaseAdmin
      .from('memo_requests')
      .insert({
        meeting_title: meetingTitle ?? `Discovery Call — ${placeholderCompany}`,
        company_name: placeholderCompany,
        meeting_datetime: meetingDatetime ?? null,
        meeting_type: 'prospect_intro',
        known_context: focus ?? null,
        memo_depth: 'standard',
        status: 'generating',
        clickup_task_id: clickupTaskId ?? null,
      })
      .select()
      .single()

    if (insertError || !memoRequest) {
      console.error('[booking] Failed to insert memo_request:', insertError)
      return NextResponse.json(
        { error: `Failed to save memo request: ${describeDbError(insertError?.message)}` },
        { status: 500 }
      )
    }

    console.log(
      `[booking] Accepted booking for ${placeholderCompany} → memo_request ${memoRequest.id}` +
      `${clickupTaskId ? ` (ClickUp ${clickupTaskId})` : ''}`
    )

    // --- Kick off the real work in the background ---
    waitUntil(
      runBookingMemoInBackground({
        memoRequestId: memoRequest.id,
        rawInput: rawInput || (companyDomain ?? ''),
        fallbackFirstName: firstName || undefined,
        fallbackLastName: restName.join(' ') || undefined,
        fallbackCompanyDomain: companyDomain,
        clickupTaskId,
        overrides: { meetingTitle, meetingDatetime, companyName },
      })
    )

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin

    return NextResponse.json({
      memoId: memoRequest.id,
      status: 'generating',
      memoUrl: `${appUrl}/memo/${memoRequest.id}`,
    })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[booking] Unhandled error:', err)
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

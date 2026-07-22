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

/** Repeat bookings inside this window reuse the existing memo (see below). */
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000

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
    // Validate up front: a blank or malformed mapping (a common Zapier
    // misconfiguration) should fail here, loudly, rather than three minutes
    // later with an unenriched memo.
    const looksLikeEmail = (v?: string) => Boolean(v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
    const hasFallback = Boolean(attendeeName?.trim() && companyDomain?.trim())

    if (!looksLikeEmail(attendeeEmail) && !hasFallback) {
      return NextResponse.json(
        {
          error:
            'Could not identify the attendee. Send a valid attendeeEmail (e.g. "jenna@hipcamp.com"), ' +
            'or attendeeName plus companyDomain. ' +
            'If this came from Zapier, check that the ClickUp field mapped to attendeeEmail is populated on the task.',
          received: {
            attendeeEmail: attendeeEmail ?? null,
            attendeeName: attendeeName ?? null,
            companyDomain: companyDomain ?? null,
          },
        },
        { status: 400 }
      )
    }

    const rawInput = [looksLikeEmail(attendeeEmail) ? attendeeEmail : null, attendeeName]
      .filter(Boolean)
      .join('\n')
      .trim()

    const [firstName, ...restName] = (attendeeName ?? '').trim().split(/\s+/)

    // --- Duplicate guard ---
    // The Zap can fire more than once for the same booking (a task edited
    // again while already in the triggering status, a deal moved out and back,
    // a replayed run). Regenerating costs Apollo credits and model spend and
    // litters Drive with near-identical docs, so return the existing memo
    // instead. The 24h window still allows a deliberate re-run tomorrow.
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()

    let existing: { id: string; status: string } | null = null

    if (clickupTaskId) {
      const { data } = await supabaseAdmin
        .from('memo_requests')
        .select('id,status')
        .eq('clickup_task_id', clickupTaskId)
        .neq('status', 'failed')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
      existing = data?.[0] ?? null
    }

    if (!existing && attendeeEmail) {
      // Falls back to the attendee — catches repeats when no task id is sent.
      // The filter value must be a JSON *string*: passing an array makes
      // postgrest-js emit `cs.{[object Object]}`, which silently matches nothing.
      const { data } = await supabaseAdmin
        .from('memo_requests')
        .select('id,status')
        .contains('attendees', JSON.stringify([{ email: attendeeEmail.trim() }]))
        .neq('status', 'failed')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
      existing = data?.[0] ?? null
    }

    if (existing) {
      console.log(
        `[booking] Duplicate suppressed — reusing memo ${existing.id} ` +
        `(${clickupTaskId ? `task ${clickupTaskId}` : attendeeEmail})`
      )
      const base = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/+$/, '')
      return NextResponse.json({
        memoId: existing.id,
        status: existing.status,
        memoUrl: `${base}/memo/${existing.id}`,
        duplicate: true,
      })
    }

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
        // Provisional attendee, replaced by the enriched version moments later.
        // Recording the email now means a second webhook firing seconds after
        // the first still matches the duplicate guard, which would otherwise
        // only see attendees once enrichment had finished.
        attendees: attendeeEmail
          ? [
              {
                name: attendeeName?.trim() || attendeeEmail,
                email: attendeeEmail.trim(),
                raw: [attendeeName?.trim(), attendeeEmail.trim()].filter(Boolean).join(' — '),
              },
            ]
          : null,
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

    // Trailing slash on the env var would produce "https://app//memo/..."
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/+$/, '')

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

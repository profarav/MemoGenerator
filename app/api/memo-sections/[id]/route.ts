/**
 * Zapier feed: the finished memo, split into template-ready fields.
 *
 *   GET /api/memo-sections/<memoRequestId>?secret=<BOOKING_WEBHOOK_SECRET>
 *
 * Called by the Zap after its Delay step. Returns flat, plain-text fields —
 * one per memo section — so they map straight onto Google Docs template
 * placeholders. Markdown is stripped (a template would otherwise print the
 * literal `**` and `- ` characters).
 *
 * Status handling matters here: if the memo isn't finished yet, this returns
 * 409 rather than partial data. Zapier surfaces that as a failed run you can
 * replay, instead of silently creating an empty document.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { parseMemoSections, MEMO_SECTIONS } from '@/lib/memo/sections'
import { stripMarkdown } from '@/lib/memo/plainText'
import { Attendee, MemoRequest, GeneratedMemo } from '@/types'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Same shared secret as the booking webhook.
  const expected = process.env.BOOKING_WEBHOOK_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'Not configured (BOOKING_WEBHOOK_SECRET missing)' },
      { status: 500 }
    )
  }
  const provided =
    req.headers.get('x-webhook-secret') ?? req.nextUrl.searchParams.get('secret') ?? ''
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = params

  const { data: requestData, error: requestError } = await supabaseAdmin
    .from('memo_requests')
    .select('*')
    .eq('id', id)
    .single()

  if (requestError || !requestData) {
    return NextResponse.json({ error: 'Memo request not found' }, { status: 404 })
  }

  const memoRequest = requestData as MemoRequest

  if (memoRequest.status === 'failed') {
    return NextResponse.json(
      { status: 'failed', memoId: id, error: 'Memo generation failed — check the app.' },
      { status: 409 }
    )
  }

  const { data: memoData } = await supabaseAdmin
    .from('generated_memos')
    .select('*')
    .eq('memo_request_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!memoData) {
    return NextResponse.json(
      {
        status: memoRequest.status === 'generating' ? 'generating' : 'no_memo',
        memoId: id,
        error:
          'Memo is not ready yet. Increase the Delay step, then replay this run.',
      },
      { status: 409 }
    )
  }

  const memo = memoData as GeneratedMemo
  const { sections } = parseMemoSections(memo.memo_markdown)

  // One flat plain-text field per section, keyed by its stable slug.
  const sectionFields: Record<string, string> = {}
  for (const spec of MEMO_SECTIONS) {
    const found = sections.find((s) => s.title === spec.title)
    sectionFields[spec.key] = found ? stripMarkdown(found.body) : ''
  }

  const attendees: Attendee[] = Array.isArray(memoRequest.attendees)
    ? memoRequest.attendees
    : []

  // Trailing slash on the env var would produce "https://app//memo/..."
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin).replace(/\/+$/, '')

  return NextResponse.json({
    status: 'ready',
    memoId: id,
    // Handy for naming the document and writing the ClickUp comment
    companyName: memoRequest.company_name,
    meetingTitle: memoRequest.meeting_title,
    attendeeNames: attendees.map((a) => a.name).filter(Boolean).join(', '),
    attendeeTitles: attendees.map((a) => a.title).filter(Boolean).join(', '),
    clickupTaskId: (memoRequest as { clickup_task_id?: string }).clickup_task_id ?? '',
    memoUrl: `${appUrl}/memo/${id}`,
    docTitle: `Meeting Prep — ${memoRequest.company_name}`,
    // Section fields for the Google Docs template placeholders
    ...sectionFields,
    // Everything at once, if a single placeholder is easier
    full_memo: stripMarkdown(memo.memo_markdown),
  })
}

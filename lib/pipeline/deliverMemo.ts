/**
 * Delivery step: turn a finished memo into a Google Doc and drop the link
 * into ClickUp.
 *
 * Runs after generation, in the background. Delivery failures are logged but
 * never thrown — a memo that generated successfully should stay available in
 * the app even if the Doc or ClickUp step fails.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { createMemoDoc, isGoogleDocsConfigured } from '@/lib/google/docs'
import { postTaskComment, buildMemoComment, isClickUpConfigured } from '@/lib/clickup/comment'
import { Attendee, MemoRequest, GeneratedMemo } from '@/types'

export interface DeliveryResult {
  docUrl?: string
  commentPosted: boolean
  errors: string[]
}

/** Human-readable doc title, e.g. "Meeting Prep — Hipcamp (Jenna Valdespino)" */
export function buildDocTitle(memoRequest: MemoRequest): string {
  const attendees: Attendee[] = Array.isArray(memoRequest.attendees)
    ? memoRequest.attendees
    : []
  const names = attendees.map((a) => a.name).filter(Boolean)
  const who = names.length > 0 ? ` (${names.join(', ')})` : ''
  return `Meeting Prep — ${memoRequest.company_name}${who}`
}

/**
 * Export a generated memo to Google Docs and, when a ClickUp task is known,
 * comment the link onto that task.
 *
 * @param clickupTaskId optional — supplied by the booking webhook
 */
export async function deliverMemo(params: {
  memoRequest: MemoRequest
  memo: GeneratedMemo
  clickupTaskId?: string
}): Promise<DeliveryResult> {
  const { memoRequest, memo, clickupTaskId } = params
  const result: DeliveryResult = { commentPosted: false, errors: [] }

  // 1. Google Doc
  if (!isGoogleDocsConfigured()) {
    result.errors.push('Google Docs export skipped: GOOGLE_SERVICE_ACCOUNT_KEY not set')
  } else {
    try {
      const doc = await createMemoDoc({
        title: buildDocTitle(memoRequest),
        markdown: memo.memo_markdown,
      })
      result.docUrl = doc.url
      console.log(`[deliverMemo] Created Google Doc ${doc.documentId} for ${memoRequest.id}`)

      // Persist the link so the app can show it too.
      const { error } = await supabaseAdmin
        .from('memo_requests')
        .update({ google_doc_url: doc.url, updated_at: new Date().toISOString() })
        .eq('id', memoRequest.id)
      if (error) {
        // Non-fatal: the doc exists, we just couldn't record the link.
        console.error('[deliverMemo] Could not save google_doc_url:', error.message)
      }
    } catch (err) {
      const message = (err as { message?: string })?.message ?? String(err)
      console.error('[deliverMemo] Google Doc creation failed:', err)
      result.errors.push(`Google Doc: ${message}`)
    }
  }

  // 2. ClickUp comment (only meaningful if we have both a task and a doc)
  if (clickupTaskId) {
    if (!isClickUpConfigured()) {
      result.errors.push('ClickUp comment skipped: CLICKUP_API_TOKEN not set')
    } else if (!result.docUrl) {
      result.errors.push('ClickUp comment skipped: no Google Doc URL to post')
    } else {
      try {
        const attendees: Attendee[] = Array.isArray(memoRequest.attendees)
          ? memoRequest.attendees
          : []
        await postTaskComment({
          taskId: clickupTaskId,
          text: buildMemoComment({
            docUrl: result.docUrl,
            companyName: memoRequest.company_name,
            attendeeNames: attendees.map((a) => a.name).filter(Boolean),
          }),
        })
        result.commentPosted = true
        console.log(`[deliverMemo] Commented memo link on ClickUp task ${clickupTaskId}`)
      } catch (err) {
        const message = (err as { message?: string })?.message ?? String(err)
        console.error('[deliverMemo] ClickUp comment failed:', err)
        result.errors.push(`ClickUp: ${message}`)
      }
    }
  }

  return result
}

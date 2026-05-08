'use client'

import { useState } from 'react'
import { MemoRequest, GeneratedMemo, ResearchSource } from '@/types'
import MarkdownRenderer from '@/components/MarkdownRenderer'

const MEETING_TYPE_LABELS: Record<string, string> = {
  prospect_intro: 'Prospect Intro',
  client_meeting: 'Client Meeting',
  partner_meeting: 'Partner Meeting',
  internal_strategy: 'Internal Strategy',
  other: 'Other',
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'approved'
      ? 'status-approved'
      : status === 'needs_review'
        ? 'status-needs_review'
        : 'status-draft'
  const labels: Record<string, string> = {
    draft: 'Draft',
    approved: 'Approved',
    needs_review: 'Needs Review',
  }
  return <span className={cls}>{labels[status] ?? status}</span>
}

interface Props {
  memoRequest: MemoRequest
  latestMemo: GeneratedMemo | null
  sources: ResearchSource[]
}

export default function MemoDetailClient({ memoRequest, latestMemo, sources }: Props) {
  const [memo, setMemo] = useState<GeneratedMemo | null>(latestMemo)
  const [editContent, setEditContent] = useState(latestMemo?.memo_markdown ?? '')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestStatus, setRequestStatus] = useState(memoRequest.status)

  async function handleSave() {
    if (!memo) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/memo/${memo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo_markdown: editContent }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMemo(data.memo)
      setIsEditing(false)
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleRegenerate() {
    setRegenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/regenerate-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memoRequestId: memoRequest.id,
          feedback: feedback || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMemo(data.memo)
      setEditContent(data.memo.memo_markdown)
      setIsEditing(false)
      setShowFeedback(false)
      setFeedback('')
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Failed to regenerate')
    } finally {
      setRegenerating(false)
    }
  }

  async function handleApprove() {
    if (!memo) return
    setApproving(true)
    setError(null)
    try {
      // Update memo review status
      const memoRes = await fetch(`/api/memo/${memo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: 'approved' }),
      })
      const memoData = await memoRes.json()
      if (!memoRes.ok) throw new Error(memoData.error)
      setMemo(memoData.memo)

      // Update request status
      const reqRes = await fetch(`/api/memo-request/${memoRequest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'approved' }),
      })
      const reqData = await reqRes.json()
      if (!reqRes.ok) throw new Error(reqData.error)
      setRequestStatus('approved')
    } catch (e: unknown) {
      setError((e as { message?: string })?.message ?? 'Failed to approve')
    } finally {
      setApproving(false)
    }
  }

  async function handleCopy() {
    if (!memo) return
    await navigator.clipboard.writeText(memo.memo_markdown)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const displayContent = isEditing ? editContent : (memo?.memo_markdown ?? '')

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <a href="/" className="text-xs text-gray-500 hover:text-gray-700">← Dashboard</a>
          <h1 className="mt-1 text-xl font-bold text-gray-900">{memoRequest.meeting_title}</h1>
          <div className="mt-1 flex items-center gap-3 flex-wrap">
            <StatusBadge status={requestStatus} />
            <span className="text-sm text-gray-500">{memoRequest.company_name}</span>
            {memoRequest.meeting_datetime && (
              <span className="text-sm text-gray-500">
                {new Date(memoRequest.meeting_datetime).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
                })}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {memo && (
          <div className="flex items-center gap-2 flex-wrap">
            {isEditing ? (
              <>
                <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
                  {saving ? 'Saving...' : 'Save Edits'}
                </button>
                <button onClick={() => { setIsEditing(false); setEditContent(memo.memo_markdown) }} className="btn-secondary text-xs">
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setIsEditing(true)} className="btn-secondary text-xs">
                  Edit
                </button>
                <button onClick={() => setShowFeedback(!showFeedback)} disabled={regenerating} className="btn-secondary text-xs">
                  {regenerating ? 'Regenerating...' : 'Regenerate'}
                </button>
                {requestStatus !== 'approved' && (
                  <button onClick={handleApprove} disabled={approving} className="btn-success text-xs">
                    {approving ? 'Approving...' : '✓ Approve'}
                  </button>
                )}
                <button onClick={handleCopy} className="btn-secondary text-xs">
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Regenerate feedback box */}
      {showFeedback && (
        <div className="mb-6 card p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Feedback for regeneration (optional)</p>
          <textarea
            rows={2}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Focus more on their recent Series B and product expansion..."
            className="input text-sm"
          />
          <div className="flex gap-2">
            <button onClick={handleRegenerate} disabled={regenerating} className="btn-primary text-xs">
              {regenerating ? (
                <>
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Regenerating...
                </>
              ) : 'Regenerate Memo'}
            </button>
            <button onClick={() => setShowFeedback(false)} className="btn-secondary text-xs">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main memo panel */}
        <div className="lg:col-span-2 space-y-6">
          {memo ? (
            <div className="card">
              <div className="border-b border-gray-200 px-5 py-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Generated Memo</span>
                <span className="text-xs text-gray-400">
                  {new Date(memo.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
              </div>
              <div className="p-5">
                {isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="input font-mono text-xs w-full min-h-[600px] resize-y"
                  />
                ) : (
                  <MarkdownRenderer content={displayContent} />
                )}
              </div>
            </div>
          ) : (
            <div className="card p-10 text-center text-gray-400">
              <p className="text-sm">No memo generated yet.</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Meeting info */}
          <div className="card p-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Meeting Info</h3>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Company</dt>
                <dd className="font-medium text-gray-900">{memoRequest.company_name}</dd>
                {memoRequest.company_website && (
                  <a href={memoRequest.company_website} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">
                    {memoRequest.company_website}
                  </a>
                )}
              </div>
              {memoRequest.meeting_type && (
                <div>
                  <dt className="text-xs text-gray-500">Type</dt>
                  <dd className="text-gray-700">{MEETING_TYPE_LABELS[memoRequest.meeting_type] ?? memoRequest.meeting_type}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-500">Depth</dt>
                <dd className="text-gray-700 capitalize">{memoRequest.memo_depth}</dd>
              </div>
            </dl>
          </div>

          {/* Attendees */}
          {memoRequest.attendees && memoRequest.attendees.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Attendees</h3>
              <ul className="space-y-2">
                {memoRequest.attendees.map((a, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium text-gray-900">{a.name}</span>
                    {a.title && <span className="block text-xs text-gray-500">{a.title}</span>}
                    {a.email && <span className="block text-xs text-blue-600">{a.email}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Research sources */}
          {sources.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Research Sources <span className="text-gray-400 font-normal">({sources.length})</span>
              </h3>
              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {sources.map((s) => (
                  <li key={s.id}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener"
                      className="text-xs text-blue-600 hover:underline line-clamp-2"
                    >
                      {s.title || s.url}
                    </a>
                    {s.source_type === 'mock' && (
                      <span className="ml-1 text-xs text-gray-400">(mock)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Internal context preview */}
          {memoRequest.internal_context && (
            <div className="card p-4 space-y-2">
              <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Internal Context</h3>
              <p className="text-xs text-gray-500 line-clamp-6 whitespace-pre-wrap">
                {memoRequest.internal_context}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

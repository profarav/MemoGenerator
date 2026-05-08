'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Attendee, MeetingType, MemoDepth } from '@/types'

function parseAttendees(text: string): Attendee[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Try to parse "Name — Title — email@example.com"
      const parts = line.split(/\s*[—–-]{1,2}\s*/)
      return {
        name: parts[0]?.trim() ?? line,
        title: parts[1]?.trim(),
        email: parts[2]?.trim(),
        raw: line,
      }
    })
}

export default function NewMemoPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({
    meeting_title: '',
    meeting_datetime: '',
    company_name: '',
    company_website: '',
    meeting_type: 'prospect_intro' as MeetingType,
    attendees_text: '',
    known_context: '',
    internal_context: '',
    memo_depth: 'standard' as MemoDepth,
  })

  function set(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const attendees = parseAttendees(form.attendees_text)

      // Save memo request
      const { data: memoRequest, error: insertError } = await supabase
        .from('memo_requests')
        .insert({
          meeting_title: form.meeting_title,
          meeting_datetime: form.meeting_datetime || null,
          company_name: form.company_name,
          company_website: form.company_website || null,
          meeting_type: form.meeting_type,
          attendees,
          known_context: form.known_context || null,
          internal_context: form.internal_context || null,
          memo_depth: form.memo_depth,
          status: 'draft',
        })
        .select()
        .single()

      if (insertError || !memoRequest) {
        throw new Error(insertError?.message ?? 'Failed to save memo request')
      }

      // Trigger generation
      const genRes = await fetch('/api/generate-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoRequestId: memoRequest.id }),
      })

      if (!genRes.ok) {
        const genData = await genRes.json()
        throw new Error(genData.error ?? 'Memo generation failed')
      }

      router.push(`/memo/${memoRequest.id}`)
    } catch (err: unknown) {
      const e = err as { message?: string }
      setError(e?.message ?? 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <a href="/" className="text-xs text-gray-500 hover:text-gray-700">← Dashboard</a>
        <h1 className="mt-2 text-xl font-bold text-gray-900">New Meeting Memo</h1>
        <p className="text-sm text-gray-500 mt-1">
          Fill in the meeting details. The agent will research the company and attendees, then generate a prep memo.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Meeting Details</h2>

          <div>
            <label className="label">Meeting Title *</label>
            <input
              type="text"
              required
              value={form.meeting_title}
              onChange={(e) => set('meeting_title', e.target.value)}
              placeholder="e.g. Intro call with Acme Co."
              className="input"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Date & Time</label>
              <input
                type="datetime-local"
                value={form.meeting_datetime}
                onChange={(e) => set('meeting_datetime', e.target.value)}
                className="input"
              />
            </div>
            <div>
              <label className="label">Meeting Type</label>
              <select
                value={form.meeting_type}
                onChange={(e) => set('meeting_type', e.target.value)}
                className="input"
              >
                <option value="prospect_intro">Prospect Intro</option>
                <option value="client_meeting">Client Meeting</option>
                <option value="partner_meeting">Partner Meeting</option>
                <option value="internal_strategy">Internal Strategy</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Company Name *</label>
              <input
                type="text"
                required
                value={form.company_name}
                onChange={(e) => set('company_name', e.target.value)}
                placeholder="Acme Inc."
                className="input"
              />
            </div>
            <div>
              <label className="label">Company Website</label>
              <input
                type="url"
                value={form.company_website}
                onChange={(e) => set('company_website', e.target.value)}
                placeholder="https://acme.com"
                className="input"
              />
            </div>
          </div>
        </div>

        {/* Attendees */}
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Attendees</h2>
          <div>
            <label className="label">Attendee List</label>
            <textarea
              rows={4}
              value={form.attendees_text}
              onChange={(e) => set('attendees_text', e.target.value)}
              placeholder={`Chris Marcus — CEO and Co-Founder — chris@colormatics.com\nAaron Breeden — Director of Production — aaron@colormatics.com`}
              className="input font-mono text-xs"
            />
            <p className="mt-1 text-xs text-gray-400">One attendee per line. Format: Name — Title — email</p>
          </div>
        </div>

        {/* Context */}
        <div className="card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-gray-800">Context</h2>

          <div>
            <label className="label">Known Context</label>
            <textarea
              rows={3}
              value={form.known_context}
              onChange={(e) => set('known_context', e.target.value)}
              placeholder="What do you already know about this meeting? Who made the intro? Any relevant history?"
              className="input"
            />
          </div>

          <div>
            <label className="label">Internal Context <span className="text-gray-400">(optional)</span></label>
            <textarea
              rows={5}
              value={form.internal_context}
              onChange={(e) => set('internal_context', e.target.value)}
              placeholder="Paste prior emails, Slack threads, Granola notes, or any internal context here..."
              className="input"
            />
            <p className="mt-1 text-xs text-gray-400">
              Paste raw notes, emails, or Slack messages. The agent will extract what's relevant.
            </p>
          </div>
        </div>

        {/* Options */}
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-3">Memo Depth</h2>
          <div className="flex gap-4">
            {(['bare', 'standard', 'detailed'] as MemoDepth[]).map((d) => (
              <label key={d} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="memo_depth"
                  value={d}
                  checked={form.memo_depth === d}
                  onChange={() => set('memo_depth', d)}
                  className="accent-gray-900"
                />
                <span className="text-sm text-gray-700 capitalize">{d}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-400">
            Bare = quick headlines. Standard = full memo. Detailed = deep research.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-4">
            <p className="text-sm text-red-700 font-medium">Error</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating Memo...
              </>
            ) : (
              'Generate Memo'
            )}
          </button>
          <a href="/" className="btn-secondary">Cancel</a>
        </div>

        {loading && (
          <div className="rounded-md bg-blue-50 border border-blue-200 p-4">
            <p className="text-sm font-medium text-blue-800">Generating your memo...</p>
            <p className="text-sm text-blue-700 mt-1">
              Searching the web, summarizing research, and writing the memo. This takes 30–60 seconds.
            </p>
          </div>
        )}
      </form>
    </div>
  )
}

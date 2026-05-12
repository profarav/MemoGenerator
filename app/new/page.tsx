'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Attendee, MeetingType, MemoDepth } from '@/types'

// ─── Attendee parser (used by manual form) ──────────────────────────────────

function parseAttendees(text: string): Attendee[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s*[—–-]{1,2}\s*/)
      return {
        name: parts[0]?.trim() ?? line,
        title: parts[1]?.trim(),
        email: parts[2]?.trim(),
        raw: line,
      }
    })
}

// ─── Loading status messages for Quick Input ────────────────────────────────

const QUICK_STATUS_STEPS = [
  { key: 'parsing',           label: 'Parsing input…' },
  { key: 'enriching_people',  label: 'Enriching people with Apollo…' },
  { key: 'enriching_company', label: 'Enriching company details…' },
  { key: 'generating',        label: 'Generating memo…' },
] as const

type QuickStatusKey = typeof QUICK_STATUS_STEPS[number]['key'] | null

// ─── Quick Input Tab ─────────────────────────────────────────────────────────

function QuickInputTab() {
  const router = useRouter()
  const [rawInput, setRawInput] = useState('')
  const [fallbackFirst, setFallbackFirst] = useState('')
  const [fallbackLast, setFallbackLast] = useState('')
  const [fallbackDomain, setFallbackDomain] = useState('')
  const [status, setStatus] = useState<QuickStatusKey>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loading = status !== null

  // Cycle through status messages while the API call runs
  function startStatusCycle() {
    setStatus('parsing')
    timerRef.current = setTimeout(() => {
      setStatus('enriching_people')
      timerRef.current = setTimeout(() => {
        setStatus('enriching_company')
        timerRef.current = setTimeout(() => {
          setStatus('generating')
        }, 4000)
      }, 5000)
    }, 1200)
  }

  function stopStatusCycle() {
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  useEffect(() => () => stopStatusCycle(), [])

  async function handleQuickGenerate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startStatusCycle()

    try {
      const res = await fetch('/api/quick-generate-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawInput,
          fallbackFirstName: fallbackFirst || undefined,
          fallbackLastName: fallbackLast || undefined,
          fallbackCompanyDomain: fallbackDomain || undefined,
        }),
      })

      const data = await res.json()
      stopStatusCycle()

      if (!res.ok) {
        setStatus(null)
        setError(data.error ?? 'Something went wrong. Try the Manual Input tab.')
        return
      }

      router.push(`/memo/${data.memoId}`)
    } catch (err: unknown) {
      stopStatusCycle()
      setStatus(null)
      setError((err as { message?: string })?.message ?? 'Network error. Please try again.')
    }
  }

  const currentStatusLabel = QUICK_STATUS_STEPS.find((s) => s.key === status)?.label ?? 'Loading…'

  return (
    <form onSubmit={handleQuickGenerate} className="space-y-5">
      <div className="card p-6 space-y-4">
        <div>
          <label className="label">
            Paste attendee emails, a meeting invite, or a prospect identifier
          </label>
          <textarea
            rows={6}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            disabled={loading}
            placeholder={[
              'chris@colormatics.com',
              '',
              'OR paste a meeting invite block:',
              '',
              'Intro call with Colormatics',
              'Guests:',
              'chris@colormatics.com',
              'aaron@colormatics.com',
            ].join('\n')}
            className="input font-mono text-xs"
          />
          <p className="mt-1 text-xs text-gray-400">
            Paste one or more work emails, or copy a calendar invite. Apollo will resolve name, title, and company automatically.
          </p>
        </div>

        <div>
          <p className="label text-gray-500">Fallback — only needed if no email is available</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label text-xs text-gray-500">First Name</label>
              <input
                type="text"
                value={fallbackFirst}
                onChange={(e) => setFallbackFirst(e.target.value)}
                disabled={loading}
                placeholder="Chris"
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label text-xs text-gray-500">Last Name</label>
              <input
                type="text"
                value={fallbackLast}
                onChange={(e) => setFallbackLast(e.target.value)}
                disabled={loading}
                placeholder="Marcus"
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label text-xs text-gray-500">Company Domain</label>
              <input
                type="text"
                value={fallbackDomain}
                onChange={(e) => setFallbackDomain(e.target.value)}
                disabled={loading}
                placeholder="colormatics.com"
                className="input text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-medium text-red-800">Could not generate memo</p>
          <p className="text-sm text-red-700 mt-1">{error}</p>
          <p className="text-xs text-red-500 mt-2">Try the Manual Input tab to enter details directly.</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={loading || (!rawInput.trim() && !(fallbackFirst.trim() && fallbackLast.trim() && fallbackDomain.trim()))}
          className="btn-primary"
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {currentStatusLabel}
            </>
          ) : (
            '⚡ Enrich & Generate Memo'
          )}
        </button>
      </div>

      {loading && (
        <div className="rounded-md bg-indigo-50 border border-indigo-200 p-4">
          <p className="text-sm font-medium text-indigo-800">{currentStatusLabel}</p>
          <p className="text-sm text-indigo-700 mt-1">
            Apollo enrichment + research + memo generation takes about 60–90 seconds.
          </p>
          <div className="mt-3 flex gap-2 flex-wrap">
            {QUICK_STATUS_STEPS.map((step) => (
              <span
                key={step.key}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                  status === step.key
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : QUICK_STATUS_STEPS.findIndex((s) => s.key === status) >
                      QUICK_STATUS_STEPS.findIndex((s) => s.key === step.key)
                    ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                    : 'bg-white text-gray-400 border-gray-200'
                }`}
              >
                {step.label.replace('…', '')}
              </span>
            ))}
          </div>
        </div>
      )}
    </form>
  )
}

// ─── Manual Input Tab (unchanged from original) ───────────────────────────

function ManualInputTab() {
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
    <form onSubmit={handleSubmit} className="space-y-6">
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
            Paste raw notes, emails, or Slack messages. The agent will extract what&apos;s relevant.
          </p>
        </div>
      </div>

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
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

type Tab = 'quick' | 'manual'

export default function NewMemoPage() {
  const [activeTab, setActiveTab] = useState<Tab>('quick')

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <a href="/" className="text-xs text-gray-500 hover:text-gray-700">← Dashboard</a>
        <h1 className="mt-2 text-xl font-bold text-gray-900">New Meeting Memo</h1>
        <p className="text-sm text-gray-500 mt-1">
          Paste attendee emails and the agent will research and write the memo automatically.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6 w-fit">
        {([
          { key: 'quick',  label: '⚡ Quick Input' },
          { key: 'manual', label: '✏️ Manual Input' },
        ] as { key: Tab; label: string }[]).map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'quick' ? <QuickInputTab /> : <ManualInputTab />}
    </div>
  )
}

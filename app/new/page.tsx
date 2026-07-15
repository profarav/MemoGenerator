'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase, describeDbError } from '@/lib/supabase'
import { Attendee, MeetingType, MemoDepth, ResolvedPerson, ResolvedOrganization } from '@/types'

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

// ─── Quick Input Tab ─────────────────────────────────────────────────────────

interface EnrichPreview {
  resolvedPeople: ResolvedPerson[]
  resolvedOrganizations: ResolvedOrganization[]
  primaryOrganization?: ResolvedOrganization
  unresolvedInputs: string[]
}

type QuickStep = 'input' | 'enriching' | 'preview' | 'generating'

/** Small card showing one resolved person from Apollo */
function PersonPreviewCard({ person }: { person: ResolvedPerson }) {
  const name = person.fullName ?? [person.firstName, person.lastName].filter(Boolean).join(' ') ?? person.inputEmail ?? 'Unknown'
  const hasApollo = !!person.rawApollo
  return (
    <div className={`rounded-lg border p-3 text-sm space-y-0.5 ${hasApollo ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-gray-900">{name}</span>
        {hasApollo
          ? <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">✓ Apollo</span>
          : <span className="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">stub</span>
        }
      </div>
      {person.title && <p className="text-xs text-gray-600">{person.title}</p>}
      {person.companyName && <p className="text-xs text-gray-500">{person.companyName}</p>}
      {person.inputEmail && <p className="text-xs text-blue-600">{person.inputEmail}</p>}
      {person.linkedinUrl && (
        <a href={person.linkedinUrl} target="_blank" rel="noopener" className="text-xs text-blue-500 hover:underline">
          LinkedIn ↗
        </a>
      )}
    </div>
  )
}

/** Small card showing resolved org */
function OrgPreviewCard({ org, isPrimary }: { org: ResolvedOrganization; isPrimary: boolean }) {
  const hasApollo = !!org.rawApollo
  return (
    <div className={`rounded-lg border p-3 text-sm space-y-0.5 ${hasApollo ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-gray-900">{org.name ?? org.domain}</span>
        <div className="flex gap-1 shrink-0">
          {isPrimary && <span className="text-xs px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">primary</span>}
          {hasApollo
            ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">✓ Apollo</span>
            : <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">domain only</span>
          }
        </div>
      </div>
      {org.industry && <p className="text-xs text-gray-600">{org.industry}</p>}
      {org.employeeCount && <p className="text-xs text-gray-500">{org.employeeCount.toLocaleString()} employees</p>}
      <p className="text-xs text-gray-400">{org.domain}</p>
    </div>
  )
}

function QuickInputTab() {
  const router = useRouter()

  // Input fields
  const [rawInput, setRawInput] = useState('')
  const [fallbackFirst, setFallbackFirst] = useState('')
  const [fallbackLast, setFallbackLast] = useState('')
  const [fallbackDomain, setFallbackDomain] = useState('')
  const [knownContext, setKnownContext] = useState('')

  // Two-step state
  const [step, setStep] = useState<QuickStep>('input')
  const [preview, setPreview] = useState<EnrichPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generatingLabel, setGeneratingLabel] = useState('Generating memo…')

  const hasInput = rawInput.trim().length > 0 || (fallbackFirst.trim() && fallbackLast.trim() && fallbackDomain.trim())

  // ── Step 1: Enrich ──────────────────────────────────────────────────────────
  async function handleEnrich(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setStep('enriching')

    try {
      const res = await fetch('/api/enrich-preview', {
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

      if (!res.ok) {
        setStep('input')
        setError(data.error ?? 'Enrichment failed. Try Manual Input.')
        return
      }

      setPreview(data)
      setStep('preview')
    } catch (err: unknown) {
      setStep('input')
      setError((err as { message?: string })?.message ?? 'Network error. Please try again.')
    }
  }

  // ── Step 2: Generate ────────────────────────────────────────────────────────
  // Generation now runs in the background: this call returns within seconds with
  // a memoId, and the memo page shows live progress while the pipeline runs.
  async function handleGenerate() {
    if (!preview) return
    setError(null)
    setStep('generating')
    setGeneratingLabel('Starting memo generation…')

    try {
      const res = await fetch('/api/quick-generate-memo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawInput,
          fallbackFirstName: fallbackFirst || undefined,
          fallbackLastName: fallbackLast || undefined,
          fallbackCompanyDomain: fallbackDomain || undefined,
          knownContext: knownContext || undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setStep('preview')
        setError(data.error ?? 'Generation failed.')
        return
      }

      router.push(`/memo/${data.memoId}`)
    } catch (err: unknown) {
      setStep('preview')
      setError((err as { message?: string })?.message ?? 'Network error. Please try again.')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (step === 'generating') {
    return (
      <div className="rounded-md bg-indigo-50 border border-indigo-200 p-6 text-center space-y-3">
        <svg className="h-6 w-6 animate-spin text-indigo-600 mx-auto" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <p className="text-sm font-semibold text-indigo-800">{generatingLabel}</p>
        <p className="text-xs text-indigo-600">You&apos;ll be taken to the memo page to watch progress.</p>
      </div>
    )
  }

  if (step === 'preview' && preview) {
    const primaryDomain = preview.primaryOrganization?.domain
    return (
      <div className="space-y-5">
        {/* Preview header */}
        <div className="card p-4 space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-800">Enrichment Preview</p>
            <button
              type="button"
              onClick={() => { setStep('input'); setPreview(null); setError(null) }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              ← Edit input
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Review what Apollo resolved. If it looks right, click Generate Memo.
          </p>
        </div>

        {/* People */}
        {preview.resolvedPeople.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              People ({preview.resolvedPeople.length})
            </p>
            {preview.resolvedPeople.map((p, i) => (
              <PersonPreviewCard key={i} person={p} />
            ))}
          </div>
        )}

        {/* Organizations */}
        {preview.resolvedOrganizations.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Company
            </p>
            {preview.resolvedOrganizations.map((o, i) => (
              <OrgPreviewCard key={i} org={o} isPrimary={o.domain === primaryDomain} />
            ))}
          </div>
        )}

        {/* Unresolved */}
        {preview.unresolvedInputs.length > 0 && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-1">Could not fully resolve:</p>
            <ul className="space-y-0.5">
              {preview.unresolvedInputs.map((u, i) => (
                <li key={i} className="text-xs text-amber-700">• {u}</li>
              ))}
            </ul>
            <p className="text-xs text-amber-600 mt-1">Memo will still generate using available data.</p>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Confirm generate */}
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleGenerate} className="btn-primary">
            ⚡ Generate Memo
          </button>
          <button
            type="button"
            onClick={() => { setStep('input'); setPreview(null); setError(null) }}
            className="btn-secondary"
          >
            Edit Input
          </button>
        </div>
      </div>
    )
  }

  // Default: input step (or enriching)
  return (
    <form onSubmit={handleEnrich} className="space-y-5">
      <div className="card p-6 space-y-4">
        <div>
          <label className="label">
            Paste emails, a LinkedIn URL, or a meeting invite
          </label>
          <textarea
            rows={6}
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            disabled={step === 'enriching'}
            placeholder={[
              'chris@colormatics.com',
              '',
              'OR a LinkedIn profile URL:',
              'https://linkedin.com/in/chris-marcus-abc123',
              '',
              'OR paste a calendar invite block:',
              'Guests: chris@colormatics.com, aaron@colormatics.com',
            ].join('\n')}
            className="input font-mono text-xs"
          />
          <p className="mt-1 text-xs text-gray-400">
            Work emails, LinkedIn profile URLs, or a copy-pasted calendar invite. Apollo resolves name, title, and company automatically.
          </p>
        </div>

        <div>
          <label className="label">Focus <span className="text-gray-400">(optional)</span></label>
          <textarea
            rows={2}
            value={knownContext}
            onChange={(e) => setKnownContext(e.target.value)}
            disabled={step === 'enriching'}
            placeholder="e.g. Focus on their AI initiatives. Focus on the founder's background before this company. Focus on whether they've raised recently."
            className="input text-sm"
          />
          <p className="mt-1 text-xs text-gray-400">Tell the memo what to prioritize — it will lead with this.</p>
        </div>

        <div>
          <p className="label text-gray-500">Fallback — only needed if no email or LinkedIn URL</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label text-xs text-gray-500">First Name</label>
              <input
                type="text"
                value={fallbackFirst}
                onChange={(e) => setFallbackFirst(e.target.value)}
                disabled={step === 'enriching'}
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
                disabled={step === 'enriching'}
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
                disabled={step === 'enriching'}
                placeholder="colormatics.com"
                className="input text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-medium text-red-800">Could not enrich input</p>
          <p className="text-sm text-red-700 mt-1">{error}</p>
          <p className="text-xs text-red-500 mt-2">Try the Manual Input tab to enter details directly.</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={step === 'enriching' || !hasInput}
          className="btn-primary"
        >
          {step === 'enriching' ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Enriching with Apollo…
            </>
          ) : (
            '🔍 Enrich & Preview'
          )}
        </button>
      </div>
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
        throw new Error(`Failed to save memo request: ${describeDbError(insertError?.message)}`)
      }

      // Kicks off background generation and returns immediately; the memo page
      // shows live progress while the pipeline runs.
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

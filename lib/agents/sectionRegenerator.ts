import { callClaude } from '@/lib/anthropic'
import { SYSTEM_PROMPT, MemoSectionSpec } from '@/lib/agents/memoGenerator'
import { ParsedSection, stripLeadingHeading } from '@/lib/memo/sections'
import { MemoRequest, ResearchSource } from '@/types'

/**
 * Rewrite a single memo section.
 *
 * Deliberately a single Claude call: it reuses the already-written memo as
 * context rather than re-running the summarize → relevance → generate pipeline,
 * so a section rewrite takes seconds instead of minutes. The research sources
 * are passed through so the rewrite can pull in detail the first pass skipped.
 */
export async function regenerateSection(params: {
  memoRequest: MemoRequest
  currentMemo: string
  section: ParsedSection
  spec: MemoSectionSpec
  sources: ResearchSource[]
  /** Optional user instruction, e.g. "focus on their Series B" */
  focus?: string
}): Promise<string> {
  const { memoRequest, currentMemo, section, spec, sources, focus } = params

  const attendeeList =
    Array.isArray(memoRequest.attendees) && memoRequest.attendees.length > 0
      ? memoRequest.attendees
          .map((a) => a.raw || `${a.name}${a.title ? ` — ${a.title}` : ''}`)
          .join('\n')
      : 'Not specified'

  const sourceList = sources
    .map((s, i) => {
      const snippet = s.snippet ? `\n    ${s.snippet.slice(0, 400)}` : ''
      return `[${i + 1}] ${s.title || s.url} — ${s.url}${snippet}`
    })
    .join('\n')

  const user = `You are revising ONE section of an existing meeting prep memo. Everything else in the memo stays exactly as it is.

---
MEETING
- Title: ${memoRequest.meeting_title}
- Company: ${memoRequest.company_name}${memoRequest.company_website ? ` (${memoRequest.company_website})` : ''}
- Attendees:
${attendeeList}

---
THE FULL CURRENT MEMO (for context — so your rewrite doesn't repeat or contradict the other sections):
${currentMemo}

---
THE SECTION YOU ARE REWRITING: "## ${section.number}. ${section.title}"

Its current text is:
${section.body || '(empty)'}

What this section is supposed to contain:
${spec.instructions}

---
RESEARCH SOURCES (use these for any new detail — do not invent facts):
${sourceList || 'No sources available.'}
${
  memoRequest.internal_context
    ? `\n---\nINTERNAL CONTEXT (emails/Slack/Granola):\n${memoRequest.internal_context}\n`
    : ''
}${
    focus
      ? `\n---\n⚠️ FOCUS INSTRUCTION — the reason this section is being rewritten. This overrides the default emphasis:
"${focus}"
Lead this section with it and make sure it is addressed directly. If the research genuinely does not support it, say plainly what is and isn't known rather than speculating.\n`
      : ''
  }
---
Rewrite the section now.

Rules:
- Output ONLY the body of this one section. Do NOT include the "## ${section.number}. ${section.title}" heading.
- Do NOT output any other section, preamble, or commentary about your changes.
- Keep the same markdown formatting conventions as the rest of the memo.
- This must be a genuine improvement, not a reshuffle of the same sentences.${focus ? ' The focus instruction above is the priority.' : ''}`

  const result = await callClaude(SYSTEM_PROMPT, user, 2000)
  return stripLeadingHeading(result)
}

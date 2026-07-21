import { callClaude } from '@/lib/anthropic'
import { MEMO_SECTIONS } from '@/lib/memo/sections'
import { OFFERING_DESCRIPTION } from '@/lib/config/offering'
import { Attendee, MemoRequest, ResearchSource, ResearchSummary, RelevanceMap } from '@/types'

export const SYSTEM_PROMPT = `You are writing a meeting prep memo for Hugh and his team before a sales meeting.

The memo's job: let someone SCAN it in under a minute and walk into the meeting knowing who they're talking to, what the company does, and how to run the conversation.

This memo is scanned, not read. That means:
- Structured and front-loaded. Key facts first. One point per bullet.
- Bullet-heavy. The ONLY prose paragraph is the Quick Summary at the very end.
- Specific over comprehensive — a sharp bullet beats a padded one.

Depth still matters. Do NOT water down the research to make it short. Keep the specific, non-obvious details — real company, product, and school names; prior startups; traction numbers. Just deliver them as tight bullets, not narrative.

Style rules:
- Plain English. Name the actual thing. No buzzwords: "innovative," "cutting-edge," "solutions," "leverage," "ecosystem," "digital transformation."
- Grounded. If uncertain, say so plainly and never fabricate. If a fact wasn't found, omit it rather than pad.
- Every fact should be concrete enough that Hugh could repeat it out loud.

Hard rules on prior products (enforce strictly):
- NEVER describe a prior product as "a digital product," "a technology platform," "unclear function," or "a service company."
- ALWAYS name the specific category first: "a calendar and task assistant app," "a CRM for agencies," "a sales automation tool," "a marketplace for X." The category has been pre-inferred for you in the research.
- If a product's current status is unclear, say so AFTER describing what it did — and treat that uncertainty as a conversation hook.

Discovery orientation:
- QUESTIONS TO ASK and KEY TALKING POINTS are sales-meeting tools. Make them sharp and specific to THIS company and contact — questions a smart rep would actually ask, angles they'd actually use. Never generic.

What makes this memo bad:
- Paragraphs where bullets belong
- Describing a company in its own marketing language or tagline
- Generic questions that could apply to any company
- Prior products left vague
- Repeating the same fact across multiple sections`

export interface MemoSectionSpec {
  key: string
  title: string
  /** The writing instructions for this section, used verbatim in both full
   *  generation and single-section regeneration so the two can't drift. */
  instructions: string
}

const SECTION_INSTRUCTIONS: Record<string, string> = {
  sector: `One or two sentences naming the sector/industry the company operates in and the market it serves. Concrete — e.g. "outdoor recreation and travel marketplace connecting campers with private and public camping accommodations." No buzzwords.`,

  who_they_are: `Scannable bullets about the COMPANY (not the person). Include, one point per bullet, in roughly this order:
- Website — and company LinkedIn if it appears in the research (do not invent a URL)
- What the product or service actually is, in plain terms — name the category
- Core features or how it works
- Positioning / what they emphasize
- Footprint, scale, or traction — geography, customers, employee count, known clients — if found
- Trust or traction signals — ratings, review volume, partnerships, notable numbers — if found
Omit any bullet you don't have real information for. Do not pad.`,

  who_talking_to: `A short contact block — one bullet each, identifiers only (background goes in the next section):
- Name
- Title
- LinkedIn or email, if available
List every attendee this way.`,

  background: `Bullets on the contact's background — this is where depth matters, keep it rich but scannable, one point per line:
- Current role, tenure, and scope
- Career trajectory — how they got here, with real company and school names
- Notable prior companies, products, or startups. One line each: **Name** (confirmed / likely / unclear) — what it did, who it served, current status. Never leave a prior product vague; name the category. If status is unclear, still include it and say so.
- Any non-obvious detail that makes them interesting or informs the meeting
No nested sub-bullets — keep each point to a single line. If nothing notable was found, say so plainly.`,

  questions: `A numbered list of 4–6 sharp discovery questions to ask in this meeting. Ground them in what this company does, the meeting type, our services (see OUR SERVICES), and any focus/context provided. Open-ended and specific to THEM — not questions that could be asked of any company. Aim at their goals, current state, what's driving the conversation, how decisions get made, and where our services could fit. Avoid yes/no questions. If the research doesn't clearly support that a service is relevant, ask a question that surfaces whether it is rather than assuming it.`,

  talking_points: `Bullets — angles and hooks to use in the conversation, oriented toward how our services (see OUR SERVICES) could help them. Draw on the relevance analysis and research: what about their business, background, or recent signals gives a natural way in; what to emphasize; and what to be aware of (e.g. "two-sided marketplace — hosts and campers may need distinct strategies"). Each a single scannable line. These must be genuinely useful to a rep, not restatements of facts already listed above.`,

  summary: `3–5 sentences — the only prose in the memo. Recap: what the company does, who the contact is, what this meeting is likely about, and the single most important thing to focus on. Write it like a colleague's quick brief — specific, not generic.`,
}

export const MEMO_SECTION_SPECS: MemoSectionSpec[] = MEMO_SECTIONS.map((s) => ({
  key: s.key,
  title: s.title,
  instructions: SECTION_INSTRUCTIONS[s.key] ?? '',
}))

export function findSectionSpec(sectionTitle: string): MemoSectionSpec | undefined {
  return MEMO_SECTION_SPECS.find((s) => s.title === sectionTitle)
}

function depthNote(depth: string): string {
  if (depth === 'bare') return 'Keep it brief — 2 bullets max per section. Skip elaboration.'
  if (depth === 'detailed') return 'Go deep. Full founder history, detailed prior products, more questions.'
  return 'Standard — useful and clear, not padded.'
}

function formatMeetingType(type: string | null): string {
  const map: Record<string, string> = {
    prospect_intro: 'Prospect Intro',
    client_meeting: 'Client Meeting',
    partner_meeting: 'Partner Meeting',
    internal_strategy: 'Internal Strategy',
    other: 'Other',
  }
  return type ? (map[type] ?? type) : 'Not specified'
}

/** Structured attendee list including LinkedIn/email so the memo can populate
 *  the WHO WE'RE TALKING TO contact block with real identifiers. */
function buildAttendeeBlock(attendees: Attendee[] | null): string {
  if (!Array.isArray(attendees) || attendees.length === 0) return 'Not specified'
  return attendees
    .map((a) => {
      const parts = [`- Name: ${a.name}`]
      if (a.title) parts.push(`  Title: ${a.title}`)
      if (a.email) parts.push(`  Email: ${a.email}`)
      if (a.linkedinUrl) parts.push(`  LinkedIn: ${a.linkedinUrl}`)
      return parts.join('\n')
    })
    .join('\n')
}

function buildPersonContext(summary: ResearchSummary): string {
  if (!summary.peopleBackground?.length) return 'No person background found in research.'
  return summary.peopleBackground
    .map((p) => {
      const lines = [`${p.name}${p.currentRole ? ` — ${p.currentRole}` : ''}`]
      if (p.facts?.length) lines.push(`Facts: ${p.facts.join(' | ')}`)
      if (p.previousCompanies?.length) {
        lines.push('Prior work:')
        for (const c of p.previousCompanies) {
          lines.push(
            `  - ${c.name} [${c.certaintyLevel}]: ${c.whatItDid} | Served: ${c.whoItServed} | Status: ${c.currentStatus}`
          )
        }
      }
      if (p.otherRoles?.length) lines.push(`Other roles: ${p.otherRoles.join(', ')}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

function buildRelevanceContext(map: RelevanceMap): string {
  const sections: string[] = []

  if (map.highestSignalFacts?.length) {
    sections.push(`HIGHEST SIGNAL FACTS (lead the memo with these):\n${map.highestSignalFacts.map((f) => `- ${f}`).join('\n')}`)
  }

  // Product relevance scores — tell the generator what matters and why
  if (map.productRelevanceScores?.length) {
    const scores = map.productRelevanceScores
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 }
        return order[a.overallScore] - order[b.overallScore]
      })
      .map(
        (s) =>
          `  ${s.productName} [score: ${s.overallScore}]\n` +
          `  Problem space: ${s.problemSpace}\n` +
          `  Category clarity: ${s.categoryClarity} | Status clarity: ${s.statusClarity}\n` +
          `  Why it matters: ${s.internalRelevanceReason}\n` +
          `  Hook value: ${s.conversationHookValue} | Priority: ${s.priorityReason}`
      )
      .join('\n\n')
    sections.push(`PRODUCT RELEVANCE SCORES (use to prioritize what to cover):\n${scores}`)
  }

  if (map.priorProductsExplained?.length) {
    const products = map.priorProductsExplained
      .map(
        (p) =>
          `  ${p.name} [${p.certaintyLevel}]\n` +
          `  What it did: ${p.whatItDid}\n` +
          `  Who it served: ${p.whoItServed}\n` +
          `  Status: ${p.currentStatus}\n` +
          `  Why it matters for this memo: ${p.whyItMatters}`
      )
      .join('\n\n')
    sections.push(`PRIOR PRODUCTS / COMPANIES (use these verbatim descriptions — do not re-vague them):\n${products}`)
  }

  if (map.whyPersonMatters) {
    sections.push(`WHY THIS PERSON MATTERS:\n${map.whyPersonMatters}`)
  }

  if (map.conversationHooks?.length) {
    sections.push(`PREPARED CONVERSATION HOOKS (use these directly or lightly adapt):\n${map.conversationHooks.map((h) => `- ${h}`).join('\n')}`)
  }

  if (map.uncertainItems?.length) {
    sections.push(`UNCERTAIN BUT WORTH ASKING:\n${map.uncertainItems.map((u) => `- ${u}`).join('\n')}`)
  }

  const buckets = map.relevanceBuckets
  const bucketLines: string[] = []
  if (buckets?.directOverlap?.length) bucketLines.push(`Direct overlap: ${buckets.directOverlap.join(' | ')}`)
  if (buckets?.aiAutomationRelevance?.length) bucketLines.push(`AI/automation: ${buckets.aiAutomationRelevance.join(' | ')}`)
  if (buckets?.similarWorkflowOrProblem?.length) bucketLines.push(`Similar workflow: ${buckets.similarWorkflowOrProblem.join(' | ')}`)
  if (buckets?.recentGrowthSignals?.length) bucketLines.push(`Recent signals: ${buckets.recentGrowthSignals.join(' | ')}`)
  if (bucketLines.length) sections.push(`RELEVANCE SIGNALS:\n${bucketLines.join('\n')}`)

  return sections.join('\n\n')
}

export async function generateMemo(
  memoRequest: MemoRequest,
  researchSummary: ResearchSummary,
  sources: ResearchSource[],
  relevanceMap?: RelevanceMap
): Promise<string> {
  const attendeeList = buildAttendeeBlock(memoRequest.attendees)

  const personContext = buildPersonContext(researchSummary)
  const relevanceContext = relevanceMap ? buildRelevanceContext(relevanceMap) : ''
  const companyFacts = researchSummary.companyBackground?.join('\n- ') || 'No company information found.'
  const signals = researchSummary.notableSignals?.join('\n- ') || 'None found.'
  const sourceList = sources.map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`).join('\n')

  const user = `Write a meeting prep memo for Hugh. Use the person and relevance research below — it has already been analyzed and prioritized for you.

Depth: ${depthNote(memoRequest.memo_depth)}

---
OUR SERVICES (what Hugh's team offers — angle QUESTIONS TO ASK and KEY TALKING POINTS toward uncovering fit for these, without making the memo a pitch):
${OFFERING_DESCRIPTION}

---
MEETING
- Title: ${memoRequest.meeting_title}
- Date/Time: ${memoRequest.meeting_datetime ?? 'TBD'}
- Company: ${memoRequest.company_name}${memoRequest.company_website ? ` (${memoRequest.company_website})` : ''}
- Type: ${formatMeetingType(memoRequest.meeting_type)}
- Attendees:
${attendeeList}

---
PERSON RESEARCH (raw extraction):
${personContext}

---
RELEVANCE ANALYSIS (prioritized signal — use this to lead the memo):
${relevanceContext || 'Not available — use person research directly.'}

---
COMPANY FACTS:
- ${companyFacts}

---
RECENT SIGNALS:
- ${signals}

${memoRequest.known_context ? `---
⚠️ FOCUS INSTRUCTION — Hugh specifically wants this memo to prioritize:
"${memoRequest.known_context}"
Make sure QUESTIONS TO ASK, KEY TALKING POINTS, and the QUICK SUMMARY reflect this directly. Do not bury it.
` : ''}
---
INTERNAL CONTEXT (emails/Slack/Granola):
${memoRequest.internal_context ?? 'None provided.'}

---
SOURCES:
${sourceList || 'No sources.'}

---
Write the memo using EXACTLY this structure and these EXACT headings, in this order. Do not add, rename, renumber, or skip sections. Start directly with the first heading — no title line.

${MEMO_SECTION_SPECS.map((s) => `## ${s.title}\n${s.instructions}`).join('\n\n')}`

  return callClaude(SYSTEM_PROMPT, user, 6000)
}

import { callClaude } from '@/lib/anthropic'
import { MemoRequest, ResearchSource, ResearchSummary, RelevanceMap } from '@/types'

export const SYSTEM_PROMPT = `You are writing a meeting prep memo for Hugh.

The memo's job is to make Hugh feel like a smart human researcher briefed him — not like an AI summarized a company website.

What Hugh actually needs:
- To know WHO the person is and what they have built, not just what their current company does
- Specific, natural conversation openers based on real background details
- A clear, honest answer to "why does this meeting matter"
- The most interesting or non-obvious fact about the person, leading the memo

Style rules:
- Person-first, always. The most interesting thing is usually what someone built before, not their current company.
- Plain English. One clear sentence before any detail. No buzzwords unless sourced directly.
- Grounded. If uncertain, say so clearly but still explain what is known and why it matters.
- Short enough to read in 3 minutes.

Hard rules on prior products (enforce these strictly):
- NEVER describe a prior product as "a digital product," "a technology platform," "unclear function," or "a service company." These are useless.
- ALWAYS name the specific product category first: "a calendar and task assistant app," "a CRM for agencies," "a sales automation tool," "a marketplace for X." Use the research and scoring provided — the category has been pre-inferred for you.
- If current status is unclear, say so AFTER describing what the product did. "Appears to have been a calendar/task app — current availability is unclear." Status uncertainty does not excuse description vagueness.
- If a product's current status is unclear, that is itself a conversation hook. Write it as one.
- Products that are divisions or arms of the CURRENT company go under Current Company or Interesting Signals — not Previous Companies.

What makes a memo bad:
- Starting with the company's marketing copy
- Describing a prior product as "unclear" without explaining what it appeared to do
- Writing "Why it matters: he manages multiple companies" — that is not relevance
- Describing a company with words like "innovative," "cutting-edge," "solutions," "leverage," "ecosystem," or "digital transformation" — these tell Hugh nothing
- Using the company's own tagline or About page as the company description
- Saying a company "helps brands tell their story" or "delivers impactful experiences" — those are not descriptions, they are slogans
- Speculation without evidence (acquisitions, market entry, "strategic fit")`

export interface MemoSectionSpec {
  number: number
  title: string
  /** The writing instructions for this section, used verbatim in both full
   *  generation and single-section regeneration so the two can't drift. */
  instructions: string
}

export const MEMO_SECTION_SPECS: MemoSectionSpec[] = [
  {
    number: 1,
    title: 'Quick Summary',
    instructions: `3–5 sentences. Lead with the person, not the company. Who are they, what makes their background interesting? Write it like a smart colleague briefing Hugh in the hallway — specific, not generic.`,
  },
  {
    number: 2,
    title: 'Person Background',
    instructions: `For each attendee: current role, how they got there, education if relevant, and any non-obvious career details. Be specific. Real names of companies, universities, or products. Do not repeat facts already stated in the Quick Summary — go deeper or move on.`,
  },
  {
    number: 3,
    title: 'Previous Companies & Products',
    instructions: `For each prior startup, app, or product found:
- **[Product/Company Name]** *(confirmed / likely / unclear)*
  - What it did: [plain English description]
  - Who it served: [target user or customer]
  - Current status: [active / shut down / acquired / unclear — with any available evidence]

If nothing was found: "No confirmed prior startups or products found in research."

Do NOT skip this section. If status is unclear, still include the product.`,
  },
  {
    number: 4,
    title: 'Current Company',
    instructions: `Explain concretely what this company does — not marketing language, but how it actually works. Do not repeat facts about the person already covered in sections 1–2.

Cover:
- **What they sell or build**: name the actual product or service in plain terms (e.g. "a video production company that makes brand commercials," not "a creative agency"). If it is software, say what the software does. If it is a service, say what the service delivers.
- **Who their customers are**: specific industries, company sizes, or buyer types — not "brands" or "enterprises."
- **How the business works**: agency? SaaS? Marketplace? Retainer? Project-based? Be direct.
- **Scale or traction**: employee count, known clients, geographic reach, or revenue signals if found in research. If nothing was found, say so.
- **Anything differentiated**: one thing that makes them different from competitors in the same space, based on research — not their own marketing claim.

Do not use words like "innovative," "cutting-edge," "solutions," "leverage," "ecosystem," or "digital transformation." If you cannot describe what they do without those words, say what is unclear and what was searched.`,
  },
  {
    number: 5,
    title: 'Sources Checked',
    instructions: `List each: Title — URL`,
  },
]

export function findSectionSpec(sectionNumber: number): MemoSectionSpec | undefined {
  return MEMO_SECTION_SPECS.find((s) => s.number === sectionNumber)
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
  const attendeeList =
    Array.isArray(memoRequest.attendees) && memoRequest.attendees.length > 0
      ? memoRequest.attendees
          .map((a) => a.raw || `${a.name}${a.title ? ` — ${a.title}` : ''}`)
          .join('\n')
      : 'Not specified'

  const personContext = buildPersonContext(researchSummary)
  const relevanceContext = relevanceMap ? buildRelevanceContext(relevanceMap) : ''
  const companyFacts = researchSummary.companyBackground?.join('\n- ') || 'No company information found.'
  const signals = researchSummary.notableSignals?.join('\n- ') || 'None found.'
  const sourceList = sources.map((s, i) => `[${i + 1}] ${s.title || s.url} — ${s.url}`).join('\n')

  const user = `Write a meeting prep memo for Hugh. Use the person and relevance research below — it has already been analyzed and prioritized for you.

Depth: ${depthNote(memoRequest.memo_depth)}

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
⚠️ FOCUS INSTRUCTION — Patrick specifically wants this memo to prioritize:
"${memoRequest.known_context}"
Lead the Quick Summary with this. Make sure section 4 addresses it directly if relevant. Do not bury it.
` : ''}
---
INTERNAL CONTEXT (emails/Slack/Granola):
${memoRequest.internal_context ?? 'None provided.'}

---
SOURCES:
${sourceList || 'No sources.'}

---
Write the memo using EXACTLY this structure. Do not add sections. Do not skip sections.

# Meeting Prep Memo: ${memoRequest.company_name}

${MEMO_SECTION_SPECS.map((s) => `## ${s.number}. ${s.title}\n${s.instructions}`).join('\n\n')}`

  return callClaude(SYSTEM_PROMPT, user, 6000)
}

import { callClaude } from '@/lib/anthropic'
import { MemoRequest, ResearchSummary, RelevanceMap } from '@/types'

export async function mapRelevance(
  memoRequest: MemoRequest,
  summary: ResearchSummary
): Promise<RelevanceMap> {
  const attendeeNames = Array.isArray(memoRequest.attendees)
    ? memoRequest.attendees.map((a) => `${a.name}${a.title ? ` (${a.title})` : ''}`).join(', ')
    : 'unknown'

  const summaryText = JSON.stringify(summary, null, 2)

  const system = `You are analyzing research for a meeting brief.
Your job: decide what actually matters, score prior products for relevance, and produce conversation hooks based on real findings.

Critical rules:
- Product description is separate from current status. A shut-down product can still be highly relevant.
- "Unclear status" is not the same as "not useful." Unclear status is often a great conversation hook.
- Never write a relevance reason like "he runs two companies." That is not relevance — that is a fact.
- Relevance must connect the product's actual problem space to something meaningful: workflow automation, scheduling, AI, productivity, agencies, sales tools, or the specific meeting goal.
- Conversation hooks must be grounded in specific findings. Use the templates. Never write "What are your AI plans?"
Return only valid JSON. No markdown fences.`

  const user = `Meeting: ${memoRequest.meeting_title}
Company: ${memoRequest.company_name}
Attendees: ${attendeeNames}
Meeting type: ${memoRequest.meeting_type ?? 'not specified'}
Known context: ${memoRequest.known_context ?? 'none'}

Research summary:
${summaryText}

Produce a relevance map. Return this exact JSON:

{
  "highestSignalFacts": [
    "The 4-6 most important things to know. Person insights first, company facts second. Be specific — use real product names, real categories, real roles."
  ],
  "productRelevanceScores": [
    {
      "productName": "exact name from previousCompanies",
      "categoryClarity": "clear | partial | unclear",
      "statusClarity": "active | inactive | unclear",
      "problemSpace": "The specific workflow or problem the product addressed. Use a category: scheduling, task management, sales automation, CRM, AI assistant, etc. Never write 'unclear' here — infer from product name, description, or category if needed.",
      "internalRelevance": "high | medium | low",
      "internalRelevanceReason": "Specific reason: 'Overlaps with scheduling/productivity workflow' or 'Serves SMB market similar to our customer base' — not vague.",
      "conversationHookValue": "high | medium | low",
      "overallScore": "high | medium | low",
      "priorityReason": "One sentence: why this product should be highlighted in the memo, even if status is unclear."
    }
  ],
  "relevanceBuckets": {
    "directOverlap": ["Facts that directly overlap with the meeting goal."],
    "similarCustomerBase": ["Facts suggesting they serve a similar customer type."],
    "similarWorkflowOrProblem": ["Facts suggesting they work on similar workflows or problems."],
    "aiAutomationRelevance": ["AI, automation, scheduling, or productivity signals."],
    "founderProductExperience": ["Prior startup or product experience — use specific product names and categories."],
    "salesAgencyRelevance": ["Agency, consulting, or sales-related signals."],
    "recentGrowthSignals": ["Recent hiring, launches, pivots, or press — specific."],
    "personalConversationHooks": ["Non-obvious personal details that make for a natural opener."]
  },
  "priorProductsExplained": [
    {
      "name": "Product name",
      "whatItDid": "Plain English. Start with the category. 'A calendar and task assistant app that...' NOT 'A digital product.'",
      "whoItServed": "Target user — individuals, SMBs, enterprises, developers, etc.",
      "currentStatus": "active / likely active / shut down / likely shut down / status unclear — add evidence if any.",
      "whyItMatters": "1-2 sentences connecting the product's problem space to this meeting. Be specific: 'This overlaps with scheduling/AI assistant workflows, which connects to [meeting goal or internal priority].' Do NOT say 'He manages multiple companies.'",
      "certaintyLevel": "confirmed | likely | unclear"
    }
  ],
  "whyPersonMatters": "1-2 grounded sentences. Must reference specific facts: a product name, a problem space, a career pattern. Format: '[Person] is relevant because [specific founding/product history], which connects to [specific thing relevant to this meeting or Hugh's interests].' No hype. No vague strategic language.",
  "conversationHooks": [
    "Use these formats based on real findings only:\n- 'I saw you previously built [X] — what did you learn from that?'\n- 'It looks like [X] may no longer be active — what happened there?'\n- 'You've worked across [role A] and [role B] — how do those connect?'\n- '[X] sounds similar to [internal theme] — is that a fair comparison?'\n- 'I noticed you have a background in [Y] — how does that shape how you build now?'"
  ],
  "uncertainItems": [
    "Things worth asking despite uncertainty. Format: 'Public sources suggest [X], but [Y] is unclear — worth asking.' Include only if the uncertainty itself is a good conversation hook."
  ]
}

Scoring rules for productRelevanceScores:
- problemSpace: ALWAYS fill this in. If the product name or any source detail gives a clue, infer the category. 'Butleroy' → likely personal assistant, butler-style app. Use the name itself as a clue.
- internalRelevanceReason: must be specific to this meeting, not generic.
- overallScore 'high': product category clearly relevant to meeting goal or internal priorities.
- overallScore 'medium': product is interesting founder experience even if not directly relevant.
- overallScore 'low': product is a minor or unrelated prior venture.

Return only the JSON object.`

  const raw = await callClaude(system, user, 3000)

  try {
    const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '').trim()
    return JSON.parse(cleaned) as RelevanceMap
  } catch {
    console.error('[relevanceMapper] JSON parse failed:', raw.slice(0, 400))
    return {
      highestSignalFacts: summary.companyBackground.slice(0, 3),
      relevanceBuckets: {
        directOverlap: [],
        similarCustomerBase: [],
        similarWorkflowOrProblem: [],
        aiAutomationRelevance: summary.relevantFacts.slice(0, 2),
        founderProductExperience: summary.peopleBackground.flatMap(
          (p) => p.previousCompanies?.map((c) => `${p.name} previously built ${c.name} (${c.whatItDid})`) ?? []
        ),
        salesAgencyRelevance: [],
        recentGrowthSignals: summary.notableSignals.slice(0, 2),
        personalConversationHooks: summary.openQuestions.slice(0, 2),
      },
      priorProductsExplained: summary.peopleBackground.flatMap(
        (p) =>
          (p.previousCompanies ?? []).map((c) => ({
            name: c.name,
            whatItDid: c.whatItDid,
            whoItServed: c.whoItServed,
            currentStatus: c.currentStatus,
            whyItMatters: `Represents prior product experience in a relevant space.`,
            certaintyLevel: c.certaintyLevel,
          }))
      ),
      whyPersonMatters: `${summary.peopleBackground[0]?.name ?? 'This person'} has relevant prior product and founder experience worth discussing.`,
      conversationHooks: summary.openQuestions.slice(0, 3),
      uncertainItems: [],
    }
  }
}

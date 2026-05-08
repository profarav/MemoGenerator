import { callClaude } from '@/lib/anthropic'
import { MemoRequest, ResearchSource, ResearchSummary } from '@/types'

export async function summarizeSources(
  memoRequest: MemoRequest,
  sources: ResearchSource[]
): Promise<ResearchSummary> {
  if (sources.length === 0) {
    return {
      companyBackground: ['No sources found.'],
      peopleBackground: [],
      notableSignals: [],
      relevantFacts: [],
      openQuestions: [],
      sourceNotes: ['No search results were available.'],
    }
  }

  const sourcesText = sources
    .map((s, i) => `[Source ${i + 1}]\nTitle: ${s.title}\nURL: ${s.url}\nContent: ${s.snippet}`)
    .join('\n\n---\n\n')

  const attendeeNames = Array.isArray(memoRequest.attendees)
    ? memoRequest.attendees.map((a) => a.name).join(', ')
    : 'unknown'

  const system = `You are a research analyst extracting structured facts for a meeting brief.

Critical rules on handling uncertainty:
- NEVER say a product is "unclear" or "unknown" without first writing down what you DO know or can reasonably infer.
- Product description uncertainty and status uncertainty are DIFFERENT. A product can have a clear description but an unclear current status.
- If you know an app exists but can't confirm it's still live, say: "appears to have been a [category] app — current availability unclear."
- Always infer the product category from every available clue: name, app store presence, founder background, press snippets, Crunchbase tags, job descriptions, or even the product's name itself.
- Bad: "Butleroy — digital product, function unclear."
- Good: "Butleroy — calendar and task assistant app (inferred from app store listing and description). Current status unclear."

Return only valid JSON. No markdown fences. No extra text.`

  const user = `Meeting: ${memoRequest.meeting_title}
Current company: ${memoRequest.company_name}
Attendees to research: ${attendeeNames}

Search results (may include both first-pass and targeted product searches):
${sourcesText}

Return this exact JSON structure:

{
  "companyBackground": [
    "One plain-English sentence about what the company does.",
    "Who they serve.",
    "Notable products, clients, or differentiators — specific, not vague."
  ],
  "peopleBackground": [
    {
      "name": "Full Name",
      "currentRole": "their specific role at the current company",
      "facts": [
        "Specific fact — education, location, how long they've been at the company, public profile detail."
      ],
      "previousCompanies": [
        {
          "name": "Product or company name",
          "whatItDid": "Plain English. State the specific product category first: 'A calendar and task assistant app that...' NOT 'A digital product that...' Use every clue available — app name, description fragments, App Store presence, Crunchbase tags, related news.",
          "whoItServed": "Who was the target user? Individuals, SMBs, enterprises, developers? Infer from product category if not stated.",
          "currentStatus": "active / likely active / shut down / likely shut down / acquired / status unclear. Separate this from the product description. Add evidence: 'app no longer appears in App Store' or 'Crunchbase still lists as active.'",
          "certaintyLevel": "confirmed | likely | unclear"
        }
      ],
      "otherRoles": [
        "Lecturer at X university — be specific about subject and institution.",
        "Advisor at Y — what kind of company.",
        "Angel investor."
      ]
    }
  ],
  "notableSignals": [
    "Specific recent signal — product launch, new hire, AI pivot, press mention, product shutdown, funding."
  ],
  "relevantFacts": [
    "Fact that connects to AI, scheduling, productivity, workflow, agencies, automation, or sales."
  ],
  "openQuestions": [
    "Something the sources hint at but don't fully answer. Frame it as: 'Sources suggest X, but Y is unclear — worth asking.' Only include if the gap is actually interesting."
  ],
  "sourceNotes": [
    "What was easy vs. hard to find. What key searches returned limited results."
  ]
}

Product extraction rules:
- Look at EVERY source for company or product names associated with attendees that are not the current company.
- If a product name appears even once (Crunchbase, personal site, LinkedIn, old press), include it in previousCompanies.
- For the whatItDid field: start with the specific category (e.g. 'A calendar and task assistant app'), then describe. Never start with 'A digital product' or 'A technology platform.'
- For certaintyLevel: 'confirmed' = multiple sources agree; 'likely' = strongly implied by available evidence; 'unclear' = you can infer the category but details are thin.
- Products that are clearly arms/divisions of the CURRENT company go in notableSignals, not previousCompanies.

Return only the JSON object.`

  const raw = await callClaude(system, user, 3500)

  try {
    const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '').trim()
    return JSON.parse(cleaned) as ResearchSummary
  } catch {
    console.error('[researchSummarizer] JSON parse failed:', raw.slice(0, 400))
    return {
      companyBackground: ['Research collected but could not be parsed. Check sources in sidebar.'],
      peopleBackground: [],
      notableSignals: [],
      relevantFacts: [],
      openQuestions: [],
      sourceNotes: ['JSON parsing error in summarization step.'],
    }
  }
}

import { callClaude } from '@/lib/anthropic'
import { ResearchSource } from '@/types'

export interface DiscoveredProduct {
  name: string
  associatedPerson: string
  discoveredFrom: string // which source hinted at this
}

/**
 * Fast first-pass extraction: given raw search results, pull out any
 * company/product names that are NOT the current company. We use these
 * to run a targeted second-pass search before writing the memo.
 */
export async function extractPriorProductNames(
  currentCompanyName: string,
  attendeeNames: string[],
  sources: ResearchSource[]
): Promise<DiscoveredProduct[]> {
  if (sources.length === 0) return []

  const sourcesText = sources
    .slice(0, 20) // keep this call fast
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.url}\n${s.snippet}`)
    .join('\n\n---\n\n')

  const system = `You extract company and product names from search results. Return only valid JSON. No markdown fences.`

  const user = `Current company (exclude this): ${currentCompanyName}
Attendees: ${attendeeNames.join(', ')}

Search results:
${sourcesText}

Scan every result for company names, app names, product names, or startup names that:
1. Are associated with one of the attendees
2. Are NOT the current company (${currentCompanyName}) or obvious subsidiaries/arms of it

Return JSON:
{
  "discoveredProducts": [
    {
      "name": "exact product or company name as found in sources",
      "associatedPerson": "which attendee this is linked to",
      "discoveredFrom": "brief note on where you saw this — e.g. 'Crunchbase profile', 'personal website', 'LinkedIn summary'"
    }
  ]
}

Rules:
- Include any name that appears to be a prior or separate company/product, even if described minimally.
- Do not include the current company or obvious divisions of it.
- If nothing is found, return { "discoveredProducts": [] }.
- Return only the JSON object.`

  const raw = await callClaude(system, user, 800)

  try {
    const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '').trim()
    const parsed = JSON.parse(cleaned) as { discoveredProducts: DiscoveredProduct[] }
    return parsed.discoveredProducts ?? []
  } catch {
    console.error('[priorProductExtractor] Parse failed:', raw.slice(0, 200))
    return []
  }
}

/**
 * Build targeted search queries for a discovered prior product.
 * We want: what the product did, who it served, its current status.
 */
export function buildProductQueries(product: DiscoveredProduct): string[] {
  const { name, associatedPerson } = product
  return [
    `${name} app product what does it do`,
    `${name} ${associatedPerson}`,
    `${name} app store startup`,
  ]
}

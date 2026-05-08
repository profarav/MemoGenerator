import { Attendee, MeetingType } from '@/types'

interface QueryInput {
  companyName: string
  companyWebsite?: string | null
  attendees: Attendee[]
  meetingType?: MeetingType | null
}

export function generateResearchQueries(input: QueryInput): string[] {
  const { companyName, attendees } = input
  const queries: string[] = []

  // --- Per-person queries (person-first, not company-first) ---
  for (const attendee of attendees.slice(0, 3)) {
    const name = attendee.name

    // Who they are now
    queries.push(`${name} ${companyName}`)

    // Founder / previous company history — most important for Hugh
    queries.push(`${name} founder startup history previous companies`)

    // LinkedIn / personal background
    queries.push(`${name} LinkedIn`)

    // Personal site, old products, app store, product hunt
    queries.push(`${name} product app startup crunchbase`)

    // Lecturer / advisor / investor angle
    queries.push(`${name} lecturer advisor investor`)
  }

  // --- Company queries (lean, not exhaustive) ---
  queries.push(`${companyName} company what they do clients`)
  queries.push(`${companyName} recent news AI product launch`)

  // Deduplicate and cap at 12
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const q of queries) {
    const key = q.toLowerCase().trim()
    if (!seen.has(key) && deduped.length < 12) {
      seen.add(key)
      deduped.push(q)
    }
  }

  return deduped
}

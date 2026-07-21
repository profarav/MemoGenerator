import { Attendee, MeetingType, MemoDepth, ResolvedEnrichmentOutput } from '@/types'

type MemoRequestInsert = {
  meeting_title: string
  meeting_datetime: string | null
  company_name: string
  company_website: string | null
  meeting_type: MeetingType
  attendees: Attendee[]
  known_context: string | null
  internal_context: string | null
  memo_depth: MemoDepth
  status: 'draft'
}

export function mapResolvedInputToMemoRequest(
  resolved: ResolvedEnrichmentOutput,
  overrides?: {
    meetingTitle?: string
    meetingType?: MeetingType
    meetingDatetime?: string
    memoDepth?: MemoDepth
    knownContext?: string
    internalContext?: string
  }
): MemoRequestInsert {
  const { resolvedPeople, primaryOrganization } = resolved

  const firstPerson = resolvedPeople[0]

  // Company name: prefer Apollo org name, fall back to person's company, then domain
  const companyName =
    primaryOrganization?.name ??
    firstPerson?.companyName ??
    primaryOrganization?.domain ??
    'Unknown Company'

  // Company website: prefer explicit URL, fall back to https://domain
  const companyWebsite =
    primaryOrganization?.websiteUrl ??
    (primaryOrganization?.domain ? `https://${primaryOrganization.domain}` : null)

  // Meeting title: override, or auto-generate from company
  const meetingTitle =
    overrides?.meetingTitle?.trim() ||
    `Meeting with ${companyName}`

  // Map resolved people to Attendee[]
  const attendees: Attendee[] = resolvedPeople.map((p) => {
    const name = p.fullName ?? p.firstName ?? p.inputEmail ?? 'Unknown'
    const title = p.title
    const email = p.inputEmail
    const linkedinUrl = p.linkedinUrl

    // Build the "raw" string in the format the existing parser already expects:
    // "Name — Title — email"  (matching parseAttendees in app/new/page.tsx)
    const rawParts = [name]
    if (title) rawParts.push(title)
    if (email) rawParts.push(email)
    if (linkedinUrl) rawParts.push(linkedinUrl)

    return {
      name,
      title,
      email,
      linkedinUrl,
      raw: rawParts.join(' — '),
    }
  })

  return {
    meeting_title: meetingTitle,
    meeting_datetime: overrides?.meetingDatetime ?? null,
    company_name: companyName,
    company_website: companyWebsite,
    meeting_type: overrides?.meetingType ?? 'prospect_intro',
    attendees,
    known_context: overrides?.knownContext ?? null,
    internal_context: overrides?.internalContext ?? null,
    memo_depth: overrides?.memoDepth ?? 'standard',
    status: 'draft',
  }
}

import { parseQuickMemoInput, domainFromEmail } from '@/lib/input/parseQuickMemoInput'
import {
  enrichPersonByEmail,
  enrichPeopleBulkByEmails,
  enrichPersonByNameAndDomain,
  enrichPersonByLinkedIn,
  enrichOrganizationByDomain,
} from '@/lib/apollo/client'
import {
  ApolloPersonResult,
  ApolloOrgResult,
  ResolvedPerson,
  ResolvedOrganization,
  ResolvedEnrichmentOutput,
} from '@/types'

function normalizePerson(apollo: ApolloPersonResult, inputEmail?: string): ResolvedPerson {
  const firstName = apollo.first_name ?? ''
  const lastName = apollo.last_name ?? ''
  const computedName = [firstName, lastName].filter(Boolean).join(' ')
  const fullName = (apollo.name ?? computedName) || undefined

  return {
    inputEmail: inputEmail ?? apollo.email,
    fullName,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    title: apollo.title ?? undefined,
    companyName: apollo.organization?.name ?? undefined,
    companyDomain: apollo.organization?.primary_domain ?? (inputEmail ? domainFromEmail(inputEmail) : undefined),
    linkedinUrl: apollo.linkedin_url ?? undefined,
    city: apollo.city ?? undefined,
    state: apollo.state ?? undefined,
    country: apollo.country ?? undefined,
    rawApollo: apollo,
  }
}

function normalizeOrg(apollo: ApolloOrgResult, domain: string): ResolvedOrganization {
  return {
    domain,
    name: apollo.name ?? undefined,
    websiteUrl: apollo.website_url ?? undefined,
    industry: apollo.industry ?? undefined,
    employeeCount: apollo.estimated_num_employees ?? undefined,
    estimatedRevenue: apollo.annual_revenue ?? undefined,
    city: apollo.city ?? undefined,
    state: apollo.state ?? undefined,
    country: apollo.country ?? undefined,
    rawApollo: apollo,
  }
}

/** Derive a person stub from an email address when Apollo returns no match */
function stubPersonFromEmail(email: string): ResolvedPerson {
  const localPart = email.split('@')[0]
  const nameParts = localPart.replace(/[._\-+]/g, ' ').trim()
  return {
    inputEmail: email,
    fullName: undefined,
    companyDomain: domainFromEmail(email),
    rawApollo: null,
    firstName: nameParts.split(' ')[0] ?? undefined,
    lastName: nameParts.split(' ').slice(1).join(' ') || undefined,
  }
}

/** Derive a person stub from a LinkedIn URL slug when Apollo returns no match */
function stubPersonFromLinkedIn(linkedinUrl: string): ResolvedPerson {
  // Extract slug: https://linkedin.com/in/chris-marcus-abc123 → "chris-marcus-abc123"
  const slug = linkedinUrl.split('/in/')[1]?.replace(/\/$/, '') ?? ''
  // Strip trailing random alphanumeric ID (e.g. "-b4a3c2" at end)
  const cleanSlug = slug.replace(/-[a-z0-9]{4,}$/i, '').replace(/-/g, ' ').trim()
  const parts = cleanSlug.split(' ')
  return {
    fullName: cleanSlug || undefined,
    firstName: parts[0] ?? undefined,
    lastName: parts.slice(1).join(' ') || undefined,
    linkedinUrl,
    rawApollo: null,
  }
}

function pickPrimaryOrganization(
  orgs: ResolvedOrganization[],
  people: ResolvedPerson[]
): ResolvedOrganization | undefined {
  if (orgs.length === 0) return undefined
  if (orgs.length === 1) return orgs[0]

  // Count domain occurrences across people
  const domainCount: Record<string, number> = {}
  for (const p of people) {
    if (p.companyDomain) {
      domainCount[p.companyDomain] = (domainCount[p.companyDomain] ?? 0) + 1
    }
  }

  // Sort orgs by people count desc, fall back to first
  const sorted = [...orgs].sort(
    (a, b) => (domainCount[b.domain] ?? 0) - (domainCount[a.domain] ?? 0)
  )
  return sorted[0]
}

export async function resolveQuickMemoInput(params: {
  rawInput: string
  fallbackFirstName?: string
  fallbackLastName?: string
  fallbackCompanyDomain?: string
}): Promise<ResolvedEnrichmentOutput> {
  const parsed = parseQuickMemoInput(params)
  const unresolvedInputs: string[] = []

  if (parsed.inputType === 'unknown') {
    throw new Error(
      'Could not find any email addresses or name/domain in your input. ' +
      'Please paste at least one work email, or provide a first name, last name, and company domain.'
    )
  }

  // ── Step 1: Enrich people ────────────────────────────────────────────────

  let apolloPeople: Array<{ result: ApolloPersonResult | null; inputEmail?: string }> = []

  if (parsed.inputType === 'name_domain_fallback') {
    const { firstName, lastName, companyDomain } = parsed.fallbackPerson!
    const result = await enrichPersonByNameAndDomain(firstName!, lastName!, companyDomain!)
    apolloPeople = [{ result }]
    if (!result) {
      unresolvedInputs.push(`${firstName} ${lastName} @ ${companyDomain} (no Apollo match)`)
    }
  } else if (parsed.inputType === 'linkedin_urls') {
    for (const url of parsed.extractedLinkedInUrls) {
      const result = await enrichPersonByLinkedIn(url)
      apolloPeople.push({ result, inputEmail: result?.email ?? undefined })
      if (!result) unresolvedInputs.push(`${url} (no Apollo match — proceeding with limited data)`)
    }
  } else {
    // emails or meeting_invite_text — also enrich any LinkedIn URLs found alongside emails
    const emails = parsed.extractedEmails
    if (emails.length === 1) {
      const result = await enrichPersonByEmail(emails[0])
      apolloPeople = [{ result, inputEmail: emails[0] }]
      if (!result) unresolvedInputs.push(emails[0])
    } else {
      const results = await enrichPeopleBulkByEmails(emails)
      // Map results back to input emails
      const resultsByEmail: Record<string, ApolloPersonResult> = {}
      for (const r of results) {
        if (r.email) resultsByEmail[r.email.toLowerCase()] = r
      }
      for (const email of emails) {
        const match = resultsByEmail[email.toLowerCase()] ?? null
        apolloPeople.push({ result: match, inputEmail: email })
        if (!match) unresolvedInputs.push(email)
      }
    }

    // Also enrich any LinkedIn URLs found in the same input (dedup by email)
    for (const url of parsed.extractedLinkedInUrls) {
      const result = await enrichPersonByLinkedIn(url)
      if (result) {
        const email = result.email?.toLowerCase()
        const alreadyResolved = apolloPeople.some(
          (p) => p.inputEmail && email && p.inputEmail.toLowerCase() === email
        )
        if (!alreadyResolved) {
          apolloPeople.push({ result, inputEmail: result.email ?? undefined })
        }
      }
    }
  }

  // ── Step 2: Build normalized people (including stubs for no-match emails) ─

  const resolvedPeople: ResolvedPerson[] = []

  for (const { result, inputEmail } of apolloPeople) {
    if (result) {
      resolvedPeople.push(normalizePerson(result, inputEmail))
    } else if (inputEmail) {
      resolvedPeople.push(stubPersonFromEmail(inputEmail))
    }
  }

  // For LinkedIn-only inputs where Apollo returned no match, create stubs from slugs
  if (parsed.inputType === 'linkedin_urls') {
    for (const url of parsed.extractedLinkedInUrls) {
      const alreadyResolved = resolvedPeople.some((p) => p.linkedinUrl === url)
      if (!alreadyResolved) resolvedPeople.push(stubPersonFromLinkedIn(url))
    }
  }

  // ── Step 3: Collect domains for org enrichment ───────────────────────────

  const domainSet = new Set<string>()

  for (const person of resolvedPeople) {
    if (person.companyDomain) domainSet.add(person.companyDomain)
  }

  // Also derive domains from input emails directly (handles no-match case)
  for (const email of parsed.extractedEmails) {
    const d = domainFromEmail(email)
    if (d) domainSet.add(d)
  }

  if (parsed.fallbackPerson?.companyDomain) {
    domainSet.add(parsed.fallbackPerson.companyDomain)
  }

  // For LinkedIn inputs, also try the fallback domain if provided
  // (user can paste a LinkedIn URL + fill in company domain in the fallback field)
  if (parsed.inputType === 'linkedin_urls' && params.fallbackCompanyDomain) {
    const cleaned = params.fallbackCompanyDomain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase()
      .trim()
    if (cleaned) domainSet.add(cleaned)
  }

  // ── Step 4: Enrich organizations ────────────────────────────────────────

  const resolvedOrganizations: ResolvedOrganization[] = []

  const orgResults = await Promise.allSettled(
    [...domainSet].map((d) => enrichOrganizationByDomain(d).then((r) => ({ domain: d, result: r })))
  )

  for (const r of orgResults) {
    if (r.status === 'fulfilled') {
      const { domain, result } = r.value
      if (result) {
        resolvedOrganizations.push(normalizeOrg(result, domain))
      } else {
        // No Apollo org match — still include a minimal org so generation proceeds
        resolvedOrganizations.push({ domain, name: undefined, websiteUrl: `https://${domain}` })
        unresolvedInputs.push(`org:${domain} (no Apollo match)`)
      }
    }
  }

  // ── Step 5: Pick primary org ─────────────────────────────────────────────

  const primaryOrganization = pickPrimaryOrganization(resolvedOrganizations, resolvedPeople)

  return {
    resolvedPeople,
    resolvedOrganizations,
    primaryOrganization,
    unresolvedInputs,
    originalRawInput: params.rawInput,
  }
}

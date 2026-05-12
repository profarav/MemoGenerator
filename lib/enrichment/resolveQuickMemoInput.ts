import { parseQuickMemoInput, domainFromEmail } from '@/lib/input/parseQuickMemoInput'
import {
  enrichPersonByEmail,
  enrichPeopleBulkByEmails,
  enrichPersonByNameAndDomain,
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
  // Try to guess first/last from common patterns: "chris.marcus" or "chrismarcus"
  const nameParts = localPart.replace(/[._\-+]/g, ' ').trim()
  return {
    inputEmail: email,
    fullName: undefined, // unknown without Apollo
    companyDomain: domainFromEmail(email),
    rawApollo: null,
    // surface the email local part as a hint
    firstName: nameParts.split(' ')[0] ?? undefined,
    lastName: nameParts.split(' ').slice(1).join(' ') || undefined,
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
  } else {
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
  }

  // ── Step 2: Build normalized people (including stubs for no-match emails) ─

  const resolvedPeople: ResolvedPerson[] = []

  for (const { result, inputEmail } of apolloPeople) {
    if (result) {
      resolvedPeople.push(normalizePerson(result, inputEmail))
    } else if (inputEmail) {
      // Apollo no-match: still create a stub from the email so generation can proceed
      resolvedPeople.push(stubPersonFromEmail(inputEmail))
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

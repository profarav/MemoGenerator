/**
 * Apollo.io API client — server-side only.
 * APOLLO_API_KEY is never exposed to the browser.
 *
 * Docs:
 *   People match:   POST https://api.apollo.io/api/v1/people/match
 *   Bulk match:     POST https://api.apollo.io/api/v1/people/bulk_match
 *   Org enrich:     GET  https://api.apollo.io/api/v1/organizations/enrich?domain=...
 */
import { supabaseAdmin } from '@/lib/supabase'
import { ApolloPersonResult, ApolloOrgResult } from '@/types'

const APOLLO_BASE = 'https://api.apollo.io/api/v1'
const CACHE_TTL_DAYS = 30

function getApiKey(): string {
  const key = process.env.APOLLO_API_KEY
  if (!key) throw new Error('APOLLO_API_KEY is not set. Add it to your .env.local file.')
  return key
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getApiKey()}`,
  }
}

/** Strip protocol, www, and path — return bare domain. e.g. "https://www.acme.com/about" → "acme.com" */
function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase()
    .trim()
}

function handleApolloError(status: number, body: string, context: string): null {
  if (status === 401) {
    throw new Error(`Apollo API authentication failed (${context}). Check your APOLLO_API_KEY.`)
  }
  if (status === 429) {
    throw new Error(`Apollo API rate limit reached (${context}). Please wait and retry.`)
  }
  if (status === 422 || status === 404) {
    console.log(`[apollo] No match found for ${context} (${status})`)
    return null
  }
  console.error(`[apollo] Unexpected status ${status} for ${context}:`, body.slice(0, 200))
  return null
}

// ─── Cache helpers ──────────────────────────────────────────────────────────

async function getCachedPerson(lookupKey: string): Promise<ApolloPersonResult | null> {
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86400 * 1000).toISOString()
    const { data } = await supabaseAdmin
      .from('apollo_people_cache')
      .select('response_json, updated_at')
      .eq('lookup_key', lookupKey)
      .gt('updated_at', cutoff)
      .single()
    return data?.response_json ?? null
  } catch {
    return null
  }
}

async function setCachedPerson(
  lookupKey: string,
  inputEmail: string | null,
  person: ApolloPersonResult
): Promise<void> {
  try {
    await supabaseAdmin.from('apollo_people_cache').upsert({
      lookup_key: lookupKey,
      input_email: inputEmail,
      full_name: person.name ?? null,
      company_domain: person.organization?.primary_domain ?? null,
      response_json: person,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lookup_key' })
  } catch (e) {
    console.error('[apollo] Cache write failed:', e)
  }
}

async function getCachedOrg(domain: string): Promise<ApolloOrgResult | null> {
  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_DAYS * 86400 * 1000).toISOString()
    const { data } = await supabaseAdmin
      .from('apollo_organization_cache')
      .select('response_json, updated_at')
      .eq('domain', domain)
      .gt('updated_at', cutoff)
      .single()
    return data?.response_json ?? null
  } catch {
    return null
  }
}

async function setCachedOrg(domain: string, org: ApolloOrgResult): Promise<void> {
  try {
    await supabaseAdmin.from('apollo_organization_cache').upsert({
      domain,
      response_json: org,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'domain' })
  } catch (e) {
    console.error('[apollo] Org cache write failed:', e)
  }
}

// ─── Public API functions ────────────────────────────────────────────────────

export async function enrichPersonByEmail(email: string): Promise<ApolloPersonResult | null> {
  const lookupKey = `email:${email.toLowerCase()}`

  const cached = await getCachedPerson(lookupKey)
  if (cached) {
    console.log(`[apollo] Cache hit for ${lookupKey}`)
    return cached
  }

  console.log(`[apollo] enrichPersonByEmail: ${email}`)
  try {
    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email }),
    })
    const body = await res.text()
    if (!res.ok) return handleApolloError(res.status, body, `email:${email}`)

    const data = JSON.parse(body)
    const person: ApolloPersonResult | null = data?.person ?? null
    if (person) await setCachedPerson(lookupKey, email, person)
    return person
  } catch (err: unknown) {
    const e = err as { message?: string }
    if (e?.message?.includes('APOLLO_API_KEY') || e?.message?.includes('rate limit')) throw err
    console.error(`[apollo] enrichPersonByEmail failed for ${email}:`, e?.message)
    return null
  }
}

export async function enrichPersonByNameAndDomain(
  firstName: string,
  lastName: string,
  companyDomain: string
): Promise<ApolloPersonResult | null> {
  const domain = normalizeDomain(companyDomain)
  const lookupKey = `namedomain:${firstName.toLowerCase()}|${lastName.toLowerCase()}|${domain}`

  const cached = await getCachedPerson(lookupKey)
  if (cached) {
    console.log(`[apollo] Cache hit for ${lookupKey}`)
    return cached
  }

  console.log(`[apollo] enrichPersonByNameAndDomain: ${firstName} ${lastName} @ ${domain}`)
  try {
    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ first_name: firstName, last_name: lastName, domain }),
    })
    const body = await res.text()
    if (!res.ok) return handleApolloError(res.status, body, `${firstName} ${lastName}@${domain}`)

    const data = JSON.parse(body)
    const person: ApolloPersonResult | null = data?.person ?? null
    if (person) await setCachedPerson(lookupKey, null, person)
    return person
  } catch (err: unknown) {
    const e = err as { message?: string }
    if (e?.message?.includes('APOLLO_API_KEY') || e?.message?.includes('rate limit')) throw err
    console.error(`[apollo] enrichPersonByNameAndDomain failed:`, e?.message)
    return null
  }
}

export async function enrichPeopleBulkByEmails(emails: string[]): Promise<ApolloPersonResult[]> {
  if (emails.length === 0) return []

  // Check cache for all emails first
  const results: ApolloPersonResult[] = []
  const uncachedEmails: string[] = []

  for (const email of emails) {
    const cached = await getCachedPerson(`email:${email.toLowerCase()}`)
    if (cached) {
      console.log(`[apollo] Cache hit for email:${email}`)
      results.push(cached)
    } else {
      uncachedEmails.push(email)
    }
  }

  if (uncachedEmails.length === 0) return results

  // Chunk uncached emails into groups of 10
  const CHUNK_SIZE = 10
  const chunks: string[][] = []
  for (let i = 0; i < uncachedEmails.length; i += CHUNK_SIZE) {
    chunks.push(uncachedEmails.slice(i, i + CHUNK_SIZE))
  }

  console.log(`[apollo] enrichPeopleBulkByEmails: ${uncachedEmails.length} emails in ${chunks.length} chunk(s)`)

  for (const chunk of chunks) {
    try {
      const res = await fetch(`${APOLLO_BASE}/people/bulk_match`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ details: chunk.map((email) => ({ email })) }),
      })
      const body = await res.text()
      if (!res.ok) {
        handleApolloError(res.status, body, `bulk_match chunk`)
        continue
      }

      const data = JSON.parse(body)
      const matches: ApolloPersonResult[] = data?.matches ?? []

      for (const person of matches) {
        if (person && person.email) {
          await setCachedPerson(`email:${person.email.toLowerCase()}`, person.email, person)
          results.push(person)
        }
      }
    } catch (err: unknown) {
      const e = err as { message?: string }
      if (e?.message?.includes('APOLLO_API_KEY') || e?.message?.includes('rate limit')) throw err
      console.error(`[apollo] bulk_match chunk failed:`, e?.message)
    }
  }

  return results
}

export async function enrichOrganizationByDomain(rawDomain: string): Promise<ApolloOrgResult | null> {
  const domain = normalizeDomain(rawDomain)
  if (!domain) return null

  const cached = await getCachedOrg(domain)
  if (cached) {
    console.log(`[apollo] Org cache hit for ${domain}`)
    return cached
  }

  console.log(`[apollo] enrichOrganizationByDomain: ${domain}`)
  try {
    const url = `${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(),
    })
    const body = await res.text()
    if (!res.ok) return handleApolloError(res.status, body, `org:${domain}`)

    const data = JSON.parse(body)
    const org: ApolloOrgResult | null = data?.organization ?? null
    if (org) await setCachedOrg(domain, org)
    return org
  } catch (err: unknown) {
    const e = err as { message?: string }
    if (e?.message?.includes('APOLLO_API_KEY') || e?.message?.includes('rate limit')) throw err
    console.error(`[apollo] enrichOrganizationByDomain failed for ${domain}:`, e?.message)
    return null
  }
}

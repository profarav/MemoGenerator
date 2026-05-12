import { ParsedQuickInput } from '@/types'

const EMAIL_REGEX = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi

// Matches linkedin.com/in/<slug> with optional trailing path segments or query strings
const LINKEDIN_REGEX = /https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_%-]+)\/?(?:[?#][^\s]*)*/gi

const MEETING_KEYWORDS = /\b(guests?|meeting|intro|call|attendees?|participants?|invitees?|join|invite)\b/i

/** Normalize a LinkedIn profile URL to a canonical form (strip trailing slashes and query params) */
function normalizeLinkedInUrl(raw: string): string {
  try {
    const u = new URL(raw)
    // keep only origin + pathname, strip query/hash, remove trailing slash
    return (u.origin + u.pathname).replace(/\/+$/, '')
  } catch {
    return raw.trim()
  }
}

export function parseQuickMemoInput(params: {
  rawInput: string
  fallbackFirstName?: string
  fallbackLastName?: string
  fallbackCompanyDomain?: string
}): ParsedQuickInput {
  const { rawInput, fallbackFirstName, fallbackLastName, fallbackCompanyDomain } = params

  // Extract all emails
  const emailMatches = rawInput.match(EMAIL_REGEX) ?? []
  const extractedEmails = [...new Set(emailMatches.map((e) => e.toLowerCase()))]

  // Extract all LinkedIn profile URLs
  const linkedInMatches = [...rawInput.matchAll(LINKEDIN_REGEX)].map((m) => m[0])
  const extractedLinkedInUrls = [...new Set(linkedInMatches.map(normalizeLinkedInUrl))]

  if (extractedEmails.length > 0) {
    const isMeetingInvite = MEETING_KEYWORDS.test(rawInput)
    return {
      inputType: isMeetingInvite ? 'meeting_invite_text' : 'emails',
      extractedEmails,
      extractedLinkedInUrls,
      rawInput,
    }
  }

  // Only LinkedIn URLs — no emails
  if (extractedLinkedInUrls.length > 0) {
    return {
      inputType: 'linkedin_urls',
      extractedEmails: [],
      extractedLinkedInUrls,
      rawInput,
    }
  }

  // No emails or LinkedIn — check for name/domain fallback
  const hasName = !!(fallbackFirstName?.trim() && fallbackLastName?.trim())
  const hasDomain = !!fallbackCompanyDomain?.trim()

  if (hasName && hasDomain) {
    return {
      inputType: 'name_domain_fallback',
      extractedEmails: [],
      extractedLinkedInUrls: [],
      fallbackPerson: {
        firstName: fallbackFirstName!.trim(),
        lastName: fallbackLastName!.trim(),
        companyDomain: fallbackCompanyDomain!.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
      },
      rawInput,
    }
  }

  return { inputType: 'unknown', extractedEmails: [], extractedLinkedInUrls: [], rawInput }
}

/** Extract bare domain from an email address. e.g. chris@colormatics.com → colormatics.com */
export function domainFromEmail(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? ''
}

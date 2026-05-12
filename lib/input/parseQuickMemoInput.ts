import { ParsedQuickInput } from '@/types'

const EMAIL_REGEX = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi

const MEETING_KEYWORDS = /\b(guests?|meeting|intro|call|attendees?|participants?|invitees?|join|invite)\b/i

export function parseQuickMemoInput(params: {
  rawInput: string
  fallbackFirstName?: string
  fallbackLastName?: string
  fallbackCompanyDomain?: string
}): ParsedQuickInput {
  const { rawInput, fallbackFirstName, fallbackLastName, fallbackCompanyDomain } = params

  // Extract all emails
  const matches = rawInput.match(EMAIL_REGEX) ?? []
  const extractedEmails = [...new Set(matches.map((e) => e.toLowerCase()))]

  if (extractedEmails.length > 0) {
    const isMeetingInvite = MEETING_KEYWORDS.test(rawInput)
    return {
      inputType: isMeetingInvite ? 'meeting_invite_text' : 'emails',
      extractedEmails,
      rawInput,
    }
  }

  // No emails — check for name/domain fallback
  const hasName = !!(fallbackFirstName?.trim() && fallbackLastName?.trim())
  const hasDomain = !!fallbackCompanyDomain?.trim()

  if (hasName && hasDomain) {
    return {
      inputType: 'name_domain_fallback',
      extractedEmails: [],
      fallbackPerson: {
        firstName: fallbackFirstName!.trim(),
        lastName: fallbackLastName!.trim(),
        companyDomain: fallbackCompanyDomain!.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
      },
      rawInput,
    }
  }

  return { inputType: 'unknown', extractedEmails: [], rawInput }
}

/** Extract bare domain from an email address. e.g. chris@colormatics.com → colormatics.com */
export function domainFromEmail(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? ''
}

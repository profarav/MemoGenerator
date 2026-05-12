import { NextResponse } from 'next/server'
import { resolveQuickMemoInput } from '@/lib/enrichment/resolveQuickMemoInput'

/**
 * POST /api/enrich-preview
 *
 * Runs Apollo enrichment only — no memo generation.
 * Used by the Quick Input tab to show a preview of resolved people/org
 * before the user commits to the full (expensive) generation pipeline.
 *
 * Body: { rawInput, fallbackFirstName?, fallbackLastName?, fallbackCompanyDomain? }
 * Returns: { resolvedPeople, resolvedOrganizations, primaryOrganization, unresolvedInputs }
 */
export async function POST(req: Request) {
  let body: Record<string, string>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { rawInput, fallbackFirstName, fallbackLastName, fallbackCompanyDomain } = body

  if (!rawInput && !(fallbackFirstName && fallbackLastName && fallbackCompanyDomain)) {
    return NextResponse.json(
      { error: 'Provide at least one email, LinkedIn URL, or first name + last name + domain.' },
      { status: 422 }
    )
  }

  try {
    const enrichment = await resolveQuickMemoInput({
      rawInput: rawInput ?? '',
      fallbackFirstName,
      fallbackLastName,
      fallbackCompanyDomain,
    })

    return NextResponse.json({
      resolvedPeople: enrichment.resolvedPeople,
      resolvedOrganizations: enrichment.resolvedOrganizations,
      primaryOrganization: enrichment.primaryOrganization,
      unresolvedInputs: enrichment.unresolvedInputs,
    })
  } catch (err: unknown) {
    const e = err as { message?: string }
    const msg = e?.message ?? 'Enrichment failed'

    if (msg.includes('APOLLO_API_KEY')) {
      return NextResponse.json({ error: 'Apollo API key not configured.' }, { status: 500 })
    }
    if (msg.includes('rate limit')) {
      return NextResponse.json({ error: 'Apollo rate limit reached. Try again in a moment.' }, { status: 429 })
    }
    if (msg.includes('No emails found') || msg.includes('Could not find')) {
      return NextResponse.json({ error: msg }, { status: 422 })
    }

    console.error('[enrich-preview] Unexpected error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

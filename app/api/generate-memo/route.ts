import { NextRequest, NextResponse } from 'next/server'
import { runMemoGeneration } from '@/lib/pipeline/runMemoGeneration'

export async function POST(req: NextRequest) {
  try {
    const { memoRequestId } = await req.json()
    if (!memoRequestId) {
      return NextResponse.json({ error: 'memoRequestId is required' }, { status: 400 })
    }

    const { memo, sources } = await runMemoGeneration(memoRequestId)
    return NextResponse.json({ memo, sources })
  } catch (err: unknown) {
    const error = err as { message?: string }
    console.error('[generate-memo] Error:', error?.message)
    return NextResponse.json(
      { error: error?.message ?? 'Internal server error' },
      { status: 500 }
    )
  }
}

import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase'
import MemoDetailClient from './MemoDetailClient'
import { MemoRequest, GeneratedMemo, ResearchSource } from '@/types'

export const dynamic = 'force-dynamic'
// Supabase reads go through fetch, which Next would otherwise cache — that can
// serve a stale memo right after a regeneration. Never cache them here.
export const fetchCache = 'force-no-store'

interface Props {
  params: { id: string }
}

export default async function MemoDetailPage({ params }: Props) {
  const { id } = params

  const [memoRequestRes, memoRes, sourcesRes] = await Promise.all([
    supabaseAdmin.from('memo_requests').select('*').eq('id', id).single(),
    supabaseAdmin
      .from('generated_memos')
      .select('*')
      .eq('memo_request_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabaseAdmin
      .from('research_sources')
      .select('*')
      .eq('memo_request_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (memoRequestRes.error || !memoRequestRes.data) {
    notFound()
  }

  const memoRequest = memoRequestRes.data as MemoRequest
  const latestMemo = memoRes.error ? null : (memoRes.data as GeneratedMemo)
  const sources: ResearchSource[] = sourcesRes.error ? [] : (sourcesRes.data as ResearchSource[])

  return (
    <MemoDetailClient
      memoRequest={memoRequest}
      latestMemo={latestMemo}
      sources={sources}
    />
  )
}

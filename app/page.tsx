import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase'
import MemoCard from '@/components/MemoCard'
import { MemoRequest } from '@/types'

async function getMemoRequests(): Promise<MemoRequest[]> {
  const { data, error } = await supabaseAdmin
    .from('memo_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[dashboard] Failed to fetch memos:', error)
    return []
  }
  return data as MemoRequest[]
}

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const memos = await getMemoRequests()

  const pending = memos.filter((m) => m.status !== 'approved')
  const approved = memos.filter((m) => m.status === 'approved')

  return (
    <div>
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Weekly Meeting Prep Agent</h1>
        <p className="mt-2 text-sm text-gray-500 max-w-xl">
          Generate research-backed meeting prep memos for Hugh. Enter meeting details,
          let the agent pull public background, and produce a ready-to-use brief.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Link href="/new" className="btn-primary">
            + Create Meeting Memo
          </Link>
        </div>
      </div>

      {/* Stats strip */}
      {memos.length > 0 && (
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="card p-4">
            <p className="text-2xl font-bold text-gray-900">{memos.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Total memos</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-yellow-700">{pending.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Pending review</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold text-green-700">{approved.length}</p>
            <p className="text-xs text-gray-500 mt-0.5">Approved</p>
          </div>
        </div>
      )}

      {/* Pending */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
          Pending Memos
        </h2>
        {pending.length === 0 ? (
          <div className="card p-10 text-center">
            <p className="text-gray-400 text-sm">No pending memos.</p>
            <Link href="/new" className="mt-3 inline-block btn-primary text-xs">
              Create your first memo →
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {pending.map((m) => (
              <MemoCard key={m.id} memo={m} />
            ))}
          </div>
        )}
      </section>

      {/* Approved */}
      {approved.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider mb-3">
            Approved Memos
          </h2>
          <div className="space-y-3">
            {approved.map((m) => (
              <MemoCard key={m.id} memo={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

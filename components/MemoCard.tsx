import Link from 'next/link'
import { MemoRequest } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  approved: 'Approved',
  needs_review: 'Needs Review',
}

const MEETING_TYPE_LABELS: Record<string, string> = {
  prospect_intro: 'Prospect Intro',
  client_meeting: 'Client Meeting',
  partner_meeting: 'Partner Meeting',
  internal_strategy: 'Internal Strategy',
  other: 'Other',
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'approved'
      ? 'status-approved'
      : status === 'needs_review'
        ? 'status-needs_review'
        : 'status-draft'
  return <span className={cls}>{STATUS_LABELS[status] ?? status}</span>
}

export default function MemoCard({ memo }: { memo: MemoRequest }) {
  const date = memo.meeting_datetime
    ? new Date(memo.meeting_datetime).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Date TBD'

  return (
    <div className="card p-5 flex items-start justify-between gap-4 hover:shadow-md transition-shadow">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900 truncate">
            {memo.meeting_title}
          </h3>
          <StatusBadge status={memo.status} />
        </div>
        <p className="mt-1 text-sm text-gray-600">{memo.company_name}</p>
        <div className="mt-2 flex items-center gap-4 text-xs text-gray-400">
          <span>{date}</span>
          {memo.meeting_type && (
            <span>{MEETING_TYPE_LABELS[memo.meeting_type] ?? memo.meeting_type}</span>
          )}
          <span>Created {new Date(memo.created_at).toLocaleDateString()}</span>
        </div>
      </div>
      <Link href={`/memo/${memo.id}`} className="btn-secondary shrink-0 text-xs">
        Open →
      </Link>
    </div>
  )
}

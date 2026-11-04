import type { MyStatus } from '@/types'

const statusConfig: Record<MyStatus, { label: string; color: string }> = {
  watching: { label: 'Watching', color: 'text-status-watching' },
  completed: { label: 'Completed', color: 'text-status-completed' },
  plan_to_watch: { label: 'Plan to watch', color: 'text-status-planned' },
  on_hold: { label: 'On hold', color: 'text-status-onhold' },
  dropped: { label: 'Dropped', color: 'text-status-dropped' },
}

export default function StatusBadge({ status }: { status: MyStatus }) {
  const { label, color } = statusConfig[status]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${color}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

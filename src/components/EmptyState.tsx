import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: { label: string; onClick: () => void }
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {icon && <div className="mb-4 text-4xl text-text-3">{icon}</div>}
      <h3 className="text-lg font-medium text-text-1">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-text-2">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 rounded-card bg-accent px-4 py-2 text-sm font-medium text-text-1 transition-colors hover:bg-accent-hover"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

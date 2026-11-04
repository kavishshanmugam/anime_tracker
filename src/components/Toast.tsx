interface ToastItemProps {
  message: string
  onUndo?: () => void
  onDismiss: () => void
  removing?: boolean
}

export default function ToastItem({ message, onUndo, onDismiss, removing }: ToastItemProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-card border border-border bg-bg-2 px-4 py-3 shadow-lg transition-all duration-300 ${
        removing ? 'translate-y-2 opacity-0' : 'translate-y-0 opacity-100'
      }`}
    >
      <span className="flex-1 text-sm text-text-1">{message}</span>
      {onUndo && (
        <button
          onClick={onUndo}
          className="shrink-0 text-sm font-medium text-accent transition-colors hover:text-accent-hover"
        >
          Undo
        </button>
      )}
      <button
        onClick={onDismiss}
        className="shrink-0 text-text-3 transition-colors hover:text-text-1"
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

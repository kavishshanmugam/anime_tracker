interface ProgressBarProps {
  current: number
  total: number | null
  accentColor?: string
  onIncrement?: () => void
}

export default function ProgressBar({ current, total, accentColor, onIncrement }: ProgressBarProps) {
  const pct = total ? Math.min((current / total) * 100, 100) : 100

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-2">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{
              width: `${pct}%`,
              ...(accentColor ? { backgroundColor: accentColor } : {}),
            }}
          />
        </div>
        <p className="mt-1 font-mono text-xs text-text-3">
          {total ? `${current} / ${total}` : current}
        </p>
      </div>
      {onIncrement && (
        <button
          onClick={onIncrement}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-bg-2 text-xs text-text-2 transition-colors hover:bg-accent hover:text-text-1"
          aria-label="Increment episode"
        >
          +1
        </button>
      )}
    </div>
  )
}

import { useState, type ReactNode } from 'react'

/** 16:9 episode thumbnail card (Continue Watching, episode lists, Up Next). */
export default function EpisodeCard({
  thumbnail, fallback, seriesTitle, episode, episodeTitle, progress, watched, current, badge, onClick, layout = 'card', width, onToggleWatched,
}: {
  thumbnail?: string | null
  fallback?: string | null
  seriesTitle?: string
  episode: number
  episodeTitle?: string | null
  progress?: number
  watched?: boolean
  current?: boolean
  badge?: ReactNode
  onClick?: () => void
  layout?: 'card' | 'row'
  width?: string
  /** Hover action to mark (or unmark) everything up to this episode. */
  onToggleWatched?: () => void
}) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)
  const useThumb = !!thumbnail && !thumbFailed
  const img = useThumb ? thumbnail : fallbackFailed ? null : fallback
  const art = (
    <div className={`relative aspect-video shrink-0 overflow-hidden rounded-[6px] bg-bg-2 ${layout === 'row' ? 'w-40' : 'w-full'}`}>
      {img ? (
        <img src={img} alt="" loading="lazy" onError={() => { if (useThumb) setThumbFailed(true); else setFallbackFailed(true) }}
          className={`h-full w-full object-cover transition-transform duration-300 group-hover/ep:scale-105 ${!useThumb ? 'opacity-60 blur-[1px]' : ''} ${watched ? 'opacity-50' : ''}`} />
      ) : <div className="h-full w-full bg-gradient-to-br from-bg-2 to-bg-1" />}
      {/* Play overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover/ep:opacity-100">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/90 text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
        </span>
      </div>
      {current && <span className="absolute left-1.5 top-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Now playing</span>}
      {!current && badge && <div className="absolute left-1.5 top-1.5">{badge}</div>}
      {watched && !current && !onToggleWatched && (
        <span className="absolute right-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-status-completed">✓ Watched</span>
      )}
      {onToggleWatched && !current && (
        <span role="button" tabIndex={0}
          onClick={e => { e.stopPropagation(); onToggleWatched() }}
          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onToggleWatched() } }}
          title={watched ? `Mark E${episode} and later as unwatched` : `Mark E1–E${episode} as watched`}
          className={`absolute right-1.5 top-1.5 z-10 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-opacity ${
            watched
              ? 'bg-black/70 text-status-completed hover:bg-status-dropped hover:text-white'
              : 'bg-black/70 text-text-1 opacity-0 hover:bg-accent group-hover/ep:opacity-100'}`}>
          {watched ? <><span className="group-hover/ep:hidden">✓ Watched</span><span className="hidden group-hover/ep:inline">✕ Unwatch</span></> : '✓ Watched up to here'}
        </span>
      )}
      {progress != null && progress > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60"><div className="h-full bg-accent" style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>
      )}
    </div>
  )

  if (layout === 'row') {
    return (
      <button onClick={onClick}
        className={`group/ep flex w-full gap-3 rounded-card p-2 text-left transition-colors hover:bg-bg-2 ${current ? 'bg-bg-2' : ''}`}>
        {art}
        <div className="min-w-0 py-0.5">
          {seriesTitle && <p className="text-[11px] uppercase tracking-wide text-text-3 truncate">{seriesTitle}</p>}
          <p className={`text-sm font-semibold leading-snug line-clamp-2 ${current ? 'text-accent' : 'text-text-1'}`}>
            E{episode}{episodeTitle ? ` - ${episodeTitle}` : ''}
          </p>
        </div>
      </button>
    )
  }

  return (
    <button onClick={onClick} className={`group/ep shrink-0 text-left ${width ?? 'w-full'}`}>
      {art}
      <div className="mt-2">
        {seriesTitle && <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3 truncate">{seriesTitle}</p>}
        <p className="text-sm font-semibold leading-snug text-text-1 line-clamp-2 group-hover/ep:text-accent">
          E{episode}{episodeTitle ? ` - ${episodeTitle}` : ''}
        </p>
      </div>
    </button>
  )
}

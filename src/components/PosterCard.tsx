import type { ReactNode } from 'react'
import type { DubStatus } from '@/lib/dubs'

export interface PosterCardProps {
  title: string
  cover: string | null
  /** Small line under the title, e.g. "Sub | Dub" or "Ep 5/12". */
  subtitle?: ReactNode
  /** Shown on hover. */
  synopsis?: string | null
  meta?: string[]
  badge?: ReactNode
  accent?: string | null
  /** 0..1 progress bar along the poster bottom. */
  progress?: number
  onClick?: () => void
  onPlay?: () => void
  onBookmark?: () => void
  bookmarked?: boolean
  width?: string
  /** English dub availability → DUB chip. */
  dub?: DubStatus
}

const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** Crunchyroll-style poster: 2:3 art, details revealed on hover. */
export default function PosterCard({
  title, cover, subtitle, synopsis, meta, badge, accent, progress, onClick, onPlay, onBookmark, bookmarked, width, dub,
}: PosterCardProps) {
  return (
    <div className={`group/card relative shrink-0 cursor-pointer ${width ?? 'w-full'}`} onClick={onClick}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-[6px] bg-bg-2">
        {cover ? (
          <img src={cover} alt={title} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover/card:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-sm text-text-3">{title}</div>
        )}
        {badge && <div className="absolute left-2 top-2">{badge}</div>}
        {(dub === 'complete' || dub === 'ongoing') && (
          <span title={dub === 'complete' ? 'English dub — complete' : 'English dub — still being released'}
            className={`absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[10px] font-black tracking-wide text-black ${dub === 'complete' ? 'bg-status-completed' : 'bg-status-onhold'}`}>
            DUB{dub === 'ongoing' ? ' …' : ''}
          </span>
        )}
        {progress != null && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, progress * 100)}%`, backgroundColor: accent ?? undefined }} />
          </div>
        )}

        {/* Hover details */}
        <div className="absolute inset-0 flex flex-col bg-bg-0/95 p-3 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100">
          <p className="font-display text-sm font-bold leading-tight text-text-1 line-clamp-3">{title}</p>
          {meta && meta.length > 0 && <p className="mt-1 text-[11px] text-text-3">{meta.filter(Boolean).join(' · ')}</p>}
          {synopsis && <p className="mt-2 flex-1 overflow-hidden text-xs leading-relaxed text-text-2 line-clamp-[8]">{strip(synopsis)}</p>}
          {!synopsis && <div className="flex-1" />}
          <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
            {onPlay && (
              <button onClick={onPlay} title="Play" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-hover">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
              </button>
            )}
            {onBookmark && (
              <button onClick={onBookmark} title={bookmarked ? 'In your watchlist' : 'Add to watchlist'}
                className={`flex h-9 w-9 items-center justify-center rounded-full border ${bookmarked ? 'border-accent text-accent' : 'border-text-3 text-text-2 hover:text-text-1'}`}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="mt-2 text-sm font-semibold leading-snug text-text-1 line-clamp-2 group-hover/card:text-accent">{title}</p>
      {subtitle && <div className="mt-0.5 text-xs text-text-3">{subtitle}</div>}
    </div>
  )
}

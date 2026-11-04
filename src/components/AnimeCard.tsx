import type { Anime, LibraryEntry } from '@/types'
import StatusBadge from './StatusBadge'

interface AnimeCardProps {
  anime: Anime
  entry?: LibraryEntry
  onClick?: () => void
  showStatus?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
} as const

export default function AnimeCard({ anime, entry, onClick, showStatus, size = 'md' }: AnimeCardProps) {
  return (
    <button
      onClick={onClick}
      className="group w-full text-left transition-transform duration-200 hover:scale-[1.03]"
    >
      <div
        className="relative aspect-[2/3] overflow-hidden rounded-card bg-bg-2"
        style={anime.cover_accent ? { borderBottom: `3px solid ${anime.cover_accent}` } : undefined}
      >
        {anime.cover_url ? (
          <img
            src={anime.cover_url}
            alt={anime.title}
            loading="lazy"
            className="h-full w-full object-cover transition-shadow duration-200 group-hover:shadow-lg"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-3">
            <span className="text-center text-sm text-text-3">{anime.title}</span>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-1">
        <p className={`line-clamp-2 font-medium text-text-1 ${sizeClasses[size]}`}>
          {anime.title}
        </p>
        {showStatus && entry && <StatusBadge status={entry.my_status} />}
        {entry && entry.progress != null && (
          <p className="font-mono text-xs text-text-3">
            Ep {entry.progress}
            {anime.episodes_total ? `/${anime.episodes_total}` : ''}
          </p>
        )}
      </div>
    </button>
  )
}

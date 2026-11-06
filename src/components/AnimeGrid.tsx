import { useNavigate } from 'react-router-dom'
import type { Anime, AnimeWithEntry } from '@/types'
import AnimeCard from './AnimeCard'
import { SkeletonGrid } from './Skeleton'
import EmptyState from './EmptyState'

interface AnimeGridProps {
  items: AnimeWithEntry[]
  onAnimeClick: (anime: Anime) => void
  loading?: boolean
  emptyMessage?: string
}

export default function AnimeGrid({ items, onAnimeClick, loading, emptyMessage }: AnimeGridProps) {
  if (loading) return <SkeletonGrid />

  if (items.length === 0) {
    return <EmptyState title={emptyMessage || 'Nothing here yet'} />
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {items.map((anime) => (
        <AnimeCard
          key={anime.id}
          anime={anime}
          entry={anime.entry}
          showStatus={!!anime.entry}
          onClick={() => onAnimeClick(anime)}
        />
      ))}
    </div>
  )
}

import type { Anime, LibraryEntry } from '@/types'
import PosterCard from './PosterCard'
import StatusBadge from './StatusBadge'
import { useDubs } from '@/hooks/useDubs'
import { displayTitle } from '@/lib/title'

interface AnimeCardProps {
  anime: Anime
  entry?: LibraryEntry
  onClick?: () => void
  showStatus?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export default function AnimeCard({ anime, entry, onClick, showStatus }: AnimeCardProps) {
  const dubOf = useDubs()
  const progress = entry && anime.episodes_total ? entry.progress / anime.episodes_total : undefined
  return (
    <PosterCard
      title={displayTitle(anime)}
      cover={anime.cover_url}
      accent={anime.cover_accent}
      synopsis={anime.synopsis}
      meta={[anime.format ?? '', anime.season_year ? String(anime.season_year) : '', anime.episodes_total ? `${anime.episodes_total} eps` : '']}
      progress={progress}
      dub={dubOf(anime.mal_id, anime.airing_status)}
      onClick={onClick}
      badge={showStatus && entry ? <StatusBadge status={entry.my_status} /> : undefined}
      subtitle={entry && entry.progress != null
        ? <span className="font-mono">Ep {entry.progress}{anime.episodes_total ? `/${anime.episodes_total}` : ''}</span>
        : anime.format ?? undefined}
    />
  )
}

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PosterCard from '@/components/PosterCard'
import { useDubs } from '@/hooks/useDubs'
import FilterSelects from '@/components/FilterSelects'
import { getSeasonAnime, mapAniListToAnime } from '@/lib/anilist'
import { useToast } from '@/hooks/useToast'
import { useLibrary } from '@/hooks/useLibrary'
import { SkeletonGrid } from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import type { AniListMedia } from '@/types'

const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const

function getCurrentSeason(): { season: string; year: number } {
  const month = new Date().getMonth()
  const season = month < 3 ? 'WINTER' : month < 6 ? 'SPRING' : month < 9 ? 'SUMMER' : 'FALL'
  return { season, year: new Date().getFullYear() }
}

export default function Seasonal() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { entries } = useLibrary()
  const current = getCurrentSeason()
  const [season, setSeason] = useState(current.season)
  const [year, setYear] = useState(current.year)
  const [anime, setAnime] = useState<AniListMedia[]>([])
  const [loading, setLoading] = useState(true)
  const [audioFilter, setAudioFilter] = useState<'' | 'dub' | 'dub_complete' | 'sub_only'>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'RELEASING' | 'FINISHED'>('')
  const dubOf = useDubs()

  const libraryAnilistIds = useMemo(() => new Set(entries.map(e => e.anilist_id).filter(Boolean)), [entries])

  useEffect(() => {
    setLoading(true)
    getSeasonAnime(season, year)
      .then(setAnime)
      .catch(() => setAnime([]))
      .finally(() => setLoading(false))
  }, [season, year])

  const handleAddToPlan = async (media: AniListMedia) => {
    if (!window.api) return
    try {
      const mapped = mapAniListToAnime(media)
      const animeId = await window.api.db.upsertAnime(mapped)
      await window.api.db.upsertLibraryEntry({
        anime_id: animeId,
        my_status: 'plan_to_watch',
        progress: 0,
        source: 'seasonal',
      })
      toast(`Added "${media.title.romaji}" to plan`)
    } catch { toast('Failed to add') }
  }

  const years = Array.from({ length: 10 }, (_, i) => current.year - i)
  const shown = anime.filter(m => {
    const d = dubOf(m.idMal, m.status)
    if (audioFilter === 'dub' && d !== 'complete' && d !== 'ongoing') return false
    if (audioFilter === 'dub_complete' && d !== 'complete') return false
    if (audioFilter === 'sub_only' && (d === 'complete' || d === 'ongoing')) return false
    if (statusFilter && m.status !== statusFilter) return false
    return true
  })

  return (
    <div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="font-display text-3xl font-black text-text-1">Seasonal</h1>
        <div className="flex gap-1">
          {SEASONS.map(s => (
            <button
              key={s}
              onClick={() => setSeason(s)}
              className={`rounded-full px-3 py-1 text-sm transition-colors ${
                season === s ? 'bg-accent text-text-1' : 'text-text-2 hover:bg-bg-1'
              }`}
            >{s[0] + s.slice(1).toLowerCase()}</button>
          ))}
        </div>
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <FilterSelects audio={audioFilter} setAudio={setAudioFilter} status={statusFilter} setStatus={setStatusFilter} />
        <span className="text-xs text-text-3 ml-auto">{shown.length} shows</span>
      </div>

      {loading ? <SkeletonGrid count={12} /> : shown.length === 0 ? (
        <EmptyState title="No anime found" description="Try a different season." />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {shown.map(media => {
            const inLibrary = libraryAnilistIds.has(media.id)
            return (
              <PosterCard key={media.id}
                title={media.title.english ?? media.title.romaji}
                cover={media.coverImage.extraLarge || media.coverImage.large}
                synopsis={media.description}
                meta={[media.format ?? '', media.episodes ? `${media.episodes} eps` : '', media.meanScore ? `★ ${media.meanScore}%` : '']}
                subtitle={inLibrary ? <span className="text-accent">In your lists</span> : media.genres.slice(0, 2).join(' · ')}
                dub={dubOf(media.idMal, media.status)}
                onClick={() => navigate(`/anime/${media.id}`)}
                onBookmark={inLibrary ? undefined : () => handleAddToPlan(media)}
                bookmarked={inLibrary}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}


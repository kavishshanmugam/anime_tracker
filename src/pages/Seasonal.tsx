import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
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

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="font-display text-xl font-bold text-text-1">Seasonal</h1>
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
        <span className="text-xs text-text-3 ml-auto">{anime.length} shows</span>
      </div>

      {loading ? <SkeletonGrid count={12} /> : anime.length === 0 ? (
        <EmptyState title="No anime found" description="Try a different season." />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {anime.map(media => {
            const inLibrary = libraryAnilistIds.has(media.id)
            return (
              <div key={media.id} className="group">
                <button
                  onClick={() => navigate(`/anime/${media.id}`)}
                  className="w-full text-left"
                >
                  <div className="aspect-[2/3] overflow-hidden rounded-card bg-bg-2 relative">
                    <img
                      src={media.coverImage.extraLarge || media.coverImage.large}
                      alt={media.title.romaji}
                      loading="lazy"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                    />
                    {inLibrary && (
                      <span className="absolute top-1.5 right-1.5 rounded bg-accent/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        In library
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium text-text-1 line-clamp-2">{media.title.romaji}</p>
                </button>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-text-3">{media.format ?? ''} {media.episodes ? `· ${media.episodes} eps` : ''}</span>
                  {media.meanScore && <span className="text-[11px] text-text-3">· {media.meanScore}%</span>}
                </div>
                {!inLibrary && (
                  <button
                    onClick={() => handleAddToPlan(media)}
                    className="mt-1 rounded bg-accent/20 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/30"
                  >Add to plan</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

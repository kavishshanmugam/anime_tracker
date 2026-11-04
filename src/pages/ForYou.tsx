import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import { getRecommendations } from '@/lib/anilist'
import EmptyState from '@/components/EmptyState'
import { SkeletonGrid } from '@/components/Skeleton'

interface RecCard {
  anilistId: number
  title: string
  cover: string
  score: number
  reason: string
  genres: string[]
  format: string | null
}

export default function ForYou() {
  const navigate = useNavigate()
  const { entries, loading: libLoading } = useLibrary()
  const { toast } = useToast()
  const [recs, setRecs] = useState<RecCard[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [genreFilter, setGenreFilter] = useState<string>('')
  const [formatFilter, setFormatFilter] = useState<string>('')

  useEffect(() => {
    if (libLoading) return

    const scored = entries
      .filter(e => e.entry.my_score != null && e.entry.my_score >= 7)
      .sort((a, b) => (b.entry.my_score ?? 0) - (a.entry.my_score ?? 0))
      .slice(0, 20)

    if (scored.length === 0) {
      setLoading(false)
      return
    }

    const libraryAnilistIds = new Set(entries.map(e => e.anilist_id).filter(Boolean))
    let cancelled = false

    async function fetchRecs() {
      const all: RecCard[] = []
      const seen = new Set<number>()
      // ponytail: fetch sequentially to avoid AniList rate limit; parallel would be faster but riskier
      let notInterestedIds: Set<number> = new Set()
      try {
        if (window.api) {
          const ni = await window.api.db.getNotInterested()
          notInterestedIds = new Set(ni)
        }
      } catch { /* ignore */ }

      for (const entry of scored) {
        if (cancelled) return
        if (!entry.anilist_id) continue
        try {
          const data = await getRecommendations(entry.anilist_id)
          for (const node of data.nodes) {
            const rec = node.mediaRecommendation
            if (!rec || seen.has(rec.id) || libraryAnilistIds.has(rec.id) || notInterestedIds.has(rec.id)) continue

            // ponytail: skip sequels if user hasn't seen the prequel
            // A sequel has a PREQUEL relation — check if that prequel is in the user's library
            const relations = rec.relations?.edges ?? []
            const prequelIds = relations
              .filter((e: any) => e.relationType === 'PREQUEL')
              .map((e: any) => e.node.id)
            if (prequelIds.length > 0 && !prequelIds.some((pid: number) => libraryAnilistIds.has(pid))) continue

            seen.add(rec.id)
            all.push({
              anilistId: rec.id,
              title: rec.title.romaji,
              cover: rec.coverImage.large,
              score: node.rating,
              reason: entry.title,
              genres: rec.genres ?? [],
              format: rec.format ?? null,
            })
          }
        } catch { /* AniList error, skip */ }
      }

      if (!cancelled) {
        all.sort((a, b) => b.score - a.score)
        setRecs(all.slice(0, 30))
        setLoading(false)
      }
    }

    fetchRecs()
    return () => { cancelled = true }
  }, [entries, libLoading])

  const handleAddToPlan = async (rec: RecCard) => {
    if (!window.api) return
    try {
      const animeId = await window.api.db.upsertAnime({
        anilist_id: rec.anilistId, mal_id: null, title: rec.title,
        title_en: null, title_jp: null, cover_url: rec.cover, banner_url: null,
        cover_accent: null, episodes_total: null, airing_status: null,
        season: null, season_year: null, studio: null, genres: null,
        tags: null, synopsis: null, mean_score: null, format: null,
        source: null, duration: null, relations: null, external_links: null,
      })
      await window.api.db.upsertLibraryEntry({
        anime_id: animeId,
        my_status: 'plan_to_watch',
        progress: 0,
        source: 'recommendation',
      })
      toast(`Added "${rec.title}" to plan`)
      setDismissed(prev => new Set(prev).add(rec.anilistId))
    } catch { toast('Failed to add') }
  }

  const handleNotInterested = async (rec: RecCard) => {
    try {
      if (window.api) {
        const animeId = await window.api.db.upsertAnime({
          anilist_id: rec.anilistId, mal_id: null, title: rec.title,
          title_en: null, title_jp: null, cover_url: rec.cover, banner_url: null,
          cover_accent: null, episodes_total: null, airing_status: null,
          season: null, season_year: null, studio: null, genres: null,
          tags: null, synopsis: null, mean_score: null, format: null,
          source: null, duration: null, relations: null, external_links: null,
        })
        await window.api.db.addNotInterested(animeId, 'for_you_dismiss')
      }
      setDismissed(prev => new Set(prev).add(rec.anilistId))
      toast('Noted')
    } catch { toast('Failed') }
  }

  if (libLoading || loading) return <div className="p-6"><SkeletonGrid count={12} /></div>

  const scoredEntries = entries.filter(e => e.entry.my_score != null && e.entry.my_score >= 7)

  if (scoredEntries.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="Rate some anime to get recommendations"
          description="Score your favorite anime 7 or above in your library."
          action={{ label: 'Go to Library', onClick: () => navigate('/library') }}
        />
      </div>
    )
  }

  const visible = recs.filter(r => !dismissed.has(r.anilistId))

  // ponytail: derive filter options from loaded recs
  const allGenres = [...new Set(visible.flatMap(r => r.genres))].sort()
  const allFormats = [...new Set(visible.map(r => r.format).filter(Boolean) as string[])].sort()

  const filtered = visible.filter(r => {
    if (genreFilter && !r.genres.includes(genreFilter)) return false
    if (formatFilter && r.format !== formatFilter) return false
    return true
  })

  if (visible.length === 0) {
    return (
      <div className="p-6">
        <EmptyState title="No recommendations found" description="Try rating more anime in your library." />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="font-display text-xl font-bold text-text-1">For You</h1>
        <select
          value={genreFilter}
          onChange={e => setGenreFilter(e.target.value)}
          className="rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1"
        >
          <option value="">All genres</option>
          {allGenres.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select
          value={formatFilter}
          onChange={e => setFormatFilter(e.target.value)}
          className="rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1"
        >
          <option value="">All formats</option>
          {allFormats.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        {(genreFilter || formatFilter) && (
          <button
            onClick={() => { setGenreFilter(''); setFormatFilter('') }}
            className="text-xs text-text-3 hover:text-text-1"
          >Clear filters</button>
        )}
        <span className="text-xs text-text-3 ml-auto">{filtered.length} recommendation{filtered.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {filtered.map(rec => (
          <div key={rec.anilistId} className="group">
            <button
              onClick={() => navigate(`/anime/${rec.anilistId}`)}
              className="w-full text-left"
            >
              <div className="aspect-[2/3] overflow-hidden rounded-card bg-bg-2">
                <img src={rec.cover} alt={rec.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
              </div>
              <p className="mt-2 text-sm font-medium text-text-1 line-clamp-2">{rec.title}</p>
            </button>
            <p className="text-[11px] text-text-3 line-clamp-1">Because you liked {rec.reason}</p>
            <div className="mt-1.5 flex gap-1">
              <button
                onClick={() => handleAddToPlan(rec)}
                className="rounded bg-accent/20 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/30"
              >Add to plan</button>
              <button
                onClick={() => handleNotInterested(rec)}
                className="rounded bg-bg-2 px-2 py-0.5 text-[11px] text-text-3 hover:text-text-1"
              >Not interested</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

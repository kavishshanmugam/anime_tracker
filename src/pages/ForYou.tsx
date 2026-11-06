import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import PosterCard from '@/components/PosterCard'
import FilterSelects from '@/components/FilterSelects'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import { useDubs } from '@/hooks/useDubs'
import { getAnimeById, getRecommendations } from '@/lib/anilist'
import { ensureLocal } from '@/lib/watch'
import { dropFromCache, getPersonalRecommendations, pickSources, type Recommendation } from '@/lib/recommend'
import EmptyState from '@/components/EmptyState'
import { SkeletonGrid } from '@/components/Skeleton'

const POPULAR = 150_000 // AniList "popularity" (members) above which a show is mainstream

export default function ForYou() {
  const navigate = useNavigate()
  const { entries, loading: libLoading, refresh } = useLibrary()
  const { toast } = useToast()
  const dubOf = useDubs()
  const [recs, setRecs] = useState<Recommendation[]>([])
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [genreFilter, setGenreFilter] = useState('')
  const [formatFilter, setFormatFilter] = useState('')
  const [audioFilter, setAudioFilter] = useState<'' | 'dub' | 'dub_complete' | 'sub_only'>('')
  const [statusFilter, setStatusFilter] = useState<'' | 'RELEASING' | 'FINISHED'>('')
  const [hiddenGems, setHiddenGems] = useState(false)

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setProgress(null)
    try {
      const list = await getPersonalRecommendations(entries, getRecommendations, {
        force, onProgress: (done, total) => setProgress({ done, total }),
      })
      setRecs(list)
    } catch { setRecs([]) }
    setLoading(false)
    setProgress(null)
  }, [entries])

  useEffect(() => { if (!libLoading) load() }, [libLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const sources = useMemo(() => pickSources(entries).liked.length, [entries])

  const visible = useMemo(() => recs.filter(r => {
    if (dismissed.has(r.anilistId)) return false
    if (genreFilter && !r.genres.includes(genreFilter)) return false
    if (formatFilter && r.format !== formatFilter) return false
    if (hiddenGems && r.popularity > POPULAR) return false
    if (statusFilter && r.status !== statusFilter) return false
    const d = dubOf(r.malId, r.status)
    if (audioFilter === 'dub' && d !== 'complete' && d !== 'ongoing') return false
    if (audioFilter === 'dub_complete' && d !== 'complete') return false
    if (audioFilter === 'sub_only' && (d === 'complete' || d === 'ongoing')) return false
    return true
  }), [recs, dismissed, genreFilter, formatFilter, hiddenGems, statusFilter, audioFilter, dubOf])

  const allGenres = useMemo(() => [...new Set(recs.flatMap(r => r.genres))].sort(), [recs])
  const allFormats = useMemo(() => [...new Set(recs.map(r => r.format).filter(Boolean))] as string[], [recs])

  const hide = (id: number) => { dropFromCache(id); setDismissed(prev => new Set(prev).add(id)) }

  const handleAddToPlan = async (rec: Recommendation) => {
    if (!window.api) return
    try {
      // Save full details so Up Next, dub status and filters work for it straight away.
      const id = await ensureLocal(await getAnimeById(rec.anilistId))
      await window.api.db.upsertLibraryEntry({ anime_id: id, my_status: 'plan_to_watch', progress: 0, source: 'recommendation' })
      await refresh()
      hide(rec.anilistId)
      toast(`Added "${rec.title}" to your watchlist`)
    } catch { toast('Failed to add') }
  }

  const handleNotInterested = async (rec: Recommendation) => {
    try {
      if (window.api) {
        const existing = await window.api.db.getAnimeByAnilistId(rec.anilistId)
        const animeId = existing?.id ?? await window.api.db.upsertAnime({
          anilist_id: rec.anilistId, mal_id: rec.malId, title: rec.title, title_en: null, title_jp: null,
          cover_url: rec.cover, banner_url: rec.banner, cover_accent: null, episodes_total: rec.episodes,
          airing_status: rec.status, season: null, season_year: rec.year, studio: null,
          genres: JSON.stringify(rec.genres), tags: null, synopsis: rec.synopsis, mean_score: rec.meanScore,
          format: rec.format, source: null, duration: null, relations: null, external_links: null,
        })
        await window.api.db.addNotInterested(animeId, 'for_you_dismiss')
      }
      hide(rec.anilistId)
      toast('Got it — you won\'t see that again')
    } catch { toast('Failed') }
  }

  if (libLoading) return <SkeletonGrid count={12} />

  if (sources === 0) {
    return (
      <EmptyState
        title="Nothing to go on yet"
        description="Complete or score a few shows (or import your MyAnimeList / AniList history) and recommendations will appear here."
        action={{ label: 'Go to My Lists', onClick: () => navigate('/library') }}
      />
    )
  }

  const reason = (r: Recommendation) => {
    const b = r.because
    const who = b.length > 2 ? `${b[0]}, ${b[1]} +${b.length - 2}` : b.join(' & ')
    return `Because you liked ${who}`
  }
  const sel = 'rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1'

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-black text-text-1">For You</h1>
        <select value={genreFilter} onChange={e => setGenreFilter(e.target.value)} className={sel}>
          <option value="">All genres</option>
          {allGenres.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={formatFilter} onChange={e => setFormatFilter(e.target.value)} className={sel}>
          <option value="">All formats</option>
          {allFormats.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <FilterSelects audio={audioFilter} setAudio={setAudioFilter} status={statusFilter} setStatus={setStatusFilter} />
        <label className="flex items-center gap-2 text-sm text-text-2" title="Hide very popular shows to surface lesser-known ones">
          <input type="checkbox" checked={hiddenGems} onChange={e => setHiddenGems(e.target.checked)} /> Hidden gems
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-text-3">{visible.length} picks</span>
          <button onClick={() => load(true)} disabled={loading}
            className="rounded-card border border-border px-3 py-1.5 text-sm text-text-2 hover:bg-bg-1 disabled:opacity-50">
            {loading ? 'Working…' : '↻ Refresh'}
          </button>
        </div>
      </div>
      <p className="mb-6 text-xs text-text-3">
        Based on {sources} show{sources === 1 ? '' : 's'} you liked — completed counts as liked unless you scored it low; low scores and drops push similar shows down.
      </p>

      {loading ? (
        <div className="space-y-4">
          {progress && (
            <div className="max-w-md">
              <p className="mb-1 text-xs text-text-3">Reading recommendations from your shows… {progress.done}/{progress.total}</p>
              <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
                <div className="h-full bg-accent transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            </div>
          )}
          <SkeletonGrid count={12} />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState title="No recommendations match" description="Try clearing the filters or press Refresh." />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {visible.map(rec => (
            <div key={rec.anilistId} className="relative">
              <PosterCard
                title={rec.title}
                cover={rec.cover}
                synopsis={rec.synopsis}
                meta={[rec.format ?? '', rec.episodes ? `${rec.episodes} eps` : '', rec.meanScore ? `★ ${rec.meanScore}%` : '', rec.matches.join(', ')]}
                dub={dubOf(rec.malId, rec.status)}
                subtitle={<span className="line-clamp-2" title={rec.because.join(', ')}>{reason(rec)}</span>}
                onClick={() => navigate(`/anime/${rec.anilistId}`)}
                onBookmark={() => handleAddToPlan(rec)}
              />
              <button onClick={() => handleNotInterested(rec)} title="Not interested"
                className="absolute right-1.5 top-1.5 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-text-2 hover:bg-status-dropped hover:text-white">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

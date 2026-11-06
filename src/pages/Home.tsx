import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import HeroCarousel, { type HeroSlide } from '@/components/HeroCarousel'
import Shelf from '@/components/Shelf'
import PosterCard from '@/components/PosterCard'
import EpisodeCard from '@/components/EpisodeCard'
import { getRecommendations, getSeasonAnime, getTrendingAnime } from '@/lib/anilist'
import { getPersonalRecommendations, pickSources, type Recommendation } from '@/lib/recommend'
import { getEpisodeMeta, type EpisodeMeta } from '@/lib/episodes'
import { ensureLocal, watchPath } from '@/lib/watch'
import { computeUpNext, timeUntil, type ScheduleRow } from '@/lib/upnext'
import { useDubs } from '@/hooks/useDubs'
import { progressAfterWatching } from '@/lib/progress'
import { getResume, loadResume } from '@/lib/resume'
import type { AniListMedia, AnimeWithEntry } from '@/types'
import { displayTitle } from '@/lib/title'
import { announceCompleted } from '@/components/FinishedModal'

function currentSeason() {
  const m = new Date().getMonth()
  return { season: m < 3 ? 'WINTER' : m < 6 ? 'SPRING' : m < 9 ? 'SUMMER' : 'FALL', year: new Date().getFullYear() }
}
const titleCase = (s: string | null | undefined) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '')
const isStale = (d: string | null) => !!d && Date.now() - new Date(d).getTime() > 90 * 86_400_000

// Remote shelves are cached for the session so going back to Home is instant.
let remoteCache: { trending: AniListMedia[]; season: AniListMedia[] } | null = null

export default function Home() {
  const navigate = useNavigate()
  const { entries, loading, updateEntry, refresh } = useLibrary()
  const { toast } = useToast()
  const [trending, setTrending] = useState<AniListMedia[]>(remoteCache?.trending ?? [])
  const [season, setSeason] = useState<AniListMedia[]>(remoteCache?.season ?? [])
  const [epMeta, setEpMeta] = useState<Record<number, Map<number, EpisodeMeta>>>({})
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [cardMenu, setCardMenu] = useState<number | null>(null)
  const [, setResumeReady] = useState(0)
  useEffect(() => { loadResume().then(() => setResumeReady(v => v + 1)).catch(() => {}) }, [])
  const [now, setNow] = useState(Date.now())
  const dubOf = useDubs()
  const [recs, setRecs] = useState<Recommendation[]>([])

  // Personal picks (cached for a day, so this is instant after the first run).
  useEffect(() => {
    if (loading || !pickSources(entries).liked.length) return
    let cancelled = false
    getPersonalRecommendations(entries, getRecommendations).then(r => { if (!cancelled) setRecs(r.slice(0, 24)) }).catch(() => {})
    return () => { cancelled = true }
  }, [loading, entries])

  // Airing schedule → which episodes are actually out. Reload on mount, after each sync,
  // and tick the clock every minute so a newly aired episode appears without a restart.
  useEffect(() => {
    const load = () => {
      const from = new Date(Date.now() - 400 * 86_400_000).toISOString()
      const to = new Date(Date.now() + 120 * 86_400_000).toISOString()
      window.api?.db.getAiringSchedule(from, to).then(rows => setSchedule(rows as ScheduleRow[])).catch(() => {})
    }
    load()
    refresh().catch(() => {}) // pick up progress made in the player
    const onSync = () => { load(); refresh().catch(() => {}) }
    window.addEventListener('senpai:synced', onSync)
    const tick = setInterval(() => setNow(Date.now()), 60_000)
    return () => { window.removeEventListener('senpai:synced', onSync); clearInterval(tick) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (remoteCache) return
    const { season: s, year } = currentSeason()
    Promise.all([getTrendingAnime(20).catch(() => []), getSeasonAnime(s, year).catch(() => [])]).then(([t, se]) => {
      remoteCache = { trending: t, season: se }
      setTrending(t)
      setSeason(se)
    })
  }, [])

  const upNext = useMemo(() => computeUpNext(entries, schedule, now), [entries, schedule, now])
  const continueWatching = useMemo(() => upNext.ready.map(i => i.anime), [upNext])
  const watchlist = useMemo(() => entries.filter(e => e.entry?.my_status === 'plan_to_watch'), [entries])
  const recentlyFinished = useMemo(() => entries
    .filter(e => e.entry?.my_status === 'completed')
    .sort((a, b) => (b.entry?.finished_at ?? b.entry?.last_watched_at ?? '').localeCompare(a.entry?.finished_at ?? a.entry?.last_watched_at ?? ''))
    .slice(0, 20), [entries])
  const libraryByAnilist = useMemo(() => new Map(entries.filter(e => e.anilist_id).map(e => [e.anilist_id!, e])), [entries])

  // Episode thumbnails for Continue Watching.
  useEffect(() => {
    for (const e of continueWatching.slice(0, 12)) {
      if (!e.anilist_id || epMeta[e.anilist_id]) continue
      getEpisodeMeta(e.anilist_id).then(m => setEpMeta(prev => ({ ...prev, [e.anilist_id!]: m }))).catch(() => {})
    }
  }, [continueWatching]) // eslint-disable-line react-hooks/exhaustive-deps

  const addToWatchlist = async (media: AniListMedia) => {
    if (libraryByAnilist.has(media.id)) { toast('Already in your lists'); return }
    try {
      const id = await ensureLocal(media)
      await window.api.db.upsertLibraryEntry({ anime_id: id, my_status: 'plan_to_watch', progress: 0, source: 'home' })
      await refresh()
      toast(`Added "${media.title.english ?? media.title.romaji}" to your watchlist`)
    } catch { toast('Failed to add') }
  }

  const playMedia = async (media: AniListMedia) => {
    const local = libraryByAnilist.get(media.id)
    if (local) { navigate(watchPath(local, (local.entry?.progress ?? 0) + 1)); return }
    try {
      const id = await ensureLocal(media)
      const anime = await window.api.db.getAnime(id)
      if (anime) navigate(watchPath(anime, 1))
    } catch { navigate(`/anime/${media.id}`) }
  }

  /** Up Next card actions: change the whole show's status. */
  const setShowStatus = async (item: AnimeWithEntry, status: 'completed' | 'on_hold' | 'dropped' | 'remove') => {
    setCardMenu(null)
    try {
      if (status === 'remove') {
        await window.api.db.deleteLibraryEntry(item.id)
        await refresh()
        toast(`Removed ${displayTitle(item)}`)
        return
      }
      const today = new Date().toISOString().split('T')[0]
      await updateEntry(item.id, status === 'completed'
        ? { my_status: 'completed', progress: item.episodes_total ?? item.entry?.progress ?? 0, finished_at: today }
        : { my_status: status })
      toast(status === 'completed' ? `${displayTitle(item)} marked completed` : status === 'dropped' ? `Dropped ${displayTitle(item)}` : `${displayTitle(item)} put on hold`)
      if (status === 'completed') announceCompleted(item.id)
    } catch { toast('Failed to update') }
  }

  const markNext = async (item: AnimeWithEntry) => {
    const next = (item.entry?.progress ?? 0) + 1
    const updates = progressAfterWatching({ entry: item.entry ?? null, episode: next, episodesTotal: item.episodes_total }) ?? {}
    try {
      await updateEntry(item.id, updates)
      await window.api?.db.addWatchEvent({ anime_id: item.id, episode: next, source: 'manual', watched_at: new Date().toISOString() })
      toast(updates.my_status === 'completed' ? 'Completed!' : `Marked E${next} watched`)
      if (updates.my_status === 'completed') announceCompleted(item.id)
    } catch { toast('Failed to update') }
  }

  // Hero: what you're watching first, then what's trending.
  const slides: HeroSlide[] = useMemo(() => {
    const out: HeroSlide[] = []
    for (const e of continueWatching.filter(x => x.banner_url).slice(0, 3)) {
      const next = (e.entry?.progress ?? 0) + 1
      out.push({
        key: `l${e.id}`, title: displayTitle(e), banner: e.banner_url, cover: e.cover_url, synopsis: e.synopsis,
        meta: [e.format ?? '', e.season_year ? String(e.season_year) : '', e.episodes_total ? `${e.entry?.progress ?? 0}/${e.episodes_total} watched` : ''],
        primaryLabel: `Continue · E${next}`,
        onPrimary: () => navigate(watchPath(e, next)),
        onDetails: () => navigate(`/anime/${e.id}`),
        tag: <span className="rounded bg-accent/20 px-2 py-1 text-xs font-bold uppercase tracking-wide text-accent">Up next</span>,
      })
    }
    for (const m of trending.filter(x => x.bannerImage)) {
      if (out.length >= 6) break
      if (out.some(o => o.title === (m.title.english ?? m.title.romaji))) continue
      const local = libraryByAnilist.get(m.id)
      out.push({
        key: `t${m.id}`, title: m.title.english ?? m.title.romaji, banner: m.bannerImage, cover: m.coverImage.extraLarge ?? m.coverImage.large,
        synopsis: m.description,
        meta: [titleCase(m.format), m.seasonYear ? String(m.seasonYear) : '', m.genres.slice(0, 3).join(', '), m.meanScore ? `★ ${m.meanScore}%` : ''],
        primaryLabel: local ? `Continue · E${(local.entry?.progress ?? 0) + 1}` : 'Start watching E1',
        onPrimary: () => playMedia(m),
        onDetails: () => navigate(`/anime/${m.id}`),
        onBookmark: () => addToWatchlist(m),
        bookmarked: !!local,
        tag: <span className="rounded bg-white/10 px-2 py-1 text-xs font-bold uppercase tracking-wide text-text-1">Trending</span>,
      })
    }
    return out
  }, [continueWatching, trending, libraryByAnilist]) // eslint-disable-line react-hooks/exhaustive-deps


  const mediaPoster = (m: AniListMedia) => {
    const local = libraryByAnilist.get(m.id)
    return (
      <PosterCard key={m.id} width="w-[170px] lg:w-[190px]"
        title={m.title.english ?? m.title.romaji}
        cover={m.coverImage.extraLarge ?? m.coverImage.large}
        synopsis={m.description}
        meta={[titleCase(m.format), m.episodes ? `${m.episodes} eps` : '', m.meanScore ? `★ ${m.meanScore}%` : '']}
        subtitle={local ? <span className="text-accent">In your lists</span> : m.genres.slice(0, 2).join(' · ')}
        dub={dubOf(m.idMal, m.status)}
        onClick={() => navigate(`/anime/${m.id}`)}
        onPlay={() => playMedia(m)}
        onBookmark={() => addToWatchlist(m)}
        bookmarked={!!local}
      />
    )
  }

  const libraryPoster = (e: AnimeWithEntry) => (
    <PosterCard key={e.id} width="w-[170px] lg:w-[190px]"
      title={displayTitle(e)} cover={e.cover_url} synopsis={e.synopsis} accent={e.cover_accent} dub={dubOf(e.mal_id, e.airing_status)}
      meta={[e.format ?? '', e.episodes_total ? `${e.episodes_total} eps` : '']}
      subtitle={e.entry?.my_status === 'completed' ? 'Completed' : e.format ?? undefined}
      onClick={() => navigate(`/anime/${e.id}`)}
      onPlay={() => navigate(watchPath(e, e.entry?.my_status === 'completed' ? 1 : (e.entry?.progress ?? 0) + 1))}
    />
  )

  const { season: sName, year } = currentSeason()

  return (
    <div className="pb-16">
      <HeroCarousel slides={slides} />

      <div className="relative z-10 -mt-16 space-y-10">
        {!loading && entries.length === 0 && (
          <div className="mx-4 flex flex-wrap items-center justify-between gap-4 rounded-card border border-accent/30 bg-accent/10 p-5 lg:mx-10">
            <div>
              <p className="font-display text-lg font-bold text-text-1">Bring your list with you</p>
              <p className="text-sm text-text-2">Import from MyAnimeList or AniList and your progress shows up here.</p>
            </div>
            <button onClick={() => navigate('/settings?tab=library')} className="rounded-[4px] bg-accent px-5 py-2.5 text-sm font-bold uppercase text-white hover:bg-accent-hover">
              Import list
            </button>
          </div>
        )}

        {upNext.ready.length > 0 && (
          <Shelf title="Up Next" subtitle="Episodes ready for you to watch" viewAll="/library?status=watching">
            {upNext.ready.map(item => {
              const e = item.anime
              const next = item.nextEp
              const meta = e.anilist_id ? epMeta[e.anilist_id]?.get(next) : undefined
              const final = e.episodes_total != null && next === e.episodes_total
              const badge = item.isNew
                ? <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">New episode</span>
                : final
                  ? <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold text-white">Final episode</span>
                  : isStale(e.entry?.last_watched_at ?? null)
                    ? <span className="rounded bg-status-onhold/90 px-1.5 py-0.5 text-[10px] font-bold text-white">Untouched 3+ months</span>
                    : item.behind > 1 && Number.isFinite(item.behind)
                      ? <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-text-1">{item.behind} episodes left</span>
                      : undefined
              return (
                <div key={e.id} className="group/cw relative w-[280px] shrink-0 lg:w-[320px]">
                  <EpisodeCard
                    seriesTitle={displayTitle(e)} episode={next} episodeTitle={meta?.title}
                    thumbnail={meta?.thumbnail} fallback={e.banner_url ?? e.cover_url}
                    progress={(() => { const r = getResume(e.id, next); return r ? r.t / r.d : e.episodes_total ? (e.entry?.progress ?? 0) / e.episodes_total : undefined })()}
                    badge={getResume(e.id, next) ? <span className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-text-1">Resume</span> : badge}
                    onClick={() => navigate(watchPath(e, next))}
                  />
                  <div className={`absolute right-2 top-2 flex gap-1 transition-opacity ${cardMenu === e.id ? 'opacity-100' : 'opacity-0 group-hover/cw:opacity-100'}`}>
                    <button onClick={() => markNext(e)} title={`Mark E${next} watched`}
                      className="rounded bg-black/70 px-2 py-1 text-[11px] font-semibold text-text-1 hover:bg-accent">✓ E{next}</button>
                    <button onClick={() => setCardMenu(cardMenu === e.id ? null : e.id)} title="More"
                      className="rounded bg-black/70 px-2 py-1 text-[11px] font-bold text-text-1 hover:bg-bg-2">⋯</button>
                  </div>
                  {cardMenu === e.id && (
                    <div className="absolute right-2 top-10 z-30 w-48 rounded-card border border-border bg-bg-1 p-1 shadow-2xl" onMouseLeave={() => setCardMenu(null)}>
                      {e.airing_status !== 'RELEASING' && (
                        <button onClick={() => setShowStatus(e, 'completed')} className="w-full rounded px-3 py-2 text-left text-sm text-status-completed hover:bg-bg-2">✓ Mark show completed</button>
                      )}
                      <button onClick={() => setShowStatus(e, 'on_hold')} className="w-full rounded px-3 py-2 text-left text-sm text-status-onhold hover:bg-bg-2">⏸ Put on hold</button>
                      <button onClick={() => setShowStatus(e, 'dropped')} className="w-full rounded px-3 py-2 text-left text-sm text-status-dropped hover:bg-bg-2">✕ Drop</button>
                      <button onClick={() => navigate(`/anime/${e.id}`)} className="w-full rounded px-3 py-2 text-left text-sm text-text-2 hover:bg-bg-2">☰ Show details & watch order</button>
                      <button onClick={() => setShowStatus(e, 'remove')} className="w-full rounded border-t border-border px-3 py-2 text-left text-sm text-text-3 hover:bg-bg-2 hover:text-red-400">Remove from my lists</button>
                    </div>
                  )}
                </div>
              )
            })}
          </Shelf>
        )}

        {upNext.waiting.length > 0 && (
          <Shelf title="Caught Up" subtitle="Airing shows you're up to date on — they move back to Up Next when the next episode airs">
            {upNext.waiting.map(w => (
              <button key={w.anime.id} onClick={() => navigate(`/anime/${w.anime.id}`)}
                className="group flex w-[300px] shrink-0 items-center gap-3 rounded-card border border-border bg-bg-1 p-2 text-left hover:bg-bg-2">
                <div className="h-[84px] w-[56px] shrink-0 overflow-hidden rounded-[4px] bg-bg-2">
                  {w.anime.cover_url && <img src={w.anime.cover_url} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-1 group-hover:text-accent">{displayTitle(w.anime)}</p>
                  <p className="mt-0.5 text-xs text-text-3">Watched {w.anime.entry?.progress ?? 0}{w.anime.episodes_total ? ` / ${w.anime.episodes_total}` : ''}</p>
                  <p className="mt-1 text-xs font-semibold text-accent">
                    {w.airsAt
                      ? <>E{w.nextEp} in {timeUntil(w.airsAt, now)} <span className="font-normal text-text-3">· {new Date(w.airsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></>
                      : <>E{w.nextEp} · date not announced</>}
                  </p>
                </div>
              </button>
            ))}
          </Shelf>
        )}

        {recs.length > 0 && (
          <Shelf title="Recommended for You" subtitle="Based on what you've finished and liked" viewAll="/for-you">
            {recs.map(r => (
              <PosterCard key={r.anilistId} width="w-[170px] lg:w-[190px]"
                title={r.title} cover={r.cover} synopsis={r.synopsis}
                meta={[r.format ?? '', r.episodes ? `${r.episodes} eps` : '', r.meanScore ? `★ ${r.meanScore}%` : '']}
                dub={dubOf(r.malId, r.status)}
                subtitle={<span className="line-clamp-1">Because you liked {r.because[0]}</span>}
                onClick={() => navigate(`/anime/${r.anilistId}`)}
              />
            ))}
          </Shelf>
        )}

        {watchlist.length > 0 && (
          <Shelf title="Your Watchlist" viewAll="/library?status=plan_to_watch">{watchlist.map(libraryPoster)}</Shelf>
        )}

        {season.length > 0 && (
          <Shelf title={`Popular in ${titleCase(sName)} ${year}`} subtitle="Airing this season" viewAll="/seasonal">
            {[...season].sort((a, b) => (b.meanScore ?? 0) - (a.meanScore ?? 0)).slice(0, 24).map(mediaPoster)}
          </Shelf>
        )}

        {trending.length > 0 && <Shelf title="Trending Now">{trending.map(mediaPoster)}</Shelf>}

        {recentlyFinished.length > 0 && (
          <Shelf title="Watch Again" subtitle="Recently completed" viewAll="/library?status=completed">{recentlyFinished.map(libraryPoster)}</Shelf>
        )}
      </div>
    </div>
  )
}

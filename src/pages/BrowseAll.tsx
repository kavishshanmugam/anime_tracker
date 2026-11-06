import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PosterCard from '@/components/PosterCard'
import EmptyState from '@/components/EmptyState'
import { SkeletonGrid } from '@/components/Skeleton'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import { useDubs } from '@/hooks/useDubs'
import { getAnimeById, gqlRaw } from '@/lib/anilist'
import { getDubLists } from '@/lib/dubs'
import { ensureLocal } from '@/lib/watch'

const GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha', 'Music',
  'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller']
const FORMATS: [string, string][] = [['TV', 'TV series'], ['MOVIE', 'Movie'], ['ONA', 'ONA'], ['OVA', 'OVA'], ['SPECIAL', 'Special'], ['TV_SHORT', 'TV short']]
const SORTS: [string, string][] = [['POPULARITY_DESC', 'Most popular'], ['SCORE_DESC', 'Highest rated'], ['TRENDING_DESC', 'Trending'], ['START_DATE_DESC', 'Newest'], ['TITLE_ROMAJI', 'A–Z']]

interface Media {
  id: number; idMal: number | null; title: { romaji: string; english: string | null }
  coverImage: { large: string; extraLarge: string | null }; description: string | null; meanScore: number | null
  genres: string[]; format: string | null; status: string | null; episodes: number | null; seasonYear: number | null
}

const QUERY = `query ($page: Int, $search: String, $genre: String, $format: MediaFormat, $status: MediaStatus, $year: Int,
  $sort: [MediaSort], $malIn: [Int], $malNotIn: [Int]) {
  Page(page: $page, perPage: 30) {
    pageInfo { hasNextPage total }
    media(type: ANIME, isAdult: false, search: $search, genre: $genre, format: $format, status: $status, seasonYear: $year,
      sort: $sort, idMal_in: $malIn, idMal_not_in: $malNotIn) {
      id idMal title { romaji english } coverImage { large extraLarge } description meanScore genres format status episodes seasonYear
    }
  }
}`

/** Browse the whole AniList catalogue — no season needed. Filters persist in the URL. */
export default function BrowseAll() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { entries, refresh } = useLibrary()
  const dubOf = useDubs()
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState<Media[]>([])
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '')
  const reqRef = useRef(0)

  const f = {
    q: params.get('q') ?? '', audio: params.get('audio') ?? '', status: params.get('status') ?? '',
    genre: params.get('genre') ?? '', format: params.get('format') ?? '', year: params.get('year') ?? '',
    sort: params.get('sort') ?? 'POPULARITY_DESC',
  }
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }

  const fetchPage = useCallback(async (p: number) => {
    const id = ++reqRef.current
    setLoading(true)
    try {
      let malIn: number[] | undefined, malNotIn: number[] | undefined
      let status = f.status || undefined
      if (f.audio) {
        const { dubbed, incomplete } = await getDubLists()
        if (f.audio === 'dub') malIn = dubbed
        else if (f.audio === 'dub_complete') { const inc = new Set(incomplete); malIn = dubbed.filter(x => !inc.has(x)); status = 'FINISHED' }
        else if (f.audio === 'sub_only') malNotIn = dubbed
      }
      const data = await gqlRaw<{ Page: { pageInfo: { hasNextPage: boolean; total: number }; media: Media[] } }>(QUERY, {
        page: p, search: f.q || undefined, genre: f.genre || undefined, format: f.format || undefined, status,
        year: f.year ? Number(f.year) : undefined, sort: f.q ? ['SEARCH_MATCH', f.sort] : [f.sort], malIn, malNotIn,
      })
      if (id !== reqRef.current) return
      setItems(prev => p === 1 ? data.Page.media : [...prev, ...data.Page.media])
      setHasNext(data.Page.pageInfo.hasNextPage)
      setTotal(data.Page.pageInfo.total)
      setPage(p)
    } catch {
      if (id === reqRef.current && p === 1) setItems([])
    } finally {
      if (id === reqRef.current) setLoading(false)
    }
  }, [f.q, f.audio, f.status, f.genre, f.format, f.year, f.sort]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchPage(1) }, [fetchPage])

  // Debounced search box.
  useEffect(() => {
    const t = setTimeout(() => { if (searchInput !== f.q) set('q', searchInput.trim()) }, 400)
    return () => clearTimeout(t)
  }, [searchInput]) // eslint-disable-line react-hooks/exhaustive-deps

  const inLists = useMemo(() => new Set(entries.map(e => e.anilist_id).filter(Boolean)), [entries])
  const years = Array.from({ length: new Date().getFullYear() + 2 - 1970 }, (_, i) => new Date().getFullYear() + 1 - i)

  const addToWatchlist = async (m: Media) => {
    try {
      const id = await ensureLocal(await getAnimeById(m.id))
      await window.api.db.upsertLibraryEntry({ anime_id: id, my_status: 'plan_to_watch', progress: 0, source: 'browse' })
      await refresh()
      toast(`Added "${m.title.english ?? m.title.romaji}" to your watchlist`)
    } catch { toast('Failed to add') }
  }

  const sel = 'rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1'
  const anyFilter = f.q || f.audio || f.status || f.genre || f.format || f.year

  return (
    <div>
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-black text-text-1">Browse</h1>
          <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search all anime…"
            className="w-72 rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1 outline-none placeholder:text-text-3 focus:border-accent" />
          <span className="ml-auto text-xs text-text-3">{total != null ? `${total.toLocaleString()}${total >= 5000 ? '+' : ''} results` : ''}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={f.audio} onChange={e => set('audio', e.target.value)} className={sel}>
            <option value="">Sub & Dub</option>
            <option value="dub">Has English dub</option>
            <option value="dub_complete">Dub complete</option>
            <option value="sub_only">Sub only</option>
          </select>
          <select value={f.status} onChange={e => set('status', e.target.value)} className={sel} disabled={f.audio === 'dub_complete'}>
            <option value="">Airing & finished</option>
            <option value="FINISHED">Finished airing</option>
            <option value="RELEASING">Still airing</option>
            <option value="NOT_YET_RELEASED">Upcoming</option>
          </select>
          <select value={f.genre} onChange={e => set('genre', e.target.value)} className={sel}>
            <option value="">Any genre</option>
            {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={f.format} onChange={e => set('format', e.target.value)} className={sel}>
            <option value="">Any format</option>
            {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={f.year} onChange={e => set('year', e.target.value)} className={sel}>
            <option value="">Any year</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={f.sort} onChange={e => set('sort', e.target.value)} className={sel}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {anyFilter && (
            <button onClick={() => { setSearchInput(''); setParams(new URLSearchParams(), { replace: true }) }} className="text-xs text-text-3 hover:text-text-1">Clear all</button>
          )}
        </div>
      </div>

      {loading && page === 1 && items.length === 0 ? <SkeletonGrid count={18} /> : items.length === 0 ? (
        <EmptyState title="No anime match these filters" description="Try loosening a filter." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {items.map(m => (
              <PosterCard key={m.id}
                title={m.title.english ?? m.title.romaji}
                cover={m.coverImage.extraLarge ?? m.coverImage.large}
                synopsis={m.description}
                meta={[m.format ?? '', m.episodes ? `${m.episodes} eps` : '', m.seasonYear ? String(m.seasonYear) : '', m.meanScore ? `★ ${m.meanScore}%` : '']}
                dub={dubOf(m.idMal, m.status)}
                subtitle={inLists.has(m.id) ? <span className="text-accent">In your lists</span>
                  : [m.status === 'RELEASING' ? 'Airing' : m.status === 'NOT_YET_RELEASED' ? 'Upcoming' : null, m.genres.slice(0, 2).join(' · ')].filter(Boolean).join(' · ')}
                onClick={() => navigate(`/anime/${m.id}`)}
                onBookmark={inLists.has(m.id) ? undefined : () => addToWatchlist(m)}
                bookmarked={inLists.has(m.id)}
              />
            ))}
          </div>
          {hasNext && (
            <div className="mt-8 flex justify-center">
              <button onClick={() => fetchPage(page + 1)} disabled={loading}
                className="rounded-[4px] border border-border px-6 py-2.5 text-sm font-bold uppercase tracking-wide text-text-2 hover:bg-bg-1 disabled:opacity-50">
                {loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

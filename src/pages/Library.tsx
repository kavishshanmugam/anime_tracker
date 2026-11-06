import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import { getAnimeByMalId, mapAniListToAnime } from '@/lib/anilist'
import AnimeGrid from '@/components/AnimeGrid'
import StatusBadge from '@/components/StatusBadge'
import ProgressBar from '@/components/ProgressBar'
import { SkeletonGrid } from '@/components/Skeleton'
import EmptyState from '@/components/EmptyState'
import FilterSelects from '@/components/FilterSelects'
import { useDubs } from '@/hooks/useDubs'
import type { MyStatus, Anime } from '@/types'
import { displayTitle } from '@/lib/title'

type SortKey = 'last_updated' | 'title' | 'score' | 'progress'
type ViewMode = 'grid' | 'list'

const STATUS_TABS: { value: MyStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'watching', label: 'Watching' },
  { value: 'completed', label: 'Completed' },
  { value: 'plan_to_watch', label: 'Plan to Watch' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'dropped', label: 'Dropped' },
]

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'last_updated', label: 'Last updated' },
  { value: 'title', label: 'Title A-Z' },
  { value: 'score', label: 'Score' },
  { value: 'progress', label: 'Progress' },
]

export default function Library() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { entries, loading, updateEntry, deleteEntry, bulkUpdate, refresh } = useLibrary()
  const { toast } = useToast()

  const urlStatus = (searchParams.get('status') as MyStatus | null) || 'all'
  const [statusFilter, setStatusFilter] = useState<MyStatus | 'all'>(urlStatus)

  // Re-sync filter when URL param changes (e.g. back/forward navigation)
  useEffect(() => { setStatusFilter(urlStatus) }, [urlStatus])
  const [sortKey, setSortKey] = useState<SortKey>('last_updated')
  const [view, setView] = useState<ViewMode>('grid')
  const [search, setSearch] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<MyStatus | ''>('')
  const [bulkScore, setBulkScore] = useState('')
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [genreFilter, setGenreFilter] = useState('')
  const [formatFilter, setFormatFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')
  const [audioFilter, setAudioFilter] = useState<'' | 'dub' | 'dub_complete' | 'sub_only'>('')
  const [airingFilter, setAiringFilter] = useState<'' | 'RELEASING' | 'FINISHED'>('')
  const dubOf = useDubs()

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: entries.length }
    for (const e of entries) counts[e.entry.my_status] = (counts[e.entry.my_status] || 0) + 1
    return counts
  }, [entries])

  // ponytail: derive filter options from current entries
  const allGenres = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) {
      if (!e.genres) continue
      try { for (const g of JSON.parse(e.genres)) set.add(g) } catch {}
    }
    return [...set].sort()
  }, [entries])

  const allFormats = useMemo(() => {
    const set = new Set<string>()
    for (const e of entries) { if (e.format) set.add(e.format) }
    return [...set].sort()
  }, [entries])

  const allYears = useMemo(() => {
    const set = new Set<number>()
    for (const e of entries) { if (e.season_year) set.add(e.season_year) }
    return [...set].sort((a, b) => b - a)
  }, [entries])

  const filtered = useMemo(() => {
    let items = entries
    if (statusFilter !== 'all') items = items.filter(e => e.entry.my_status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(e =>
        e.title.toLowerCase().includes(q) || (e.title_en ?? '').toLowerCase().includes(q) ||
        e.title_en?.toLowerCase().includes(q) ||
        e.title_jp?.toLowerCase().includes(q)
      )
    }
    if (genreFilter) {
      items = items.filter(e => {
        if (!e.genres) return false
        try { return JSON.parse(e.genres).includes(genreFilter) } catch { return false }
      })
    }
    if (formatFilter) items = items.filter(e => e.format === formatFilter)
    if (yearFilter) items = items.filter(e => e.season_year === Number(yearFilter))
    if (audioFilter) items = items.filter(e => {
      const d = dubOf(e.mal_id, e.airing_status)
      return audioFilter === 'dub' ? d === 'complete' || d === 'ongoing' : audioFilter === 'dub_complete' ? d === 'complete' : d !== 'complete' && d !== 'ongoing'
    })
    if (airingFilter) items = items.filter(e => e.airing_status === airingFilter)
    const sorted = [...items]
    switch (sortKey) {
      case 'title': sorted.sort((a, b) => displayTitle(a).localeCompare(displayTitle(b))); break
      case 'score': sorted.sort((a, b) => (b.entry.my_score ?? 0) - (a.entry.my_score ?? 0)); break
      case 'progress': sorted.sort((a, b) => b.entry.progress - a.entry.progress); break
      default: sorted.sort((a, b) => (b.entry.last_watched_at ?? '').localeCompare(a.entry.last_watched_at ?? ''))
    }
    return sorted
  }, [entries, statusFilter, sortKey, search, genreFilter, formatFilter, yearFilter, audioFilter, airingFilter, dubOf])

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleBulkApply = async () => {
    const ids = Array.from(selected)
    const partial: any = {}
    if (bulkStatus) partial.my_status = bulkStatus
    if (bulkScore) partial.my_score = Number(bulkScore)
    if (Object.keys(partial).length === 0) return
    await bulkUpdate(ids, partial)
    toast(`Updated ${ids.length} entries`)
    setSelectMode(false)
    setSelected(new Set())
    setBulkStatus('')
    setBulkScore('')
  }

  const handleMarkCompleted = async (anime: Anime & { entry: any }) => {
    const now = new Date().toISOString().split('T')[0]
    await updateEntry(anime.id, {
      my_status: 'completed' as MyStatus,
      progress: anime.episodes_total ?? anime.entry.progress,
      finished_at: now,
    })
    toast(`${displayTitle(anime)} marked completed`)
    setMenuOpen(null)
  }

  const handleRemove = async (anime: Anime) => {
    await deleteEntry(anime.id)
    toast(`${displayTitle(anime)} removed`)
    setMenuOpen(null)
  }

  const handleEnrich = async (anime: Anime) => {
    if (!window.api || !anime.mal_id) return
    try {
      const media = await getAnimeByMalId(anime.mal_id)
      const mapped = mapAniListToAnime(media)
      await window.api.db.upsertAnime({ ...mapped, mal_id: anime.mal_id })
      toast(`Enriched "${displayTitle(anime)}"`)
      refresh()
    } catch {
      toast('Could not find on AniList')
    }
    setMenuOpen(null)
  }

  const handleAnimeClick = (anime: Anime) => {
    if (selectMode) { toggleSelect(anime.id); return }
    navigate(`/anime/${anime.id}`)
  }

  if (loading) return <div><SkeletonGrid /></div>

  return (
    <div className="flex flex-col h-full">
      {/* Header + tabs */}
      <div className="sticky top-[60px] z-20 -mx-4 space-y-4 bg-bg-0/95 px-4 pt-2 pb-3 backdrop-blur lg:-mx-10 lg:px-10">
        <h1 className="font-display text-3xl font-black text-text-1">My Lists</h1>
        <div className="flex items-center gap-6 overflow-x-auto border-b border-border">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => { setStatusFilter(tab.value); navigate(tab.value === 'all' ? '/library' : `/library?status=${tab.value}`, { replace: true }) }}
              className={`relative whitespace-nowrap pb-3 text-sm font-bold uppercase tracking-wide transition-colors
                after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full ${
                statusFilter === tab.value ? 'text-text-1 after:bg-accent' : 'text-text-3 hover:text-text-1 after:bg-transparent'
              }`}
            >
              {tab.value === 'plan_to_watch' ? 'Watchlist' : tab.label}
              <span className="ml-1.5 font-mono text-xs font-normal opacity-60">{statusCounts[tab.value] || 0}</span>
            </button>
          ))}
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search library..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1 placeholder:text-text-3 focus:outline-none focus:border-accent w-56"
          />
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-1 focus:outline-none"
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={genreFilter} onChange={e => setGenreFilter(e.target.value)} className="rounded-card border border-border bg-bg-1 px-2 py-1.5 text-sm text-text-1">
            <option value="">Genre</option>
            {allGenres.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={formatFilter} onChange={e => setFormatFilter(e.target.value)} className="rounded-card border border-border bg-bg-1 px-2 py-1.5 text-sm text-text-1">
            <option value="">Format</option>
            {allFormats.map(f => <option key={f} value={f}>{{ TV: 'TV Series', TV_SHORT: 'TV Short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' }[f] ?? f}</option>)}
          </select>
          <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="rounded-card border border-border bg-bg-1 px-2 py-1.5 text-sm text-text-1">
            <option value="">Year</option>
            {allYears.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          <FilterSelects audio={audioFilter} setAudio={setAudioFilter} status={airingFilter} setStatus={setAiringFilter} />
          <div className="flex rounded-card border border-border overflow-hidden">
            <button
              onClick={() => setView('grid')}
              className={`px-2.5 py-1.5 text-sm ${view === 'grid' ? 'bg-accent text-text-1' : 'bg-bg-1 text-text-2'}`}
              aria-label="Grid view"
            >
              {/* grid icon */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
            </button>
            <button
              onClick={() => setView('list')}
              className={`px-2.5 py-1.5 text-sm ${view === 'list' ? 'bg-accent text-text-1' : 'bg-bg-1 text-text-2'}`}
              aria-label="List view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2.5" rx="1"/><rect x="1" y="6.75" width="14" height="2.5" rx="1"/><rect x="1" y="11.5" width="14" height="2.5" rx="1"/></svg>
            </button>
          </div>
          <button
            onClick={() => { setSelectMode(!selectMode); setSelected(new Set()) }}
            className={`ml-auto rounded-card px-3 py-1.5 text-sm transition-colors ${
              selectMode ? 'bg-accent text-text-1' : 'border border-border text-text-2 hover:bg-bg-1'
            }`}
          >
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 pt-6">
        {filtered.length === 0 ? (
          <EmptyState title="No anime found" description={search ? 'Try a different search.' : 'Your library is empty.'} />
        ) : view === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map(item => (
              <div key={item.id} className="group relative">
                {selectMode && (
                  <div className={`absolute top-2 left-2 z-10 h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                    selected.has(item.id) ? 'bg-accent border-accent' : 'border-white/70 bg-black/30'
                  }`}>
                    {selected.has(item.id) && <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" fill="none"/></svg>}
                  </div>
                )}
                <button
                  onClick={() => handleAnimeClick(item)}
                  className="group w-full text-left transition-transform duration-200 hover:scale-[1.03]"
                >
                  <div
                    className="relative aspect-[2/3] overflow-hidden rounded-card bg-bg-2"
                    style={item.cover_accent ? { borderBottom: `3px solid ${item.cover_accent}` } : undefined}
                  >
                    {item.cover_url ? (
                      <img src={item.cover_url} alt={displayTitle(item)} loading="lazy" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center p-3">
                        <span className="text-center text-sm text-text-3">{displayTitle(item)}</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-medium text-text-1 line-clamp-2">{displayTitle(item)}</p>
                    <StatusBadge status={item.entry.my_status} />
                  </div>
                </button>
                {/* Quick complete (watched it elsewhere) */}
                {!selectMode && item.entry.my_status !== 'completed' && item.airing_status !== 'RELEASING' && item.airing_status !== 'NOT_YET_RELEASED' && (
                  <button
                    onClick={e => { e.stopPropagation(); handleMarkCompleted(item) }}
                    title="Mark completed"
                    className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold text-status-completed opacity-0 transition-opacity hover:bg-status-completed hover:text-black group-hover:opacity-100"
                  >✓ Completed</button>
                )}
                {/* Quick menu */}
                {!selectMode && (
                  <div className="absolute top-2 right-2">
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === item.id ? null : item.id) }}
                      className="rounded bg-black/50 px-1.5 py-0.5 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                    >...</button>
                    {menuOpen === item.id && (
                      <div className="absolute right-0 mt-1 rounded-card border border-border bg-bg-1 py-1 shadow-lg z-20 w-40">
                        {item.airing_status !== 'RELEASING' && (
                          <button
                            onClick={e => { e.stopPropagation(); handleMarkCompleted(item) }}
                            className="block w-full px-3 py-1.5 text-left text-sm text-text-1 hover:bg-bg-2"
                          >Mark completed</button>
                        )}
                        {!item.cover_url && item.mal_id && (
                          <button
                            onClick={e => { e.stopPropagation(); handleEnrich(item) }}
                            className="block w-full px-3 py-1.5 text-left text-sm text-accent hover:bg-bg-2"
                          >Enrich from AniList</button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); handleRemove(item) }}
                          className="block w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-bg-2"
                        >Remove</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* List view */
          <div className="space-y-1">
            {filtered.map(item => (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => handleAnimeClick(item)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAnimeClick(item) } }}
                className="flex items-center gap-4 rounded-card px-3 py-2 hover:bg-bg-1 cursor-pointer transition-colors group relative"
              >
                {selectMode && (
                  <div className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 ${
                    selected.has(item.id) ? 'bg-accent border-accent' : 'border-border'
                  }`}>
                    {selected.has(item.id) && <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" fill="none"/></svg>}
                  </div>
                )}
                <div className="h-12 w-8 shrink-0 overflow-hidden rounded bg-bg-2">
                  {item.cover_url && <img src={item.cover_url} alt="" className="h-full w-full object-cover" />}
                </div>
                <p className="flex-1 text-sm font-medium text-text-1 line-clamp-1">{displayTitle(item)}</p>
                <StatusBadge status={item.entry.my_status} />
                <div className="w-32" onClick={e => e.stopPropagation()}>
                  <ProgressBar current={item.entry.progress} total={item.episodes_total} />
                </div>
                <span className="w-10 text-center text-sm text-text-2 font-mono">
                  {item.entry.my_score || '-'}
                </span>
                <span className="w-20 text-xs text-text-3 text-right">
                  {item.entry.last_watched_at ? new Date(item.entry.last_watched_at).toLocaleDateString() : '-'}
                </span>
                {/* list row menu */}
                {!selectMode && (
                  <div className="relative">
                    <button
                      onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === item.id ? null : item.id) }}
                      className="text-text-3 hover:text-text-1 text-sm px-1"
                    >...</button>
                    {menuOpen === item.id && (
                      <div className="absolute right-0 mt-1 rounded-card border border-border bg-bg-1 py-1 shadow-lg z-20 w-40">
                        {item.airing_status !== 'RELEASING' && (
                          <button
                            onClick={e => { e.stopPropagation(); handleMarkCompleted(item) }}
                            className="block w-full px-3 py-1.5 text-left text-sm text-text-1 hover:bg-bg-2"
                          >Mark completed</button>
                        )}
                        {!item.cover_url && item.mal_id && (
                          <button
                            onClick={e => { e.stopPropagation(); handleEnrich(item) }}
                            className="block w-full px-3 py-1.5 text-left text-sm text-accent hover:bg-bg-2"
                          >Enrich from AniList</button>
                        )}
                        <button
                          onClick={e => { e.stopPropagation(); handleRemove(item) }}
                          className="block w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-bg-2"
                        >Remove</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-bg-1 px-6 py-3">
          <span className="text-sm font-medium text-text-1">{selected.size} selected</span>
          <select
            value={bulkStatus}
            onChange={e => setBulkStatus(e.target.value as MyStatus | '')}
            className="rounded-card border border-border bg-bg-0 px-2 py-1 text-sm text-text-1"
          >
            <option value="">Status...</option>
            {STATUS_TABS.filter(t => t.value !== 'all').map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            max="10"
            placeholder="Score"
            value={bulkScore}
            onChange={e => setBulkScore(e.target.value)}
            className="w-16 rounded-card border border-border bg-bg-0 px-2 py-1 text-sm text-text-1"
          />
          <button
            onClick={handleBulkApply}
            className="rounded-card bg-accent px-4 py-1.5 text-sm font-medium text-text-1 hover:bg-accent-hover"
          >Apply</button>
          <button
            onClick={() => { setSelectMode(false); setSelected(new Set()) }}
            className="text-sm text-text-2 hover:text-text-1"
          >Cancel</button>
        </div>
      )}
    </div>
  )
}

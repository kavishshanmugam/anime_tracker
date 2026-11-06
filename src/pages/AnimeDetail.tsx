import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAnimeDetail } from '@/hooks/useAnimeDetail'
import { useToast } from '@/hooks/useToast'
import ProgressBar from '@/components/ProgressBar'
import StatusBadge from '@/components/StatusBadge'
import { SkeletonText } from '@/components/Skeleton'
import type { MyStatus } from '@/types'
import EpisodeCard from '@/components/EpisodeCard'
import AudioToggle, { useShowAudio } from '@/components/AudioToggle'
import { useDubs } from '@/hooks/useDubs'
import { DUB_LABEL } from '@/lib/dubs'
import { airedFromMeta, getEpisodeMeta, type EpisodeMeta } from '@/lib/episodes'
import { latestAired, type ScheduleRow } from '@/lib/upnext'
import WatchOrder from '@/components/WatchOrder'
import { watchPath, stripHtml } from '@/lib/watch'
import { displayTitle } from '@/lib/title'
import { announceCompleted } from '@/components/FinishedModal'

const STREAMING_SITES = ['Crunchyroll', 'Funimation', 'Netflix', 'Hulu', 'Amazon', 'Disney Plus', 'HIDIVE', 'VRV', 'Bilibili', 'iQIYI', 'Wakanim', 'AnimeLab']
const STATUSES: { value: MyStatus; label: string }[] = [
  { value: 'watching', label: 'Watching' },
  { value: 'completed', label: 'Completed' },
  { value: 'plan_to_watch', label: 'Plan to Watch' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'dropped', label: 'Dropped' },
]

const EP_PAGE = 100

interface Relation {
  type: string
  id: number
  malId: number | null
  title: string
  status: string
  cover: string
}

interface ExternalLink {
  url: string
  site: string
  type: string
}

export default function AnimeDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { anime, entry, events, loading, updateEntry, deleteEntry, refresh } = useAnimeDetail(Number(id))
  const { toast } = useToast()
  const [synopsisExpanded, setSynopsisExpanded] = useState(false)
  const [epPage, setEpPage] = useState(0)
  const [tab, setTab] = useState<'episodes' | 'order' | 'tracking' | 'more'>('episodes')
  const [actionsOpen, setActionsOpen] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [dubCount, setDubCount] = useState<number | null>(null)
  const [epMeta, setEpMeta] = useState<Map<number, EpisodeMeta>>(new Map())
  const [configuredServices, setConfiguredServices] = useState<string[]>([])
  const [localNotes, setLocalNotes] = useState(entry?.notes ?? '')
  const [localProgress, setLocalProgress] = useState(entry?.progress ?? 0)
  const notesTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const progressTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Sync local state when entry changes externally
  useEffect(() => { setLocalNotes(entry?.notes ?? '') }, [entry?.notes])
  useEffect(() => { setLocalProgress(entry?.progress ?? 0) }, [entry?.progress])

  const debouncedNotesUpdate = useCallback((value: string) => {
    setLocalNotes(value)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(() => handleUpdate({ notes: value || null }), 500)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const debouncedProgressUpdate = useCallback((value: number) => {
    setLocalProgress(value)
    if (progressTimerRef.current) clearTimeout(progressTimerRef.current)
    progressTimerRef.current = setTimeout(() => handleUpdate({ progress: value }), 500)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.api?.db.getAppState('streaming_services').then(v => {
      if (v) setConfiguredServices(JSON.parse(v))
    }).catch(() => {})
  }, [])

  // ponytail: prefetch slug on mount, cancel on unmount/navigate away
  useEffect(() => {
    if (!anime?.title) return
    window.api?.stream.prefetch(anime.title, anime.title_en ?? undefined).catch(() => {})
    return () => { window.api?.stream.cancelPrefetch(anime.title).catch(() => {}) }
  }, [anime?.title])

  useEffect(() => {
    setEpMeta(new Map())
    if (anime?.anilist_id) getEpisodeMeta(anime.anilist_id).then(setEpMeta).catch(() => {})
  }, [anime?.anilist_id])

  const [audio, setAudio] = useShowAudio(anime?.id)
  const dubOf = useDubs()

  // Airing schedule rows for this show (to hide episodes that haven't aired yet).
  useEffect(() => {
    if (!anime?.id || !window.api) return
    const from = new Date(Date.now() - 400 * 86_400_000).toISOString()
    const to = new Date(Date.now() + 120 * 86_400_000).toISOString()
    window.api.db.getAiringSchedule(from, to)
      .then(rows => setSchedule((rows as ScheduleRow[]).filter(r => r.anime_id === anime.id)))
      .catch(() => {})
  }, [anime?.id])

  // In dub mode, ask the source how many episodes are dubbed so far (null = unknown).
  useEffect(() => {
    setDubCount(null)
    if (!anime || audio !== 'dub' || !window.api) return
    window.api.stream.episodeCount(anime.title, 'dub', { titleEn: anime.title_en ?? undefined, anilistId: anime.anilist_id ?? undefined })
      .then(setDubCount).catch(() => {})
  }, [anime?.id, audio]) // eslint-disable-line react-hooks/exhaustive-deps

  // Start on the page of episodes containing the next one to watch.
  useEffect(() => { setEpPage(Math.floor((entry?.progress ?? 0) / EP_PAGE)) }, [anime?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <SkeletonText height="200px" />
        <SkeletonText width="60%" height="2rem" />
        <SkeletonText width="80%" />
        <SkeletonText width="40%" />
      </div>
    )
  }

  if (!anime) {
    return <div className="flex items-center justify-center h-full text-text-2">Anime not found.</div>
  }

  let relations: Relation[] = []
  let externalLinks: ExternalLink[] = []
  try { if (anime.relations) relations = JSON.parse(anime.relations) } catch { /* malformed JSON */ }
  try { if (anime.external_links) externalLinks = JSON.parse(anime.external_links) } catch { /* malformed JSON */ }
  const streamingLinks = externalLinks.filter(l => STREAMING_SITES.some(s => l.site.toLowerCase().includes(s.toLowerCase())))

  // Group relations by type
  const relationGroups = relations.reduce<Record<string, Relation[]>>((acc, r) => {
    ;(acc[r.type] ??= []).push(r)
    return acc
  }, {})

  const handleUpdate = async (partial: any) => {
    const prev = entry ? { ...entry } : null
    await updateEntry(partial)
    toast('Updated', {
      undo: prev ? () => updateEntry(prev) : undefined,
    })
  }

  const handleIncrement = async () => {
    if (!anime) return
    try {
      const next = (entry?.progress ?? 0) + 1
      const updates: any = { progress: next, last_watched_at: new Date().toISOString() }
      if (!entry?.my_status || entry.my_status === 'plan_to_watch') updates.my_status = 'watching'
      if (!entry?.started_at) updates.started_at = new Date().toISOString().split('T')[0]
      if (anime.episodes_total && next >= anime.episodes_total && anime.airing_status !== 'RELEASING') {
        updates.my_status = 'completed'
        updates.finished_at = new Date().toISOString().split('T')[0]
      }
      await updateEntry(updates)
      if (window.api) {
        await window.api.db.addWatchEvent({
          anime_id: anime.id,
          episode: next,
          source: 'manual',
          watched_at: new Date().toISOString(),
        })
      }
      refresh()
      toast(anime.episodes_total && next >= anime.episodes_total ? 'Completed!' : `Episode ${next}`)
    } catch { toast('Failed to update') }
  }

  /** Watched it elsewhere: set progress to exactly `ep` (marks earlier episodes too). */
  const setWatchedUpTo = async (ep: number) => {
    if (!anime) return
    const target = Math.max(0, ep)
    const day = new Date().toISOString().split('T')[0]
    const finished = !!anime.episodes_total && target >= anime.episodes_total
    const updates: any = { progress: target, last_watched_at: new Date().toISOString() }
    if (!entry?.started_at && target > 0) updates.started_at = day
    if (finished) { updates.my_status = 'completed'; updates.finished_at = day }
    else if (target > 0 && (!entry || entry.my_status === 'plan_to_watch' || entry.my_status === 'completed')) updates.my_status = 'watching'
    else if (target === 0 && !entry) updates.my_status = 'plan_to_watch'
    await updateEntry(updates)
    if (target > (entry?.progress ?? 0) && window.api)
      await window.api.db.addWatchEvent({ anime_id: anime.id, episode: target, source: 'manual', watched_at: new Date().toISOString() })
    refresh()
    toast(finished ? 'Completed!' : target === 0 ? 'Marked all episodes unwatched' : `Watched up to E${target}`)
    if (finished && entry?.my_status !== 'completed') announceCompleted(anime.id)
  }

  const handleMarkCompleted = async () => {
    await updateEntry({
      my_status: 'completed' as MyStatus,
      progress: anime.episodes_total ?? entry?.progress ?? 0,
      finished_at: new Date().toISOString().split('T')[0],
    })
    toast('Marked completed')
    announceCompleted(anime.id)
  }

  const handleDrop = async () => {
    await updateEntry({ my_status: 'dropped' as MyStatus })
    toast('Dropped')
  }

  const handleRemove = async () => {
    await deleteEntry()
    toast('Removed from library')
  }

  const handleStartRewatch = async () => {
    const newCount = (entry?.rewatch_count ?? 0) + 1
    await updateEntry({
      my_status: 'watching' as MyStatus,
      progress: 0,
      rewatch_count: newCount,
      started_at: new Date().toISOString().split('T')[0],
      finished_at: null,
    })
    toast(`Rewatch #${newCount} started`)
  }

  const synopsis = anime.synopsis ?? ''
  const isLongSynopsis = synopsis.length > 400

  const infoPairs = [
    ['Studio', anime.studio],
    ['Format', anime.format],
    ['Episodes', anime.episodes_total],
    ['Season', anime.season && anime.season_year ? `${anime.season} ${anime.season_year}` : null],
    ['Duration', anime.duration ? `${anime.duration} min/ep` : null],
    ['Score', anime.mean_score ? `${anime.mean_score}%` : null],
  ].filter(([, v]) => v != null) as [string, string | number][]

  const total = anime.episodes_total ?? 0
  const progress = entry?.progress ?? 0
  const watchedEps = new Set(events.map(ev => ev.episode))
  const nextEp = anime.episodes_total ? Math.min(progress + 1, anime.episodes_total) : progress + 1
  const paidLink = configuredServices.length > 0
    ? streamingLinks.find(l => configuredServices.some(sv => l.site.toLowerCase().includes(sv.toLowerCase())))
    : undefined
  // Paid service you subscribe to → open it in your browser; otherwise the in-app player.
  const playEp = (ep: number) => {
    if (paidLink) { window.open(paidLink.url, '_blank'); return }
    navigate(watchPath(anime, ep))
  }
  let genres: string[] = []
  try { genres = anime.genres ? (JSON.parse(anime.genres) as string[]) : [] } catch { genres = (anime.genres ?? '').split(',').map(g => g.trim()).filter(Boolean) }
  const primaryLabel = !entry || progress === 0 ? 'Start watching E1'
    : entry.my_status === 'completed' ? 'Watch again E1' : `Continue E${nextEp}`
  // Only list episodes that are actually out (and, for the dub, that are dubbed).
  const metaAired = airedFromMeta(epMeta)
  const scheduleAired = latestAired({ ...anime, entry: entry ?? undefined } as any, schedule, Date.now())
  const aired = anime.airing_status === 'NOT_YET_RELEASED' ? 0
    : anime.airing_status === 'RELEASING' ? Math.min(metaAired ?? Infinity, Number.isFinite(scheduleAired) ? scheduleAired : Infinity)
    : (total || metaAired || 0)
  const airedCount = Number.isFinite(aired) ? aired : (metaAired ?? total)
  const listed = audio === 'dub' && dubCount != null ? Math.min(airedCount, dubCount) : airedCount
  const nextAiring = [...epMeta.values()].filter(e => e.airAt && e.airAt > Date.now()).sort((a, b) => a.number - b.number)[0]
    ?? (() => { const r = schedule.filter(x => Date.parse(x.airing_at) > Date.now()).sort((a, b) => a.episode - b.episode)[0]; return r ? { number: r.episode, airAt: Date.parse(r.airing_at) } : undefined })()
  const pages = Math.ceil(listed / EP_PAGE)
  const epFrom = epPage * EP_PAGE + 1
  const epTo = Math.min(listed, epFrom + EP_PAGE - 1)

  const tabBtn = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)}
      className={`relative px-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${tab === id ? 'text-text-1' : 'text-text-3 hover:text-text-1'}
        after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full ${tab === id ? 'after:bg-accent' : 'after:bg-transparent'}`}>
      {label}
    </button>
  )

  return (
    <div className="pb-16">
      {/* Hero */}
      <div className="relative min-h-[520px] w-full">
        {/* Art is clipped on its own layer so menus in the hero can overflow it. */}
        <div className="absolute inset-0 overflow-hidden">
          {anime.banner_url ? (
            <img src={anime.banner_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : anime.cover_url ? (
            <img src={anime.cover_url} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-r from-bg-0 via-bg-0/85 to-bg-0/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg-0 via-transparent to-bg-0/50" />
        </div>

        <button onClick={() => (window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/')}
          className="absolute left-4 top-[72px] z-20 flex items-center gap-1.5 rounded-full bg-black/50 px-3 py-1.5 text-sm font-semibold text-white backdrop-blur hover:bg-black/70 lg:left-10"
          title="Back (Esc)">
          ← Back
        </button>
        <div className="relative flex gap-8 px-4 pb-10 pt-[116px] lg:px-10">
          <div className="hidden w-56 shrink-0 md:block">
            <div className="aspect-[2/3] overflow-hidden rounded-[6px] bg-bg-2 shadow-2xl ring-1 ring-white/10">
              {anime.cover_url
                ? <img src={anime.cover_url} alt={displayTitle(anime)} className="h-full w-full object-cover" />
                : <div className="flex h-full items-center justify-center p-3 text-sm text-text-3">{displayTitle(anime)}</div>}
            </div>
          </div>

          <div className="max-w-3xl flex-1 space-y-4">
            <h1 className="font-display text-4xl font-black leading-tight text-white drop-shadow-lg lg:text-5xl">{displayTitle(anime)}</h1>
            {(displayTitle(anime) !== anime.title || anime.title_jp) && (
              <p className="text-sm text-text-3">{[displayTitle(anime) !== anime.title ? anime.title : null, anime.title_jp].filter(Boolean).join(' · ')}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-2">
              {anime.mean_score && <span className="font-semibold text-text-1">★ {anime.mean_score}%</span>}
              {infoPairs.filter(([l]) => l !== 'Score').map(([label, value]) => (
                <span key={label}><span className="text-text-3">{label}</span> {value}</span>
              ))}
              {anime.airing_status && <span><span className="text-text-3">Status</span> {anime.airing_status === 'RELEASING' ? 'Airing' : anime.airing_status === 'FINISHED' ? 'Finished' : anime.airing_status === 'NOT_YET_RELEASED' ? 'Upcoming' : anime.airing_status}</span>}
              {dubOf(anime.mal_id, anime.airing_status) !== 'unknown' && (
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${dubOf(anime.mal_id, anime.airing_status) === 'complete' ? 'bg-status-completed/20 text-status-completed' : dubOf(anime.mal_id, anime.airing_status) === 'ongoing' ? 'bg-status-onhold/20 text-status-onhold' : 'bg-white/10 text-text-2'}`}>
                  {DUB_LABEL[dubOf(anime.mal_id, anime.airing_status)]}
                </span>
              )}
              {entry && <StatusBadge status={entry.my_status} />}
            </div>
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {genres.slice(0, 6).map(g => <span key={g} className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-text-2">{g}</span>)}
              </div>
            )}
            {synopsis && (
              <div>
                <p className={`text-sm leading-relaxed text-text-2 ${!synopsisExpanded && isLongSynopsis ? 'line-clamp-4' : ''}`}>
                  {stripHtml(synopsis)}
                </p>
                {isLongSynopsis && (
                  <button onClick={() => setSynopsisExpanded(!synopsisExpanded)} className="mt-1 text-xs font-semibold uppercase text-accent hover:text-accent-hover">
                    {synopsisExpanded ? 'Less details' : 'More details'}
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button onClick={() => playEp(entry?.my_status === 'completed' ? 1 : nextEp)}
                className="flex items-center gap-2 rounded-[4px] bg-accent px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-accent-hover">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
                {primaryLabel}{paidLink ? ` on ${paidLink.site}` : ''}
              </button>
              <button
                onClick={() => entry ? setTab('tracking') : handleUpdate({ my_status: 'plan_to_watch' as MyStatus })}
                title={entry ? 'In your lists' : 'Add to watchlist'}
                className={`flex h-12 w-12 items-center justify-center rounded-[4px] border-2 ${entry ? 'border-accent text-accent' : 'border-accent/70 text-accent hover:bg-accent/10'}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={entry ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>
              </button>
              <div className="relative">
                <button onClick={() => setActionsOpen(v => !v)} title="More actions"
                  className="flex h-12 w-12 items-center justify-center rounded-[4px] border-2 border-border text-xl font-bold text-text-2 hover:text-text-1">⋯</button>
                {actionsOpen && (
                  <div className="absolute left-0 top-14 z-40 w-56 rounded-card border border-border bg-bg-1 p-1 shadow-2xl" onMouseLeave={() => setActionsOpen(false)}>
                    {entry?.my_status !== 'completed' && (
                      <button onClick={() => { setActionsOpen(false); handleMarkCompleted() }} className="w-full rounded px-3 py-2 text-left text-sm text-status-completed hover:bg-bg-2">✓ Mark completed</button>
                    )}
                    {entry?.my_status !== 'on_hold' && (
                      <button onClick={() => { setActionsOpen(false); handleUpdate({ my_status: 'on_hold' as MyStatus }) }} className="w-full rounded px-3 py-2 text-left text-sm text-status-onhold hover:bg-bg-2">⏸ Put on hold</button>
                    )}
                    {entry?.my_status !== 'dropped' && (
                      <button onClick={() => { setActionsOpen(false); handleDrop() }} className="w-full rounded px-3 py-2 text-left text-sm text-status-dropped hover:bg-bg-2">✕ Drop</button>
                    )}
                    {entry?.my_status === 'completed' && (
                      <button onClick={() => { setActionsOpen(false); handleStartRewatch() }} className="w-full rounded px-3 py-2 text-left text-sm text-accent hover:bg-bg-2">↻ Start rewatch</button>
                    )}
                    <button onClick={() => { setActionsOpen(false); setTab('order') }} className="w-full rounded px-3 py-2 text-left text-sm text-text-2 hover:bg-bg-2">☰ Whole series: complete / drop…</button>
                    {entry && (
                      <button onClick={() => { setActionsOpen(false); handleRemove() }} className="w-full rounded border-t border-border px-3 py-2 text-left text-sm text-text-3 hover:bg-bg-2 hover:text-red-400">Remove from my lists</button>
                    )}
                  </div>
                )}
              </div>
              <select value={entry?.my_status ?? ''} onChange={e => handleUpdate({ my_status: e.target.value as MyStatus })}
                className="h-12 rounded-[4px] border-2 border-border bg-bg-0/60 px-3 text-sm font-semibold text-text-1 backdrop-blur">
                <option value="">+ Add to list</option>
                {STATUSES.map(st => <option key={st.value} value={st.value}>{st.label}</option>)}
              </select>
              {entry?.my_status !== 'completed' && anime.airing_status !== 'RELEASING' && anime.airing_status !== 'NOT_YET_RELEASED' && (
                <button onClick={handleMarkCompleted} title="Watched it elsewhere? Marks every episode watched and the show Completed"
                  className="flex h-12 items-center gap-2 rounded-[4px] border-2 border-status-completed/60 px-4 text-sm font-bold uppercase tracking-wide text-status-completed hover:bg-status-completed/10">
                  ✓ Mark completed
                </button>
              )}
              {entry?.my_status === 'completed' && (
                <span className="flex h-12 items-center gap-2 rounded-[4px] bg-status-completed/15 px-4 text-sm font-bold uppercase tracking-wide text-status-completed">
                  ✓ Completed{entry.finished_at ? ` · ${entry.finished_at}` : ''}
                </span>
              )}
              {entry && total > 0 && entry.my_status !== 'completed' && (
                <span className="font-mono text-sm text-text-3">{progress}/{total} watched</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-[60px] z-30 border-b border-border bg-bg-0/95 px-4 backdrop-blur lg:px-10">
        <div className="flex gap-8">
          {tabBtn('episodes', listed && total && listed < total ? `Episodes (${listed} of ${total})` : listed ? `Episodes (${listed})` : 'Episodes')}
          {anime.anilist_id ? tabBtn('order', 'Watch Order') : null}
          {tabBtn('tracking', 'Your Tracking')}
          {tabBtn('more', 'More')}
        </div>
      </div>

      <div className="space-y-8 px-4 pt-6 lg:px-10">
        {tab === 'order' && anime.anilist_id && <WatchOrder anilistId={anime.anilist_id} />}

        {tab === 'episodes' && (
          listed > 0 ? (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                {pages > 1 && (
                  <select value={epPage} onChange={e => setEpPage(Number(e.target.value))}
                    className="rounded-[4px] border border-border bg-bg-1 px-3 py-2 text-sm font-semibold text-text-1">
                    {Array.from({ length: pages }, (_, i) => (
                      <option key={i} value={i}>Episodes {i * EP_PAGE + 1}–{Math.min(listed, (i + 1) * EP_PAGE)}</option>
                    ))}
                  </select>
                )}
                {!paidLink && (
                  <div className="flex items-center gap-2">
                    <AudioToggle value={audio} onChange={setAudio} />
                    <span className="text-xs text-text-3">
                      {audio === 'dub' ? 'English dub' : 'Japanese with subtitles'} · all episodes
                      {audio === 'dub' && dubCount != null && dubCount < airedCount && <span className="text-status-onhold"> · {dubCount} of {airedCount} aired episodes dubbed so far</span>}
                      {audio === 'dub' && dubOf(anime.mal_id, anime.airing_status) === 'none' && <span className="text-status-onhold"> · no English dub is listed for this show — the sub will play</span>}
                      {audio === 'dub' && dubOf(anime.mal_id, anime.airing_status) === 'ongoing' && <span className="text-status-onhold"> · dub still in progress — newer episodes may play subbed</span>}
                    </span>
                  </div>
                )}
                {paidLink && <span className="text-xs text-text-3">Episodes open on {paidLink.site} (Settings → Streaming Services)</span>}
                <div className="flex-1" />
                {nextAiring?.airAt && (
                  <span className="text-xs text-text-3">E{nextAiring.number} airs {new Date(nextAiring.airAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
                )}
                {entry && <div className="w-56"><ProgressBar current={progress} total={anime.episodes_total} accentColor={anime.cover_accent ?? undefined} onIncrement={handleIncrement} /></div>}
              </div>
              <div className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {Array.from({ length: epTo - epFrom + 1 }, (_, i) => {
                  const ep = epFrom + i
                  const meta = epMeta.get(ep)
                  const watched = ep <= progress || watchedEps.has(ep)
                  return (
                    <EpisodeCard key={ep} episode={ep} episodeTitle={meta?.title}
                      thumbnail={meta?.thumbnail} fallback={anime.banner_url ?? anime.cover_url}
                      watched={watched}
                      onToggleWatched={() => setWatchedUpTo(watched ? ep - 1 : ep)}
                      badge={ep === nextEp && entry && !watched ? <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Up next</span> : undefined}
                      onClick={() => playEp(ep)} />
                  )
                })}
              </div>
            </section>
          ) : (
            <div className="space-y-3 py-6">
              <p className="text-sm text-text-3">
                {anime.airing_status === 'NOT_YET_RELEASED' || airedCount === 0
                  ? `No episodes have aired yet${nextAiring?.airAt ? ` — E${nextAiring.number} airs ${new Date(nextAiring.airAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}.`
                  : audio === 'dub' && dubCount === 0 ? 'No dubbed episodes are out yet — switch to Sub to watch now.'
                  : "Episode count isn't known yet for this show."}
              </p>
              <button onClick={() => playEp(nextEp)} className="rounded-[4px] bg-accent px-5 py-2.5 text-sm font-bold uppercase text-white hover:bg-accent-hover">
                Play episode {nextEp}
              </button>
            </div>
          )
        )}

        {tab === 'tracking' && (
          <>
        {/* Your tracking */}
        <section className="rounded-card border border-border bg-bg-1 p-5 space-y-4">
          <h2 className="font-display text-base font-semibold text-text-1">Your Tracking</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {/* Status */}
            <div>
              <label className="block text-xs text-text-3 mb-1">Status</label>
              <select
                value={entry?.my_status ?? ''}
                onChange={e => handleUpdate({ my_status: e.target.value as MyStatus })}
                className="w-full rounded-card border border-border bg-bg-0 px-2 py-1.5 text-sm text-text-1"
              >
                <option value="">Not in library</option>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            {/* Score */}
            <div>
              <label className="block text-xs text-text-3 mb-1">Score</label>
              <input
                type="number"
                min="1"
                max="10"
                value={entry?.my_score ?? ''}
                onChange={e => handleUpdate({ my_score: e.target.value ? Number(e.target.value) : null })}
                className="w-full rounded-card border border-border bg-bg-0 px-2 py-1.5 text-sm text-text-1"
                placeholder="-"
              />
            </div>
            {/* Started */}
            <div>
              <label className="block text-xs text-text-3 mb-1">Started</label>
              <input
                type="date"
                value={entry?.started_at ?? ''}
                onChange={e => handleUpdate({ started_at: e.target.value || null })}
                className="w-full rounded-card border border-border bg-bg-0 px-2 py-1.5 text-sm text-text-1"
              />
            </div>
            {/* Finished */}
            <div>
              <label className="block text-xs text-text-3 mb-1">Finished</label>
              <input
                type="date"
                value={entry?.finished_at ?? ''}
                onChange={e => handleUpdate({ finished_at: e.target.value || null })}
                className="w-full rounded-card border border-border bg-bg-0 px-2 py-1.5 text-sm text-text-1"
              />
            </div>
          </div>

          {/* Progress */}
          <div>
            <label className="block text-xs text-text-3 mb-1">Progress</label>
            <div className="flex items-center gap-3">
              <div className="w-48">
                <ProgressBar
                  current={entry?.progress ?? 0}
                  total={anime.episodes_total}
                  accentColor={anime.cover_accent ?? undefined}
                  onIncrement={handleIncrement}
                />
              </div>
              <input
                type="number"
                min="0"
                max={anime.episodes_total ?? 9999}
                value={localProgress}
                onChange={e => debouncedProgressUpdate(Number(e.target.value))}
                className="w-16 rounded-card border border-border bg-bg-0 px-2 py-1 text-sm text-text-1 font-mono"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs text-text-3 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {(entry?.custom_tags ? entry.custom_tags.split(',').filter(Boolean) : []).map(tag => (
                <span key={tag} className="flex items-center gap-1 rounded-full bg-bg-2 px-2 py-0.5 text-xs text-text-2">
                  {tag.trim()}
                  <button
                    onClick={() => {
                      const tags = (entry?.custom_tags ?? '').split(',').filter(t => t.trim() && t.trim() !== tag.trim())
                      handleUpdate({ custom_tags: tags.length ? tags.join(',') : null })
                    }}
                    className="text-text-3 hover:text-text-1"
                  >&times;</button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Add tag and press Enter..."
              className="w-full rounded-card border border-border bg-bg-0 px-2 py-1 text-sm text-text-1"
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const val = (e.target as HTMLInputElement).value.trim()
                  if (!val) return
                  const existing = (entry?.custom_tags ?? '').split(',').filter(Boolean).map(t => t.trim())
                  if (existing.includes(val)) return
                  handleUpdate({ custom_tags: [...existing, val].join(',') })
                  ;(e.target as HTMLInputElement).value = ''
                }
              }}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-text-3 mb-1">Notes</label>
            <textarea
              value={localNotes}
              onChange={e => debouncedNotesUpdate(e.target.value)}
              rows={2}
              className="w-full rounded-card border border-border bg-bg-0 px-3 py-2 text-sm text-text-1 resize-none"
              placeholder="Add notes..."
            />
          </div>

          {/* Rewatch count */}
          {entry && entry.rewatch_count > 0 && (
            <p className="text-xs text-text-3">
              Rewatched {entry.rewatch_count} time{entry.rewatch_count > 1 ? 's' : ''}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            {anime.airing_status !== 'RELEASING' && (
              <button
                onClick={handleMarkCompleted}
                className="rounded-card bg-status-completed/20 px-3 py-1.5 text-sm text-status-completed hover:bg-status-completed/30"
              >Mark completed</button>
            )}
            <button
              onClick={handleDrop}
              className="rounded-card bg-status-dropped/20 px-3 py-1.5 text-sm text-status-dropped hover:bg-status-dropped/30"
            >Drop</button>
            {entry?.my_status === 'completed' && (
              <button
                onClick={handleStartRewatch}
                className="rounded-card bg-accent/20 px-3 py-1.5 text-sm text-accent hover:bg-accent/30"
              >Start rewatch</button>
            )}
            {entry && (
              <button
                onClick={handleRemove}
                className="rounded-card border border-border px-3 py-1.5 text-sm text-text-3 hover:text-red-400 hover:border-red-400/50 ml-auto"
              >Remove from library</button>
            )}
          </div>
        </section>

          </>
        )}

        {tab === 'more' && (
          <>
            {streamingLinks.length > 0 && (
              <section>
                <h2 className="mb-3 font-display text-lg font-bold text-text-1">Official streams</h2>
                <div className="flex flex-wrap gap-2">
                  {streamingLinks.map((link, i) => {
                    const mine = configuredServices.some(sv => link.site.toLowerCase().includes(sv.toLowerCase()))
                    return (
                      <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                        className={`rounded-[4px] border px-3 py-1.5 text-sm transition-colors ${mine ? 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20' : 'border-border bg-bg-1 text-text-2 hover:bg-bg-2'}`}>
                        {link.site}
                      </a>
                    )
                  })}
                </div>
              </section>
            )}
        {/* Relations */}
        {Object.keys(relationGroups).length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-base font-semibold text-text-1">Relations</h2>
            {Object.entries(relationGroups).map(([type, rels]) => (
              <div key={type} className="mb-4">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-3">{type.replace(/_/g, ' ')}</h3>
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {rels.map(rel => (
                    <button
                      key={rel.id}
                      onClick={() => navigate(`/anime/${rel.id}`)}
                      className="shrink-0 w-28 text-left group"
                    >
                      <div className="aspect-[2/3] overflow-hidden rounded-card bg-bg-2">
                        {rel.cover ? (
                          <img src={rel.cover} alt={rel.title} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-text-3 p-2">{rel.title}</div>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-text-1 line-clamp-2">{rel.title}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Watch history */}
        {events.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-base font-semibold text-text-1">Watch History</h2>
            <div className="space-y-1">
              {events.map(ev => (
                <div key={ev.id} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm">
                  <span className="font-mono text-text-1">Ep {ev.episode}</span>
                  <span className="text-text-3">{new Date(ev.watched_at).toLocaleDateString()}</span>
                  <span className="rounded bg-bg-2 px-1.5 py-0.5 text-xs text-text-3">{ev.source}</span>
                </div>
              ))}
            </div>
          </section>
        )}
          </>
        )}
      </div>
    </div>
  )
}

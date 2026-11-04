import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAnimeDetail } from '@/hooks/useAnimeDetail'
import { useToast } from '@/hooks/useToast'
import ProgressBar from '@/components/ProgressBar'
import StatusBadge from '@/components/StatusBadge'
import { SkeletonText } from '@/components/Skeleton'
import type { MyStatus } from '@/types'

const STREAMING_SITES = ['Crunchyroll', 'Funimation', 'Netflix', 'Hulu', 'Amazon', 'Disney Plus', 'HIDIVE', 'VRV', 'Bilibili', 'iQIYI', 'Wakanim', 'AnimeLab']
const STATUSES: { value: MyStatus; label: string }[] = [
  { value: 'watching', label: 'Watching' },
  { value: 'completed', label: 'Completed' },
  { value: 'plan_to_watch', label: 'Plan to Watch' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'dropped', label: 'Dropped' },
]

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
  const [epCollapsed, setEpCollapsed] = useState(true)
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
    window.api?.stream.prefetch(anime.title).catch(() => {})
    return () => { window.api?.stream.cancelPrefetch(anime.title).catch(() => {}) }
  }, [anime?.title])

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

  const handleMarkCompleted = async () => {
    await updateEntry({
      my_status: 'completed' as MyStatus,
      progress: anime.episodes_total ?? entry?.progress ?? 0,
      finished_at: new Date().toISOString().split('T')[0],
    })
    toast('Marked completed')
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

  return (
    <div className="pb-12">
      {/* Banner */}
      <div
        className="relative h-36 md:h-48"
        style={{
          background: anime.banner_url
            ? `url(${anime.banner_url}) center/cover`
            : anime.cover_accent ?? 'var(--color-bg-2, #1a1a2e)',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-bg-0" />
        <button
          onClick={() => navigate(-1)}
          className="absolute top-3 left-3 z-20 rounded-card bg-black/50 px-2.5 py-1 text-sm text-white hover:bg-black/70 backdrop-blur-sm"
        >&larr; Back</button>
      </div>

      {/* Main info */}
      <div className="relative px-6 -mt-20 flex gap-6">
        {/* Cover */}
        <div className="shrink-0 w-36 md:w-44">
          <div className="aspect-[2/3] overflow-hidden rounded-card bg-bg-2 shadow-lg">
            {anime.cover_url ? (
              <img src={anime.cover_url} alt={anime.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center p-3 text-sm text-text-3">{anime.title}</div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 pt-20 space-y-3">
          <h1 className="font-display text-2xl font-bold text-text-1">{anime.title}</h1>
          {anime.title_jp && <p className="text-sm text-text-3">{anime.title_jp}</p>}

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {infoPairs.map(([label, value]) => (
              <span key={label} className="text-sm">
                <span className="text-text-3">{label}:</span>{' '}
                <span className="text-text-2">{value}</span>
              </span>
            ))}
          </div>

          {/* Synopsis */}
          {synopsis && (
            <div>
              <p
                className={`text-sm text-text-2 leading-relaxed ${!synopsisExpanded && isLongSynopsis ? 'line-clamp-4' : ''}`}
                dangerouslySetInnerHTML={{ __html: synopsis.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/on\w+\s*=/gi, '') }}
              />
              {isLongSynopsis && (
                <button
                  onClick={() => setSynopsisExpanded(!synopsisExpanded)}
                  className="mt-1 text-xs text-accent hover:text-accent-hover"
                >{synopsisExpanded ? 'Show less' : 'Show more'}</button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 px-6 space-y-8">
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

        {/* Where to watch */}
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-text-1">Where to Watch</h2>
          <div className="flex flex-wrap gap-2">
            {/* Configured paid service links */}
            {configuredServices.length > 0 && streamingLinks
              .filter(l => configuredServices.some(s => l.site.toLowerCase().includes(s.toLowerCase())))
              .map((link, i) => (
                <a key={`c-${i}`} href={link.url} target="_blank" rel="noopener noreferrer"
                  className="rounded-card border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm text-accent hover:bg-accent/20 transition-colors"
                >{link.site}</a>
              ))}
            {/* Other known streaming links */}
            {streamingLinks
              .filter(l => !configuredServices.some(s => l.site.toLowerCase().includes(s.toLowerCase())))
              .map((link, i) => (
                <a key={`o-${i}`} href={link.url} target="_blank" rel="noopener noreferrer"
                  className="rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-2 hover:bg-bg-2 transition-colors"
                >{link.site}</a>
              ))}
            {/* Watch in-app — opens player at episode 1 or next unwatched */}
            <button
              onClick={() => {
                const nextEp = (entry?.progress ?? 0) + 1
                const params = new URLSearchParams({ title: anime.title })
                if (anime.title_en) params.set('titleEn', anime.title_en)
                if (anime.mal_id) params.set('malId', String(anime.mal_id))
                if (anime.episodes_total) params.set('total', String(anime.episodes_total))
                navigate(`/watch/${anime.id}/${nextEp}?${params}`)
              }}
              className="rounded-card border border-border bg-bg-1 px-3 py-1.5 text-sm text-text-3 hover:bg-bg-2 hover:text-text-1 transition-colors"
            >Watch in app</button>
          </div>
        </section>

        {/* Episodes */}
        {anime.episodes_total && anime.episodes_total > 0 && (() => {
          const watchedEps = new Set(events.map(ev => ev.episode))
          const progress = entry?.progress ?? 0
          const total = anime.episodes_total!
          const showAll = !epCollapsed || total <= 50
          const displayed = showAll ? total : Math.min(total, 50)

          // Navigate to in-app player, or open paid service in browser
          const handleEpClick = (e: React.MouseEvent, ep: number) => {
            e.preventDefault()

            // Check configured paid services first — open in browser
            if (configuredServices.length > 0) {
              const match = streamingLinks.find(l =>
                configuredServices.some(s => l.site.toLowerCase().includes(s.toLowerCase()))
              )
              if (match) {
                window.open(match.url, '_blank')
                return
              }
            }

            // Navigate to in-app player
            const params = new URLSearchParams({ title: anime.title })
            if (anime.title_en) params.set('titleEn', anime.title_en)
            if (anime.mal_id) params.set('malId', String(anime.mal_id))
            if (total) params.set('total', String(total))
            navigate(`/watch/${anime.id}/${ep}?${params}`)
          }

          return (
            <section>
              <h2 className="mb-3 font-display text-base font-semibold text-text-1">
                Episodes <span className="text-text-3 font-normal text-sm">({total})</span>
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: displayed }, (_, i) => {
                  const ep = i + 1
                  const watched = ep <= progress || watchedEps.has(ep)
                  return (
                    <button
                      key={ep}
                      onClick={(e) => handleEpClick(e, ep)}
                      title={`Episode ${ep}${watched ? ' (watched)' : ''} — click to stream`}
                      className={`flex items-center justify-center h-8 w-8 rounded text-xs font-mono transition-colors cursor-pointer ${
                        watched
                          ? 'bg-accent/30 text-accent hover:bg-accent/50'
                          : 'bg-bg-2 text-text-3 hover:bg-bg-0 hover:text-text-1'
                      }`}
                    >{ep}</button>
                  )
                })}
              </div>
              {total > 50 && (
                <button
                  onClick={() => setEpCollapsed(!epCollapsed)}
                  className="mt-2 text-xs text-accent hover:text-accent-hover"
                >{epCollapsed ? `Show all ${total} episodes` : 'Show less'}</button>
              )}
            </section>
          )
        })()}

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
      </div>
    </div>
  )
}

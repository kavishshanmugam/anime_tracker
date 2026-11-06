import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import { getFranchise, type FranchiseEntry } from '@/lib/franchise'
import { getAnimeById } from '@/lib/anilist'
import { ensureLocal } from '@/lib/watch'
import StatusBadge from './StatusBadge'
import type { LibraryEntry } from '@/types'

const KIND_LABEL: Record<FranchiseEntry['kind'], string> = { main: 'Main series', movie: 'Movie', side: 'Side story', spinoff: 'Spin-off' }
const FORMAT: Record<string, string> = { TV: 'TV', TV_SHORT: 'TV short', MOVIE: 'Movie', SPECIAL: 'Special', OVA: 'OVA', ONA: 'ONA', MUSIC: 'Music' }

/** Franchise in release order, with bulk "complete / drop / watchlist" for the whole series. */
export default function WatchOrder({ anilistId }: { anilistId: number }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { entries, refresh } = useLibrary()
  const [list, setList] = useState<FranchiseEntry[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'complete' | 'drop' | 'plan' | null>(null)

  useEffect(() => {
    setList(null)
    getFranchise(anilistId).then(l => {
      setList(l)
      setChecked(new Set(l.filter(e => e.kind === 'main' || e.kind === 'movie').map(e => e.id)))
    }).catch(() => setList([]))
  }, [anilistId])

  const mine = useMemo(() => new Map(entries.filter(e => e.anilist_id).map(e => [e.anilist_id!, e])), [entries])

  if (!list) return <p className="py-6 text-sm text-text-3">Working out the watch order…</p>
  if (list.length <= 1) return <p className="py-6 text-sm text-text-3">This show has no sequels, prequels or related entries.</p>

  const selected = list.filter(e => checked.has(e.id))
  const toggle = (id: number) => setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const run = async (action: 'complete' | 'drop' | 'plan') => {
    setConfirm(null)
    setBusy(action)
    const today = new Date().toISOString().split('T')[0]
    let done = 0, skipped = 0
    for (const f of selected) {
      try {
        const existing = mine.get(f.id)
        if (action === 'complete' && f.status !== 'FINISHED') { skipped++; continue } // can't complete what hasn't finished airing
        if (action === 'drop' && !existing) { skipped++; continue }                  // only drop things you were tracking
        if (action === 'plan' && existing) { skipped++; continue }
        const animeId = existing?.id ?? await ensureLocal(await getAnimeById(f.id))
        const update: Partial<LibraryEntry> = action === 'complete'
          ? { my_status: 'completed', progress: f.episodes ?? existing?.entry?.progress ?? 0, finished_at: existing?.entry?.finished_at ?? today, started_at: existing?.entry?.started_at ?? today }
          : action === 'drop' ? { my_status: 'dropped' } : { my_status: 'plan_to_watch', progress: 0 }
        await window.api.db.upsertLibraryEntry({ anime_id: animeId, source: 'franchise', ...update })
        done++
      } catch { skipped++ }
    }
    await refresh()
    setBusy(null)
    const verb = action === 'complete' ? 'marked completed' : action === 'drop' ? 'dropped' : 'added to your watchlist'
    toast(`${done} ${done === 1 ? 'entry' : 'entries'} ${verb}${skipped ? ` · ${skipped} skipped` : ''}`)
  }

  const btn = 'rounded-[4px] border px-3 py-1.5 text-xs font-bold uppercase tracking-wide disabled:opacity-40'
  let n = 0

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-text-3">Release order · tick what to include, then apply to the whole series</p>
        {confirm ? (
          <>
            <span className="text-sm text-text-2">
              {confirm === 'complete' ? `Mark ${selected.length} as completed?` : confirm === 'drop' ? `Drop ${selected.length}?` : `Add ${selected.length} to watchlist?`}
            </span>
            <button onClick={() => run(confirm)} className={`${btn} border-accent bg-accent text-white`}>Yes</button>
            <button onClick={() => setConfirm(null)} className={`${btn} border-border text-text-3`}>Cancel</button>
          </>
        ) : (
          <>
            <button disabled={!selected.length || !!busy} onClick={() => setConfirm('complete')} className={`${btn} border-status-completed/60 text-status-completed hover:bg-status-completed/10`}>
              {busy === 'complete' ? 'Working…' : '✓ Mark ticked completed'}
            </button>
            <button disabled={!selected.length || !!busy} onClick={() => setConfirm('drop')} className={`${btn} border-status-dropped/60 text-status-dropped hover:bg-status-dropped/10`}>
              {busy === 'drop' ? 'Working…' : 'Drop ticked'}
            </button>
            <button disabled={!selected.length || !!busy} onClick={() => setConfirm('plan')} className={`${btn} border-border text-text-2 hover:bg-bg-1`}>
              {busy === 'plan' ? 'Working…' : '+ Add ticked to watchlist'}
            </button>
          </>
        )}
      </div>

      <ol className="space-y-1.5">
        {list.map(f => {
          const local = mine.get(f.id)
          const current = f.id === anilistId
          const numbered = f.kind === 'main' || f.kind === 'movie'
          if (numbered) n++
          return (
            <li key={f.id}
              className={`flex items-center gap-3 rounded-card border p-2 ${current ? 'border-accent/60 bg-accent/5' : 'border-border bg-bg-1'} ${f.kind === 'side' || f.kind === 'spinoff' ? 'ml-6' : ''}`}>
              <input type="checkbox" checked={checked.has(f.id)} onChange={() => toggle(f.id)} className="ml-1" />
              <span className="w-6 text-center font-mono text-sm font-bold text-text-3">{numbered ? n : '·'}</span>
              <button onClick={() => navigate(`/anime/${local?.id ?? f.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <div className="h-16 w-11 shrink-0 overflow-hidden rounded-[4px] bg-bg-2">
                  {f.cover && <img src={f.cover} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0">
                  <p className={`truncate text-sm font-semibold ${current ? 'text-accent' : 'text-text-1 hover:text-accent'}`}>{f.title}</p>
                  <p className="text-xs text-text-3">
                    {[KIND_LABEL[f.kind], FORMAT[f.format ?? ''] ?? f.format, f.episodes ? `${f.episodes} ep${f.episodes === 1 ? '' : 's'}` : null, f.year,
                      f.status === 'RELEASING' ? 'Airing' : f.status === 'NOT_YET_RELEASED' ? 'Upcoming' : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
              {current && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">You are here</span>}
              {local?.entry && <StatusBadge status={local.entry.my_status} />}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

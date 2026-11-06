import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SkeletonText } from '@/components/Skeleton'
import { syncAiringSchedules } from '@/lib/sync'
import type { Anime, AiringScheduleItem } from '@/types'
import { displayTitle } from '@/lib/title'

type AiringEntry = AiringScheduleItem & { anime: Anime }
type View = 'week' | 'month'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)) // Monday-based
  d.setHours(0, 0, 0, 0)
  return d
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, o)
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function readView(): View {
  try { return localStorage.getItem('calendar_view') === 'week' ? 'week' : 'month' } catch { return 'month' }
}

export default function Calendar() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>(readView)
  const [anchor, setAnchor] = useState(() => new Date())
  const [items, setItems] = useState<AiringEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const syncedOnce = useRef(false)
  const today = new Date()

  useEffect(() => { try { localStorage.setItem('calendar_view', view) } catch { /* */ } }, [view])

  // Visible range: a week, or the Monday-aligned 6-week grid around the month.
  const { start, days } = useMemo(() => {
    const s = view === 'week' ? startOfWeek(anchor) : startOfWeek(startOfMonth(anchor))
    const n = view === 'week' ? 7 : 42
    return { start: s, days: Array.from({ length: n }, (_, i) => addDays(s, i)) }
  }, [view, anchor])
  const end = days[days.length - 1]

  const fetchSchedule = useCallback(() => {
    if (!window.api) { setLoading(false); return }
    setLoading(true)
    window.api.db.getAiringSchedule(start.toISOString(), addDays(end, 1).toISOString())
      .then(r => setItems(r as AiringEntry[]))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [start, end])

  useEffect(() => {
    if (syncedOnce.current) { fetchSchedule(); return }
    syncedOnce.current = true
    setSyncing(true)
    syncAiringSchedules().finally(() => { fetchSchedule(); setSyncing(false) })
  }, [fetchSchedule])

  const byDay = useMemo(() => {
    const m = new Map<string, AiringEntry[]>()
    for (const it of items) {
      const d = new Date(it.airing_at)
      const k = d.toDateString()
      ;(m.get(k) ?? m.set(k, []).get(k)!).push(it)
    }
    for (const list of m.values()) list.sort((a, b) => a.airing_at.localeCompare(b.airing_at))
    return m
  }, [items])

  const step = (dir: 1 | -1) => setAnchor(a => view === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1))
  const title = view === 'week'
    ? `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : fmt(anchor, { month: 'long', year: 'numeric' })
  const btn = 'rounded-card border border-border px-3 py-1 text-sm text-text-2 hover:bg-bg-1'
  const todayItems = byDay.get(today.toDateString()) ?? []

  const entryButton = (it: AiringEntry, compact: boolean) => (
    <button key={`${it.anime_id}-${it.episode}`} onClick={() => navigate(`/anime/${it.anime_id}`)}
      className="flex w-full items-center gap-1.5 rounded bg-bg-2 p-1 text-left transition-colors hover:bg-bg-0"
      title={`${displayTitle(it.anime)} — E${it.episode} at ${time(it.airing_at)}`}>
      {!compact && it.anime.cover_url && <img src={it.anime.cover_url} alt="" className="h-8 w-6 shrink-0 rounded object-cover" />}
      <div className="min-w-0 flex-1">
        <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} truncate font-medium text-text-1`}>{displayTitle(it.anime)}</p>
        <p className="text-[10px] text-text-3">E{it.episode} · {time(it.airing_at)}</p>
      </div>
    </button>
  )

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-black text-text-1">Calendar</h1>
        <span className="text-sm text-text-3">{title}</span>
        <div className="ml-auto flex items-center gap-1">
          <div className="mr-2 flex overflow-hidden rounded-[4px] border border-border">
            {(['week', 'month'] as const).map(v => (
              <button key={v} onClick={() => { setView(v); setExpanded(null) }}
                className={`px-3 py-1 text-sm font-semibold capitalize ${view === v ? 'bg-accent text-white' : 'bg-bg-0 text-text-3 hover:text-text-1'}`}>{v}</button>
            ))}
          </div>
          <button onClick={() => step(-1)} className={btn}>&larr;</button>
          <button onClick={() => setAnchor(new Date())} className={btn}>Today</button>
          <button onClick={() => step(1)} className={btn}>&rarr;</button>
          <button onClick={() => { setSyncing(true); syncAiringSchedules().finally(() => { fetchSchedule(); setSyncing(false) }) }}
            disabled={syncing} className={`${btn} disabled:opacity-50`}>{syncing ? 'Syncing…' : 'Sync'}</button>
        </div>
      </div>

      {!loading && items.length === 0 && (
        <p className="mb-3 text-xs text-text-3">
          Nothing airing in this {view} from your lists. The calendar shows episodes of shows you're watching or planning to watch that are still airing.
        </p>
      )}

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {DAY_NAMES.map(d => <div key={d} className="pb-1 text-xs font-semibold uppercase tracking-wide text-text-3">{d}</div>)}
      </div>

      {loading ? (
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: view === 'week' ? 7 : 35 }, (_, i) => <div key={i} className="p-2"><SkeletonText height={view === 'week' ? '8rem' : '4rem'} /></div>)}
        </div>
      ) : (
        <div className={`grid grid-cols-7 gap-1.5 ${view === 'week' ? 'min-h-[60vh]' : ''}`}>
          {days.map(d => {
            const k = d.toDateString()
            const list = byDay.get(k) ?? []
            const isToday = isSameDay(d, today)
            const outside = view === 'month' && d.getMonth() !== anchor.getMonth()
            const max = view === 'week' || expanded === k ? list.length : 3
            return (
              <div key={k}
                className={`flex flex-col rounded-card border p-1.5 ${view === 'month' ? 'min-h-[110px]' : ''} ${
                  isToday ? 'border-accent bg-accent/5' : 'border-border bg-bg-1'} ${outside ? 'opacity-40' : ''}`}>
                <p className={`mb-1 text-right text-xs ${isToday ? 'font-bold text-accent' : 'text-text-3'}`}>
                  {view === 'week' ? fmt(d, { day: 'numeric', month: 'short' }) : d.getDate()}
                </p>
                <div className="space-y-1">
                  {list.slice(0, max).map(it => entryButton(it, view === 'month'))}
                  {list.length > max && (
                    <button onClick={() => setExpanded(k)} className="w-full text-left text-[10px] font-semibold text-accent hover:underline">+{list.length - max} more</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {todayItems.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 font-display text-lg font-bold text-text-1">Airing Today</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {todayItems.map(it => (
              <button key={`t-${it.anime_id}-${it.episode}`} onClick={() => navigate(`/anime/${it.anime_id}`)}
                className="flex shrink-0 items-center gap-3 rounded-card border border-border bg-bg-1 p-3 transition-colors hover:bg-bg-2">
                {it.anime.cover_url && <img src={it.anime.cover_url} alt="" className="h-14 w-10 rounded object-cover" />}
                <div className="text-left">
                  <p className="text-sm font-medium text-text-1">{displayTitle(it.anime)}</p>
                  <p className="text-xs text-text-3">Episode {it.episode} · {time(it.airing_at)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

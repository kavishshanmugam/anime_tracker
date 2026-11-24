import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SkeletonText } from '@/components/Skeleton'
import { syncAiringSchedules } from '@/lib/sync'
import type { Anime, AiringScheduleItem } from '@/types'
import { displayTitle } from '@/lib/title'
import { getPopularAiring, type PopularAiring } from '@/lib/anilist'

type AiringEntry = AiringScheduleItem & { anime: Anime }
type View = 'week' | 'month'
/** One episode in a day cell — from your lists, or a popular show that's airing. */
interface DayItem { key: string; title: string; cover: string | null; episode: number; at: string; mine: boolean; to: string }

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
  const [popular, setPopular] = useState<PopularAiring[]>([])
  const [showPopular, setShowPopularState] = useState(() => { try { return localStorage.getItem('calendar_popular') !== 'off' } catch { return true } })
  const setShowPopular = (on: boolean) => { setShowPopularState(on); try { localStorage.setItem('calendar_popular', on ? 'on' : 'off') } catch { /* */ } }
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

  // Popular shows airing in the visible range (so the calendar is useful even when nothing of yours is airing).
  useEffect(() => {
    if (!showPopular) return
    let cancelled = false
    getPopularAiring(start, addDays(end, 1)).then(p => { if (!cancelled) setPopular(p) }).catch(() => { /* offline: your shows only */ })
    return () => { cancelled = true }
  }, [showPopular, start, end])

  const byDay = useMemo(() => {
    const m = new Map<string, DayItem[]>()
    const add = (it: DayItem) => { const k = new Date(it.at).toDateString(); (m.get(k) ?? m.set(k, []).get(k)!).push(it) }
    const mine = new Set<string>()
    for (const it of items) {
      if (it.anime.anilist_id) mine.add(`${it.anime.anilist_id}:${it.episode}`)
      add({ key: `m${it.anime_id}-${it.episode}`, title: displayTitle(it.anime), cover: it.anime.cover_url, episode: it.episode, at: it.airing_at, mine: true, to: `/anime/${it.anime_id}` })
    }
    if (showPopular) for (const p of popular) {
      if (mine.has(`${p.anilistId}:${p.episode}`)) continue
      add({ key: `p${p.anilistId}-${p.episode}`, title: p.title, cover: p.cover, episode: p.episode, at: p.airingAt, mine: false, to: `/anime/${p.anilistId}` })
    }
    // Your shows first, then by time.
    for (const list of m.values()) list.sort((a, b) => Number(b.mine) - Number(a.mine) || a.at.localeCompare(b.at))
    return m
  }, [items, popular, showPopular])

  const step = (dir: 1 | -1) => setAnchor(a => view === 'week' ? addDays(a, 7 * dir) : new Date(a.getFullYear(), a.getMonth() + dir, 1))
  const title = view === 'week'
    ? `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : fmt(anchor, { month: 'long', year: 'numeric' })
  const btn = 'rounded-card border border-border px-3 py-1 text-sm text-text-2 hover:bg-bg-1'
  const todayItems = byDay.get(today.toDateString()) ?? []

  const entryButton = (it: DayItem, compact: boolean) => (
    <button key={it.key} onClick={() => navigate(it.to)}
      className={`flex w-full items-center gap-1.5 rounded border-l-2 p-1 text-left transition-colors hover:bg-bg-0 ${it.mine ? 'border-accent bg-accent/10' : 'border-transparent bg-bg-2'}`}
      title={`${it.title} — E${it.episode} at ${time(it.at)}${it.mine ? ' · in your lists' : ' · popular this season'}`}>
      {!compact && it.cover && <img src={it.cover} alt="" className="h-8 w-6 shrink-0 rounded object-cover" />}
      <div className="min-w-0 flex-1">
        <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} truncate font-medium ${it.mine ? 'text-text-1' : 'text-text-2'}`}>{it.title}</p>
        <p className="text-[10px] text-text-3">E{it.episode} · {time(it.at)}</p>
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

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-3">
        <span className="flex items-center gap-1.5"><span className="h-3 w-1 rounded bg-accent" />Your shows (watching or on your watchlist)</span>
        <label className="flex cursor-pointer items-center gap-1.5 hover:text-text-1">
          <input type="checkbox" checked={showPopular} onChange={e => setShowPopular(e.target.checked)} className="accent-[var(--accent,#7c6cf0)]" />
          Also show the 20 most popular shows airing now
        </label>
        {!loading && items.length === 0 && <span>· Nothing from your lists is airing this {view}.</span>}
      </div>

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
              <button key={`t-${it.key}`} onClick={() => navigate(it.to)}
                className={`flex shrink-0 items-center gap-3 rounded-card border bg-bg-1 p-3 transition-colors hover:bg-bg-2 ${it.mine ? 'border-accent' : 'border-border'}`}>
                {it.cover && <img src={it.cover} alt="" className="h-14 w-10 rounded object-cover" />}
                <div className="text-left">
                  <p className="text-sm font-medium text-text-1">{it.title}</p>
                  <p className="text-xs text-text-3">Episode {it.episode} · {time(it.at)}{it.mine ? ' · in your lists' : ''}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

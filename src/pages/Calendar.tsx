import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '@/components/EmptyState'
import { SkeletonText } from '@/components/Skeleton'
import { syncAiringSchedules } from '@/lib/sync'
import type { Anime, AiringScheduleItem } from '@/types'

type AiringEntry = AiringScheduleItem & { anime: Anime }

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  // ponytail: Monday-based week
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function formatDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Calendar() {
  const navigate = useNavigate()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [items, setItems] = useState<AiringEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const syncedOnce = useRef(false)

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])
  // ponytail: refresh 'today' so midnight crossings don't stale the highlight
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    const now = new Date()
    const msUntilMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
    const timer = setTimeout(() => setToday(new Date()), msUntilMidnight + 1000)
    return () => clearTimeout(timer)
  }, [today])

  const fetchSchedule = useCallback(() => {
    if (!window.api) { setLoading(false); return }
    setLoading(true)
    window.api.db.getAiringSchedule(weekStart.toISOString(), weekEnd.toISOString())
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [weekStart, weekEnd])

  // ponytail: sync once on first mount, then just read DB
  useEffect(() => {
    if (syncedOnce.current) { fetchSchedule(); return }
    syncedOnce.current = true
    setSyncing(true)
    syncAiringSchedules()
      .then(() => { fetchSchedule() })
      .catch(() => { fetchSchedule() })
      .finally(() => setSyncing(false))
  }, [fetchSchedule])

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekStart, i)
      const dayItems = items.filter(item => {
        const airingDate = new Date(item.airing_at)
        return isSameDay(airingDate, date)
      })
      return { date, name: DAY_NAMES[i], items: dayItems }
    })
  }, [weekStart, items])

  const todayItems = useMemo(() => {
    return items.filter(item => isSameDay(new Date(item.airing_at), today))
  }, [items, today])

  const goToday = () => setWeekStart(startOfWeek(new Date()))
  const goPrev = () => setWeekStart(addDays(weekStart, -7))
  const goNext = () => setWeekStart(addDays(weekStart, 7))

  return (
    <div className="flex flex-col h-full p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-xl font-bold text-text-1">Calendar</h1>
        <span className="text-sm text-text-3">
          {formatDate(weekStart)} - {formatDate(addDays(weekStart, 6))}
        </span>
        <div className="ml-auto flex gap-1">
          <button onClick={goPrev} className="rounded-card border border-border px-2.5 py-1 text-sm text-text-2 hover:bg-bg-1">&larr;</button>
          <button onClick={goToday} className="rounded-card border border-border px-3 py-1 text-sm text-text-2 hover:bg-bg-1">Today</button>
          <button onClick={goNext} className="rounded-card border border-border px-2.5 py-1 text-sm text-text-2 hover:bg-bg-1">&rarr;</button>
          <button
            onClick={() => { setSyncing(true); syncAiringSchedules().then(() => { fetchSchedule() }).finally(() => setSyncing(false)) }}
            disabled={syncing}
            className="rounded-card border border-border px-3 py-1 text-sm text-text-2 hover:bg-bg-1 disabled:opacity-50"
          >{syncing ? 'Syncing...' : 'Sync'}</button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-7 gap-2 flex-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="space-y-2 p-2">
              <SkeletonText width="60%" height="1rem" />
              <SkeletonText height="3rem" />
              <SkeletonText height="3rem" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No airing data yet"
          description="Your calendar will populate as you add anime to your library."
        />
      ) : (
        <>
          {/* Week grid */}
          <div className="grid grid-cols-7 gap-2 flex-1 min-h-0">
            {days.map(day => {
              const isToday = isSameDay(day.date, today)
              return (
                <div
                  key={day.name}
                  className={`flex flex-col rounded-card border p-2 overflow-y-auto ${
                    isToday ? 'border-accent bg-accent/5' : 'border-border bg-bg-1'
                  }`}
                >
                  <div className="mb-2 text-center">
                    <p className={`text-xs font-medium ${isToday ? 'text-accent' : 'text-text-3'}`}>{day.name}</p>
                    <p className={`text-sm ${isToday ? 'text-accent font-bold' : 'text-text-2'}`}>{day.date.getDate()}</p>
                  </div>
                  <div className="space-y-1.5 flex-1">
                    {day.items.map(item => (
                      <button
                        key={`${item.anime_id}-${item.episode}`}
                        onClick={() => navigate(`/anime/${item.anime_id}`)}
                        className="w-full flex items-center gap-1.5 rounded bg-bg-2 p-1.5 text-left hover:bg-bg-0 transition-colors"
                      >
                        {item.anime.cover_url && (
                          <img src={item.anime.cover_url} alt="" className="h-8 w-6 rounded object-cover shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-text-1 line-clamp-2">{item.anime.title}</p>
                          <p className="text-[10px] text-text-3">Ep {item.episode}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Airing today */}
          {todayItems.length > 0 && (
            <div className="mt-6">
              <h2 className="mb-3 font-display text-base font-semibold text-text-1">Airing Today</h2>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {todayItems.map(item => (
                  <button
                    key={`${item.anime_id}-${item.episode}`}
                    onClick={() => navigate(`/anime/${item.anime_id}`)}
                    className="flex items-center gap-3 shrink-0 rounded-card border border-border bg-bg-1 p-3 hover:bg-bg-2 transition-colors"
                  >
                    {item.anime.cover_url && (
                      <img src={item.anime.cover_url} alt="" className="h-14 w-10 rounded object-cover" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-text-1">{item.anime.title}</p>
                      <p className="text-xs text-text-3">Episode {item.episode} - {new Date(item.airing_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// "Up Next": shows you're watching whose next episode has actually aired.
// Airing shows you've caught up on drop out and come back when the next episode airs.
import type { AnimeWithEntry } from '@/types'

export interface ScheduleRow { anime_id: number; episode: number; airing_at: string }

export interface UpNextItem {
  anime: AnimeWithEntry
  nextEp: number
  /** Latest episode that has aired (Infinity when unknown/finished without a count). */
  aired: number
  /** Episodes available beyond what you've watched. */
  behind: number
  /** The next episode aired after you last watched → "New episode" badge. */
  isNew: boolean
  airedAt?: number
}

export interface WaitingItem {
  anime: AnimeWithEntry
  nextEp: number
  /** When `nextEp` airs (ms), if known. */
  airsAt?: number
}

/** Latest aired episode for a show, using the synced airing schedule. */
export function latestAired(anime: AnimeWithEntry, rows: ScheduleRow[], now: number): number {
  const total = anime.episodes_total ?? Infinity
  const upcoming = rows.filter(r => Date.parse(r.airing_at) > now).map(r => r.episode)
  const past = rows.filter(r => Date.parse(r.airing_at) <= now).map(r => r.episode)
  if (upcoming.length) return Math.min(total, Math.min(...upcoming) - 1)
  if (anime.airing_status === 'NOT_YET_RELEASED') return past.length ? Math.max(...past) : 0
  if (anime.airing_status === 'RELEASING' && past.length) return Math.min(total, Math.max(...past))
  // Finished, or airing with no schedule data yet: assume everything listed is out.
  return total
}

export function computeUpNext(entries: AnimeWithEntry[], schedule: ScheduleRow[], now = Date.now()) {
  const byAnime = new Map<number, ScheduleRow[]>()
  for (const r of schedule) (byAnime.get(r.anime_id) ?? byAnime.set(r.anime_id, []).get(r.anime_id)!).push(r)

  const ready: UpNextItem[] = []
  const waiting: WaitingItem[] = []
  for (const a of entries) {
    const e = a.entry
    if (!e || e.my_status !== 'watching') continue
    const progress = e.progress ?? 0
    const total = a.episodes_total
    if (total && progress >= total) continue // finished it — nothing next
    const rows = byAnime.get(a.id) ?? []
    const aired = latestAired(a, rows, now)
    const nextEp = progress + 1
    const nextRow = rows.find(r => r.episode === nextEp)
    if (nextEp <= aired) {
      const airedAt = nextRow ? Date.parse(nextRow.airing_at) : undefined
      const lastWatched = e.last_watched_at ? Date.parse(e.last_watched_at) : 0
      ready.push({
        anime: a, nextEp, aired, behind: Number.isFinite(aired) ? aired - progress : 1,
        isNew: !!airedAt && airedAt > lastWatched && now - airedAt < 7 * 86_400_000,
        airedAt,
      })
    } else {
      waiting.push({ anime: a, nextEp, airsAt: nextRow ? Date.parse(nextRow.airing_at) : undefined })
    }
  }

  // Freshly aired episodes first, then most recently watched.
  ready.sort((x, y) =>
    Number(y.isNew) - Number(x.isNew) ||
    (y.isNew ? (y.airedAt ?? 0) - (x.airedAt ?? 0) : 0) ||
    (y.anime.entry?.last_watched_at ?? '').localeCompare(x.anime.entry?.last_watched_at ?? ''))
  waiting.sort((x, y) => (x.airsAt ?? Infinity) - (y.airsAt ?? Infinity))
  return { ready, waiting }
}

export function timeUntil(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((ms - now) / 1000))
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${Math.max(1, m)}m`
}

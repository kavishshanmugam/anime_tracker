import { XMLParser } from 'fast-xml-parser'
import type { MyStatus } from '@/types'

export interface ParsedMALEntry {
  malId: number
  title: string
  status: MyStatus
  score: number
  progress: number
  startDate: string | null
  finishDate: string | null
  /** Total episodes per MAL (0 = unknown). */
  episodes: number
  timesWatched: number
}

export interface MALImportResult {
  total: number
  byStatus: Record<MyStatus, number>
  entries: ParsedMALEntry[]
}

// MAL's XML export writes the status as text ("Completed", "Plan to Watch");
// older exports / other tools use the numeric codes. Accept both.
const MAL_STATUS_MAP: Record<string, MyStatus> = {
  '1': 'watching', watching: 'watching',
  '2': 'completed', completed: 'completed',
  '3': 'on_hold', onhold: 'on_hold',
  '4': 'dropped', dropped: 'dropped',
  '5': 'watching', rewatching: 'watching',
  '6': 'plan_to_watch', plantowatch: 'plan_to_watch',
}
const statusOf = (raw: unknown): MyStatus | undefined =>
  MAL_STATUS_MAP[String(raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')]

function parseDate(d: string | undefined | null): string | null {
  const s = String(d ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || s.startsWith('0000')) return null
  return s
}

export function parseMALExport(xmlString: string): MALImportResult {
  const parser = new XMLParser({ ignoreAttributes: true })
  const parsed = parser.parse(xmlString)

  const rawAnime = parsed?.myanimelist?.anime
  if (!rawAnime) return { total: 0, byStatus: emptyByStatus(), entries: [] }

  // fast-xml-parser returns a single object if there's only one entry
  const list: any[] = Array.isArray(rawAnime) ? rawAnime : [rawAnime]

  const byStatus = emptyByStatus()
  const entries: ParsedMALEntry[] = []

  for (const item of list) {
    const status = statusOf(item.my_status)
    const malId = Number(item.series_animedb_id)
    if (!status || !malId) continue // skip unknown statuses / broken rows

    byStatus[status]++
    entries.push({
      malId,
      title: String(item.series_title ?? ''),
      status,
      score: Number(item.my_score ?? 0),
      progress: Number(item.my_watched_episodes ?? 0),
      startDate: parseDate(item.my_start_date),
      finishDate: parseDate(item.my_finish_date),
      episodes: Number(item.series_episodes) || 0,
      timesWatched: Number(item.my_times_watched) || 0,
    })
  }

  return { total: entries.length, byStatus, entries }
}

function emptyByStatus(): Record<MyStatus, number> {
  return { watching: 0, completed: 0, plan_to_watch: 0, on_hold: 0, dropped: 0 }
}

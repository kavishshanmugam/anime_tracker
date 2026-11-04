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
}

export interface MALImportResult {
  total: number
  byStatus: Record<MyStatus, number>
  entries: ParsedMALEntry[]
}

const MAL_STATUS_MAP: Record<number, MyStatus> = {
  1: 'watching',
  2: 'completed',
  3: 'on_hold',
  4: 'dropped',
  5: 'watching', // re-watching → treat as watching
  6: 'plan_to_watch',
}

function parseDate(d: string | undefined | null): string | null {
  if (!d || d === '0000-00-00' || d === 'null') return null
  return d
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
    const statusNum = Number(item.my_status)
    const status = MAL_STATUS_MAP[statusNum]
    if (!status) continue // skip unknown statuses

    byStatus[status]++
    entries.push({
      malId: Number(item.series_animedb_id),
      title: String(item.series_title ?? ''),
      status,
      score: Number(item.my_score ?? 0),
      progress: Number(item.my_watched_episodes ?? 0),
      startDate: parseDate(item.my_start_date),
      finishDate: parseDate(item.my_finish_date),
    })
  }

  return { total: entries.length, byStatus, entries }
}

function emptyByStatus(): Record<MyStatus, number> {
  return { watching: 0, completed: 0, plan_to_watch: 0, on_hold: 0, dropped: 0 }
}

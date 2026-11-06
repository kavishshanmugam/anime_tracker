// English dub availability from the community-maintained MAL-Dubs list
// (https://github.com/MAL-Dubs/MAL-Dubs, AGPL-3.0 — fetched at runtime, not bundled).
//   dubbed     = MAL ids that have an English dub
//   incomplete = MAL ids whose dub is still being released
import type { AnimeWithEntry } from '@/types'
import { displayTitle } from '@/lib/title'

export type DubStatus = 'complete' | 'ongoing' | 'none' | 'unknown'

const URL = 'https://raw.githubusercontent.com/MAL-Dubs/MAL-Dubs/main/data/dubInfo.json'
const TTL = 24 * 3_600_000

let dubbed: Set<number> | null = null
let incomplete: Set<number> | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

async function fetchList(): Promise<{ dubbed: number[]; incomplete: number[] } | null> {
  try {
    const res = await fetch(URL, { cache: 'no-store' })
    if (!res.ok) return null
    const j = await res.json()
    if (!Array.isArray(j.dubbed)) return null
    return { dubbed: j.dubbed.filter(Number.isInteger), incomplete: (j.incomplete ?? []).filter(Number.isInteger) }
  } catch { return null }
}

/** Load the dub list (cached in the DB for a day, refreshed in the background). */
export function loadDubs(force = false): Promise<void> {
  if (loading && !force) return loading
  loading = (async () => {
    let cached: { at: number; dubbed: number[]; incomplete: number[] } | null = null
    try { cached = JSON.parse((await window.api?.db.getAppState('dub_info')) ?? 'null') } catch { /* */ }
    if (cached) { dubbed = new Set(cached.dubbed); incomplete = new Set(cached.incomplete); emit() }
    if (!force && cached && Date.now() - cached.at < TTL) return
    const fresh = await fetchList()
    if (!fresh) return
    dubbed = new Set(fresh.dubbed)
    incomplete = new Set(fresh.incomplete)
    window.api?.db.setAppState('dub_info', JSON.stringify({ at: Date.now(), ...fresh })).catch(() => {})
    emit()
  })()
  return loading
}

function emit() { for (const l of listeners) { try { l() } catch { /* */ } } }
export function onDubsLoaded(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

/**
 * Dub status for a show. Simulcast dubs are listed as "dubbed" while still coming out
 * weekly, so a dubbed show that is still airing counts as 'ongoing' until it finishes.
 */
export function dubStatus(malId: number | null | undefined, airingStatus?: string | null): DubStatus {
  if (!dubbed || !malId) return 'unknown'
  if (incomplete?.has(malId)) return 'ongoing'
  if (!dubbed.has(malId)) return 'none'
  return airingStatus === 'RELEASING' || airingStatus === 'NOT_YET_RELEASED' ? 'ongoing' : 'complete'
}

/** Raw MAL id lists (for server-side filtering, e.g. AniList idMal_in). */
export async function getDubLists(): Promise<{ dubbed: number[]; incomplete: number[] }> {
  await loadDubs()
  return { dubbed: dubbed ? [...dubbed] : [], incomplete: incomplete ? [...incomplete] : [] }
}

export const DUB_LABEL: Record<DubStatus, string> = {
  complete: 'Dub complete', ongoing: 'Dub in progress', none: 'Sub only', unknown: '',
}

/**
 * Compare current dub status of library shows against what we saw last time and
 * return notifications for new dubs and dubs that finished.
 */
export async function dubChanges(library: AnimeWithEntry[]): Promise<{ title: string; body: string; animeId: number }[]> {
  await loadDubs()
  if (!dubbed) return []
  let seen: Record<string, DubStatus> = {}
  try { seen = JSON.parse((await window.api?.db.getAppState('dub_seen')) ?? '{}') } catch { /* */ }
  const first = Object.keys(seen).length === 0
  const out: { title: string; body: string; animeId: number }[] = []
  for (const a of library) {
    if (!a.mal_id || !a.entry || a.entry.my_status === 'dropped') continue
    const now = dubStatus(a.mal_id, a.airing_status)
    const before = seen[a.mal_id]
    seen[a.mal_id] = now
    if (first || !before || before === now) continue
    if (now === 'complete' && before === 'ongoing')
      out.push({ title: 'Dub complete', body: `${displayTitle(a)}: every episode is now dubbed`, animeId: a.id })
    else if (now === 'complete' && before === 'none')
      out.push({ title: 'Dub available', body: `${displayTitle(a)} now has a complete English dub`, animeId: a.id })
    else if (now === 'ongoing' && before === 'none')
      out.push({ title: 'Dub started', body: `${displayTitle(a)}: English dub episodes are coming out`, animeId: a.id })
  }
  window.api?.db.setAppState('dub_seen', JSON.stringify(seen)).catch(() => {})
  return out
}

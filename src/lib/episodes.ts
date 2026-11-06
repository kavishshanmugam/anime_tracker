// Episode titles, thumbnails and air dates.
//   Primary: ani.zip (TVDB-backed, keyed by AniList id) — English titles, artwork, exact air time.
//   Fallback: AniList streamingEpisodes (official-stream titles/thumbnails) for anything missing.
import { getStreamingEpisodes } from './anilist'

export interface EpisodeMeta {
  number: number
  title: string | null
  thumbnail: string | null
  /** Air time (ms since epoch) if known. */
  airAt: number | null
}

const memory = new Map<number, Promise<Map<number, EpisodeMeta>>>()
const TTL = 3 * 86_400_000

async function fromAniZip(anilistId: number): Promise<EpisodeMeta[]> {
  try {
    const res = await fetch(`https://api.ani.zip/mappings?anilist_id=${anilistId}`)
    if (!res.ok) return []
    const j = await res.json()
    const out: EpisodeMeta[] = []
    for (const [key, e] of Object.entries<any>(j.episodes ?? {})) {
      if (!/^\d+$/.test(key)) continue // skip specials ("S1"…)
      const n = Number(key)
      const air = e.airDateUtc ? Date.parse(e.airDateUtc) : e.airDate ? Date.parse(`${e.airDate}T12:00:00Z`) : NaN
      out.push({
        number: n,
        title: e.title?.en || e.title?.['x-jat'] || null,
        thumbnail: typeof e.image === 'string' && e.image ? e.image : null,
        airAt: Number.isFinite(air) ? air : null,
      })
    }
    return out
  } catch { return [] }
}

async function fromAniList(anilistId: number): Promise<EpisodeMeta[]> {
  const raw = await getStreamingEpisodes(anilistId).catch(() => [])
  const out: EpisodeMeta[] = []
  for (const e of raw) {
    // Titles look like "Episode 12 - The Title".
    const m = e.title?.match(/Episode\s+(\d+)(?:\s*[-–:]\s*(.+))?/i)
    if (!m) continue
    const number = Number(m[1])
    if (out.some(x => x.number === number)) continue
    out.push({ number, title: m[2]?.trim() || null, thumbnail: e.thumbnail || null, airAt: null })
  }
  return out
}

async function load(anilistId: number): Promise<Map<number, EpisodeMeta>> {
  const key = `episodes2_${anilistId}`
  try {
    const cached = await window.api?.db.getAppState(key)
    if (cached) {
      const { at, list } = JSON.parse(cached) as { at: number; list: EpisodeMeta[] }
      if (Date.now() - at < TTL) return new Map(list.map(e => [e.number, e]))
    }
  } catch { /* ignore */ }

  const [zip, al] = await Promise.all([fromAniZip(anilistId), fromAniList(anilistId)])
  const merged = new Map<number, EpisodeMeta>()
  for (const e of zip) merged.set(e.number, e)
  for (const e of al) {
    const cur = merged.get(e.number)
    if (!cur) merged.set(e.number, e)
    else merged.set(e.number, { ...cur, title: cur.title ?? e.title, thumbnail: cur.thumbnail ?? e.thumbnail })
  }
  const list = [...merged.values()].sort((a, b) => a.number - b.number)
  if (list.length) window.api?.db.setAppState(key, JSON.stringify({ at: Date.now(), list })).catch(() => {})
  return merged
}

export function getEpisodeMeta(anilistId: number | null | undefined): Promise<Map<number, EpisodeMeta>> {
  if (!anilistId) return Promise.resolve(new Map())
  let p = memory.get(anilistId)
  if (!p) { p = load(anilistId); memory.set(anilistId, p) }
  return p
}

/**
 * How many episodes have aired: from ani.zip air dates when present, otherwise from the
 * synced airing schedule / airing status (see upnext.latestAired).
 */
export function airedFromMeta(meta: Map<number, EpisodeMeta>, now = Date.now()): number | null {
  const dated = [...meta.values()].filter(e => e.airAt != null)
  if (!dated.length) return null
  const aired = dated.filter(e => e.airAt! <= now).map(e => e.number)
  return aired.length ? Math.max(...aired) : 0
}

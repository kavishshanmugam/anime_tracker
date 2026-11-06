// Personal recommendations.
//
// 1. Every library entry becomes a taste signal (no ratings required):
//      score 8–10 → loved, 7 → liked, 5–6 → neutral, 1–4 → disliked (even if completed)
//      unscored: completed → liked, rewatched → loved, watching (a few eps in) → mild like,
//      on hold → slight, dropped → disliked, plan to watch → none
// 2. For the strongest liked shows (and a few disliked ones) we take AniList's
//    "users who liked X also liked Y" recommendations.
// 3. Candidates are ranked by: how many of your liked shows point to them (weighted by how
//    much you liked each and how strongly AniList users back the link), how well their
//    genres/tags match your taste profile, and their community score — minus a penalty when
//    they're recommended from shows you disliked.
import type { AnimeWithEntry } from '@/types'
import { displayTitle } from '@/lib/title'

export interface RecNode {
  rating: number
  media: {
    id: number
    idMal: number | null
    title: { romaji: string; english: string | null }
    coverImage: { large: string; extraLarge?: string | null }
    bannerImage?: string | null
    description?: string | null
    meanScore: number | null
    popularity?: number | null
    genres: string[]
    tags?: { name: string; rank: number }[]
    format: string | null
    status?: string | null
    episodes?: number | null
    seasonYear?: number | null
    relations?: { edges: { relationType: string; node: { id: number } }[] }
  }
}

export interface Recommendation {
  anilistId: number
  malId: number | null
  title: string
  cover: string
  banner: string | null
  synopsis: string | null
  genres: string[]
  format: string | null
  status: string | null
  episodes: number | null
  year: number | null
  meanScore: number | null
  popularity: number
  score: number
  /** Titles of your shows that led here, strongest first. */
  because: string[]
  /** Your favourite genres/tags this matches. */
  matches: string[]
}

/** How much a library entry says about your taste (-1 … 1.5). */
export function tasteWeight(e: AnimeWithEntry): number {
  const en = e.entry
  if (!en) return 0
  const s = en.my_score
  if (s != null && s > 0) {
    // Scores can be 1–10 (MAL) — a low score overrides everything, even completing it.
    if (s >= 9) return 1.5
    if (s >= 8) return 1.3
    if (s >= 7) return 1.0
    if (s >= 5) return s === 6 ? 0.3 : 0
    return -1.0
  }
  switch (en.my_status) {
    case 'completed': return en.rewatch_count > 0 ? 1.4 : 1.0
    case 'watching': {
      const total = e.episodes_total ?? 0
      const p = en.progress ?? 0
      if (p >= 3 || (total > 0 && p / total >= 0.25)) return 0.6
      return p > 0 ? 0.2 : 0
    }
    case 'on_hold': return 0.2
    case 'dropped': return (en.progress ?? 0) <= 2 ? -0.5 : -0.9 // dropped after giving it a real try = stronger dislike
    default: return 0
  }
}

const parseList = (raw: string | null | undefined): string[] => {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.map(String) : [] } catch { return raw.split(',').map(x => x.trim()).filter(Boolean) }
}

/** Genre/tag affinity built from your library: positive = you like it. */
export function tasteProfile(library: AnimeWithEntry[]): Map<string, number> {
  const raw = new Map<string, number>()
  for (const e of library) {
    const w = tasteWeight(e)
    if (!w) continue
    for (const g of parseList(e.genres)) raw.set(`g:${g}`, (raw.get(`g:${g}`) ?? 0) + w)
    for (const t of parseList(e.tags).slice(0, 8)) raw.set(`t:${t}`, (raw.get(`t:${t}`) ?? 0) + w * 0.5)
  }
  const max = Math.max(1, ...[...raw.values()].map(Math.abs))
  return new Map([...raw].map(([k, v]) => [k, v / max]))
}

/** Pick the shows to fetch AniList recommendations for. */
export function pickSources(library: AnimeWithEntry[], maxLiked = 25, maxDisliked = 5) {
  const withW = library.filter(e => e.anilist_id).map(e => ({ e, w: tasteWeight(e) }))
  const recent = (e: AnimeWithEntry) => e.entry?.finished_at ?? e.entry?.last_watched_at ?? ''
  const liked = withW.filter(x => x.w > 0.25)
    .sort((a, b) => b.w - a.w || recent(b.e).localeCompare(recent(a.e))).slice(0, maxLiked)
  const disliked = withW.filter(x => x.w < 0).sort((a, b) => a.w - b.w).slice(0, maxDisliked)
  return { liked, disliked }
}

/** Combine per-source AniList recommendations into a ranked list. */
export function rankRecommendations(
  library: AnimeWithEntry[],
  recsBySource: Map<number, RecNode[]>,
  opts: { exclude?: Set<number>; limit?: number } = {},
): Recommendation[] {
  const inLibrary = new Set(library.map(e => e.anilist_id).filter((x): x is number => !!x))
  const exclude = opts.exclude ?? new Set<number>()
  const profile = tasteProfile(library)
  const { liked, disliked } = pickSources(library)
  const cands = new Map<number, { node: RecNode['media']; support: number; penalty: number; because: { title: string; w: number }[] }>()

  const visit = (src: AnimeWithEntry, w: number, negative: boolean) => {
    for (const r of recsBySource.get(src.anilist_id!) ?? []) {
      const m = r.media
      if (!m || inLibrary.has(m.id) || exclude.has(m.id)) continue
      // Skip sequels whose earlier season you haven't seen.
      const prequels = (m.relations?.edges ?? []).filter(x => x.relationType === 'PREQUEL').map(x => x.node.id)
      if (prequels.length && !prequels.some(id => inLibrary.has(id))) continue
      const strength = 0.4 + 0.6 * Math.min(1, Math.max(0, r.rating) / 40) // AniList votes for this link
      const c = cands.get(m.id) ?? { node: m, support: 0, penalty: 0, because: [] }
      if (negative) c.penalty += Math.abs(w) * strength
      else { c.support += w * strength; c.because.push({ title: displayTitle(src), w: w * strength }) }
      cands.set(m.id, c)
    }
  }
  for (const { e, w } of liked) visit(e, w, false)
  for (const { e, w } of disliked) visit(e, w, true)

  const maxSupport = Math.max(1, ...[...cands.values()].map(c => c.support))
  const out: Recommendation[] = []
  for (const [id, c] of cands) {
    if (c.support <= 0) continue
    const m = c.node
    const keys = [...(m.genres ?? []).map(g => `g:${g}`), ...(m.tags ?? []).filter(t => t.rank >= 60).slice(0, 8).map(t => `t:${t.name}`)]
    const affinities = keys.map(k => ({ k, v: profile.get(k) ?? 0 }))
    const taste = affinities.length ? affinities.reduce((s, a) => s + a.v, 0) / affinities.length : 0
    const quality = (m.meanScore ?? 65) / 100
    const score = 0.5 * (c.support / maxSupport) + 0.3 * Math.max(-1, Math.min(1, taste)) + 0.2 * quality - 0.35 * Math.min(1, c.penalty)
    out.push({
      anilistId: id, malId: m.idMal ?? null,
      title: m.title.english ?? m.title.romaji, cover: m.coverImage.extraLarge ?? m.coverImage.large,
      banner: m.bannerImage ?? null, synopsis: m.description ?? null, genres: m.genres ?? [],
      format: m.format, status: m.status ?? null, episodes: m.episodes ?? null, year: m.seasonYear ?? null,
      meanScore: m.meanScore, popularity: m.popularity ?? 0, score,
      because: c.because.sort((a, b) => b.w - a.w).map(b => b.title),
      matches: affinities.filter(a => a.v > 0.3).sort((a, b) => b.v - a.v).slice(0, 3).map(a => a.k.slice(2)),
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 60)
}

// ---------------- fetching + caching ----------------

const SOURCE_TTL = 7 * 86_400_000
const LIST_TTL = 24 * 3_600_000

async function cachedRecsFor(anilistId: number, fetchRecs: (id: number) => Promise<RecNode[]>, force: boolean): Promise<RecNode[]> {
  const key = `recs_src_${anilistId}`
  if (!force) {
    try {
      const c = JSON.parse((await window.api.db.getAppState(key)) ?? 'null')
      if (c && Date.now() - c.at < SOURCE_TTL) return c.nodes
    } catch { /* */ }
  }
  const nodes = await fetchRecs(anilistId)
  window.api.db.setAppState(key, JSON.stringify({ at: Date.now(), nodes })).catch(() => {})
  return nodes
}

const signature = (library: AnimeWithEntry[]) =>
  library.map(e => `${e.anilist_id}:${e.entry?.my_status}:${e.entry?.my_score ?? ''}:${e.entry?.rewatch_count ?? 0}`).sort().join('|')

let memo: { sig: string; at: number; list: Recommendation[] } | null = null

/** Personal recommendations (cached for a day; `force` refetches everything). */
export async function getPersonalRecommendations(
  library: AnimeWithEntry[],
  fetchRecs: (id: number) => Promise<RecNode[]>,
  opts: { force?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<Recommendation[]> {
  const sig = signature(library)
  let exclude = new Set<number>()
  try { exclude = new Set(await window.api.db.getNotInterested()) } catch { /* */ }
  if (!opts.force && memo && memo.sig === sig && Date.now() - memo.at < LIST_TTL)
    return memo.list.filter(r => !exclude.has(r.anilistId))
  if (!opts.force) {
    try {
      const c = JSON.parse((await window.api.db.getAppState('recs_list')) ?? 'null')
      if (c && c.sig === sig && Date.now() - c.at < LIST_TTL) {
        memo = c
        return c.list.filter((r: Recommendation) => !exclude.has(r.anilistId))
      }
    } catch { /* */ }
  }
  const { liked, disliked } = pickSources(library)
  const sources = [...liked, ...disliked]
  const bySource = new Map<number, RecNode[]>()
  let done = 0
  for (const { e } of sources) {
    try { bySource.set(e.anilist_id!, await cachedRecsFor(e.anilist_id!, fetchRecs, !!opts.force)) } catch { /* skip */ }
    opts.onProgress?.(++done, sources.length)
  }
  const list = rankRecommendations(library, bySource, { exclude })
  memo = { sig, at: Date.now(), list }
  window.api.db.setAppState('recs_list', JSON.stringify(memo)).catch(() => {})
  return list
}

/** Forget a dismissed / added show in the cached list straight away. */
export function dropFromCache(anilistId: number) {
  if (memo) memo = { ...memo, list: memo.list.filter(r => r.anilistId !== anilistId) }
}

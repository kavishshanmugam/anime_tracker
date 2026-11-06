// Franchise watch order: walk AniList relations from a show and return every related
// anime (seasons, movies, OVAs, side stories, spin-offs) sorted by release date.
import { gqlRaw } from './anilist'

export type FranchiseKind = 'main' | 'movie' | 'side' | 'spinoff'

export interface FranchiseEntry {
  id: number
  idMal: number | null
  title: string
  format: string | null
  status: string | null
  episodes: number | null
  /** yyyymmdd (0 if unknown) — used for release-order sorting. */
  start: number
  year: number | null
  cover: string | null
  kind: FranchiseKind
}

const FOLLOW = new Set(['PREQUEL', 'SEQUEL', 'PARENT', 'SIDE_STORY'])
const LIST_ONLY = new Set(['SPIN_OFF'])
const MAX_NODES = 40
const TTL = 7 * 86_400_000

const QUERY = `query ($id: Int) { Media(id: $id, type: ANIME) {
  id idMal title { romaji english } format status episodes startDate { year month day } coverImage { large }
  relations { edges { relationType node { id type format } } } } }`

interface Node {
  id: number; idMal: number | null; title: { romaji: string; english: string | null }; format: string | null
  status: string | null; episodes: number | null; startDate: { year: number | null; month: number | null; day: number | null }
  coverImage: { large: string } | null; relations: { edges: { relationType: string; node: { id: number; type: string; format: string | null } }[] }
}

function kindOf(n: Node, via: string): FranchiseKind {
  if (via === 'SPIN_OFF') return 'spinoff'
  if (n.format === 'MOVIE') return 'movie'
  if (via === 'SIDE_STORY' || n.format === 'OVA' || n.format === 'SPECIAL' || n.format === 'MUSIC') return 'side'
  return 'main'
}

export async function getFranchise(anilistId: number, force = false): Promise<FranchiseEntry[]> {
  const key = `franchise_${anilistId}`
  if (!force) {
    try {
      const c = JSON.parse((await window.api?.db.getAppState(key)) ?? 'null')
      if (c && Date.now() - c.at < TTL) return c.list
    } catch { /* */ }
  }
  const seen = new Map<number, FranchiseEntry>()
  const queue: { id: number; via: string }[] = [{ id: anilistId, via: 'SELF' }]
  while (queue.length && seen.size < MAX_NODES) {
    const { id, via } = queue.shift()!
    if (seen.has(id)) continue
    let n: Node
    try { n = (await gqlRaw<{ Media: Node }>(QUERY, { id })).Media } catch { continue }
    if (!n) continue
    const d = n.startDate ?? { year: null, month: null, day: null }
    seen.set(id, {
      id: n.id, idMal: n.idMal, title: n.title.english ?? n.title.romaji, format: n.format, status: n.status,
      episodes: n.episodes, start: (d.year ?? 9999) * 10000 + (d.month ?? 12) * 100 + (d.day ?? 28),
      year: d.year, cover: n.coverImage?.large ?? null,
      kind: via === 'SELF' ? (n.format === 'MOVIE' ? 'movie' : 'main') : via === 'SPIN_OFF' ? 'spinoff' : kindOf(n, via),
    })
    // Spin-offs are listed but not expanded (they're separate series).
    if (via === 'SPIN_OFF') continue
    for (const e of n.relations?.edges ?? []) {
      if (e.node.type !== 'ANIME' || seen.has(e.node.id)) continue
      if (FOLLOW.has(e.relationType)) queue.push({ id: e.node.id, via: e.relationType })
      else if (LIST_ONLY.has(e.relationType)) queue.push({ id: e.node.id, via: 'SPIN_OFF' })
    }
  }
  const list = [...seen.values()].sort((a, b) => a.start - b.start)
  window.api?.db.setAppState(key, JSON.stringify({ at: Date.now(), list })).catch(() => {})
  return list
}

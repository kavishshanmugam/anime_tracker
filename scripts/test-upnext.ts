// Tests for the Home "Up Next" / "Caught Up" logic. Run: npm run test:upnext
import assert from 'node:assert/strict'
import { computeUpNext } from '../src/lib/upnext'
import { dubStatus, dubChanges, loadDubs } from '../src/lib/dubs'
import { progressAfterWatching } from '../src/lib/progress'
import { tasteWeight, rankRecommendations, type RecNode } from '../src/lib/recommend'
import { dubStatus, dubChanges, loadDubs } from '../src/lib/dubs'
import type { AnimeWithEntry } from '../src/types'

let passed = 0, failed = 0
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`) } catch (e: any) { failed++; console.log(`  ✕ ${name}\n      ${e.message}`) }
}

const NOW = Date.parse('2026-11-05T12:00:00Z')
const day = 86_400_000
const iso = (ms: number) => new Date(ms).toISOString()

function show(id: number, o: Partial<AnimeWithEntry> & { progress?: number; status?: string; lastWatched?: number } = {}): AnimeWithEntry {
  return {
    id, title: `Show ${id}`, airing_status: 'FINISHED', episodes_total: 12, ...o,
    entry: { my_status: (o.status ?? 'watching') as any, progress: o.progress ?? 0, last_watched_at: o.lastWatched ? iso(o.lastWatched) : iso(NOW - 2 * day) },
  } as AnimeWithEntry
}
// Weekly show: E1 aired 8 weeks ago, one per week → E1..E8 out, E9 airs in 1 day.
const weekly = (animeId: number) => Array.from({ length: 12 }, (_, i) => ({
  anime_id: animeId, episode: i + 1, airing_at: iso(NOW - (7 * (7 - i)) * day - 6 * day),
}))

console.log('\n[Up Next]')
test('finished show, mid-way → ready with next episode', () => {
  const { ready, waiting } = computeUpNext([show(1, { progress: 4 })], [], NOW)
  assert.equal(ready.length, 1); assert.equal(ready[0].nextEp, 5); assert.equal(waiting.length, 0)
})
test('finished show fully watched → not listed anywhere', () => {
  const { ready, waiting } = computeUpNext([show(1, { progress: 12 })], [], NOW)
  assert.equal(ready.length + waiting.length, 0)
})
test('only "watching" shows are included', () => {
  const { ready } = computeUpNext([show(1, { progress: 3, status: 'plan_to_watch' }), show(2, { progress: 3, status: 'completed' })], [], NOW)
  assert.equal(ready.length, 0)
})
test('weekly show, behind (watched 5 of 8 aired) → ready, 3 left', () => {
  const rows = weekly(1)
  const { ready } = computeUpNext([show(1, { airing_status: 'RELEASING', progress: 5 })], rows, NOW)
  assert.equal(ready.length, 1); assert.equal(ready[0].nextEp, 6); assert.equal(ready[0].aired, 8); assert.equal(ready[0].behind, 3)
})
test('weekly show, caught up (watched 8 of 8 aired) → hidden from Up Next, in Caught Up with countdown', () => {
  const rows = weekly(1)
  const { ready, waiting } = computeUpNext([show(1, { airing_status: 'RELEASING', progress: 8 })], rows, NOW)
  assert.equal(ready.length, 0); assert.equal(waiting.length, 1); assert.equal(waiting[0].nextEp, 9)
  assert.equal(waiting[0].airsAt, Date.parse(rows[8].airing_at))
})
test('…and it comes back the moment E9 airs, flagged as a new episode', () => {
  const rows = weekly(1)
  const later = Date.parse(rows[8].airing_at) + 60_000
  const { ready, waiting } = computeUpNext([show(1, { airing_status: 'RELEASING', progress: 8, lastWatched: NOW - day })], rows, later)
  assert.equal(waiting.length, 0); assert.equal(ready.length, 1); assert.equal(ready[0].nextEp, 9); assert.equal(ready[0].isNew, true)
})
test('only future schedule known (typical sync) → aired = next scheduled - 1', () => {
  const rows = [{ anime_id: 1, episode: 9, airing_at: iso(NOW + day) }, { anime_id: 1, episode: 10, airing_at: iso(NOW + 8 * day) }]
  assert.equal(computeUpNext([show(1, { airing_status: 'RELEASING', progress: 8 })], rows, NOW).waiting.length, 1)
  assert.equal(computeUpNext([show(1, { airing_status: 'RELEASING', progress: 7 })], rows, NOW).ready[0].nextEp, 8)
})
test('not yet released → Caught Up (nothing to watch)', () => {
  const rows = [{ anime_id: 1, episode: 1, airing_at: iso(NOW + 3 * day) }]
  const { ready, waiting } = computeUpNext([show(1, { airing_status: 'NOT_YET_RELEASED', episodes_total: null as any, progress: 0 })], rows, NOW)
  assert.equal(ready.length, 0); assert.equal(waiting[0].nextEp, 1)
})
test('airing show with unknown episode count and no schedule yet → shown (not hidden by mistake)', () => {
  const { ready } = computeUpNext([show(1, { airing_status: 'RELEASING', episodes_total: null as any, progress: 3 })], [], NOW)
  assert.equal(ready.length, 1)
})
test('newly aired episodes sort first', () => {
  const rows = weekly(2)
  const later = Date.parse(rows[8].airing_at) + 60_000
  const { ready } = computeUpNext([
    show(1, { progress: 2, lastWatched: later - 1000 }),
    show(2, { airing_status: 'RELEASING', progress: 8, lastWatched: NOW - day }),
  ], rows, later)
  assert.equal(ready[0].anime.id, 2)
})

// ---------- Progress across Sub/Dub ----------
console.log('\n[Progress]')
{
  const t = new Date('2026-11-05T10:00:00Z')
  const watching = (progress: number) => ({ my_status: 'watching' as const, progress, started_at: '2026-11-01', finished_at: null })
  test('E1–3 in sub then E4 in dub continues the same progress (3 → 4)', () => {
    const u = progressAfterWatching({ entry: watching(3), episode: 4, episodesTotal: 12, now: t })!
    assert.equal(u.progress, 4); assert.equal(u.my_status, undefined)
  })
  test('finishing the last episode (in either language) marks Completed with a finish date', () => {
    const u = progressAfterWatching({ entry: watching(11), episode: 12, episodesTotal: 12, now: t })!
    assert.equal(u.my_status, 'completed'); assert.equal(u.finished_at, '2026-11-05'); assert.equal(u.progress, 12)
  })
  test('re-watching an earlier episode in the other language never lowers progress', () => {
    const u = progressAfterWatching({ entry: watching(8), episode: 2, episodesTotal: 12, now: t })!
    assert.equal(u.progress, undefined)
  })
  test('show not in your lists yet → added as Watching', () => {
    const u = progressAfterWatching({ entry: null, episode: 1, episodesTotal: 24, now: t })!
    assert.equal(u.my_status, 'watching'); assert.equal(u.progress, 1); assert.equal(u.started_at, '2026-11-05')
  })
  test('Plan to Watch / On Hold become Watching when you watch an episode', () => {
    assert.equal(progressAfterWatching({ entry: { ...watching(0), my_status: 'plan_to_watch' }, episode: 1, episodesTotal: 12, now: t })!.my_status, 'watching')
    assert.equal(progressAfterWatching({ entry: { ...watching(5), my_status: 'on_hold' }, episode: 6, episodesTotal: 12, now: t })!.my_status, 'watching')
  })
  test('unknown episode count (still airing) never auto-completes', () => {
    assert.equal(progressAfterWatching({ entry: watching(30), episode: 31, episodesTotal: null, now: t })!.my_status, undefined)
  })
}

// ---------- Recommendations ----------
console.log('\n[Recommendations]')
{
  const lib = (id: number, entry: Record<string, unknown>, genres: string[] = ['Action']) => ({
    id, anilist_id: id, title: `Show ${id}`, episodes_total: 12, genres: JSON.stringify(genres), tags: null,
    entry: { my_status: 'completed', progress: 12, my_score: null, rewatch_count: 0, ...entry },
  }) as any
  test('completed without a score counts as liked', () => assert.equal(tasteWeight(lib(1, {})), 1.0))
  test('completed but scored low counts as disliked', () => assert.ok(tasteWeight(lib(1, { my_score: 3 })) < 0))
  test('high score = loved; rewatched = loved', () => {
    assert.ok(tasteWeight(lib(1, { my_score: 9 })) > 1); assert.ok(tasteWeight(lib(1, { rewatch_count: 2 })) > 1)
  })
  test('dropped = disliked; plan to watch = no signal; just started = weak', () => {
    assert.ok(tasteWeight(lib(1, { my_status: 'dropped', progress: 6 })) < 0)
    assert.equal(tasteWeight(lib(1, { my_status: 'plan_to_watch', progress: 0 })), 0)
    assert.ok(tasteWeight(lib(1, { my_status: 'watching', progress: 1 })) < 0.5)
  })

  const media = (id: number, genres = ['Action'], extra: Record<string, unknown> = {}) => ({
    id, idMal: id, title: { romaji: `Rec ${id}`, english: null }, coverImage: { large: '' }, meanScore: 75,
    genres, format: 'TV', relations: { edges: [] }, ...extra,
  }) as any
  const node = (m: any, rating = 20): RecNode => ({ rating, media: m })
  const library = [
    lib(1, {}, ['Fantasy', 'Drama']), lib(2, {}, ['Fantasy']), lib(3, { my_score: 8 }, ['Fantasy', 'Adventure']),
    lib(4, { my_status: 'dropped', progress: 5 }, ['Ecchi']), lib(5, { my_score: 2 }, ['Harem']),
    lib(6, { my_status: 'plan_to_watch', progress: 0 }),
  ]
  const recs = new Map<number, RecNode[]>([
    [1, [node(media(100, ['Fantasy'])), node(media(101, ['Action']), 200), node(media(6)), node(media(102, ['Fantasy'], { relations: { edges: [{ relationType: 'PREQUEL', node: { id: 999 } }] } }))]],
    [2, [node(media(100, ['Fantasy']))]],
    [3, [node(media(100, ['Fantasy'])), node(media(103, ['Fantasy'])), node(media(104, ['Ecchi']))]],
    [4, [node(media(104, ['Ecchi']), 100)]],
    [5, [node(media(103, ['Fantasy']), 100)]],
  ])
  const ranked = rankRecommendations(library, recs, { exclude: new Set([101]) })
  const ids = ranked.map(r => r.anilistId)
  test('a show recommended by 3 of your liked shows ranks first', () => assert.equal(ids[0], 100))
  test('"because" lists the shows that led to it', () => assert.equal(ranked[0].because.length, 3))
  test('dismissed (not interested), already-listed and unseen-prequel sequels are excluded', () => {
    assert.equal(ids.includes(101), false); assert.equal(ids.includes(6), false); assert.equal(ids.includes(102), false)
  })
  test('shows similar to ones you dropped / scored low rank below comparable picks', () => {
    const s = (id: number) => ranked.find(r => r.anilistId === id)?.score ?? -9
    assert.ok(s(104) < s(100)); assert.ok(s(103) < s(100))
  })
  test('genre taste is reported as matches', () => assert.ok(ranked[0].matches.includes('Fantasy')))
}

// ---------- English dub status (MAL-Dubs list) ----------
async function dubTests() {
  console.log('\n[Dubs]')
  const store = new Map<string, string>()
  let list = { dubbed: [21, 100, 200], incomplete: [200] }
  ;(globalThis as any).window = { api: { db: {
    getAppState: async (k: string) => store.get(k) ?? null,
    setAppState: async (k: string, v: string) => { store.set(k, v) },
  } } }
  ;(globalThis as any).fetch = async () => new Response(JSON.stringify(list), { status: 200 })
  await loadDubs(true)
  test('status: complete / ongoing / none', () => {
    assert.equal(dubStatus(21), 'complete'); assert.equal(dubStatus(200), 'ongoing'); assert.equal(dubStatus(5), 'none'); assert.equal(dubStatus(null), 'unknown')
  })
  const lib = (malId: number, status = 'watching') => ({ id: malId, mal_id: malId, title: `Show ${malId}`, entry: { my_status: status } }) as any
  const library = [lib(21), lib(200), lib(300, 'plan_to_watch'), lib(400, 'dropped')]
  const first = await dubChanges(library)
  test('first run records state silently (no notification flood)', () => assert.equal(first.length, 0))
  list = { dubbed: [21, 100, 200, 300, 400], incomplete: [300] }
  await loadDubs(true)
  const changes = await dubChanges(library)
  test('dub finished (in progress -> complete) notifies "Dub complete"', () => {
    assert.equal(changes.find(x => x.animeId === 200)?.title, 'Dub complete')
  })
  test('new dub (none -> in progress) notifies "Dub started"', () => {
    assert.equal(changes.find(x => x.animeId === 300)?.title, 'Dub started')
  })
  test('dropped shows never notify; unchanged shows stay quiet', () => {
    assert.equal(changes.some(x => x.animeId === 400), false); assert.equal(changes.some(x => x.animeId === 21), false)
  })
  test('a dubbed show still airing counts as "dub in progress"', () => {
    assert.equal(dubStatus(21, 'RELEASING'), 'ongoing'); assert.equal(dubStatus(21, 'FINISHED'), 'complete')
  })
  const airing = { id: 500, mal_id: 500, title: 'New Season', airing_status: 'RELEASING', entry: { my_status: 'watching' } } as any
  list = { dubbed: [21, 100, 200, 300, 400, 500], incomplete: [300] }
  await loadDubs(true)
  await dubChanges([...library, airing])
  const done = await dubChanges([...library, { ...airing, airing_status: 'FINISHED' }])
  test('new season: dub flagged complete once the show finishes airing → "Dub complete"', () => {
    assert.equal(done.find(x => x.animeId === 500)?.title, 'Dub complete')
  })
  ;(globalThis as any).fetch = async () => { throw new Error('offline') }
  await loadDubs(true)
  test('cached list survives going offline', () => assert.equal(dubStatus(300), 'ongoing'))
}

dubTests().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})

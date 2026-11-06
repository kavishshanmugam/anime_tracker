// Self-test for the streaming-source engine. Run: npm run test:sources
//  - Part 1 hits the real network: safety gate against known-bad / known-good domains.
//  - Part 2 uses a mocked fetch to simulate a mirror site end-to-end (search → show → episode,
//    failover, learning from player URLs, slug migration, navigation allowlist).
import assert from 'node:assert/strict'
import { runSafetyGate } from '../electron/sources/safety'
import { SourceEngine } from '../electron/sources/engine'
import { setFetchImpl } from '../electron/sources/http'
import type { ProviderDef, SafetyReport } from '../electron/sources/types'

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) }
  catch (e: any) { failed++; console.log(`  ✕ ${name}\n      ${e?.message ?? e}`) }
}
const fails = (r: SafetyReport) => r.checks.filter(c => c.status === 'fail').map(c => `${c.id}: ${c.detail}`).join(' | ')

const gogo: ProviderDef = {
  id: 'gogo', name: 'Gogo', layout: 'gogo', priority: 10, brandLabels: ['anitaku', 'gogoanime'], domains: [],
  searchPath: '/search.html?keyword={q}', fingerprint: ['class=["\']last_episodes'],
}

async function networkTests() {
  console.log('\n[1] Safety gate (live network)')
  await test('rejects plain HTTP before any network call', async () => {
    const r = await runSafetyGate('http://anitaku.to', gogo, 'discovered')
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /HTTPS/)
  })
  await test('rejects raw IP address', async () => {
    const r = await runSafetyGate('https://1.2.3.4', gogo, 'discovered')
    assert.equal(r.verdict, 'blocked')
  })
  await test('rejects punycode look-alike', async () => {
    const r = await runSafetyGate(new URL('https://аnitaku.to').origin, gogo, 'discovered') // Cyrillic "а"
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /punycode/)
  })
  await test('rejects .zip TLD', async () => {
    const r = await runSafetyGate('https://anitaku.zip', gogo, 'discovered')
    assert.equal(r.verdict, 'blocked')
  })
  await test('rejects domain outside the site family', async () => {
    const r = await runSafetyGate('https://example.com', gogo, 'discovered')
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /brand/)
  })
  await test('Cloudflare malware filter blocks malware.testcategory.com', async () => {
    const r = await runSafetyGate('https://malware.testcategory.com', { ...gogo, brandLabels: ['testcategory'] }, 'discovered')
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /threat-cf/)
  })
  await test('Quad9 threat filter blocks isitblocked.org', async () => {
    const r = await runSafetyGate('https://isitblocked.org', { ...gogo, brandLabels: ['isitblocked'] }, 'discovered')
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /threat-q9/)
  })
  await test('non-existent domain is "unreachable" (not unsafe, retried later)', async () => {
    const r = await runSafetyGate('https://anitaku-doesnotexist-zz9.com', { ...gogo, brandLabels: ['anitaku-doesnotexist-zz9'] }, 'discovered')
    assert.equal(r.verdict, 'unreachable'); assert.match(fails(r), /reach/)
  })
  await test('discovered domain for a source without fingerprint is held for approval', async () => {
    const wiki: ProviderDef = { ...gogo, brandLabels: ['wikipedia'], searchPath: '/w/index.php?search={q}', fingerprint: undefined }
    const r = await runSafetyGate('https://en.wikipedia.org', wiki, 'discovered')
    assert.equal(r.verdict, 'pending', fails(r))
  })
  await test('same-family redirector is "moved" (unreachable) and reports its target', async () => {
    const realFetch = fetch
    setFetchImpl(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://anitaku.bz')) {
        const r = new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })
        Object.defineProperty(r, 'url', { value: 'https://anitaku.new/' })
        return r
      }
      return realFetch(url, init)
    })
    const r = await runSafetyGate('https://anitaku.bz', gogo, 'bundled')
    setFetchImpl((u, i) => fetch(u, i))
    assert.equal(r.verdict, 'unreachable'); assert.equal(r.redirectedTo, 'https://anitaku.new')
  })
  await test('mirror redirecting to an ad/malware host is blocked (real DNS, replayed redirect)', async () => {
    const realFetch = fetch
    setFetchImpl(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://anitaku.bz')) {
        const r = new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })
        Object.defineProperty(r, 'url', { value: 'http://click-v4.expclknb.com/click?i=x' })
        return r
      }
      return realFetch(url, init)
    })
    const r = await runSafetyGate('https://anitaku.bz', gogo, 'discovered')
    setFetchImpl((u, i) => fetch(u, i))
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /off-site/)
  })
  await test('add a site from just a link: gate runs, search form auto-detected + verified (live, wikipedia)', async () => {
    const e = new SourceEngine(memoryStore(), () => {})
    const r = await e.addSiteByLink('https://en.wikipedia.org/wiki/Anime')
    const p = e.provider(r.providerId!)
    console.log('      ', r.message)
    assert.equal(r.ok, true); assert.equal(r.searchVerified, true)
    assert.match(p!.searchPath, /search=\{q\}/)
    const t = await e.testSearch(r.providerId!, 'Naruto')
    assert.equal(t.ok, true, t.message)
  })
  await test('add a site from a link: unsafe site is refused and nothing is kept (live, Cloudflare test domain)', async () => {
    const e = new SourceEngine(memoryStore(), () => {})
    const r = await e.addSiteByLink('https://malware.testcategory.com/')
    assert.equal(r.ok, false); assert.match(r.message, /safety/)
    assert.equal(e.state.customProviders.length, 0)
    assert.equal(Object.keys(e.state.domains).some(o => o.includes('testcategory')), false)
  })
  await test('dead anitaku.bz is blocked (live)', async () => {
    const r = await runSafetyGate('https://anitaku.bz', gogo, 'bundled')
    console.log('      ', r.checks.map(c => `${c.status}:${c.id}`).join(' '))
    assert.equal(r.verdict, 'blocked')
  })
  await test('parked "Coming Soon" page is blocked (real DNS, replayed page)', async () => {
    const realFetch = fetch
    setFetchImpl(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://anitaku.bz')) {
        const r = new Response('<html><head><title>anitaku.bz - Coming Soon</title></head><body>Coming soon</body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } })
        Object.defineProperty(r, 'url', { value: url })
        return r
      }
      return realFetch(url, init)
    })
    const r = await runSafetyGate('https://anitaku.bz', gogo, 'bundled')
    setFetchImpl((u, i) => fetch(u, i))
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /Parked/)
  })
  await test('clone with wrong layout fails fingerprint (real DNS, replayed page)', async () => {
    const realFetch = fetch
    setFetchImpl(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://anitaku.bz')) {
        const r = new Response('<html><title>Watch anime</title><a href="/x">ok</a></html>', { status: 200, headers: { 'content-type': 'text/html' } })
        Object.defineProperty(r, 'url', { value: url })
        return r
      }
      return realFetch(url, init)
    })
    const r = await runSafetyGate('https://anitaku.bz', gogo, 'discovered')
    setFetchImpl((u, i) => fetch(u, i))
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /fingerprint/)
  })
  await test('forced binary download is blocked (real DNS, replayed response)', async () => {
    const realFetch = fetch
    setFetchImpl(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://anitaku.bz')) {
        const r = new Response('MZ...', { status: 200, headers: { 'content-type': 'application/octet-stream' } })
        Object.defineProperty(r, 'url', { value: url })
        return r
      }
      return realFetch(url, init)
    })
    const r = await runSafetyGate('https://anitaku.bz', gogo, 'discovered')
    setFetchImpl((u, i) => fetch(u, i))
    assert.equal(r.verdict, 'blocked'); assert.match(fails(r), /download/)
  })
  await test('a clean, real site passes DNS/threat/HTTP checks (wikipedia.org with matching brand + fingerprint)', async () => {
    const wiki: ProviderDef = { ...gogo, brandLabels: ['wikipedia'], searchPath: '/w/index.php?search={q}', fingerprint: ['mw-search|searchresults|One Piece'] }
    const r = await runSafetyGate('https://en.wikipedia.org', wiki, 'discovered')
    console.log('      ', r.checks.map(c => `${c.status}:${c.id}`).join(' '))
    assert.notEqual(r.verdict, 'blocked', fails(r))
  })
}

// ---------- simulated mirror ----------

function mockSite(routes: Record<string, string | { status: number; body?: string; redirect?: string }>) {
  setFetchImpl(async (url: string) => {
    const route = routes[url] ?? routes[url.replace(/\?t=\d+$/, '')]
    if (route === undefined) {
      if (/cloudflare-dns|dns\.google|rdap/.test(url)) throw new Error('network disabled in mock')
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } })
    }
    if (typeof route === 'string') {
      const r = new Response(route, { status: 200, headers: { 'content-type': 'text/html' } })
      Object.defineProperty(r, 'url', { value: url })
      return r
    }
    const r = new Response(route.body ?? '', { status: route.status, headers: { 'content-type': 'text/html' } })
    Object.defineProperty(r, 'url', { value: route.redirect ?? url })
    return r
  })
}

function memoryStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v) }, m }
}

function markSafe(e: SourceEngine, origin: string, providerId = 'gogo') {
  e.state.domains[origin] ??= { origin, providerId, source: 'bundled', approved: false, safety: null, successes: 0, failures: 0, consecutiveFailures: 0, addedAt: 0 }
  e.state.domains[origin].safety = { origin, verdict: 'safe', checks: [], checkedAt: Date.now() }
}

async function engineTests() {
  console.log('\n[2] Engine (simulated mirrors)')
  const A = 'https://anitaku.to', B = 'https://anitaku.pe'
  const search = `<ul class="items"><li><p class="name"><a href="/category/one-piece-dub" title="One Piece (Dub)">x</a></p></li>
    <li><p class="name"><a href="/category/one-piece" title="One Piece">x</a></p></li>
    <li><p class="name"><a href="/category/one-piece-film-red" title="One Piece Film: Red">x</a></p></li></ul><div class="last_episodes"></div>`
  const show = `<ul id="episode_page"></ul><input type="hidden" value="123" id="movie_id">`
  const ajax = `<li><a href=" /one-piece-episode-10"></a></li><li><a href=" /one-piece-episode-1"></a></li><li><a href=" /one-piece-episode-11"></a></li>`

  await test('silent log', () => {})
  const quiet = () => {}

  await test('search → show → episode via AJAX list, picks sub over dub and exact ep', async () => {
    mockSite({
      [`${A}/search.html?keyword=One%20Piece`]: search,
      [`${A}/category/one-piece`]: show,
      [`${A}/ajax/load-list-episode?ep_start=0&ep_end=9999&id=123`]: ajax,
    })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A)
    const r = await e.resolveEpisode('One Piece', 1)
    assert.equal(r.url, `${A}/one-piece-episode-1`)
    assert.equal(e.state.slugs['one-piece'].gogo, '/category/one-piece')
  })

  await test('cached slug uses direct episode URL on a different mirror (domain-agnostic cache)', async () => {
    mockSite({ [`${B}/one-piece-episode-5`]: '<title>One Piece Episode 5</title><div id="player"></div>' })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, B)
    e.state.slugs['one-piece'] = { gogo: '/category/one-piece' }
    const r = await e.resolveEpisode('One Piece', 5)
    assert.equal(r.url, `${B}/one-piece-episode-5`)
  })

  await test('fails over to next mirror when first is down, and records health', async () => {
    mockSite({
      [`${A}/one-piece-episode-2`]: { status: 0 as any, body: '' },
      [`${B}/one-piece-episode-2`]: '<title>ep 2</title>',
    })
    setFetchImpl(async (url: string) => {
      if (url.startsWith(A)) throw new Error('ECONNREFUSED')
      const r = new Response('<title>ep 2</title>', { status: 200, headers: { 'content-type': 'text/html' } })
      Object.defineProperty(r, 'url', { value: url })
      return r
    })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A); markSafe(e, B)
    e.state.domains[A].lastOkAt = Date.now() // prefer A first
    e.state.slugs['one-piece'] = { gogo: '/category/one-piece' }
    const r = await e.resolveEpisode('One Piece', 2)
    assert.equal(r.origin, B)
    assert.ok(e.state.domains[A].consecutiveFailures >= 1)
  })

  await test('circuit breaker: 3 failures → cooldown, healthy mirror sorted first', async () => {
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A); markSafe(e, B)
    e.state.domains[A].lastOkAt = Date.now()
    for (let i = 0; i < 3; i++) e.recordResult(A, false, undefined, 'down')
    assert.ok(e.state.domains[A].cooldownUntil! > Date.now())
    assert.deepEqual(e.usableOrigins('gogo'), [B, A])
    e.recordResult(A, true, 100)
    assert.equal(e.state.domains[A].cooldownUntil, undefined)
  })

  await test('redirect to an off-brand host counts as failure (hijacked mirror)', async () => {
    setFetchImpl(async (url: string) => {
      const r = new Response('<html>casino</html>', { status: 200, headers: { 'content-type': 'text/html' } })
      Object.defineProperty(r, 'url', { value: 'https://evil-casino.example/' })
      return r
    })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A)
    e.state.lastDiscoveryAt.gogo = Date.now() // skip discovery
    const r = await e.resolveEpisode('One Piece', 1)
    assert.notEqual(r.isSearch && r.url.includes('evil'), true)
    assert.ok(e.state.domains[A].failures >= 1)
  })

  await test('blocked / pending-unapproved domains are never used or navigable', async () => {
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A)
    e.state.domains[A].safety!.verdict = 'blocked'
    e.state.domains[B] = { origin: B, providerId: 'gogo', source: 'discovered', approved: false, safety: { origin: B, verdict: 'pending', checks: [], checkedAt: Date.now() }, successes: 0, failures: 0, consecutiveFailures: 0, addedAt: 0 }
    assert.deepEqual(e.usableOrigins('gogo'), [])
    assert.equal(e.isAllowedNavigation(`${A}/x`), false)
    assert.equal(e.isAllowedNavigation(`${B}/x`), false)
    e.approveDomain(B, true)
    assert.equal(e.isAllowedNavigation(`${B}/x`), true)
    assert.equal(e.approveDomain(A, true), false, 'blocked domains cannot be approved')
    assert.equal(e.isAllowedNavigation('https://evil.example/'), false)
    assert.equal(e.isAllowedNavigation(`http://anitaku.pe/x`), false)
  })

  await test('strict approval mode holds even fully-safe discovered domains', async () => {
    const e = new SourceEngine(memoryStore(), quiet)
    e.state.domains[B] = { origin: B, providerId: 'gogo', source: 'discovered', approved: false, safety: { origin: B, verdict: 'safe', checks: [], checkedAt: Date.now() }, successes: 0, failures: 0, consecutiveFailures: 0, addedAt: 0 }
    assert.equal(e.usable(e.state.domains[B]), true)
    e.setOptions({ strictApproval: true })
    assert.equal(e.usable(e.state.domains[B]), false)
  })

  await test('learnFromUrl: gogo episode page → slug saved, wrong ep redirected', () => {
    const e = new SourceEngine(memoryStore(), quiet)
    markSafe(e, A)
    const r = e.learnFromUrl('Frieren', `${A}/sousou-no-frieren-episode-3`, 7)!
    assert.equal(r.onEpisode, true)
    assert.equal(r.redirect, `${A}/sousou-no-frieren-episode-7`)
    assert.equal(e.state.slugs['frieren'].gogo, '/category/sousou-no-frieren')
    const s = e.learnFromUrl('Frieren', `${A}/category/sousou-no-frieren`, 2)!
    assert.equal(s.redirect, `${A}/sousou-no-frieren-episode-2`)
  })

  await test('generic provider learns an episode URL template and reuses it', async () => {
    const G = 'https://somesite.example'
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    e.state.customProviders.push({ id: 'custom-x', name: 'X', layout: 'generic', priority: 1, brandLabels: ['somesite'], domains: [G], searchPath: '/search?q={q}', custom: true })
    markSafe(e, G, 'custom-x')
    e.state.domains[G].source = 'user'
    const r = e.learnFromUrl('Dandadan', `${G}/watch/dandadan-19319?ep=3`, 3)!
    assert.equal(r.onEpisode, true)
    assert.equal(e.state.slugs['dandadan']['custom-x'], 'tpl:/watch/dandadan-19319?ep={ep}')
    setFetchImpl(async (url: string) => {
      const r = new Response('<title>Dandadan</title>', { status: 200, headers: { 'content-type': 'text/html' } })
      Object.defineProperty(r, 'url', { value: url })
      return r
    })
    const res = await e.resolveEpisode('Dandadan', 4, { providerId: 'custom-x' })
    assert.equal(res.url, `${G}/watch/dandadan-19319?ep=4`)
  })

  await test('generic search scoring picks the right show link', () => {
    const e = new SourceEngine(memoryStore(), quiet)
    const p: ProviderDef = { id: 'g', name: 'G', layout: 'generic', priority: 1, brandLabels: ['s'], domains: [], searchPath: '/s?q={q}' }
    const html = `<a href="/home">Home</a><a href="/anime/attack-on-titan-final-season-112">Attack on Titan Final Season</a>
      <a href="/anime/attack-on-titan-16498" title="Attack on Titan"><img></a><a href="/genre/action">Action</a>`
    assert.equal(e.findShowPath(p, html, 'https://s.example', ['Attack on Titan', 'Shingeki no Kyojin']), '/anime/attack-on-titan-16498')
    assert.equal(e.findShowPath(p, html, 'https://s.example', ['Totally Different Show']), null)
  })

  await test('sub/dub: dub mode picks the "(Dub)" result, sub mode the plain one', () => {
    const e = new SourceEngine(memoryStore(), quiet)
    const p = e.provider('gogo')!
    const html = `<p class="name"><a href="/category/one-piece-dub" title="One Piece (Dub)">x</a></p>
      <p class="name"><a href="/category/one-piece" title="One Piece">x</a></p>`
    assert.equal(e.findShowPath(p, html, A, ['One Piece'], 'sub'), '/category/one-piece')
    assert.equal(e.findShowPath(p, html, A, ['One Piece'], 'dub'), '/category/one-piece-dub')
  })
  await test('sub/dub: dub mode never silently returns the sub', () => {
    const e = new SourceEngine(memoryStore(), quiet)
    const html = `<p class="name"><a href="/category/frieren" title="Frieren">x</a></p>`
    assert.equal(e.findShowPath(e.provider('gogo')!, html, A, ['Frieren'], 'dub'), null)
  })
  await test('sub/dub: no dub anywhere → falls back to sub and flags it', async () => {
    mockSite({
      [`${A}/search.html?keyword=Frieren`]: `<div class="last_episodes"></div><p class="name"><a href="/category/frieren" title="Frieren">x</a></p>`,
      [`${A}/frieren-episode-3`]: '<title>Frieren Episode 3</title>',
    })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A)
    e.state.lastDiscoveryAt.gogo = Date.now()
    const r = await e.resolveEpisode('Frieren', 3, { audio: 'dub' })
    assert.equal(r.url, `${A}/frieren-episode-3`); assert.equal(r.audio, 'sub'); assert.equal(r.audioFallback, true)
  })
  await test('sub/dub: dub resolves to the dub page and is cached separately from the sub', async () => {
    mockSite({
      [`${A}/search.html?keyword=One%20Piece`]: `<p class="name"><a href="/category/one-piece-dub" title="One Piece (Dub)">x</a></p><p class="name"><a href="/category/one-piece" title="One Piece">x</a></p>`,
      [`${A}/one-piece-dub-episode-2`]: '<title>ep</title>',
      [`${A}/one-piece-episode-2`]: '<title>ep</title>',
    })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A)
    e.state.lastDiscoveryAt.gogo = Date.now()
    const d = await e.resolveEpisode('One Piece', 2, { audio: 'dub' })
    const sb = await e.resolveEpisode('One Piece', 2, { audio: 'sub' })
    assert.equal(d.url, `${A}/one-piece-dub-episode-2`); assert.equal(d.audio, 'dub')
    assert.equal(sb.url, `${A}/one-piece-episode-2`)
    assert.equal(e.state.slugs['one-piece::dub'].gogo, '/category/one-piece-dub')
    assert.equal(e.state.slugs['one-piece'].gogo, '/category/one-piece')
  })
  await test('sub/dub: clicking a dub episode on the site is learned as dub', () => {
    const e = new SourceEngine(memoryStore(), quiet)
    markSafe(e, A)
    const r = e.learnFromUrl('Dandadan', `${A}/dandadan-dub-episode-4`, 4)!
    assert.equal(r.audio, 'dub')
    assert.equal(e.state.slugs['dandadan::dub'].gogo, '/category/dandadan-dub')
    assert.equal(e.state.slugs['dandadan'], undefined)
  })
  await test('sub/dub: dub listed only under the English title / a synonym is still found', async () => {
    setFetchImpl(async (url: string) => {
      let body = '<div class="last_episodes"></div>'
      if (url.startsWith('https://graphql.anilist.co'))
        body = JSON.stringify({ data: { Media: { title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End" }, synonyms: ['Frieren at the Funeral', '葬送のフリーレン'] } } })
      else if (url === `${A}/search.html?keyword=Frieren%20Beyond%20Journey%20s%20End`)
        body += `<p class="name"><a href="/category/frieren-beyond-journeys-end-dub" title="Frieren: Beyond Journey's End (Dub)">x</a></p>`
      else if (url === `${A}/frieren-beyond-journeys-end-dub-episode-1`) body = '<title>ep1</title>'
      const r = new Response(body, { status: url.includes('search') || url.includes('episode') || url.includes('anilist') ? 200 : 404, headers: { 'content-type': url.includes('anilist') ? 'application/json' : 'text/html' } })
      Object.defineProperty(r, 'url', { value: url })
      return r
    })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, A)
    e.state.lastDiscoveryAt.gogo = Date.now()
    const r = await e.resolveEpisode('Sousou no Frieren', 1, { audio: 'dub', anilistId: 154587 })
    assert.equal(r.url, `${A}/frieren-beyond-journeys-end-dub-episode-1`); assert.equal(r.audio, 'dub')
    const alt = await e.altTitles(154587)
    assert.equal(alt.includes('葬送のフリーレン'), false, 'non-Latin synonyms are skipped')
  })
  await test('bundled source list is valid and includes the new sites', () => {
    const e = new SourceEngine(memoryStore(), quiet)
    assert.equal(SourceEngine.validateManifest(e.manifest), true)
    const ids = e.providers(true).map(p => p.id)
    for (const id of ['gogo', '9anime', 'animesuge', 'animesuge-alt', '4anime']) assert.ok(ids.includes(id), id)
  })
  await test('browser-only source: no scraping; learned show → direct episode URL; otherwise search fallback', async () => {
    const F = 'https://4anime.lol'
    let fetched = 0
    setFetchImpl(async () => { fetched++; throw new Error('should not be called') })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, F, '4anime')
    e.state.lastDiscoveryAt['4anime'] = Date.now()
    for (const id of ['gogo', '9anime', 'animesuge', 'animesuge-alt']) e.setProviderPref(id, { enabled: false })
    const first = await e.resolveEpisode('Frieren', 3)
    assert.equal(first.isSearch, true); assert.equal(first.url, `${F}/?s=Frieren`)
    e.learnFromUrl('Frieren', `${F}/frieren-beyond-journeys-end-episode-1-english-subbed/`, 1)
    const next = await e.resolveEpisode('Frieren', 3)
    assert.equal(next.url, `${F}/frieren-beyond-journeys-end-episode-3-english-subbed/`)
    assert.equal(fetched, 0, 'browser-only sites are never fetched in the background')
  })
  await test('wrong first match is skipped: tries the next candidate and only remembers the one that has the episode', async () => {
    const N = 'https://9anime.by'
    mockSite({
      [`${N}/?s=Sousou%20no%20Frieren`]: `<div class="bsx"><a href="${N}/anime/sousou-no-frieren-series/">x</a><a href="${N}/anime/sousou-no-frieren/">x</a></div>`,
      [`${N}/anime/sousou-no-frieren-series/`]: '<h1>series</h1><a href="/other-show-episode-5-english-subbed/">sidebar</a>',
      [`${N}/sousou-no-frieren-episode-5-english-subbed/`]: '<title>Sousou no Frieren Episode 5</title>',
    })
    const e = new SourceEngine(memoryStore(), quiet)
    for (const o of Object.keys(e.state.domains)) delete e.state.domains[o]
    markSafe(e, N, '9anime')
    for (const id of ['gogo', 'animesuge', 'animesuge-alt', '4anime']) e.setProviderPref(id, { enabled: false })
    e.state.lastDiscoveryAt['9anime'] = Date.now()
    const r = await e.resolveEpisode('Sousou no Frieren', 5)
    assert.equal(r.url, `${N}/sousou-no-frieren-episode-5-english-subbed/`)
    assert.equal(e.state.slugs['sousou-no-frieren']['9anime'], '/anime/sousou-no-frieren/')
  })
  await test('legacy slug_cache is migrated to provider-relative paths', () => {
    const store = memoryStore({ slug_cache: JSON.stringify([['naruto', 'https://anitaku.so/category/naruto'], ['bleach', 'bleach']]) })
    const e = new SourceEngine(store, quiet)
    assert.equal(e.state.slugs['naruto'].gogo, '/category/naruto')
    assert.equal(e.state.slugs['bleach'].gogo, '/category/bleach')
  })

  await test('manifest validation rejects http domains and invalid regexes', () => {
    const ok = { version: 2, updated: '', tlds: [], adHosts: [], providers: [{ id: 'a', name: 'A', searchPath: '/s?q={q}', domains: ['https://a.to'], brandLabels: ['a'], episodeLink: ['-episode-{ep}'] }] }
    assert.equal(SourceEngine.validateManifest(ok), true)
    assert.equal(SourceEngine.validateManifest({ ...ok, providers: [{ ...ok.providers[0], domains: ['http://a.to'] }] }), false)
    assert.equal(SourceEngine.validateManifest({ ...ok, providers: [{ ...ok.providers[0], fingerprint: ['(['] }] }), false)
  })

  await test('ad host blocking matches subdomains and respects toggle', () => {
    const e = new SourceEngine(memoryStore(), quiet)
    assert.equal(e.isAdHost('pagead2.googlesyndication.com'), true)
    assert.equal(e.isAdHost('notgooglesyndication.com'), false)
    e.setOptions({ adblock: false })
    assert.equal(e.isAdHost('pagead2.googlesyndication.com'), false)
  })

  await test('state persists through the store', () => {
    const store = memoryStore()
    const e = new SourceEngine(store, quiet)
    e.state.slugs['x'] = { gogo: '/category/x' }
    e.flush()
    const e2 = new SourceEngine(store, quiet)
    assert.equal(e2.state.slugs['x'].gogo, '/category/x')
  })
}

async function liveDiscovery() {
  console.log('\n[3] Live discovery + resolve with the bundled source list (informational)')
  setFetchImpl((u, i) => fetch(u, i))
  const e = new SourceEngine(memoryStore(), m => console.log(`      ${m}`))
  const t0 = Date.now()
  const r = await e.resolveEpisode('One Piece', 1)
  console.log(`   result after ${Math.round((Date.now() - t0) / 1000)}s: ${r.url || '(none)'} search=${r.isSearch}`)
  for (const t of r.tried) console.log(`   tried ${t.providerId} ${t.origin ?? ''}: ${t.reason}`)
  for (const d of Object.values(e.state.domains))
    console.log(`   ${d.origin.padEnd(32)} ${d.source.padEnd(10)} ${d.safety?.verdict ?? '-'}  ${d.safety?.checks.filter(c => c.status === 'fail' || c.status === 'warn').map(c => c.detail).join('; ') ?? ''}`)
}

;(async () => {
  const onlyEngine = process.argv.includes('--offline')
  if (!onlyEngine) await networkTests()
  await engineTests()
  if (process.argv.includes('--live')) await liveDiscovery()
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()

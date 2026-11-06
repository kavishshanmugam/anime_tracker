// SourceEngine: provider registry + domain health + discovery + episode resolution.
// Electron-free so it can be exercised from a plain Node test harness.

import bundledManifest from './providers.json'
import { httpGet, pool } from './http'
import {
  brandLabel, cleanTitle, fillTemplate, hostMatches, hostOf, normalizeOrigin, slugify, titleSimilarity,
} from './domain'
import { isUsable, resolvesPublicly, runSafetyGate } from './safety'
import type {
  DomainSource, DomainState, Manifest, ProviderDef, ResolveResult, SafetyReport, StreamState,
} from './types'

export const DEFAULT_MANIFEST_URL =
  'https://raw.githubusercontent.com/kavishshanmugam/anime_tracker/master/electron/sources/providers.json'

const SAFETY_TTL = 7 * 86_400_000
const UNREACHABLE_TTL = 3_600_000
const REJECT_TTL = 24 * 3_600_000
const SOURCE_RANK: Record<DomainSource, number> = { user: 0, manifest: 1, bundled: 2, discovered: 3 }
const MANIFEST_TTL = 6 * 3_600_000
const DISCOVERY_COOLDOWN = 30 * 60_000
const DISCOVERY_AUTO_INTERVAL = 24 * 3_600_000
/** Background re-discovery while a source has no working domain (manual "Find domains" is always allowed). */
const DISCOVERY_RETRY_WHEN_DOWN = 6 * 3_600_000
const COOLDOWN_BASE = 5 * 60_000
const COOLDOWN_MAX = 6 * 3_600_000

export type Audio = 'sub' | 'dub'
/** Does a URL/title refer to the dubbed version? */
export const isDub = (text: string) => /(^|[^a-z])(dub|dubbed|english-dub)([^a-z]|$)/i.test(text)
/** Shows are cached per language: sub uses the plain title key (backwards compatible). */
export const showKey = (title: string, audio: Audio) => audio === 'dub' ? `${slugify(title)}::dub` : slugify(title)

export interface Store {
  get(key: string): string | null
  set(key: string, value: string): void
}

type Log = (msg: string) => void

interface Outcome { url?: string; netFail?: boolean; reason?: string }

export class SourceEngine {
  state: StreamState
  private store: Store
  private log: Log
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private inflightSafety = new Map<string, Promise<SafetyReport>>()
  private inflightDiscovery = new Map<string, Promise<string[]>>()
  private prefetchGen = new Map<string, number>()
  private listeners = new Set<() => void>()

  constructor(store: Store, log: Log = (m) => console.log(`[sources] ${m}`)) {
    this.store = store
    this.log = log
    this.state = this.load()
    this.syncDomains()
  }

  // ---------- persistence ----------

  private load(): StreamState {
    const fresh: StreamState = {
      version: 1, manifestUrl: DEFAULT_MANIFEST_URL, remoteManifest: null, customProviders: [],
      providerPrefs: {}, domains: {}, slugs: {}, lastDiscoveryAt: {}, rejected: {}, discoveryLog: [], adblock: true, strictApproval: false,
    }
    let state = fresh
    try {
      const raw = this.store.get('stream_state')
      if (raw) state = { ...fresh, ...JSON.parse(raw) }
    } catch { /* corrupted: start fresh */ }

    // Migrate legacy slug_cache (title key -> absolute show URL or bare slug) to provider 'gogo'.
    try {
      const legacy = this.store.get('slug_cache')
      if (legacy && !state.slugs.__migrated__) {
        for (const [key, value] of JSON.parse(legacy) as [string, string][]) {
          let path: string | null = null
          if (/^https?:\/\//.test(value)) { try { path = new URL(value).pathname } catch { /* */ } }
          else if (value) path = `/category/${value}`
          if (path) (state.slugs[key] ??= {}).gogo ??= path
        }
        state.slugs.__migrated__ = { v: '1' }
        this.log('migrated legacy slug cache')
      }
    } catch { /* ignore */ }
    return state
  }

  save() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 500)
    for (const l of this.listeners) { try { l() } catch { /* */ } }
  }

  flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null }
    try { this.store.set('stream_state', JSON.stringify(this.state)) } catch (e) { this.log(`save failed: ${e}`) }
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) }

  // ---------- manifest / providers ----------

  get manifest(): Manifest {
    const bundled = bundledManifest as Manifest
    const remote = this.state.remoteManifest
    return remote && remote.version >= bundled.version ? remote : bundled
  }

  providers(includeDisabled = false): ProviderDef[] {
    const list = [...this.manifest.providers, ...this.state.customProviders].map(p => {
      const pref = this.state.providerPrefs[p.id]
      return { ...p, enabled: pref?.enabled ?? p.enabled ?? true, priority: pref?.priority ?? p.priority }
    })
    return list.filter(p => includeDisabled || p.enabled).sort((a, b) => a.priority - b.priority)
  }

  provider(id: string): ProviderDef | undefined {
    return this.providers(true).find(p => p.id === id)
  }

  /** Make sure every manifest/custom domain has a DomainState entry. */
  private syncDomains() {
    const remoteIds = new Set(this.state.remoteManifest?.providers.map(p => p.id))
    for (const p of this.providers(true)) {
      const source: DomainSource = p.custom ? 'user' : remoteIds.has(p.id) && this.manifest === this.state.remoteManifest ? 'manifest' : 'bundled'
      for (const d of p.domains) {
        const origin = normalizeOrigin(d)
        if (origin && !this.state.domains[origin]) this.addDomainState(origin, p.id, source, source === 'user')
      }
    }
  }

  private addDomainState(origin: string, providerId: string, source: DomainSource, approved = false): DomainState {
    const d: DomainState = {
      origin, providerId, source, approved, safety: null, successes: 0, failures: 0, consecutiveFailures: 0, addedAt: Date.now(),
    }
    this.state.domains[origin] = d
    this.save()
    return d
  }

  static validateManifest(m: any): m is Manifest {
    if (!m || typeof m.version !== 'number' || !Array.isArray(m.providers) || !Array.isArray(m.tlds)) return false
    for (const p of m.providers) {
      if (!p.id || !p.name || !p.searchPath || !Array.isArray(p.domains) || !Array.isArray(p.brandLabels)) return false
      if (p.domains.some((d: string) => !/^https:\/\//.test(d))) return false
      const regexes = [...(p.fingerprint ?? []), ...(p.showLink ?? []), ...(p.episodeLink ?? []),
        p.episodeUrlPattern, p.showUrlPattern, p.episodeAjax?.idPattern].filter(Boolean)
      for (const r of regexes) { try { new RegExp(String(r).replace(/\{ep\}/g, '1')) } catch { return false } }
    }
    return true
  }

  async refreshManifest(force = false): Promise<{ ok: boolean; message: string }> {
    if (!force && this.state.manifestFetchedAt && Date.now() - this.state.manifestFetchedAt < MANIFEST_TTL)
      return { ok: true, message: 'Source list is up to date' }
    const url = this.state.manifestUrl
    if (!/^https:\/\//.test(url)) return this.manifestFail('Source list URL must use HTTPS')
    const r = await httpGet(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { accept: 'application/json', timeoutMs: 10000 })
    this.state.manifestFetchedAt = Date.now()
    if (!r.ok) return this.manifestFail(`Fetch failed (${r.status || r.error}) — using built-in list`)
    let parsed: unknown
    try { parsed = JSON.parse(r.body) } catch { return this.manifestFail('Remote list is not valid JSON') }
    if (!SourceEngine.validateManifest(parsed)) return this.manifestFail('Remote list failed validation')
    this.state.remoteManifest = parsed
    this.state.manifestError = undefined
    this.syncDomains()
    this.save()
    this.log(`manifest v${parsed.version} loaded (${parsed.providers.length} providers)`)
    return { ok: true, message: `Loaded source list v${parsed.version}` }
  }

  private manifestFail(message: string) {
    this.state.manifestError = message
    this.save()
    this.log(message)
    return { ok: false, message }
  }

  // ---------- safety + health ----------

  private stale(d: DomainState): boolean {
    if (!d.safety) return true
    const ttl = d.safety.verdict === 'unreachable' ? UNREACHABLE_TTL : SAFETY_TTL
    return Date.now() - d.safety.checkedAt > ttl
  }

  async ensureSafety(origin: string, force = false): Promise<SafetyReport | null> {
    const d = this.state.domains[origin]
    if (!d) return null
    if (!force && !this.stale(d)) return d.safety
    const existing = this.inflightSafety.get(origin)
    if (existing) return existing
    const provider = this.provider(d.providerId)
    if (!provider) return null
    const job = runSafetyGate(origin, provider, d.source, { safeBrowsingKey: this.state.safeBrowsingKey })
      .then(report => {
        d.safety = report
        this.save()
        this.log(`safety ${origin}: ${report.verdict}${report.verdict !== 'safe' ? ' — ' + report.checks.filter(c => c.status === 'fail' || c.status === 'warn').map(c => c.detail).join('; ') : ''}`)
        if (report.redirectedTo && !this.state.domains[report.redirectedTo]) {
          this.addCandidate(report.redirectedTo, provider.id, `redirect from ${origin}`).catch(() => {})
        }
        return report
      })
      .finally(() => this.inflightSafety.delete(origin))
    this.inflightSafety.set(origin, job)
    return job
  }

  usable(d: DomainState): boolean {
    if (d.removed || !d.safety) return false
    if (this.state.strictApproval && d.source === 'discovered' && !d.approved) return false
    return isUsable(d.safety.verdict, d.approved, d.source)
  }

  private cooling(d: DomainState) { return !!d.cooldownUntil && d.cooldownUntil > Date.now() }

  /** Ordered usable origins for a provider: healthy first, then fastest. */
  usableOrigins(providerId: string, exclude: string[] = []): string[] {
    return Object.values(this.state.domains)
      .filter(d => d.providerId === providerId && this.usable(d) && !exclude.includes(d.origin))
      .sort((a, b) =>
        Number(this.cooling(a)) - Number(this.cooling(b)) ||
        a.consecutiveFailures - b.consecutiveFailures ||
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
        (b.lastOkAt ?? 0) - (a.lastOkAt ?? 0) ||
        (a.latencyMs ?? 9e9) - (b.latencyMs ?? 9e9))
      .map(d => d.origin)
  }

  recordResult(origin: string, ok: boolean, ms?: number, error?: string) {
    const d = this.state.domains[origin]
    if (!d) return
    if (ok) {
      d.successes++; d.consecutiveFailures = 0; d.lastOkAt = Date.now(); d.cooldownUntil = undefined; d.lastError = undefined
      if (ms) d.latencyMs = d.latencyMs ? Math.round(d.latencyMs * 0.7 + ms * 0.3) : ms
    } else {
      d.failures++; d.consecutiveFailures++; d.lastFailAt = Date.now(); d.lastError = error
      if (d.consecutiveFailures >= 3)
        d.cooldownUntil = Date.now() + Math.min(COOLDOWN_BASE * 2 ** (d.consecutiveFailures - 3), COOLDOWN_MAX)
    }
    this.save()
  }

  /** Get usable origins, running safety checks and discovery if necessary. */
  private hasHealthy(providerId: string, exclude: string[] = []) {
    return this.usableOrigins(providerId, exclude).some(o => !this.cooling(this.state.domains[o]))
  }

  /** Vet domains that have never been checked (first run / new manifest entries), all providers in parallel. */
  private async vetUnchecked(providers: ProviderDef[], maxWaitMs = 20000) {
    const ids = new Set(providers.map(p => p.id))
    const unchecked = Object.values(this.state.domains).filter(d => ids.has(d.providerId) && !d.removed && this.stale(d))
    if (!unchecked.length) return
    await Promise.race([pool(unchecked, 6, d => this.ensureSafety(d.origin)), new Promise(r => setTimeout(r, maxWaitMs))])
  }

  async healthTick(): Promise<void> {
    const enabled = new Set(this.providers().map(p => p.id))
    const domains = Object.values(this.state.domains).filter(d => !d.removed && enabled.has(d.providerId))
    await pool(domains, 4, async d => {
      if (this.stale(d)) await this.ensureSafety(d.origin)
      if (!d.safety || d.safety.verdict === 'blocked' || d.safety.verdict === 'unreachable') return
      const r = await httpGet(`${d.origin}/`, { timeoutMs: 8000 })
      const finalHost = r.status ? hostOf(r.url) : ''
      const challenged = (r.status === 403 || r.status === 503) && /just a moment|cf-chl|challenge-platform|ddos-guard/i.test(r.body)
      // A bot challenge means the site is up (the player can pass it); only browser-only sources count it as healthy.
      const ok = (r.ok || (challenged && !!this.provider(d.providerId)?.browserOnly)) && hostMatches(finalHost, d.origin)
      this.recordResult(d.origin, ok, r.ms, ok ? undefined : r.error ?? (r.ok ? `redirected to ${finalHost}` : `HTTP ${r.status}`))
      const p = this.provider(d.providerId)
      if (p && finalHost && !hostMatches(finalHost, d.origin) && p.brandLabels.includes(brandLabel(finalHost))) {
        await this.addCandidate(`https://${finalHost}`, p.id, `health-check redirect from ${d.origin}`)
      }
    })
    for (const p of this.providers()) {
      const healthy = this.usableOrigins(p.id).filter(o => !this.cooling(this.state.domains[o]))
      const last = this.state.lastDiscoveryAt[p.id] ?? 0
      // A source whose domains already work doesn't need a discovery sweep on first run — start its daily clock instead.
      if (!last && healthy.length) { this.state.lastDiscoveryAt[p.id] = Date.now(); this.save(); continue }
      const due = Date.now() - last > (healthy.length ? DISCOVERY_AUTO_INTERVAL : DISCOVERY_RETRY_WHEN_DOWN)
      if (due) this.discover(p.id).catch(() => {})
    }
  }

  // ---------- discovery ----------

  private logDiscovery(providerId: string, message: string) {
    this.state.discoveryLog.unshift({ at: Date.now(), providerId, message })
    this.state.discoveryLog.length = Math.min(this.state.discoveryLog.length, 50)
    this.log(`discovery[${providerId}] ${message}`)
  }

  /** Add a newly found origin and run it through the security gate. */
  async addCandidate(origin: string, providerId: string, via: string): Promise<DomainState | null> {
    const norm = normalizeOrigin(origin)
    if (!norm || this.state.domains[norm]) return this.state.domains[norm ?? ''] ?? null
    if (Date.now() - (this.state.rejected[norm] ?? 0) < REJECT_TTL) return null
    const d = this.addDomainState(norm, providerId, 'discovered')
    const report = await this.ensureSafety(norm)
    const why = report?.checks.filter(c => c.status === 'fail' || c.status === 'warn').map(c => c.detail).join('; ')
    this.logDiscovery(providerId, `${norm} (via ${via}) → ${report?.verdict ?? 'error'}${why ? ` — ${why}` : ''}`)
    if (!report || report.verdict === 'blocked' || report.verdict === 'unreachable') {
      // Don't clutter the domain list with dead/unsafe guesses; remember them to skip re-checks.
      delete this.state.domains[norm]
      this.state.rejected[norm] = Date.now()
      this.save()
      return null
    }
    return d
  }

  discover(providerId: string): Promise<string[]> {
    const running = this.inflightDiscovery.get(providerId)
    if (running) return running
    const job = this.runDiscovery(providerId).finally(() => this.inflightDiscovery.delete(providerId))
    this.inflightDiscovery.set(providerId, job)
    return job
  }

  private async runDiscovery(providerId: string): Promise<string[]> {
    const p = this.provider(providerId)
    if (!p) return []
    this.state.lastDiscoveryAt[providerId] = Date.now()
    this.save()
    const known = new Set(Object.keys(this.state.domains))
    for (const [o, at] of Object.entries(this.state.rejected)) {
      if (Date.now() - at < REJECT_TTL) known.add(o); else delete this.state.rejected[o]
    }
    const candidates = new Map<string, string>() // origin -> via

    // 1) Redirects from known domains (sites usually 301 to the new home).
    const knownDomains = Object.values(this.state.domains).filter(d => d.providerId === providerId && !d.removed && d.safety?.verdict !== 'blocked')
    await pool(knownDomains, 4, async d => {
      const r = await httpGet(`${d.origin}/`, { timeoutMs: 8000 })
      const host = r.status ? hostOf(r.url) : ''
      if (host && !hostMatches(host, d.origin) && p.brandLabels.includes(brandLabel(host))) candidates.set(`https://${host}`, `redirect from ${d.origin}`)
    })

    // 2) Official domain hub pages.
    for (const hub of p.hubs ?? []) {
      const r = await httpGet(hub, { timeoutMs: 10000 })
      if (!r.ok) continue
      for (const m of r.body.matchAll(/https:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
        const host = m[1].toLowerCase()
        if (p.brandLabels.includes(brandLabel(host))) candidates.set(`https://${host}`, `hub ${hostOf(hub)}`)
      }
    }

    // 3) Same brand label on other TLDs — only those that actually resolve.
    const permutations: string[] = []
    for (const label of p.brandLabels) for (const tld of this.manifest.tlds) permutations.push(`${label}.${tld}`)
    const resolving = await pool(permutations.filter(h => !known.has(`https://${h}`)), 8, async h => (await resolvesPublicly(h)) ? h : null)
    for (const h of resolving) if (h) candidates.set(`https://${h}`, 'TLD probe')

    const fresh = [...candidates].filter(([o]) => !known.has(o))
    this.logDiscovery(providerId, `checked ${knownDomains.length} known, ${p.hubs?.length ?? 0} hubs, ${permutations.length} TLD variants → ${fresh.length} new candidate(s)`)
    const added = await pool(fresh, 3, ([o, via]) => this.addCandidate(o, providerId, via))
    return added.filter((d): d is DomainState => !!d && this.usable(d)).map(d => d.origin)
  }

  // ---------- scraping ----------

  private async fetchPage(origin: string, url: string): Promise<{ html?: string; finalUrl?: string; netFail?: boolean; reason?: string }> {
    const r = await httpGet(url, { timeoutMs: 10000 })
    if (r.status === 0 || r.status >= 500 || r.status === 403) {
      this.recordResult(origin, false, r.ms, r.error ?? `HTTP ${r.status}`)
      return { netFail: true, reason: r.error ?? `HTTP ${r.status}` }
    }
    if (!hostMatches(hostOf(r.url), origin)) {
      this.recordResult(origin, false, r.ms, `redirected to ${hostOf(r.url)}`)
      return { netFail: true, reason: `redirected to ${hostOf(r.url)}` }
    }
    this.recordResult(origin, true, r.ms)
    if (!r.ok) return { reason: `HTTP ${r.status}` }
    return { html: r.body, finalUrl: r.url }
  }

  /** Pick the best show link on a search page. */
  /** Show links on a search page, best title match first (only those above the match threshold). */
  rankShowPaths(p: ProviderDef, html: string, origin: string, titles: string[], audio: Audio = 'sub'): { path: string; score: number }[] {
    const cands: { path: string; title: string }[] = []
    for (const src of p.showLink ?? []) {
      let re: RegExp
      try { re = new RegExp(src, 'gi') } catch { continue }
      for (const m of html.matchAll(re)) cands.push({ path: m[1], title: m[2] ?? '' })
      if (cands.length) break
    }
    if (!cands.length) {
      // Generic: every same-site anchor, scored by its text/title.
      for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
        let path: string
        try {
          const u = new URL(m[1], origin)
          if (!hostMatches(u.hostname, origin) || u.pathname === '/' || /search|login|register|genre|\.(?:css|js|png|jpg)$/i.test(u.pathname)) continue
          path = u.pathname + u.search
        } catch { continue }
        const attrTitle = m[0].match(/title=["']([^"']+)["']/i)?.[1]
        cands.push({ path, title: attrTitle ?? m[2].replace(/<[^>]+>/g, ' ').trim() })
      }
    }
    // Dub mode only accepts results marked as dubbed (otherwise we'd silently play the sub).
    const pool = audio === 'dub' ? cands.filter(c => isDub(`${c.title} ${c.path}`)) : cands
    const ranked: { path: string; score: number }[] = []
    for (const c of pool) {
      const slug = (p.showUrlPattern && c.path.match(new RegExp(p.showUrlPattern, 'i'))?.[1]) || c.path.split('/').filter(Boolean).pop() || ''
      const score = Math.max(...titles.map(t => Math.max(
        c.title ? titleSimilarity(t, c.title) : 0,
        titleSimilarity(t, slug.replace(/-/g, ' ')),
      )))
      // Compare titles without the "(Dub)" marker; in sub mode prefer the non-dubbed result on ties.
      const dubbed = isDub(`${c.title} ${slug}`)
      const bare = audio === 'dub'
        ? Math.max(...titles.map(t => Math.max(
            c.title ? titleSimilarity(t, c.title.replace(/\(?\s*(english\s+)?dub(bed)?\s*\)?/ig, ' ')) : 0,
            titleSimilarity(t, slug.replace(/-?(english-)?dub(bed)?/ig, '').replace(/-/g, ' ')))))
        : score
      const adj = audio === 'dub' ? bare : score - (dubbed ? 0.05 : 0)
      const prev = ranked.find(r => r.path === c.path)
      if (prev) prev.score = Math.max(prev.score, adj)
      else ranked.push({ path: c.path, score: adj })
    }
    // Gogo results are already relevance-ranked; generic scraping needs a stronger signal.
    const threshold = p.layout === 'gogo' ? 0.3 : 0.5
    return ranked.filter(r => r.score >= threshold).sort((a, b) => b.score - a.score)
  }

  findShowPath(p: ProviderDef, html: string, origin: string, titles: string[], audio: Audio = 'sub'): string | null {
    return this.rankShowPaths(p, html, origin, titles, audio)[0]?.path ?? null
  }

  private episodeRegexes(p: ProviderDef, ep: number): RegExp[] {
    const sources = p.episodeLink?.length ? p.episodeLink : [
      'href=["\']\\s*([^"\']*?-episode-{ep}(?!\\d)[^"\']*)["\']',
      'href=["\']\\s*([^"\']*?/(?:episode|ep)[-/]{ep}(?!\\d)[^"\']*)["\']',
      'href=["\']\\s*([^"\']*?[?&](?:ep|episode)={ep}(?!\\d)[^"\']*)["\']',
    ]
    return sources.flatMap(s => { try { return [new RegExp(s.replace(/\{ep\}/g, String(ep)), 'i')] } catch { return [] } })
  }

  async findEpisodeOnShow(p: ProviderDef, origin: string, showPath: string, ep: number): Promise<Outcome> {
    const page = await this.fetchPage(origin, origin + showPath)
    if (!page.html) return { netFail: page.netFail, reason: page.reason ?? 'show page empty' }
    const showSlug = p.showUrlPattern ? showPath.match(new RegExp(p.showUrlPattern, 'i'))?.[1] : undefined
    const epRe = p.episodeUrlPattern ? new RegExp(p.episodeUrlPattern, 'i') : null
    const belongs = (href: string) => {
      if (!showSlug || !epRe) return true
      try { return new URL(href, page.finalUrl).pathname.match(epRe)?.[1] === showSlug } catch { return false }
    }
    for (const re of this.episodeRegexes(p, ep)) {
      for (const m of page.html.matchAll(new RegExp(re.source, 'gi'))) {
        if (belongs(m[1].trim())) return { url: new URL(m[1].trim(), page.finalUrl).href }
      }
    }
    if (p.episodeAjax) {
      const idm = page.html.match(new RegExp(p.episodeAjax.idPattern, 'i'))
      const id = idm?.slice(1).find(Boolean)
      if (id) {
        const ajax = await this.fetchPage(origin, origin + fillTemplate(p.episodeAjax.url, { id }))
        if (ajax.html) for (const re of this.episodeRegexes(p, ep)) {
          const m = ajax.html.match(re)
          if (m) return { url: new URL(m[1].trim(), origin + '/').href }
        }
      }
    }
    return { reason: `episode ${ep} not listed` }
  }

  private async tryDirectEpisode(p: ProviderDef, origin: string, showPath: string, ep: number): Promise<Outcome> {
    if (!p.episodeUrlTemplate || !p.showUrlPattern) return {}
    const slug = showPath.match(new RegExp(p.showUrlPattern, 'i'))?.[1]
    if (!slug) return {}
    const url = origin + fillTemplate(p.episodeUrlTemplate, { slug, ep })
    const page = await this.fetchPage(origin, url)
    if (page.html && page.finalUrl && new URL(page.finalUrl).pathname !== '/' && !/404|not\s+found/i.test(page.html.match(/<title>([^<]*)/i)?.[1] ?? ''))
      return { url: page.finalUrl }
    return { netFail: page.netFail, reason: page.reason }
  }

  /** Search the site with each title; returns candidate show paths, best first. */
  private async searchShow(p: ProviderDef, origin: string, titles: string[], audio: Audio = 'sub'): Promise<{ path?: string; paths: string[]; netFail?: boolean; reason?: string }> {
    const queries = audio === 'dub' ? [...titles, ...titles.slice(0, 2).map(t => `${t} dub`)] : titles
    const scores = new Map<string, number>()
    for (const t of queries) {
      const page = await this.fetchPage(origin, origin + fillTemplate(p.searchPath, { q: encodeURIComponent(cleanTitle(t)) }))
      if (page.netFail) return { netFail: true, paths: [], reason: page.reason }
      if (!page.html) continue
      for (const r of this.rankShowPaths(p, page.html, origin, titles, audio)) scores.set(r.path, Math.max(scores.get(r.path) ?? 0, r.score))
      if (Math.max(0, ...scores.values()) >= 0.95) break // exact title match — no need to try other names
    }
    const paths = [...scores].sort((a, b) => b[1] - a[1]).map(([path]) => path).slice(0, 4)
    return paths.length ? { path: paths[0], paths } : { paths, reason: audio === 'dub' ? 'no dub found on site' : 'not found on site' }
  }

  private async resolveOn(p: ProviderDef, origin: string, titles: string[], key: string, ep: number, audio: Audio = 'sub'): Promise<Outcome> {
    const cached = this.state.slugs[key]?.[p.id]
    if (p.browserOnly) {
      // Can't verify in the background — trust what the player learned, else fall back to its search page.
      if (cached?.startsWith('tpl:')) return { url: origin + fillTemplate(cached.slice(4), { ep }) }
      const slug = cached && p.showUrlPattern ? cached.match(new RegExp(p.showUrlPattern, 'i'))?.[1] : undefined
      if (slug && p.episodeUrlTemplate) return { url: origin + fillTemplate(p.episodeUrlTemplate, { slug, ep }) }
      return { reason: 'pick the show once on this site (it blocks automatic search)' }
    }
    if (cached?.startsWith('tpl:')) {
      const page = await this.fetchPage(origin, origin + fillTemplate(cached.slice(4), { ep }))
      if (page.html && page.finalUrl) return { url: page.finalUrl }
      if (page.netFail) return { netFail: true, reason: page.reason }
    } else if (cached) {
      const direct = await this.tryDirectEpisode(p, origin, cached, ep)
      if (direct.url || direct.netFail) return direct
      const viaShow = await this.findEpisodeOnShow(p, origin, cached, ep)
      if (viaShow.url || viaShow.netFail) return viaShow
    }
    const found = await this.searchShow(p, origin, titles, audio)
    if (!found.paths.length) return { netFail: found.netFail, reason: found.reason }
    // Try the best matches in order; only remember a show once it actually has the episode.
    let last: Outcome = { reason: found.reason }
    for (const path of found.paths) {
      const direct = await this.tryDirectEpisode(p, origin, path, ep)
      const out = direct.url ? direct : direct.netFail ? direct : await this.findEpisodeOnShow(p, origin, path, ep)
      if (out.url) { this.rememberShow(key, p.id, path); return out }
      if (out.netFail) return out
      last = out
    }
    return last
  }

  private rememberShow(key: string, providerId: string, path: string) {
    (this.state.slugs[key] ??= {})[providerId] = path
    this.save()
  }

  // ---------- public API ----------

  async resolveEpisode(title: string, ep: number, opts: { titleEn?: string; providerId?: string; excludeOrigins?: string[]; audio?: Audio; anilistId?: number } = {}): Promise<ResolveResult> {
    const audio: Audio = opts.audio === 'dub' ? 'dub' : 'sub'
    const alt = opts.anilistId ? await this.altTitles(opts.anilistId) : []
    opts = { ...opts, altTitles: alt } as typeof opts
    const first = await this.resolveWith(title, ep, opts, audio)
    if (audio === 'sub' || (first.url && !first.isSearch)) return { ...first, audio }
    // No dub anywhere: fall back to the sub rather than failing.
    const sub = await this.resolveWith(title, ep, opts, 'sub')
    if (sub.url && !sub.isSearch) return { ...sub, audio: 'sub', audioFallback: true }
    return { ...first, audio }
  }

  private async resolveWith(title: string, ep: number, opts: { titleEn?: string; providerId?: string; excludeOrigins?: string[]; altTitles?: string[] }, audio: Audio): Promise<ResolveResult> {
    const key = showKey(title, audio)
    // Dubs are usually listed under the English title, so search that first in dub mode.
    const ordered = audio === 'dub' ? [opts.titleEn, title, ...(opts.altTitles ?? [])] : [title, opts.titleEn, ...(opts.altTitles ?? [])]
    const titles = [...new Set(ordered.filter((t): t is string => !!t && !!t.trim()))].slice(0, 5)
    const exclude = opts.excludeOrigins ?? []
    const tried: ResolveResult['tried'] = []
    let providers = this.providers()
    if (opts.providerId) providers = [...providers.filter(p => p.id === opts.providerId), ...providers.filter(p => p.id !== opts.providerId)]
    let searchFallback: { url: string; p: ProviderDef; origin: string } | null = null

    const tryProvider = async (p: ProviderDef): Promise<ResolveResult | null> => {
      const origins = this.usableOrigins(p.id, exclude)
      if (!origins.length) { tried.push({ providerId: p.id, reason: 'no safe, reachable domain' }); return null }
      for (const origin of origins.slice(0, 3)) {
        const out = await this.resolveOn(p, origin, titles, key, ep, audio)
        if (out.url) {
          this.log(`resolved "${title}" ep ${ep} (${audio}) → ${out.url}`)
          return { url: out.url, isSearch: false, providerId: p.id, providerName: p.name, origin, tried, providers: this.providerSummary() }
        }
        tried.push({ providerId: p.id, origin, reason: out.reason ?? 'unknown' })
        searchFallback ??= { url: origin + fillTemplate(p.searchPath, { q: encodeURIComponent(cleanTitle(audio === 'dub' ? `${title} dub` : title)) }), p, origin }
        if (!out.netFail) break // site works but doesn't have it — mirrors share content, try next provider
      }
      return null
    }

    // Pass 1: providers that already have vetted, healthy domains — no waiting on discovery.
    await this.vetUnchecked(providers)
    for (const p of providers) {
      if (!this.hasHealthy(p.id, exclude)) continue
      const r = await tryProvider(p)
      if (r) return r
    }
    // Pass 2: look for new domains for providers with none healthy (bounded wait), then try them.
    const needDiscovery = providers.filter(p => !this.hasHealthy(p.id, exclude) &&
      Date.now() - (this.state.lastDiscoveryAt[p.id] ?? 0) > DISCOVERY_COOLDOWN)
    if (needDiscovery.length)
      await Promise.race([Promise.all(needDiscovery.map(p => this.discover(p.id))), new Promise(r => setTimeout(r, 25000))])
    for (const p of providers) {
      if (this.hasHealthy(p.id, exclude) && !tried.some(t => t.providerId === p.id && t.origin)) {
        const r = await tryProvider(p)
        if (r) return r
      } else if (!this.usableOrigins(p.id, exclude).length && !tried.some(t => t.providerId === p.id)) {
        tried.push({ providerId: p.id, reason: 'no safe, reachable domain' })
      } else if (!tried.some(t => t.providerId === p.id)) {
        // Only cooling-down domains left: last resort.
        const r = await tryProvider(p)
        if (r) return r
      }
    }
    const providersOut = this.providerSummary()
    // Assigned inside tryProvider; TS can't see that through the closure.
    const fb = searchFallback as { url: string; p: ProviderDef; origin: string } | null
    if (fb) return { url: fb.url, isSearch: true, providerId: fb.p.id, providerName: fb.p.name, origin: fb.origin, tried, providers: providersOut }
    return { url: '', isSearch: true, tried, providers: providersOut }
  }

  /**
   * How many episodes a site actually lists for this show in this language (e.g. the dub
   * page may be a few episodes behind). null when no working source can tell us.
   */
  async episodeCount(title: string, audio: Audio, opts: { titleEn?: string; anilistId?: number } = {}): Promise<number | null> {
    const key = showKey(title, audio)
    const cache = ((this.state as any).epCounts ??= {}) as Record<string, { at: number; count: number | null }>
    const hit = cache[key]
    if (hit && Date.now() - hit.at < 6 * 3_600_000) return hit.count
    const alt = opts.anilistId ? await this.altTitles(opts.anilistId) : []
    const ordered = audio === 'dub' ? [opts.titleEn, title, ...alt] : [title, opts.titleEn, ...alt]
    const titles = [...new Set(ordered.filter((t): t is string => !!t))].slice(0, 5)
    let count: number | null = null
    for (const p of this.providers()) {
      const origin = this.usableOrigins(p.id).find(o => !this.cooling(this.state.domains[o]))
      if (!origin) continue
      let path = this.state.slugs[key]?.[p.id]
      if (path?.startsWith('tpl:')) continue // learned per-episode template: no show page to count
      if (!path) {
        const found = await this.searchShow(p, origin, titles, audio)
        if (!found.path) continue
        path = found.path
        this.rememberShow(key, p.id, path)
      }
      const page = await this.fetchPage(origin, origin + path)
      if (!page.html) continue
      let html = page.html
      if (p.episodeAjax) {
        const id = page.html.match(new RegExp(p.episodeAjax.idPattern, 'i'))?.slice(1).find(Boolean)
        if (id) html += (await this.fetchPage(origin, origin + fillTemplate(p.episodeAjax.url, { id }))).html ?? ''
      }
      const nums = [...html.matchAll(/-episode-(\d+)(?!\d)|[?&](?:ep|episode)=(\d+)(?!\d)|\/(?:episode|ep)[-/](\d+)(?!\d)/gi)]
        .map(m => Number(m[1] ?? m[2] ?? m[3])).filter(n => n > 0 && n < 5000)
      if (nums.length) { count = Math.max(...nums); break }
    }
    cache[key] = { at: Date.now(), count }
    this.save()
    return count
  }

  /** English title + Latin-script synonyms from AniList (cached 30 days) — sites often list shows under these. */
  async altTitles(anilistId: number): Promise<string[]> {
    const cache = (this.state as any).titleCache as Record<string, { at: number; titles: string[] }> | undefined
    const hit = cache?.[anilistId]
    if (hit && Date.now() - hit.at < 30 * 86_400_000) return hit.titles
    const r = await httpGet('https://graphql.anilist.co', {
      method: 'POST', accept: 'application/json', timeoutMs: 6000, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query($id:Int){Media(id:$id,type:ANIME){title{romaji english}synonyms}}', variables: { id: anilistId } }),
    })
    let titles: string[] = []
    try {
      const m = JSON.parse(r.body).data.Media
      titles = [m.title.english, m.title.romaji, ...(m.synonyms ?? [])]
        .filter((t: unknown): t is string => typeof t === 'string' && /^[\x20-\x7E\u00C0-\u024F]+$/.test(t) && t.length <= 80)
    } catch { return hit?.titles ?? [] }
    ;((this.state as any).titleCache ??= {})[anilistId] = { at: Date.now(), titles: [...new Set(titles)].slice(0, 6) }
    this.save()
    return titles
  }

  providerSummary() {
    return this.providers().map(p => ({ id: p.id, name: p.name, available: this.usableOrigins(p.id).length > 0 }))
  }

  async prefetch(title: string, titleEn?: string) {
    const key = slugify(title)
    const p = this.providers()[0]
    if (!p || this.state.slugs[key]?.[p.id]) return
    const gen = (this.prefetchGen.get(key) ?? 0) + 1
    this.prefetchGen.set(key, gen)
    const origin = this.usableOrigins(p.id)[0]
    if (!origin) return
    const found = await this.searchShow(p, origin, [title, titleEn].filter((t): t is string => !!t))
    if (this.prefetchGen.get(key) !== gen) return
    if (found.path) this.rememberShow(key, p.id, found.path)
  }

  cancelPrefetch(title: string) {
    const key = slugify(title)
    this.prefetchGen.set(key, (this.prefetchGen.get(key) ?? 0) + 1)
  }

  /** Called by the player when the user navigates inside the site. */
  learnFromUrl(title: string, url: string, wantedEp: number): { providerId: string; onEpisode: boolean; episode?: number; redirect?: string; audio: Audio } | null {
    let u: URL
    try { u = new URL(url) } catch { return null }
    const d = Object.values(this.state.domains).find(x => hostMatches(u.hostname, x.origin))
    const p = d ? this.provider(d.providerId) : this.providers(true).find(x => x.brandLabels.includes(brandLabel(u.hostname)))
    if (!p) return null
    const audio: Audio = isDub(u.pathname + u.search) ? 'dub' : 'sub'
    const key = showKey(title, audio)
    const path = u.pathname
    const genericEp = /-episode-(\d+)|\/(?:episode|ep)[-/](\d+)|[?&](?:ep|episode)=(\d+)/i
    const epRe = p.episodeUrlPattern ? new RegExp(p.episodeUrlPattern, 'i') : null
    const em = epRe ? path.match(epRe) : null
    if (em) {
      const slug = em[1], epNum = Number(em[2])
      if (p.showPathTemplate) this.rememberShow(key, p.id, fillTemplate(p.showPathTemplate, { slug }))
      const redirect = epNum !== wantedEp && p.episodeUrlTemplate
        ? `${u.origin}${fillTemplate(p.episodeUrlTemplate, { slug, ep: wantedEp })}` : undefined
      return { providerId: p.id, onEpisode: true, episode: epNum, redirect, audio }
    }
    const sm = p.showUrlPattern ? path.match(new RegExp(p.showUrlPattern, 'i')) : null
    if (sm) {
      this.rememberShow(key, p.id, path)
      const redirect = p.episodeUrlTemplate ? `${u.origin}${fillTemplate(p.episodeUrlTemplate, { slug: sm[1], ep: wantedEp })}` : undefined
      return { providerId: p.id, onEpisode: false, redirect, audio }
    }
    const rel = url.slice(u.origin.length)
    const gm = rel.match(genericEp)
    if (gm && gm.index !== undefined) {
      const num = gm.slice(1).find(Boolean)!
      const epNum = Number(num)
      // Remember an episode URL template for this show: same URL with {ep} in place of the number.
      const at = gm.index + gm[0].lastIndexOf(num)
      const tpl = rel.slice(0, at) + '{ep}' + rel.slice(at + num.length)
      this.rememberShow(key, p.id, `tpl:${tpl}`)
      const redirect = epNum !== wantedEp ? u.origin + fillTemplate(tpl, { ep: wantedEp }) : undefined
      return { providerId: p.id, onEpisode: true, episode: epNum, redirect, audio }
    }
    return { providerId: p.id, onEpisode: false, audio }
  }

  reportFailure(url: string, reason: string) {
    const host = hostOf(url)
    const d = Object.values(this.state.domains).find(x => hostMatches(host, x.origin))
    if (d) this.recordResult(d.origin, false, undefined, reason)
  }

  /** Top-level navigation allowlist for the player webview. */
  isAllowedNavigation(url: string): boolean {
    if (url === 'about:blank') return true
    let u: URL
    try { u = new URL(url) } catch { return false }
    if (u.protocol !== 'https:') return false
    return Object.values(this.state.domains).some(d => this.usable(d) && hostMatches(u.hostname, d.origin))
  }

  isAdHost(host: string): boolean {
    if (!this.state.adblock) return false
    return this.manifest.adHosts.some(a => host === a || host.endsWith(`.${a}`))
  }

  clearCache(title?: string) {
    if (title) { delete this.state.slugs[slugify(title)]; delete this.state.slugs[showKey(title, 'dub')] }
    else this.state.slugs = { __migrated__: { v: '1' } }
    this.save()
  }

  // ---------- settings operations ----------

  snapshot() {
    const now = Date.now()
    return {
      manifestUrl: this.state.manifestUrl,
      manifestVersion: this.manifest.version,
      manifestSource: this.manifest === this.state.remoteManifest ? 'remote' : 'built-in',
      manifestFetchedAt: this.state.manifestFetchedAt,
      manifestError: this.state.manifestError,
      adblock: this.state.adblock,
      strictApproval: this.state.strictApproval,
      hasSafeBrowsingKey: !!this.state.safeBrowsingKey,
      discoveryLog: this.state.discoveryLog.slice(0, 20),
      providers: this.providers(true).map(p => ({
        id: p.id, name: p.name, enabled: !!p.enabled, priority: p.priority, custom: !!p.custom, layout: p.layout,
        discovering: this.inflightDiscovery.has(p.id), lastDiscoveryAt: this.state.lastDiscoveryAt[p.id],
        domains: Object.values(this.state.domains).filter(d => d.providerId === p.id && !d.removed).map(d => ({
          origin: d.origin, source: d.source, approved: d.approved, usable: this.usable(d),
          checking: this.inflightSafety.has(d.origin),
          verdict: d.safety?.verdict ?? 'unchecked', checks: d.safety?.checks ?? [], checkedAt: d.safety?.checkedAt,
          latencyMs: d.latencyMs, failures: d.failures, successes: d.successes, consecutiveFailures: d.consecutiveFailures,
          coolingDown: !!d.cooldownUntil && d.cooldownUntil > now, cooldownUntil: d.cooldownUntil, lastError: d.lastError, lastOkAt: d.lastOkAt,
        })),
      })),
    }
  }

  setProviderPref(id: string, pref: { enabled?: boolean; priority?: number }) {
    const p = this.provider(id)
    if (!p) return
    this.state.providerPrefs[id] = { enabled: pref.enabled ?? !!p.enabled, priority: pref.priority ?? p.priority }
    this.save()
  }

  /** Move provider up/down by swapping priorities with its neighbour. */
  moveProvider(id: string, dir: -1 | 1) {
    const list = this.providers(true)
    const i = list.findIndex(p => p.id === id), j = i + dir
    if (i < 0 || j < 0 || j >= list.length) return
    list.forEach((p, idx) => { this.state.providerPrefs[p.id] = { enabled: !!p.enabled, priority: idx * 10 } })
    this.state.providerPrefs[list[i].id].priority = j * 10
    this.state.providerPrefs[list[j].id].priority = i * 10
    this.save()
  }

  async addUserDomain(providerId: string, input: string): Promise<{ ok: boolean; message: string; report?: SafetyReport }> {
    const origin = normalizeOrigin(input)
    if (!origin) return { ok: false, message: 'Not a valid URL' }
    if (!origin.startsWith('https://')) return { ok: false, message: 'Only HTTPS sites are allowed' }
    if (!this.provider(providerId)) return { ok: false, message: 'Unknown source' }
    const existing = this.state.domains[origin]
    if (existing) { existing.removed = false; existing.approved = true; existing.source = existing.source === 'discovered' ? 'user' : existing.source }
    else this.addDomainState(origin, providerId, 'user', true)
    const report = await this.ensureSafety(origin, true)
    if (!report) return { ok: false, message: 'Check failed' }
    const msg = report.verdict === 'blocked'
      ? `Blocked: ${report.checks.filter(c => c.status === 'fail').map(c => c.detail).join('; ')}`
      : report.verdict === 'pending' ? 'Added with warnings (you approved it by adding it)' : 'Added — all safety checks passed'
    return { ok: report.verdict !== 'blocked', message: msg, report }
  }

  approveDomain(origin: string, approved: boolean) {
    const d = this.state.domains[origin]
    if (!d || d.safety?.verdict === 'blocked') return false
    d.approved = approved
    this.save()
    return true
  }

  removeDomain(origin: string) {
    const d = this.state.domains[origin]
    if (d) { d.removed = true; this.save() }
  }

  async addCustomProvider(input: { name: string; url: string; searchPath?: string; layout: 'gogo' | 'generic' }): Promise<{ ok: boolean; message: string }> {
    const origin = normalizeOrigin(input.url)
    if (!origin?.startsWith('https://')) return { ok: false, message: 'Enter an HTTPS site URL' }
    const label = brandLabel(hostOf(origin))
    const id = `custom-${slugify(input.name || label)}`
    if (this.provider(id)) return { ok: false, message: 'A source with that name already exists' }
    const gogo = (bundledManifest as Manifest).providers.find(p => p.layout === 'gogo')
    let searchPath = input.searchPath?.trim() || (input.layout === 'gogo' ? '/search.html?keyword={q}' : '/search?keyword={q}')
    if (/^https?:\/\//.test(searchPath)) { try { const u = new URL(searchPath); searchPath = u.pathname + u.search } catch { /* */ } }
    if (!searchPath.includes('{q}')) return { ok: false, message: 'Search path must contain {q} where the query goes' }
    const def: ProviderDef = input.layout === 'gogo' && gogo
      ? { ...gogo, id, name: input.name || label, priority: 100, brandLabels: [label], domains: [origin], hubs: [], searchPath, custom: true }
      : { id, name: input.name || label, layout: 'generic', priority: 100, brandLabels: [label], domains: [origin], searchPath, custom: true }
    this.state.customProviders.push(def)
    this.addDomainState(origin, id, 'user', true)
    const report = await this.ensureSafety(origin, true)
    return report?.verdict === 'blocked'
      ? { ok: false, message: `Source added but its domain was blocked: ${report.checks.filter(c => c.status === 'fail').map(c => c.detail).join('; ')}` }
      : { ok: true, message: `Added ${def.name}` }
  }

  /**
   * Add a site from nothing but a link the user pasted. The security gate runs FIRST;
   * only if the domain passes do we crawl it to work out how its search works.
   */
  async addSiteByLink(input: string): Promise<{ ok: boolean; message: string; providerId?: string; searchVerified?: boolean }> {
    const origin = normalizeOrigin(input)
    if (!origin?.startsWith('https://')) return { ok: false, message: 'Paste an HTTPS link (https://…)' }
    const existing = this.state.domains[origin]
    if (existing && !existing.removed && this.provider(existing.providerId))
      return { ok: true, message: `${hostOf(origin)} is already a source (${this.provider(existing.providerId)!.name})`, providerId: existing.providerId }

    const label = brandLabel(hostOf(origin))
    let id = `custom-${slugify(label)}`
    for (let n = 2; this.provider(id); n++) id = `custom-${slugify(label)}-${n}`
    const def: ProviderDef = { id, name: label, layout: 'generic', priority: 100, brandLabels: [label], domains: [origin], searchPath: '/search?keyword={q}', custom: true }
    this.state.customProviders.push(def)
    this.addDomainState(origin, id, 'user', true)

    const report = await this.ensureSafety(origin, true)
    if (!report || report.verdict === 'blocked' || report.verdict === 'unreachable') {
      this.removeCustomProvider(id)
      const why = report?.checks.filter(c => c.status === 'fail').map(c => c.detail).join('; ') || 'check failed'
      return { ok: false, message: `Not added — ${report?.verdict === 'unreachable' ? 'site unreachable' : 'failed safety checks'}: ${why}` }
    }

    const found = await this.detectSite(origin, def)
    Object.assign(def, found.patch)
    this.save()
    const warn = report.verdict === 'pending' ? ' (with safety warnings — see its report)' : ''
    return {
      ok: true, providerId: id, searchVerified: found.verified,
      message: found.verified
        ? `Added ${def.name}${warn}: search works (${def.searchPath})`
        : `Added ${def.name}${warn}. Couldn't confirm its search automatically — the first time, pick the show yourself and Senpai will learn it`,
    }
  }

  /** Work out a site's search URL + layout by reading its homepage and test-searching. */
  private async detectSite(origin: string, def: ProviderDef): Promise<{ patch: Partial<ProviderDef>; verified: boolean }> {
    const home = await httpGet(`${origin}/`, { timeoutMs: 12000 })
    const html = home.ok ? home.body : ''
    const patch: Partial<ProviderDef> = {}
    const title = html.match(/<title[^>]*>([^<]{2,80})<\/title>/i)?.[1]?.split(/\s[|\-–—:]\s/)[0]?.trim()
    if (title && !/just a moment|attention required/i.test(title)) patch.name = title

    // gogo-style clone?
    const gogo = (bundledManifest as Manifest).providers.find(p => p.layout === 'gogo')
    const isGogo = !!gogo?.fingerprint?.some(f => new RegExp(f, 'i').test(html))

    // Candidate search URLs: real <form>s on the homepage first, then common conventions.
    const candidates: string[] = []
    for (const form of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
      if (/method=["']?post/i.test(form[1])) continue
      const action = form[1].match(/action=["']([^"']*)["']/i)?.[1] ?? '/'
      const input = [...form[2].matchAll(/<input\b[^>]*>/gi)].map(m => m[0])
        .find(i => /type=["']?(search|text)/i.test(i) || /name=["'](keyword|q|s|query|search|term|k|w|keyw)["']/i.test(i))
      const name = input?.match(/name=["']([^"']+)["']/i)?.[1]
      if (!name) continue
      try {
        const u = new URL(action || '/', `${origin}/`)
        if (!hostMatches(u.hostname, origin)) continue
        candidates.push(`${u.pathname}?${encodeURIComponent(name)}={q}`)
      } catch { /* bad action */ }
    }
    if (isGogo) candidates.push('/search.html?keyword={q}')
    candidates.push('/search?keyword={q}', '/search?q={q}', '/search.html?keyword={q}', '/?s={q}', '/search?query={q}',
      '/filter?keyword={q}', '/browser?keyword={q}', '/search/{q}', '/catalog?search={q}', '/anime?search={q}')
    const unique = [...new Set(candidates)].slice(0, 12)

    const probe: ProviderDef = { ...def, ...(isGogo && gogo ? { ...gogo, id: def.id, name: def.name, brandLabels: def.brandLabels, domains: def.domains, hubs: [] } : {}) }
    let firstLoading: string | null = null
    for (const path of unique) {
      const r = await httpGet(origin + fillTemplate(path, { q: encodeURIComponent('One Piece') }), { timeoutMs: 10000 })
      if (!r.ok || !hostMatches(hostOf(r.url), origin)) continue
      firstLoading ??= path
      if (this.findShowPath({ ...probe, searchPath: path }, r.body, origin, ['One Piece'])) {
        Object.assign(patch, isGogo && gogo ? { ...gogo, id: def.id, name: patch.name ?? def.name, brandLabels: def.brandLabels, domains: def.domains, hubs: [], custom: true } : { layout: 'generic' }, { searchPath: path })
        return { patch, verified: true }
      }
    }
    // Results may be rendered by JavaScript: keep the search page that loaded; the user's first pick teaches the rest.
    patch.searchPath = firstLoading ?? unique[0]
    if (isGogo && gogo) Object.assign(patch, { ...gogo, id: def.id, name: patch.name ?? def.name, brandLabels: def.brandLabels, domains: def.domains, hubs: [], custom: true, searchPath: patch.searchPath })
    return { patch, verified: false }
  }

  /** Settings "Test" button: search a title on a source and report what it found. */
  async testSearch(providerId: string, title: string): Promise<{ ok: boolean; message: string; url?: string }> {
    const p = this.provider(providerId)
    if (!p) return { ok: false, message: 'Unknown source' }
    const origin = this.usableOrigins(providerId)[0]
    if (!origin) return { ok: false, message: 'No safe, reachable domain for this source' }
    const r = await this.searchShowPublic(p, origin, title)
    return r.path ? { ok: true, message: `Found "${title}" → ${r.path}`, url: origin + r.path } : { ok: false, message: `Not found (${r.reason ?? 'no match'})` }
  }

  private searchShowPublic(p: ProviderDef, origin: string, title: string) { return this.searchShow(p, origin, [title]) }

  /**
   * Player "Paste a link": user found the show/episode page themselves. Vet the domain
   * (adding the site as a source if new), then learn from the URL and play it.
   */
  async useLink(title: string, url: string, ep: number): Promise<{ ok: boolean; message: string; url?: string; providerId?: string }> {
    let u: URL
    try { u = new URL(url.trim()) } catch { return { ok: false, message: 'Not a valid link' } }
    if (u.protocol !== 'https:') return { ok: false, message: 'Only HTTPS links are allowed' }
    let d = Object.values(this.state.domains).find(x => !x.removed && hostMatches(u.hostname, x.origin))
    if (!d) {
      const added = await this.addSiteByLink(u.origin)
      if (!added.ok) return added
      d = this.state.domains[normalizeOrigin(u.origin)!]
    } else if (!d.approved && d.safety?.verdict === 'pending') {
      d.approved = true // pasting a link on a held domain = approving it
      this.save()
    }
    if (!d || !this.usable(d)) {
      const report = d ? await this.ensureSafety(d.origin) : null
      if (!d || !report || !this.usable(d)) return { ok: false, message: `${u.hostname} did not pass the safety checks` }
    }
    const learned = this.learnFromUrl(title, u.href, ep)
    return { ok: true, message: `Playing from ${u.hostname}`, url: learned?.redirect ?? u.href, providerId: d.providerId }
  }

  removeCustomProvider(id: string) {
    this.state.customProviders = this.state.customProviders.filter(p => p.id !== id)
    for (const d of Object.values(this.state.domains)) if (d.providerId === id) delete this.state.domains[d.origin]
    delete this.state.providerPrefs[id]
    this.save()
  }

  setOptions(opts: { manifestUrl?: string; adblock?: boolean; strictApproval?: boolean; safeBrowsingKey?: string | null }) {
    if (opts.manifestUrl !== undefined) {
      const url = opts.manifestUrl.trim() || DEFAULT_MANIFEST_URL
      if (!/^https:\/\//.test(url)) throw new Error('Source list URL must use HTTPS')
      if (url !== this.state.manifestUrl) { this.state.manifestUrl = url; this.state.manifestFetchedAt = undefined }
    }
    if (opts.adblock !== undefined) this.state.adblock = opts.adblock
    if (opts.strictApproval !== undefined) this.state.strictApproval = opts.strictApproval
    if (opts.safeBrowsingKey !== undefined) this.state.safeBrowsingKey = opts.safeBrowsingKey || undefined
    this.save()
  }
}

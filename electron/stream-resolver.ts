import { ipcMain, net } from 'electron'

// ponytail: auto-resolves the slug from the streaming site's search page,
// so episodes play directly without user interaction. Slugs are persisted
// to DB via app_state so they survive restarts.

const ANISKIP_BASE = 'https://api.aniskip.com/v2'
let siteDomain = 'https://anitaku.so'

// ponytail: mirror list for parallel resolution, first hit wins
// Add mirrors here to try multiple sites simultaneously
let siteMirrors: string[] = []

interface SkipTime {
  type: 'op' | 'ed' | 'recap' | 'mixed-op' | 'mixed-ed'
  startTime: number
  endTime: number
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/['']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').replace(/-+/g, '-')
}

function cleanTitle(title: string): string {
  return title.replace(/\s*\(\d{4}\)\s*/g, ' ').replace(/[^a-zA-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function fetchRaw(url: string, timeoutMs = 10000, accept = 'application/json'): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const request = net.request({ url, method: 'GET', redirect: 'follow' })
      request.setHeader('Accept', accept)
      let body = '', resolved = false
      const timer = setTimeout(() => { if (!resolved) { resolved = true; request.abort(); resolve(null) } }, timeoutMs)
      request.on('response', (res) => {
        if (res.statusCode !== 200) { clearTimeout(timer); if (!resolved) { resolved = true; resolve(null) } return }
        res.on('data', (c) => { body += c.toString() })
        res.on('end', () => { clearTimeout(timer); if (!resolved) { resolved = true; resolve(body) } })
      })
      request.on('error', () => { clearTimeout(timer); if (!resolved) { resolved = true; resolve(null) } })
      request.end()
    } catch { resolve(null) }
  })
}

function fetchJson<T>(url: string, timeoutMs = 10000): Promise<T | null> {
  return fetchRaw(url, timeoutMs).then(body => {
    if (!body) return null
    try { return JSON.parse(body) } catch { return null }
  })
}

// Slug cache: title key → slug (persisted to DB via app_state)
const slugCache = new Map<string, string>()
let dbGetAppState: ((key: string) => string | null) | null = null
let dbSetAppState: ((key: string, value: string) => void) | null = null
const SLUG_DB_KEY = 'slug_cache'

function loadSlugCache() {
  if (!dbGetAppState) return
  try {
    const raw = dbGetAppState(SLUG_DB_KEY)
    if (raw) {
      const entries = JSON.parse(raw) as [string, string][]
      for (const [k, v] of entries) slugCache.set(k, v)
    }
  } catch {}
}

function saveSlugCache() {
  if (!dbSetAppState) return
  try {
    dbSetAppState(SLUG_DB_KEY, JSON.stringify([...slugCache.entries()]))
  } catch {}
}

// ponytail: LRU(2) warm cache — stores the show page URL so we don't re-search
interface WarmEntry { showPageUrl: string; site: string; resolvedAt: number }
const warmCache = new Map<string, WarmEntry>()
const WARM_MAX = 2

function warmSet(titleKey: string, entry: WarmEntry) {
  warmCache.delete(titleKey) // re-insert to update recency
  if (warmCache.size >= WARM_MAX) {
    const oldest = warmCache.keys().next().value!
    warmCache.delete(oldest)
  }
  warmCache.set(titleKey, entry)
}

// ponytail: generation counter per title for cancellation
const prefetchGen = new Map<string, number>()

// Step 1: Search the site → find the show/category page URL from results
async function findShowPage(title: string, domain: string): Promise<string | null> {
  const searchUrl = `${domain}/search.html?keyword=${encodeURIComponent(cleanTitle(title))}`
  const html = await fetchRaw(searchUrl, 10000, 'text/html')
  if (!html) return null

  // Look for category page link: /category/show-slug
  const categoryMatch = html.match(/href=["'](\/category\/[a-z0-9][\w-]*)["']/i)
  if (categoryMatch) return `${domain}${categoryMatch[1]}`

  // Some sites use direct show page links in results
  const showLink = html.match(/<a\s+href=["'](\/[a-z0-9][\w-]*)["'][^>]*class=["'][^"']*name["']/i)
  if (showLink) return `${domain}${showLink[1]}`

  // Broader: first link inside a list item that looks like a result
  const resultLink = html.match(/<li[^>]*>[\s\S]*?<a\s+href=["'](\/[a-z0-9][\w/-]*)["']/i)
  if (resultLink) return `${domain}${resultLink[1]}`

  return null
}

// Step 2: Fetch the show page → find the actual episode link
async function findEpisodeUrl(showPageUrl: string, ep: number): Promise<string | null> {
  const html = await fetchRaw(showPageUrl, 10000, 'text/html')
  if (!html) return null

  // ponytail: look for actual episode links in the page HTML
  // Gogoanime/anitaku pattern: links like /show-slug-episode-N
  // We search for the exact episode number in href attributes
  // ponytail: (?!\d) prevents ep 1 from matching ep 10/11/etc
  const epPatterns = [
    new RegExp(`href=["'](https?://[^"']*-episode-${ep}(?!\\d))[^"']*["']`, 'i'),
    new RegExp(`href=["'](\/[^"']*-episode-${ep}(?!\\d))[^"']*["']`, 'i'),
    new RegExp(`href=["']([^"']*[?&]ep=${ep}(?!\\d))[^"']*["']`, 'i'),
  ]

  for (const pattern of epPatterns) {
    const match = html.match(pattern)
    if (match) {
      const href = match[1].replace(/["']$/, '')
      // Make absolute if relative
      if (href.startsWith('/')) {
        const origin = new URL(showPageUrl).origin
        return `${origin}${href}`
      }
      return href
    }
  }

  // ponytail: gogoanime often has an episode list loaded via ajax with an id range
  // Look for the anime movie-id and construct the episode list URL
  const movieIdMatch = html.match(/value=["'](\d+)["'][^>]*id=["']movie_id["']/i)
    || html.match(/id=["']movie_id["'][^>]*value=["'](\d+)["']/i)
  if (movieIdMatch) {
    const movieId = movieIdMatch[1]
    // Fetch the episode list ajax endpoint
    const ajaxUrl = `${new URL(showPageUrl).origin}/ajax/load-list-episode?ep_start=0&ep_end=9999&id=${movieId}`
    const ajaxHtml = await fetchRaw(ajaxUrl, 10000, 'text/html')
    if (ajaxHtml) {
      const ajaxEpMatch = ajaxHtml.match(new RegExp(`href=["']\\s*([^"']*-episode-${ep}(?!\\d))\\s*["']`, 'i'))
      if (ajaxEpMatch) {
        const href = ajaxEpMatch[1].trim()
        if (href.startsWith('/')) return `${new URL(showPageUrl).origin}${href}`
        if (href.startsWith('http')) return href
        return `${new URL(showPageUrl).origin}/${href}`
      }
    }
  }

  return null
}

// Combined: search → show page → episode link, across all mirrors in parallel
async function resolveEpisodeFromSite(title: string, ep: number, domain: string): Promise<{ url: string; showPageUrl: string; site: string } | null> {
  const showPageUrl = await findShowPage(title, domain)
  if (!showPageUrl) return null

  const episodeUrl = await findEpisodeUrl(showPageUrl, ep)
  if (!episodeUrl) return null

  return { url: episodeUrl, showPageUrl, site: domain }
}

async function resolveEpisodeParallel(title: string, ep: number): Promise<{ url: string; showPageUrl: string; site: string } | null> {
  const domains = [siteDomain, ...siteMirrors.filter(m => m !== siteDomain)]

  if (domains.length === 1) {
    return resolveEpisodeFromSite(title, ep, domains[0])
  }

  try {
    return await Promise.any(
      domains.map(d => resolveEpisodeFromSite(title, ep, d).then(r => {
        if (!r) throw new Error('no result')
        return r
      }))
    )
  } catch {
    return null
  }
}

// Prefetch: find the show page URL in background so episode resolution is faster later
async function prefetchShowPage(title: string): Promise<void> {
  const titleKey = slugify(title)
  if (slugCache.has(titleKey) || warmCache.has(titleKey)) return

  const gen = (prefetchGen.get(titleKey) ?? 0) + 1
  prefetchGen.set(titleKey, gen)

  const domains = [siteDomain, ...siteMirrors.filter(m => m !== siteDomain)]

  // ponytail: just find the show page, don't resolve a specific episode
  let showPageUrl: string | null = null
  let site = siteDomain
  if (domains.length === 1) {
    showPageUrl = await findShowPage(title, domains[0])
  } else {
    try {
      const result = await Promise.any(
        domains.map(d => findShowPage(title, d).then(url => {
          if (!url) throw new Error('no result')
          return { url, site: d }
        }))
      )
      showPageUrl = result.url
      site = result.site
    } catch {}
  }

  // Check if cancelled
  if (prefetchGen.get(titleKey) !== gen) return

  if (showPageUrl) {
    slugCache.set(titleKey, showPageUrl)
    saveSlugCache()
    warmSet(titleKey, { showPageUrl, site, resolvedAt: Date.now() })
    console.log(`[stream] Prefetched show page for "${title}": ${showPageUrl}`)
  }
}

async function resolveUrl(title: string, ep: number): Promise<{ url: string; isSearch: boolean; site: string }> {
  const titleKey = slugify(title)

  // Check if we have a cached show page URL (from prefetch or previous resolve)
  const cachedShowPage = slugCache.get(titleKey) || warmCache.get(titleKey)?.showPageUrl
  const cachedSite = warmCache.get(titleKey)?.site ?? siteDomain

  if (cachedShowPage) {
    // Fetch the show page and find the actual episode link
    const episodeUrl = await findEpisodeUrl(cachedShowPage, ep)
    if (episodeUrl) {
      return { url: episodeUrl, isSearch: false, site: cachedSite }
    }
    // Show page cached but episode not found — try full resolve
  }

  // Full resolve: search → show page → episode link
  try {
    const result = await resolveEpisodeParallel(title, ep)
    if (result) {
      slugCache.set(titleKey, result.showPageUrl)
      saveSlugCache()
      warmSet(titleKey, { showPageUrl: result.showPageUrl, site: result.site, resolvedAt: Date.now() })
      console.log(`[stream] Resolved episode from "${title}" ep ${ep}: ${result.url}`)
      return { url: result.url, isSearch: false, site: result.site }
    }
  } catch {
    // Fall through to search page
  }

  // Fallback: load search page in webview for manual selection
  return { url: `${siteDomain}/search.html?keyword=${encodeURIComponent(cleanTitle(title))}`, isSearch: true, site: siteDomain }
}

async function fetchSkipTimes(malId: number, ep: number, duration?: number): Promise<SkipTime[]> {
  const len = duration ?? 1440
  const result = await fetchJson<{
    found: boolean
    results: { skipType: string; interval: { startTime: number; endTime: number } }[]
  }>(`${ANISKIP_BASE}/skip-times/${malId}/${ep}?types=op&types=ed&types=recap&types=mixed-op&types=mixed-ed&episodeLength=${len}`)
  if (!result?.found || !result.results) return []
  return result.results.map(r => ({ type: r.skipType as SkipTime['type'], startTime: r.interval.startTime, endTime: r.interval.endTime }))
}

export function registerStreamHandlers(getAppState?: (key: string) => string | null, setAppState?: (key: string, value: string) => void) {
  if (getAppState) dbGetAppState = getAppState
  if (setAppState) dbSetAppState = setAppState
  loadSlugCache()
  ipcMain.handle('stream:resolveEpisode', async (_event, title: string, ep: number) => {
    const { url, isSearch, site } = await resolveUrl(title, ep)
    console.log(`[stream] ${isSearch ? 'Search' : 'Direct'}: ${url}`)
    return { url, isSearch, site }
  })

  ipcMain.handle('stream:resolveShow', async (_event, title: string) => {
    const { url, isSearch, site } = await resolveUrl(title, 1)
    return { url, isSearch, site }
  })

  // ponytail: prefetch starts background resolution when user opens anime detail page
  ipcMain.handle('stream:prefetch', async (_event, title: string) => {
    prefetchShowPage(title).catch(() => {})
  })

  // ponytail: cancel prefetch when user navigates away
  ipcMain.handle('stream:cancelPrefetch', async (_event, title: string) => {
    const titleKey = slugify(title)
    // Bump generation to invalidate any in-flight prefetch
    prefetchGen.set(titleKey, (prefetchGen.get(titleKey) ?? 0) + 1)
  })

  ipcMain.handle('stream:learnSlug', async (_event, title: string, slug: string) => {
    slugCache.set(slugify(title), slug)
    saveSlugCache()
    console.log(`[stream] Learned slug for "${title}": ${slug}`)
  })

  ipcMain.handle('stream:getSources', async () => null)

  ipcMain.handle('stream:getSkipTimes', async (_event, malId: number, ep: number, duration?: number) => {
    return fetchSkipTimes(malId, ep, duration)
  })

  ipcMain.handle('stream:clearCache', async (_event, title?: string) => {
    if (title) { slugCache.delete(slugify(title)) } else { slugCache.clear() }
    saveSlugCache()
  })
  ipcMain.handle('stream:siteHealth', async () => [{ name: siteDomain, healthy: true, failures: 0 }])
  ipcMain.handle('stream:setApiUrl', async (_event, url: string) => { siteDomain = url.replace(/\/$/, ''); slugCache.clear(); warmCache.clear(); saveSlugCache() })
  ipcMain.handle('stream:getApiUrl', async () => siteDomain)
}

// Minimal HTTP layer. Uses Electron's net.fetch when injected (Chromium network
// stack, honours system proxy), falling back to Node's fetch so the core logic
// is testable outside Electron.

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>
let fetchImpl: FetchFn = (url, init) => fetch(url, init)
export function setFetchImpl(fn: FetchFn) { fetchImpl = fn }

export interface HttpResult {
  ok: boolean
  status: number
  /** Final URL after redirects. */
  url: string
  contentType: string
  body: string
  ms: number
  error?: string
}

export interface HttpOptions {
  timeoutMs?: number
  accept?: string
  method?: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
}

const MAX_BODY = 3_000_000

export async function httpGet(url: string, opts: HttpOptions = {}): Promise<HttpResult> {
  const start = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10000)
  try {
    const res = await fetchImpl(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...opts.headers,
      },
    })
    const contentType = res.headers.get('content-type') ?? ''
    let body = ''
    // Never buffer binaries (an unexpected download is itself a red flag).
    if (!contentType || /text|json|xml|javascript/i.test(contentType)) {
      body = await res.text()
      if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY)
    } else {
      try { await res.body?.cancel() } catch { /* ignore */ }
    }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, url: res.url || url, contentType, body, ms: Date.now() - start }
  } catch (e: any) {
    const msg = e?.name === 'AbortError' ? 'timeout' : String(e?.cause?.code ?? e?.message ?? e)
    return { ok: false, status: 0, url, contentType: '', body: '', ms: Date.now() - start, error: msg }
  } finally {
    clearTimeout(timer)
  }
}

export async function getJson<T>(url: string, opts: HttpOptions = {}): Promise<T | null> {
  const r = await httpGet(url, { accept: 'application/json', ...opts })
  if (!r.ok || !r.body) return null
  try { return JSON.parse(r.body) as T } catch { return null }
}

/** Run async tasks with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx])
    }
  })
  await Promise.all(workers)
  return out
}

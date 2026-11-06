// Hostname helpers. Deliberately simple: we only need "registrable domain" and
// "brand label" for same-family checks, not a full public-suffix list.

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'co.in',
  'com.mx', 'com.tr', 'com.ar', 'com.co', 'com.ph', 'com.vn', 'co.za', 'com.sg', 'com.my',
])

export function normalizeOrigin(input: string): string | null {
  try {
    let s = input.trim()
    if (!s) return null
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`
    const u = new URL(s)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.protocol}//${u.host}`.toLowerCase()
  } catch {
    return null
  }
}

export function hostOf(url: string): string {
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.')
  if (parts.length <= 2) return parts.join('.')
  const last2 = parts.slice(-2).join('.')
  return MULTI_PART_SUFFIXES.has(last2) ? parts.slice(-3).join('.') : last2
}

export function brandLabel(host: string): string {
  return registrableDomain(host).split('.')[0]
}

export function tldOf(host: string): string {
  const reg = registrableDomain(host)
  return reg.slice(reg.indexOf('.') + 1)
}

export function isIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host.startsWith('[')
}

export function isPrivateIp(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
}

/** host equals origin host or is a subdomain of it */
export function hostMatches(host: string, originOrHost: string): boolean {
  const base = originOrHost.includes('://') ? hostOf(originOrHost) : originOrHost
  if (!host || !base) return false
  const strip = (h: string) => h.replace(/^www\./, '')
  const h = strip(host), b = strip(base)
  return h === b || h.endsWith(`.${b}`)
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/(^-|-$)/g, '')
}

export function cleanTitle(title: string): string {
  return title.replace(/\s*\(\d{4}\)\s*/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

/** Token-overlap similarity in [0,1], biased against extra tokens (sequels). */
export function titleSimilarity(a: string, b: string): number {
  const tok = (s: string) => slugify(s).split('-').filter(Boolean)
  const ta = tok(a), tb = tok(b)
  if (!ta.length || !tb.length) return 0
  if (ta.join('-') === tb.join('-')) return 1
  const sb = new Set(tb)
  const common = ta.filter(t => sb.has(t)).length
  return (2 * common) / (ta.length + tb.length)
}

export function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
}

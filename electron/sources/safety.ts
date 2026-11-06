// Security gate: every domain must pass these checks before the app will load
// it in the player. Any 'fail' blocks the domain; any 'warn' quarantines it as
// 'pending' until the user approves it in Settings.
//
// Checks (no API keys required):
//   1. URL shape      - HTTPS only, no IP literals, no punycode/homoglyphs, no credentials, risky TLDs
//   2. Brand match    - registrable domain must belong to the provider's site family
//   3. DNS exists     - resolves via Cloudflare 1.1.1.1 and not to private/loopback IPs (rebinding)
//   4. Threat DNS     - Cloudflare 1.1.1.2 (malware filter) and Quad9 (threat-intel filter)
//   5. Domain age     - RDAP registration date; very new domains are quarantined
//   6. HTTPS probe    - valid TLS, HTML content, no off-site redirect, no parked/for-sale page, no auto-download
//   7. Fingerprint    - search page must look like the real provider
//   8. Safe Browsing  - optional, only if the user supplies a Google API key

import http2 from 'node:http2'
import { httpGet, getJson } from './http'
import { brandLabel, hostOf, isIpHost, isPrivateIp, registrableDomain, tldOf, fillTemplate } from './domain'
import type { DomainSource, ProviderDef, SafetyCheck, SafetyReport, Verdict } from './types'

const BLOCKED_TLDS = new Set(['zip', 'mov'])
const RISKY_TLDS = new Set(['tk', 'ml', 'ga', 'cf', 'gq', 'click', 'country', 'kim', 'work', 'xin', 'loan', 'top', 'rest', 'cfd', 'sbs'])
const NEW_DOMAIN_DAYS = 30

const PARKED_PATTERNS = [
  /domain\s+(?:name\s+)?(?:is\s+)?for\s+sale/i, /buy\s+this\s+domain/i, /this\s+domain\s+(?:may\s+be|is)\s+for\s+sale/i,
  /parkingcrew|sedoparking|bodis\.com|parklogic|above\.com\/marketplace|dan\.com\/buy|afternic/i,
  /<title>[^<]*(?:coming\s+soon|domain\s+parked|account\s+suspended|under\s+construction)[^<]*<\/title>/i,
  /this\s+account\s+has\s+been\s+suspended/i,
]
const CHALLENGE_PATTERNS = [/<title>\s*just a moment/i, /cf-browser-verification|challenge-platform|cf_chl_/i, /attention required!? \| cloudflare/i, /ddos-guard/i]
const DOWNLOAD_EXT = /\.(?:exe|msi|scr|bat|cmd|apk|dmg|vbs|jar|ps1)(?:[?"'#]|$)/i

// ---------- DNS over HTTPS ----------

interface DnsResult { rcode: number; ips: string[] }

async function dohJson(endpoint: string, name: string): Promise<DnsResult | null> {
  const r = await getJson<{ Status: number; Answer?: { type: number; data: string }[] }>(
    `${endpoint}?name=${encodeURIComponent(name)}&type=A`, { timeoutMs: 6000, accept: 'application/dns-json' })
  if (!r) return null
  return { rcode: r.Status, ips: (r.Answer ?? []).filter(a => a.type === 1).map(a => a.data) }
}

function buildDnsQuery(name: string): string {
  const parts: Buffer[] = [Buffer.from([0x53, 0x50, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0])]
  for (const l of name.split('.')) { parts.push(Buffer.from([l.length])); parts.push(Buffer.from(l, 'ascii')) }
  parts.push(Buffer.from([0, 0, 1, 0, 1]))
  return Buffer.concat(parts).toString('base64url')
}

/** Quad9 only serves RFC 8484 wire format over HTTP/2. We only need the RCODE. */
function dohQuad9(name: string): Promise<DnsResult | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: DnsResult | null) => { if (!done) { done = true; try { client.close() } catch { /* */ } resolve(v) } }
    const client = http2.connect('https://dns.quad9.net')
    client.on('error', () => finish(null))
    const req = client.request({ ':path': `/dns-query?dns=${buildDnsQuery(name)}`, accept: 'application/dns-message' })
    const chunks: Buffer[] = []
    req.on('data', (d: Buffer) => chunks.push(d))
    req.on('end', () => {
      const b = Buffer.concat(chunks)
      finish(b.length >= 12 ? { rcode: b[3] & 0x0f, ips: [] } : null)
    })
    req.on('error', () => finish(null))
    req.setTimeout(6000, () => finish(null))
    req.end()
  })
}

export async function resolvesPublicly(host: string): Promise<boolean> {
  const r = await dohJson('https://cloudflare-dns.com/dns-query', host) ?? await dohJson('https://dns.google/resolve', host)
  return !!r && r.rcode === 0 && r.ips.length > 0
}

// ---------- individual checks ----------

function checkShape(origin: string): SafetyCheck {
  const id = 'shape', label = 'URL safety'
  let u: URL
  try { u = new URL(origin) } catch { return { id, label, status: 'fail', detail: 'Not a valid URL' } }
  const host = u.hostname
  if (u.protocol !== 'https:') return { id, label, status: 'fail', detail: 'Only HTTPS sites are allowed' }
  if (u.username || u.password) return { id, label, status: 'fail', detail: 'URL contains embedded credentials' }
  if (isIpHost(host)) return { id, label, status: 'fail', detail: 'Raw IP addresses are not allowed' }
  if (host.split('.').some(l => l.startsWith('xn--'))) return { id, label, status: 'fail', detail: 'Internationalised (punycode) domain — possible look-alike' }
  if (u.port && u.port !== '443') return { id, label, status: 'fail', detail: `Non-standard port ${u.port}` }
  const tld = tldOf(host)
  if (BLOCKED_TLDS.has(tld)) return { id, label, status: 'fail', detail: `.${tld} TLD is commonly used for phishing` }
  if (RISKY_TLDS.has(tld)) return { id, label, status: 'warn', detail: `.${tld} has a high abuse rate` }
  return { id, label, status: 'pass', detail: 'HTTPS, plain hostname' }
}

function checkBrand(origin: string, provider: ProviderDef, source: DomainSource): SafetyCheck {
  const id = 'brand', label = 'Belongs to site family'
  const brand = brandLabel(hostOf(origin))
  if (provider.brandLabels.includes(brand)) return { id, label, status: 'pass', detail: `"${brand}" is a known ${provider.name} name` }
  if (source === 'user') return { id, label, status: 'warn', detail: `"${brand}" isn't a known name for ${provider.name} (added by you)` }
  return { id, label, status: 'fail', detail: `"${brand}" is not part of the ${provider.name} family` }
}

async function checkDns(host: string): Promise<SafetyCheck[]> {
  const [plain, cfSec, quad9] = await Promise.all([
    dohJson('https://cloudflare-dns.com/dns-query', host).then(r => r ?? dohJson('https://dns.google/resolve', host)),
    dohJson('https://security.cloudflare-dns.com/dns-query', host),
    dohQuad9(host),
  ])
  const out: SafetyCheck[] = []
  if (!plain) {
    out.push({ id: 'dns', label: 'DNS', status: 'warn', detail: 'Could not reach a DNS-over-HTTPS resolver' })
  } else if (plain.rcode !== 0 || !plain.ips.length) {
    out.push({ id: 'reach', label: 'DNS', status: 'fail', detail: 'Domain does not resolve (expired or taken down)' })
    return out
  } else if (plain.ips.some(isPrivateIp)) {
    out.push({ id: 'dns', label: 'DNS', status: 'fail', detail: `Resolves to a private/loopback address (${plain.ips.join(', ')})` })
    return out
  } else {
    out.push({ id: 'dns', label: 'DNS', status: 'pass', detail: `Resolves to ${plain.ips.slice(0, 3).join(', ')}` })
  }

  if (!cfSec) out.push({ id: 'threat-cf', label: 'Cloudflare malware filter', status: 'warn', detail: 'Filter unreachable' })
  else if (cfSec.ips.includes('0.0.0.0') || (plain && plain.rcode === 0 && cfSec.rcode !== 0))
    out.push({ id: 'threat-cf', label: 'Cloudflare malware filter', status: 'fail', detail: 'Flagged as malware/phishing by 1.1.1.2' })
  else out.push({ id: 'threat-cf', label: 'Cloudflare malware filter', status: 'pass', detail: 'Not flagged' })

  if (!quad9) out.push({ id: 'threat-q9', label: 'Quad9 threat filter', status: 'warn', detail: 'Filter unreachable' })
  else if (plain && plain.rcode === 0 && quad9.rcode === 3)
    out.push({ id: 'threat-q9', label: 'Quad9 threat filter', status: 'fail', detail: 'Blocked by Quad9 threat intelligence' })
  else out.push({ id: 'threat-q9', label: 'Quad9 threat filter', status: 'pass', detail: 'Not flagged' })
  return out
}

async function checkAge(host: string): Promise<SafetyCheck> {
  const id = 'age', label = 'Domain age'
  const reg = registrableDomain(host)
  const r = await getJson<{ events?: { eventAction: string; eventDate: string }[] }>(
    `https://rdap.org/domain/${reg}`, { timeoutMs: 8000, accept: 'application/rdap+json' })
  const ev = r?.events?.find(e => e.eventAction === 'registration')
  if (!ev) return { id, label, status: 'info', detail: 'Registration date not published for this TLD' }
  const days = Math.floor((Date.now() - Date.parse(ev.eventDate)) / 86_400_000)
  if (!Number.isFinite(days)) return { id, label, status: 'info', detail: 'Unknown registration date' }
  if (days < NEW_DOMAIN_DAYS) return { id, label, status: 'warn', detail: `Registered ${days} day(s) ago — new domains are higher risk` }
  return { id, label, status: 'pass', detail: `Registered ${days} days ago` }
}

async function checkHttp(origin: string, provider: ProviderDef): Promise<{ checks: SafetyCheck[]; redirectedTo?: string }> {
  const id = 'http', label = 'HTTPS probe'
  const r = await httpGet(`${origin}/`, { timeoutMs: 12000 })
  if (r.status === 0) {
    const tls = /CERT|SSL|TLS|certificate/i.test(r.error ?? '')
    if (tls) return { checks: [{ id, label, status: 'fail', detail: `Invalid TLS certificate (${r.error})` }] }
    // Not a security failure: the site is down or the network (ISP / firewall) blocks it.
    return { checks: [{ id: 'reach', label: 'Reachable', status: 'fail', detail: `Unreachable from this network (${r.error})` }] }
  }
  const finalUrl = new URL(r.url)
  const checks: SafetyCheck[] = []
  let redirectedTo: string | undefined
  const finalHost = finalUrl.hostname.toLowerCase()
  const sameHost = finalHost === hostOf(origin) || finalHost === `www.${hostOf(origin)}` || `www.${finalHost}` === hostOf(origin)
  if (!sameHost) {
    if (!provider.brandLabels.includes(brandLabel(finalHost)))
      return { checks: [{ id, label, status: 'fail', detail: `Redirects off-site to ${finalHost} (ad/malware redirect or hijacked domain)` }] }
    // Same family, different host: this domain is just a redirector. Don't use it directly;
    // the target is fed back into discovery and vetted on its own.
    redirectedTo = `https://${finalHost}`
    return { checks: [{ id: 'reach', label: 'Redirect', status: 'fail', detail: `Moved to ${finalHost} (checking that domain instead)` }], redirectedTo }
  }
  if (finalUrl.protocol !== 'https:') return { checks: [{ id, label, status: 'fail', detail: `Downgrades to insecure HTTP (${r.url})` }] }
  if (r.contentType && !/text\/html/i.test(r.contentType))
    return { checks: [{ id, label, status: 'fail', detail: `Serves ${r.contentType} instead of a web page (possible forced download)` }] }
  if (PARKED_PATTERNS.some(p => p.test(r.body)))
    return { checks: [{ id, label, status: 'fail', detail: 'Parked / for-sale / suspended page' }], redirectedTo }
  const refresh = r.body.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+url=([^"'>\s]+)/i)
  if (refresh) {
    const target = hostOf(new URL(refresh[1], r.url).href)
    if (target && !provider.brandLabels.includes(brandLabel(target)))
      return { checks: [{ id, label, status: 'fail', detail: `Meta-refresh redirect to ${target}` }] }
  }
  if (CHALLENGE_PATTERNS.some(p => p.test(r.body)) || r.status === 403 || r.status === 503) {
    checks.push({ id, label, status: 'warn', detail: `Behind a bot challenge (HTTP ${r.status}); content could not be verified` })
    return { checks, redirectedTo }
  }
  if (!r.ok) return { checks: [{ id, label, status: 'fail', detail: `HTTP ${r.status}` }], redirectedTo }
  if (DOWNLOAD_EXT.test(r.body.match(/href=["'][^"']+["']/gi)?.join(' ') ?? ''))
    checks.push({ id: 'downloads', label: 'Executable links', status: 'warn', detail: 'Page links to executable downloads' })
  checks.push({ id, label, status: 'pass', detail: `HTTP ${r.status} in ${r.ms} ms, valid TLS` })
  return { checks, redirectedTo }
}

async function checkFingerprint(origin: string, provider: ProviderDef, source: DomainSource): Promise<SafetyCheck> {
  const id = 'fingerprint', label = 'Looks like the real site'
  if (!provider.fingerprint?.length) {
    // Without a fingerprint we can't tell the real site from a squatter on another TLD.
    return source === 'discovered'
      ? { id, label, status: 'warn', detail: 'Cannot verify this is the real site (source has no fingerprint) — approve only if you trust it' }
      : { id, label, status: 'info', detail: 'No fingerprint defined for this source' }
  }
  const r = await httpGet(origin + fillTemplate(provider.searchPath, { q: encodeURIComponent('one piece') }), { timeoutMs: 12000 })
  if (!r.ok) {
    if (CHALLENGE_PATTERNS.some(p => p.test(r.body)) || r.status === 403 || r.status === 503)
      return { id, label, status: 'warn', detail: 'Search page is behind a bot challenge' }
    return { id, label, status: 'fail', detail: `Search page failed (${r.status || r.error})` }
  }
  const matched = provider.fingerprint.some(src => { try { return new RegExp(src, 'i').test(r.body) } catch { return false } })
  return matched
    ? { id, label, status: 'pass', detail: `Search page matches ${provider.name} layout` }
    : { id, label, status: 'fail', detail: `Search page does not match ${provider.name} (clone, parked or redesigned)` }
}

async function checkSafeBrowsing(origin: string, key: string): Promise<SafetyCheck> {
  const id = 'gsb', label = 'Google Safe Browsing'
  const r = await httpGet(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
    method: 'POST', accept: 'application/json', timeoutMs: 8000, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client: { clientId: 'senpai', clientVersion: '1.0' },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url: `${origin}/` }],
      },
    }),
  })
  if (!r.ok) return { id, label, status: 'warn', detail: `Lookup failed (${r.status || r.error})` }
  try {
    const j = JSON.parse(r.body || '{}')
    if (j.matches?.length) return { id, label, status: 'fail', detail: `Flagged: ${[...new Set(j.matches.map((m: any) => m.threatType))].join(', ')}` }
  } catch { /* empty body = clean */ }
  return { id, label, status: 'pass', detail: 'Not flagged' }
}

// ---------- gate ----------

export function verdictOf(checks: SafetyCheck[]): Verdict {
  const fails = checks.filter(c => c.status === 'fail')
  if (fails.length && fails.every(c => c.id === 'reach')) return 'unreachable'
  if (fails.length) return 'blocked'
  if (checks.some(c => c.status === 'warn')) return 'pending'
  return 'safe'
}

export async function runSafetyGate(
  origin: string, provider: ProviderDef, source: DomainSource, opts: { safeBrowsingKey?: string } = {},
): Promise<SafetyReport> {
  const checks: SafetyCheck[] = []
  const finish = (redirectedTo?: string): SafetyReport =>
    ({ origin, verdict: verdictOf(checks), checks, checkedAt: Date.now(), redirectedTo })

  // Cheap, offline checks first — stop before any network contact if they fail.
  checks.push(checkShape(origin))
  checks.push(checkBrand(origin, provider, source))
  if (checks.some(c => c.status === 'fail')) return finish()

  const host = hostOf(origin)
  const [dns, age, gsb] = await Promise.all([
    checkDns(host),
    checkAge(host),
    opts.safeBrowsingKey ? checkSafeBrowsing(origin, opts.safeBrowsingKey) : Promise.resolve(null),
  ])
  checks.push(...dns, age)
  if (gsb) checks.push(gsb)
  // Never make an HTTP request to a domain the threat filters flagged.
  if (checks.some(c => c.status === 'fail')) return finish()

  const http = await checkHttp(origin, provider)
  checks.push(...http.checks)
  if (!http.checks.some(c => c.status === 'fail' || c.status === 'warn')) checks.push(await checkFingerprint(origin, provider, source))
  return finish(http.redirectedTo)
}

/** Can the player use this domain? */
export function isUsable(verdict: Verdict | undefined, approved: boolean, source: DomainSource): boolean {
  if (verdict === 'safe') return true
  if (verdict === 'pending') return approved || source === 'bundled' || source === 'manifest'
  return false
}

// Shared types for the streaming-source system.
// Providers are pure data (see providers.json) so a broken site can be fixed by
// editing the remote manifest instead of shipping a new build.

export type DomainSource = 'bundled' | 'manifest' | 'discovered' | 'user'
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info'
export type Verdict = 'safe' | 'pending' | 'blocked' | 'unreachable'

export interface ProviderDef {
  id: string
  name: string
  /** 'gogo' = gogoanime-style layout, 'generic' = learn from links/titles */
  layout: 'gogo' | 'generic'
  priority: number
  enabled?: boolean
  /** Registrable-domain labels that belong to this site family (e.g. "anitaku"). */
  brandLabels: string[]
  /** Known origins, e.g. "https://anitaku.to" */
  domains: string[]
  /** Pages that list the site's current official domains. */
  hubs?: string[]
  /** Search path template, {q} = url-encoded query. */
  searchPath: string
  /** Regexes; the search page must match at least one to prove it's the real site. */
  fingerprint?: string[]
  /** Regexes over search HTML; group 1 = show path, optional group 2 = title. */
  showLink?: string[]
  /** Regex templates over show HTML with {ep}; group 1 = href. */
  episodeLink?: string[]
  /** Optional AJAX episode list: idPattern group 1 = id, url template uses {id}. */
  episodeAjax?: { idPattern: string; url: string }
  /** Regex over a URL path; group 1 = slug, group 2 = episode number. */
  episodeUrlPattern?: string
  /** Regex over a URL path; group 1 = slug of a show page. */
  showUrlPattern?: string
  /** Templates using {slug}/{ep}. */
  episodeUrlTemplate?: string
  showPathTemplate?: string
  /** True for providers the user added locally (not from the manifest). */
  custom?: boolean
  /** Site blocks automated requests (bot challenge): never scrape it — build URLs from what the
   *  player learned, otherwise open its search page in the player for you to pick once. */
  browserOnly?: boolean
}

export interface Manifest {
  version: number
  updated: string
  /** TLDs to probe during discovery. */
  tlds: string[]
  /** Ad / malvertising hosts blocked inside the player. */
  adHosts: string[]
  providers: ProviderDef[]
}

export interface SafetyCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
}

export interface SafetyReport {
  origin: string
  verdict: Verdict
  checks: SafetyCheck[]
  checkedAt: number
  /** Same-brand origin the site redirected to (fed back into discovery). */
  redirectedTo?: string
}

export interface DomainState {
  origin: string
  providerId: string
  source: DomainSource
  approved: boolean
  removed?: boolean
  safety: SafetyReport | null
  successes: number
  failures: number
  consecutiveFailures: number
  latencyMs?: number
  lastOkAt?: number
  lastFailAt?: number
  lastError?: string
  cooldownUntil?: number
  addedAt: number
}

export interface StreamState {
  version: 1
  manifestUrl: string
  remoteManifest: Manifest | null
  manifestFetchedAt?: number
  manifestError?: string
  customProviders: ProviderDef[]
  providerPrefs: Record<string, { enabled: boolean; priority: number }>
  domains: Record<string, DomainState>
  /** titleKey -> providerId -> show path (domain-agnostic) */
  slugs: Record<string, Record<string, string>>
  lastDiscoveryAt: Record<string, number>
  /** Discovered origins that failed the gate: origin -> rejectedAt (skipped for 24h). */
  rejected: Record<string, number>
  discoveryLog: { at: number; providerId: string; message: string }[]
  safeBrowsingKey?: string
  adblock: boolean
  strictApproval: boolean
}

export interface ResolveResult {
  url: string
  isSearch: boolean
  providerId?: string
  providerName?: string
  origin?: string
  tried: { providerId: string; origin?: string; reason: string }[]
  providers: { id: string; name: string; available: boolean }[]
  /** Language actually resolved. */
  audio?: 'sub' | 'dub'
  /** Dub was requested but only the sub was found. */
  audioFallback?: boolean
}

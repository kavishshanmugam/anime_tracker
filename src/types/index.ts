export type MyStatus = 'watching' | 'completed' | 'plan_to_watch' | 'on_hold' | 'dropped'

export interface VideoSource {
  url: string
  quality: string
  isM3U8: boolean
}

export interface SkipTime {
  type: 'op' | 'ed' | 'recap' | 'mixed-op' | 'mixed-ed'
  startTime: number
  endTime: number
}

export interface StreamSources {
  sources: VideoSource[]
  subtitles: { url: string; lang: string }[]
  headers: Record<string, string>
  skips: SkipTime[]
}

export interface ResolveResult {
  url: string
  isSearch: boolean
  providerId?: string
  providerName?: string
  origin?: string
  tried: { providerId: string; origin?: string; reason: string }[]
  providers: { id: string; name: string; available: boolean }[]
  audio?: 'sub' | 'dub'
  audioFallback?: boolean
}

export interface AccountView { clientId: string; connected: boolean; user: string | null; lastSync: number | null; lastError: string | null; expiresAt: number | null }
export interface AccountsStatus { anilist: AccountView | null; mal: AccountView | null; anilistRedirect: string; malRedirect: string }

export interface PlayerState {
  time: number
  duration: number
  paused: boolean
  rate: number
  /** Actual decoded video height (e.g. 1080). */
  height: number
  buffering: boolean
  /** Which player API controls quality, or null if the site player exposes none. */
  adapter: string | null
  /** Quality levels high → low, e.g. ['1080p', '720p', '480p']. */
  levels: string[]
  mode: 'max' | 'auto' | 'manual'
  /** Index into levels currently targeted (-1 = player auto). */
  selected: number
  playerAuto: boolean
  downgrades: number
  /** Controller messages since last poll, e.g. "Lowered to 720p (buffered 3.1s)". */
  events: string[]
  /** Separate subtitle tracks in the video (empty = none / burned-in). */
  subs: { tracks: string[]; current: number; on: boolean; lang: string }
  audio: 'sub' | 'dub'
  /** Requests from the in-player ⚙ menu that need the app (e.g. switch to Dub). */
  requests: ({ type: 'audio'; value: 'sub' | 'dub' } | { type: 'autoplay'; value: boolean } | { type: 'autoskip'; value: boolean })[]
}

export interface SafetyCheck { id: string; label: string; status: 'pass' | 'warn' | 'fail' | 'info'; detail: string }

export interface SourceDomain {
  origin: string
  source: 'bundled' | 'manifest' | 'discovered' | 'user'
  approved: boolean
  usable: boolean
  checking: boolean
  verdict: 'safe' | 'pending' | 'blocked' | 'unreachable' | 'unchecked'
  checks: SafetyCheck[]
  checkedAt?: number
  latencyMs?: number
  failures: number
  successes: number
  consecutiveFailures: number
  coolingDown: boolean
  cooldownUntil?: number
  lastError?: string
  lastOkAt?: number
}

export interface SourcesSnapshot {
  manifestUrl: string
  manifestVersion: number
  manifestSource: 'remote' | 'built-in'
  manifestFetchedAt?: number
  manifestError?: string
  adblock: boolean
  strictApproval: boolean
  hasSafeBrowsingKey: boolean
  discoveryLog: { at: number; providerId: string; message: string }[]
  providers: {
    id: string; name: string; enabled: boolean; priority: number; custom: boolean; layout: 'gogo' | 'generic'
    discovering: boolean; lastDiscoveryAt?: number; domains: SourceDomain[]
  }[]
}

export interface Anime {
  id: number
  mal_id: number | null
  anilist_id: number | null
  title: string
  title_en: string | null
  title_jp: string | null
  cover_url: string | null
  banner_url: string | null
  cover_accent: string | null
  episodes_total: number | null
  airing_status: string | null
  season: string | null
  season_year: number | null
  studio: string | null
  genres: string | null
  tags: string | null
  synopsis: string | null
  mean_score: number | null
  format: string | null
  source: string | null
  duration: number | null
  relations: string | null
  external_links: string | null
  updated_at: string
}

export interface LibraryEntry {
  id: number
  anime_id: number
  my_status: MyStatus
  my_score: number | null
  progress: number
  rewatch_count: number
  started_at: string | null
  finished_at: string | null
  last_watched_at: string | null
  notes: string | null
  custom_tags: string | null
  source: string
  updated_at: string
}

export interface AnimeWithEntry extends Anime {
  entry?: LibraryEntry
}

export interface AiringScheduleItem {
  id: number
  anime_id: number
  episode: number
  airing_at: string
  state: 'scheduled' | 'delayed' | 'break'
}

export interface FranchiseWatch {
  id: number
  root_anime_id: number
  related_anime_id: number
  relation_type: string
  release_status: string
  start_date: string | null
  surfaced_at: string
  state: 'watching' | 'muted' | 'dismissed'
}

export interface PendingReview {
  id: number
  anime_id: number
  detected_range: string
  source_url_host: string
  state: 'pending' | 'reviewed' | 'dismissed'
  detected_at: string
}

export interface WatchEvent {
  id: number
  anime_id: number
  episode: number
  source: 'browser' | 'manual' | 'file' | 'bulk' | 'history' | 'in-app' | 'in-app · sub' | 'in-app · dub'
  watched_at: string
}

export interface CalendarDay {
  date: string
  items: CalendarItem[]
}

export interface CalendarItem {
  anime: Anime
  episode: number
  airing_at: string
  state: string
  entry?: LibraryEntry
}

export interface Recommendation {
  anime: Anime
  reason: string
  score: number
}

// AniList API types
export interface AniListMedia {
  id: number
  idMal: number | null
  title: { romaji: string; english: string | null; native: string | null }
  coverImage: { large: string; extraLarge: string | null; color: string | null }
  bannerImage: string | null
  episodes: number | null
  status: string
  season: string | null
  seasonYear: number | null
  studios: { nodes: { name: string }[] }
  genres: string[]
  tags: { name: string; rank: number }[]
  description: string | null
  meanScore: number | null
  format: string | null
  source: string | null
  duration: number | null
  relations: {
    edges: {
      relationType: string
      node: { id: number; idMal: number | null; title: { romaji: string }; status: string; coverImage: { large: string } }
    }[]
  }
  externalLinks: { url: string; site: string; type: string }[]
  recommendations: {
    nodes: { mediaRecommendation: { id: number; title: { romaji: string }; coverImage: { large: string }; meanScore: number | null } | null; rating: number }[]
  }
  nextAiringEpisode: { episode: number; airingAt: number } | null
  airingSchedule: { nodes: { episode: number; airingAt: number }[] }
  startDate: { year: number | null; month: number | null; day: number | null }
}

// IPC API types (electron preload bridge)
export interface ElectronAPI {
  db: {
    getAllAnime: () => Promise<Anime[]>
    getAnime: (id: number) => Promise<Anime | null>
    getAnimeByMalId: (malId: number) => Promise<Anime | null>
    getAnimeByAnilistId: (anilistId: number) => Promise<Anime | null>
    upsertAnime: (anime: Omit<Anime, 'id' | 'updated_at'> & { id?: number }) => Promise<number>
    getLibrary: () => Promise<(Anime & { entry: LibraryEntry })[]>
    getLibraryEntry: (animeId: number) => Promise<LibraryEntry | null>
    upsertLibraryEntry: (entry: Partial<LibraryEntry> & { anime_id: number }) => Promise<number>
    deleteLibraryEntry: (animeId: number) => Promise<void>
    getAiringSchedule: (from: string, to: string) => Promise<(AiringScheduleItem & { anime: Anime })[]>
    upsertAiringSchedule: (item: Omit<AiringScheduleItem, 'id'>) => Promise<void>
    getFranchiseWatches: () => Promise<(FranchiseWatch & { root: Anime; related: Anime })[]>
    upsertFranchiseWatch: (fw: Omit<FranchiseWatch, 'id' | 'surfaced_at'>) => Promise<void>
    updateFranchiseWatchState: (id: number, state: 'watching' | 'muted' | 'dismissed') => Promise<void>
    addWatchEvent: (event: Omit<WatchEvent, 'id'>) => Promise<void>
    getWatchEvents: (animeId: number) => Promise<WatchEvent[]>
    addNotInterested: (animeId: number, reason?: string) => Promise<void>
    getNotInterested: () => Promise<number[]>
    exportData: () => Promise<string>
    importData: (json: string) => Promise<{ imported: number }>
    getStats: () => Promise<{
      totalAnime: number; totalEpisodes: number; totalHours: number
      byStatus: Record<string, number>; byGenre: { genre: string; count: number }[]
      scoreDistribution: { score: number; count: number }[]; byYear: { year: number; count: number }[]
      recentlyCompleted: Anime[]; meanScore: number | null; epsPerWeek: number; heatmap: Record<string, number>
    }>
    search: (query: string) => Promise<Anime[]>
    getAppState: (key: string) => Promise<string | null>
    setAppState: (key: string, value: string) => Promise<void>
  }
  stream: {
    resolveEpisode: (title: string, ep: number, opts?: { titleEn?: string; providerId?: string; excludeOrigins?: string[]; audio?: 'sub' | 'dub'; anilistId?: number }) => Promise<ResolveResult>
    getSkipTimes: (malId: number, ep: number, duration?: number) => Promise<SkipTime[]>
    learnFromUrl: (title: string, url: string, ep: number) => Promise<{ providerId: string; onEpisode: boolean; episode?: number; redirect?: string; audio: 'sub' | 'dub' } | null>
    reportFailure: (url: string, reason: string) => Promise<void>
    episodeCount: (title: string, audio: 'sub' | 'dub', opts?: { titleEn?: string; anilistId?: number }) => Promise<number | null>
    useLink: (title: string, url: string, ep: number) => Promise<{ ok: boolean; message: string; url?: string; providerId?: string }>
    clearCache: (title?: string) => Promise<void>
    prefetch: (title: string, titleEn?: string) => Promise<void>
    cancelPrefetch: (title: string) => Promise<void>
    player: {
      (webContentsId: number, cmd: { type: 'state'; prefs?: { rate?: number; mode?: 'max' | 'auto'; subs?: { on: boolean; lang: string }; audio?: 'sub' | 'dub'; flags?: { autoplay: boolean; autoSkip: boolean } } }): Promise<PlayerState | null>
      (webContentsId: number, cmd: { type: 'rate'; rate: number }): Promise<boolean | null>
      (webContentsId: number, cmd: { type: 'quality'; mode: 'max' | 'auto' | 'manual'; index?: number }): Promise<boolean | null>
      (webContentsId: number, cmd: { type: 'seek'; time: number }): Promise<boolean | null>
    }
    onBlocked: (callback: (info: { kind: string; detail: string }) => void) => () => void
  }
  sources: {
    snapshot: () => Promise<SourcesSnapshot>
    refreshManifest: () => Promise<{ ok: boolean; message: string }>
    discover: (providerId?: string) => Promise<{ found: string[] }>
    recheck: (origin?: string) => Promise<void>
    approve: (origin: string, approved: boolean) => Promise<boolean>
    removeDomain: (origin: string) => Promise<void>
    addDomain: (providerId: string, url: string) => Promise<{ ok: boolean; message: string }>
    addProvider: (input: { name: string; url: string; searchPath?: string; layout: 'gogo' | 'generic' }) => Promise<{ ok: boolean; message: string }>
    removeProvider: (id: string) => Promise<void>
    addSiteByLink: (url: string) => Promise<{ ok: boolean; message: string; providerId?: string; searchVerified?: boolean }>
    testSearch: (id: string, title: string) => Promise<{ ok: boolean; message: string; url?: string }>
    setProvider: (id: string, pref: { enabled?: boolean }) => Promise<void>
    moveProvider: (id: string, dir: -1 | 1) => Promise<void>
    setOptions: (opts: { manifestUrl?: string; adblock?: boolean; strictApproval?: boolean; safeBrowsingKey?: string | null }) => Promise<void>
    onChanged: (callback: () => void) => () => void
  }
  fs: {
    selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
    readFile: (path: string) => Promise<string>
    selectSavePath: (defaultName?: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
    writeFile: (path: string, content: string) => Promise<void>
  }
  accounts: {
    status: () => Promise<AccountsStatus>
    setClientId: (service: 'anilist' | 'mal', clientId: string) => Promise<AccountsStatus>
    login: (service: 'anilist' | 'mal') => Promise<{ ok: boolean; message: string }>
    logout: (service: 'anilist' | 'mal') => Promise<AccountsStatus>
    syncAll: () => Promise<AccountsStatus & { pushed: number }>
  }
  app: {
    getDataPath: () => Promise<string>
    onDeepLink: (callback: (url: string) => void) => void
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

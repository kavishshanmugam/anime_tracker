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
  source: 'browser' | 'manual' | 'file' | 'bulk' | 'history' | 'in-app'
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
    resolveEpisode: (title: string, ep: number, titleEn?: string) => Promise<{ url: string; urls: string[]; site: string } | null>
    resolveShow: (title: string) => Promise<{ url: string; urls: string[]; site: string } | null>
    getSources: (title: string, ep: number, malId?: number) => Promise<StreamSources | null>
    getSkipTimes: (malId: number, ep: number, duration?: number) => Promise<SkipTime[]>
    learnSlug: (title: string, slug: string) => Promise<void>
    clearCache: (title: string) => Promise<void>
    prefetch: (title: string) => Promise<void>
    cancelPrefetch: (title: string) => Promise<void>
    siteHealth: () => Promise<{ name: string; healthy: boolean; failures: number }[]>
    setApiUrl: (url: string) => Promise<void>
    getApiUrl: () => Promise<string>
  }
  fs: {
    selectFile: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
    readFile: (path: string) => Promise<string>
    selectSavePath: (defaultName?: string, filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
    writeFile: (path: string, content: string) => Promise<void>
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

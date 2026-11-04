import type { AniListMedia, Anime } from '@/types'

const ANILIST_URL = 'https://graphql.anilist.co'

// ponytail: simple token-bucket rate limiter, 90 req/min
const queue: (() => void)[] = []
const timestamps: number[] = []
let processing = false

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject))
    processQueue()
  })
}

function processQueue() {
  if (processing || queue.length === 0) return
  processing = true

  const now = Date.now()
  // remove timestamps older than 60s
  while (timestamps.length && timestamps[0] < now - 60000) timestamps.shift()

  if (timestamps.length >= 90) {
    const wait = timestamps[0] + 60000 - now
    setTimeout(() => { processing = false; processQueue() }, wait)
    return
  }

  const task = queue.shift()!
  timestamps.push(now)
  // ponytail: wait for task to finish before dispatching next — prevents concurrent requests
  Promise.resolve().then(task).finally(() => { processing = false; processQueue() })
}

async function gql<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
  return enqueue(async () => {
    const res = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    })
    // ponytail: retry once on 429 with Retry-After header
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || '60')
      await new Promise(r => setTimeout(r, retryAfter * 1000))
      const retry = await fetch(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })
      if (!retry.ok) throw new Error(`AniList API error: ${retry.status}`)
      const json = await retry.json()
      if (json.errors?.length) throw new Error(json.errors[0].message)
      return json.data
    }
    if (!res.ok) throw new Error(`AniList API error: ${res.status}`)
    const json = await res.json()
    if (json.errors?.length) throw new Error(json.errors[0].message)
    return json.data
  })
}

const MEDIA_FIELDS = `
  id idMal
  title { romaji english native }
  coverImage { large extraLarge color }
  bannerImage
  episodes status season seasonYear
  studios(isMain: true) { nodes { name } }
  genres
  tags { name rank }
  description(asHtml: false)
  meanScore format source duration
  relations { edges { relationType node { id idMal title { romaji } status coverImage { large } } } }
  externalLinks { url site type }
  recommendations(perPage: 10, sort: RATING_DESC) { nodes { mediaRecommendation { id title { romaji } coverImage { large } meanScore } rating } }
  nextAiringEpisode { episode airingAt }
  airingSchedule(notYetAired: true, perPage: 10) { nodes { episode airingAt } }
  startDate { year month day }
`

export async function searchAnime(query: string): Promise<AniListMedia[]> {
  const data = await gql(`
    query ($q: String) {
      Page(perPage: 10) {
        media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
      }
    }
  `, { q: query })
  return data.Page.media
}

export async function getAnimeById(id: number): Promise<AniListMedia> {
  const data = await gql(`
    query ($id: Int) {
      Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} }
    }
  `, { id })
  return data.Media
}

export async function getAnimeByMalId(malId: number): Promise<AniListMedia> {
  const data = await gql(`
    query ($malId: Int) {
      Media(idMal: $malId, type: ANIME) { ${MEDIA_FIELDS} }
    }
  `, { malId })
  return data.Media
}

export async function getAiringSchedule(page: number = 1): Promise<{ schedules: any[]; hasNext: boolean }> {
  const now = Math.floor(Date.now() / 1000)
  const data = await gql(`
    query ($page: Int, $now: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage }
        airingSchedules(airingAt_greater: $now, sort: TIME) {
          episode airingAt
          media { ${MEDIA_FIELDS} }
        }
      }
    }
  `, { page, now })
  return { schedules: data.Page.airingSchedules, hasNext: data.Page.pageInfo.hasNextPage }
}

export async function getSeasonAnime(season: string, year: number): Promise<AniListMedia[]> {
  const data = await gql(`
    query ($season: MediaSeason, $year: Int) {
      Page(perPage: 50) {
        media(season: $season, seasonYear: $year, type: ANIME, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
      }
    }
  `, { season: season.toUpperCase(), year })
  return data.Page.media
}

export async function getAnimeRelations(id: number): Promise<AniListMedia['relations']> {
  const data = await gql(`
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        relations { edges { relationType node { id idMal title { romaji } status coverImage { large } } } }
      }
    }
  `, { id })
  return data.Media.relations
}

export async function getRecommendations(id: number): Promise<any> {
  const data = await gql(`
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        recommendations(perPage: 25, sort: RATING_DESC) {
          nodes {
            mediaRecommendation {
              id title { romaji } coverImage { large } meanScore
              genres format
              relations { edges { relationType node { id } } }
            }
            rating
          }
        }
      }
    }
  `, { id })
  return data.Media.recommendations
}

// ponytail: fetch a user's public anime list by username
export async function getUserAnimeList(username: string): Promise<{ media: AniListMedia; status: string; score: number; progress: number; startedAt: any; completedAt: any; repeat: number }[]> {
  const statusMap: Record<string, string> = {
    CURRENT: 'watching', COMPLETED: 'completed', PLANNING: 'plan_to_watch',
    PAUSED: 'on_hold', DROPPED: 'dropped', REPEATING: 'watching',
  }
  const result: any[] = []
  let hasNext = true
  let chunk = 1

  while (hasNext) {
    const data = await gql(`
      query ($username: String, $chunk: Int) {
        MediaListCollection(userName: $username, type: ANIME, chunk: $chunk, perChunk: 500) {
          hasNextChunk
          lists {
            status
            entries {
              score(format: POINT_10)
              progress
              startedAt { year month day }
              completedAt { year month day }
              repeat
              media { ${MEDIA_FIELDS} }
            }
          }
        }
      }
    `, { username, chunk })

    const collection = data.MediaListCollection
    for (const list of collection.lists) {
      for (const entry of list.entries) {
        const fmtDate = (d: any) => d?.year ? `${d.year}-${String(d.month ?? 1).padStart(2, '0')}-${String(d.day ?? 1).padStart(2, '0')}` : null
        result.push({
          media: entry.media,
          status: statusMap[list.status] ?? 'plan_to_watch',
          score: entry.score,
          progress: entry.progress,
          startedAt: fmtDate(entry.startedAt),
          completedAt: fmtDate(entry.completedAt),
          repeat: entry.repeat ?? 0,
        })
      }
    }
    hasNext = collection.hasNextChunk
    chunk++
  }
  return result
}

export function mapAniListToAnime(media: AniListMedia): Omit<Anime, 'id' | 'updated_at'> {
  return {
    mal_id: media.idMal,
    anilist_id: media.id,
    title: media.title.romaji,
    title_en: media.title.english,
    title_jp: media.title.native,
    cover_url: media.coverImage.extraLarge || media.coverImage.large,
    banner_url: media.bannerImage,
    cover_accent: media.coverImage.color,
    episodes_total: media.episodes,
    airing_status: media.status,
    season: media.season,
    season_year: media.seasonYear,
    studio: media.studios.nodes[0]?.name ?? null,
    genres: media.genres.length ? JSON.stringify(media.genres) : null,
    tags: media.tags.length ? JSON.stringify(media.tags.map(t => t.name)) : null,
    synopsis: media.description,
    mean_score: media.meanScore,
    format: media.format,
    source: media.source,
    duration: media.duration,
    relations: media.relations?.edges?.length ? JSON.stringify(media.relations.edges.map(e => ({
      type: e.relationType,
      id: e.node.id,
      malId: e.node.idMal,
      title: e.node.title.romaji,
      status: e.node.status,
      cover: e.node.coverImage.large,
    }))) : null,
    external_links: media.externalLinks?.length ? JSON.stringify(media.externalLinks) : null,
  }
}

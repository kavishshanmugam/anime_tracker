import { getAnimeById, mapAniListToAnime, getAnimeByMalId } from './anilist'
import type { Anime } from '@/types'

export interface SyncNotification {
  type: 'new_episode' | 'sequel'
  title: string
  body: string
  animeId?: number
}

// ponytail: sync airing schedules for currently-airing library entries
export async function syncAiringSchedules(
  onProgress?: (done: number, total: number) => void
): Promise<{ synced: number; notifications: SyncNotification[] }> {
  if (!window.api) return { synced: 0, notifications: [] }

  const library = await window.api.db.getLibrary()
  const airing = library.filter(
    e => e.airing_status === 'RELEASING' || (e.entry.my_status === 'watching' && e.anilist_id)
  )

  let synced = 0
  const notifications: SyncNotification[] = []
  const now = new Date()
  const notifiedEpisodes = new Set<string>()

  for (const anime of airing) {
    if (!anime.anilist_id) continue
    try {
      const media = await getAnimeById(anime.anilist_id)
      if (media.airingSchedule?.nodes?.length) {
        for (const node of media.airingSchedule.nodes) {
          const airingAt = new Date(node.airingAt * 1000)
          await window.api.db.upsertAiringSchedule({
            anime_id: anime.id,
            episode: node.episode,
            airing_at: airingAt.toISOString(),
            state: 'scheduled',
          })
          // Notify for episodes that aired today or are upcoming today (deduplicate with nextAiringEpisode)
          const nKey = `${anime.id}-${node.episode}`
          if (airingAt.toDateString() === now.toDateString() && node.episode > anime.entry.progress && !notifiedEpisodes.has(nKey)) {
            notifiedEpisodes.add(nKey)
            notifications.push({
              type: 'new_episode',
              title: 'New Episode',
              body: `${anime.title} Episode ${node.episode} airs today`,
              animeId: anime.id,
            })
          }
        }
      }
      if (media.nextAiringEpisode) {
        const airingAt = new Date(media.nextAiringEpisode.airingAt * 1000)
        await window.api.db.upsertAiringSchedule({
          anime_id: anime.id,
          episode: media.nextAiringEpisode.episode,
          airing_at: airingAt.toISOString(),
          state: 'scheduled',
        })
        const nKey = `${anime.id}-${media.nextAiringEpisode.episode}`
        if (airingAt.toDateString() === now.toDateString() && media.nextAiringEpisode.episode > anime.entry.progress && !notifiedEpisodes.has(nKey)) {
          notifiedEpisodes.add(nKey)
          notifications.push({
            type: 'new_episode',
            title: 'New Episode',
            body: `${anime.title} Episode ${media.nextAiringEpisode.episode} airs today`,
            animeId: anime.id,
          })
        }
      }
      synced++
    } catch {
      // skip failed fetches
    }
    onProgress?.(synced, airing.length)
  }
  return { synced, notifications }
}

// ponytail: detect sequels/spin-offs from an anime's relations and write to franchise_watch
export async function detectFranchiseEntries(anime: Anime): Promise<{ added: number; notifications: SyncNotification[] }> {
  if (!window.api || !anime.relations) return { added: 0, notifications: [] }

  let relations: { type: string; id: number; malId: number | null; title: string; status: string; cover: string }[]
  try {
    relations = JSON.parse(anime.relations)
  } catch {
    return { added: 0, notifications: [] }
  }

  const dominated = ['SEQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE']
  const relevant = relations.filter(r => dominated.includes(r.type))
  if (!relevant.length) return { added: 0, notifications: [] }

  let added = 0
  const notifications: SyncNotification[] = []
  for (const rel of relevant) {
    // Ensure the related anime exists in DB
    let relAnime = await window.api.db.getAnimeByAnilistId(rel.id)
    if (!relAnime) {
      try {
        const media = await getAnimeById(rel.id)
        const mapped = mapAniListToAnime(media)
        const newId = await window.api.db.upsertAnime(mapped)
        relAnime = await window.api.db.getAnime(newId)
      } catch {
        continue
      }
    }
    if (!relAnime) continue

    // Don't surface if user already has it in library
    const existing = await window.api.db.getLibraryEntry(relAnime.id)
    if (existing) continue

    // Build start date string from the related anime
    const startDate = relAnime.season && relAnime.season_year
      ? `${relAnime.season} ${relAnime.season_year}`
      : null

    await window.api.db.upsertFranchiseWatch({
      root_anime_id: anime.id,
      related_anime_id: relAnime.id,
      relation_type: rel.type,
      release_status: relAnime.airing_status ?? rel.status ?? 'UNKNOWN',
      start_date: startDate,
      state: 'watching',
    })
    added++
    notifications.push({
      type: 'sequel',
      title: 'Sequel Available',
      body: `${relAnime.title} (${rel.type.replace(/_/g, ' ').toLowerCase()}) of ${anime.title}`,
      animeId: relAnime.id,
    })
  }
  return { added, notifications }
}

// ponytail: batch-enrich bare MAL imports with AniList metadata
export async function enrichBareEntries(
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  if (!window.api) return 0

  const library = await window.api.db.getLibrary()
  // Bare entries: have mal_id but no cover_url (imported from MAL, never enriched)
  const bare = library.filter(e => e.mal_id && !e.cover_url)
  if (!bare.length) return 0

  let enriched = 0
  for (const anime of bare) {
    try {
      const media = await getAnimeByMalId(anime.mal_id!)
      const mapped = mapAniListToAnime(media)
      await window.api.db.upsertAnime({ ...mapped, mal_id: anime.mal_id })
      enriched++
    } catch {
      // AniList might not have this MAL entry, skip
    }
    onProgress?.(enriched, bare.length)
  }
  return enriched
}

import type { AniListMedia, Anime } from '@/types'
import { mapAniListToAnime } from './anilist'

/** Route to the in-app player for an episode. */
export function watchPath(anime: Pick<Anime, 'id' | 'title' | 'title_en' | 'mal_id' | 'episodes_total'>, ep: number): string {
  const params = new URLSearchParams({ title: anime.title })
  if (anime.title_en) params.set('titleEn', anime.title_en)
  if (anime.mal_id) params.set('malId', String(anime.mal_id))
  if (anime.episodes_total) params.set('total', String(anime.episodes_total))
  return `/watch/${anime.id}/${ep}?${params}`
}

/** Make sure an AniList show exists locally (needed before playing or listing it); returns the local id. */
export async function ensureLocal(media: AniListMedia): Promise<number> {
  const existing = await window.api.db.getAnimeByAnilistId(media.id)
  if (existing) return existing.id
  return window.api.db.upsertAnime(mapAniListToAnime(media))
}

export const stripHtml = (s: string | null | undefined) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

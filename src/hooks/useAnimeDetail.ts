import { useState, useEffect, useCallback, useRef } from 'react'
import type { Anime, LibraryEntry, WatchEvent } from '@/types'
import { getAnimeById, mapAniListToAnime } from '@/lib/anilist'
import { detectFranchiseEntries } from '@/lib/sync'

export function useAnimeDetail(id: number) {
  const [anime, setAnime] = useState<Anime | null>(null)
  const [entry, setEntry] = useState<LibraryEntry | null>(null)
  const [events, setEvents] = useState<WatchEvent[]>([])
  const [loading, setLoading] = useState(true)
  const franchiseScanned = useRef(false)

  const refresh = useCallback(async () => {
    if (!window.api) { setLoading(false); return }
    setLoading(true)
    try {
      let a = await window.api.db.getAnime(id)
      if (!a) a = await window.api.db.getAnimeByAnilistId(id)

      if (!a) {
        try {
          const media = await getAnimeById(id)
          const mapped = mapAniListToAnime(media)
          const newId = await window.api.db.upsertAnime(mapped)
          a = await window.api.db.getAnime(newId)
        } catch {
          // AniList fetch failed
        }
      }

      setAnime(a)

      if (a) {
        const [e, ev] = await Promise.all([
          window.api.db.getLibraryEntry(a.id),
          window.api.db.getWatchEvents(a.id),
        ])
        setEntry(e)
        setEvents(ev)

        // ponytail: detect franchise entries once per detail view if user has this anime tracked
        if (e && !franchiseScanned.current && a.relations) {
          franchiseScanned.current = true
          detectFranchiseEntries(a).catch(() => ({ added: 0, notifications: [] }))
        }
      }
    } catch (e) {
      console.error('Failed to load anime detail:', e)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { franchiseScanned.current = false; refresh() }, [refresh])

  const updateEntry = useCallback(async (partial: Partial<LibraryEntry>) => {
    if (!anime || !window.api) return
    setEntry(prev => prev
      ? { ...prev, ...partial }
      : { id: 0, anime_id: anime.id, my_status: 'plan_to_watch', my_score: null, progress: 0, rewatch_count: 0, started_at: null, finished_at: null, last_watched_at: null, notes: null, custom_tags: null, source: 'manual', updated_at: new Date().toISOString(), ...partial }
    )
    await window.api.db.upsertLibraryEntry({ anime_id: anime.id, ...partial })
  }, [anime])

  const deleteEntry = useCallback(async () => {
    if (!anime || !window.api) return
    setEntry(null)
    await window.api.db.deleteLibraryEntry(anime.id)
  }, [anime])

  return { anime, entry, events, loading, updateEntry, deleteEntry, refresh }
}

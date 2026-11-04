import { useState, useEffect, useCallback, createContext, useContext, createElement } from 'react'
import type { Anime, LibraryEntry } from '@/types'

type AnimeWithEntry = Anime & { entry: LibraryEntry }

interface LibraryContextValue {
  entries: AnimeWithEntry[]
  loading: boolean
  refresh: () => Promise<void>
  updateEntry: (animeId: number, partial: Partial<LibraryEntry>) => Promise<void>
  deleteEntry: (animeId: number) => Promise<void>
  bulkUpdate: (animeIds: number[], partial: Partial<LibraryEntry>) => Promise<void>
}

const LibraryContext = createContext<LibraryContextValue | null>(null)

// ponytail: single provider, all consumers share one fetch
export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<AnimeWithEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!window.api) { setLoading(false); return }
    try {
      const data = await window.api.db.getLibrary()
      data.sort((a, b) => {
        const aDate = a.entry.last_watched_at ?? ''
        const bDate = b.entry.last_watched_at ?? ''
        return bDate.localeCompare(aDate)
      })
      setEntries(data)
    } catch (e) {
      console.error('Failed to load library:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const updateEntry = useCallback(async (animeId: number, partial: Partial<LibraryEntry>) => {
    setEntries(prev => prev.map(e =>
      e.entry.anime_id === animeId ? { ...e, entry: { ...e.entry, ...partial } } : e
    ))
    if (window.api) {
      await window.api.db.upsertLibraryEntry({ anime_id: animeId, ...partial })
    }
  }, [])

  const deleteEntry = useCallback(async (animeId: number) => {
    let prev: AnimeWithEntry[] = []
    setEntries(current => { prev = current; return current.filter(e => e.entry.anime_id !== animeId) })
    if (window.api) {
      try {
        await window.api.db.deleteLibraryEntry(animeId)
      } catch {
        setEntries(prev)
      }
    }
  }, [])

  const bulkUpdate = useCallback(async (animeIds: number[], partial: Partial<LibraryEntry>) => {
    setEntries(prev => prev.map(e =>
      animeIds.includes(e.entry.anime_id) ? { ...e, entry: { ...e.entry, ...partial } } : e
    ))
    if (window.api) {
      await Promise.all(animeIds.map(id =>
        window.api.db.upsertLibraryEntry({ anime_id: id, ...partial })
      ))
    }
  }, [])

  const value = { entries, loading, refresh, updateEntry, deleteEntry, bulkUpdate }

  return createElement(LibraryContext.Provider, { value }, children)
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used within LibraryProvider')
  return ctx
}

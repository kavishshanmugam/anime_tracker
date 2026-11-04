import { useState, useEffect, useRef, useCallback } from 'react'
import type { Anime } from '@/types'
import { searchAnime, mapAniListToAnime } from '@/lib/anilist'

export function useSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Anime[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      // Local DB search first
      const local: Anime[] = window.api ? await window.api.db.search(q) : []

      // AniList search
      let remote: Anime[] = []
      try {
        const anilistResults = await searchAnime(q)
        remote = anilistResults.map(m => ({
          id: 0, // ponytail: id=0 signals unsaved; consumer should upsert before using
          ...mapAniListToAnime(m),
          updated_at: new Date().toISOString(),
        }))
      } catch {
        // AniList unavailable, local results only
      }

      // Deduplicate: prefer local entries (they have real IDs)
      const seen = new Set(local.map(a => a.anilist_id).filter(Boolean))
      const deduped = [
        ...local,
        ...remote.filter(a => a.anilist_id && !seen.has(a.anilist_id)),
      ]

      setResults(deduped)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, search])

  return { query, setQuery, results, loading }
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSearch } from '@/hooks/useSearch'
import { displayTitle } from '@/lib/title'

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { query, setQuery, results, loading } = useSearch()

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      // ponytail: raf to wait for mount
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [results])

  const go = useCallback(
    (id: number | string) => {
      onClose()
      navigate(`/anime/${id}`)
    },
    [navigate, onClose],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      const r = results[selectedIndex]
      go(r.id || r.anilist_id || r.mal_id || 0)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-card border border-border bg-bg-1 shadow-2xl"
        data-command-palette
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center border-b border-border px-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-text-3">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anime..."
            className="flex-1 bg-transparent px-3 py-4 text-sm text-text-1 placeholder:text-text-3 focus:outline-none"
          />
          <kbd className="rounded bg-bg-2 px-1.5 py-0.5 font-mono text-xs text-text-3">Esc</kbd>
        </div>

        <ul className="max-h-96 overflow-y-auto p-2">
          {loading && (
            <li className="px-3 py-6 text-center text-sm text-text-3">Searching...</li>
          )}
          {!loading && query && results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-text-3">No results found</li>
          )}
          {!loading &&
            results.map((anime, i) => (
              <li key={anime.id}>
                <button
                  onClick={() => go(anime.id || anime.anilist_id || anime.mal_id || 0)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    i === selectedIndex ? 'bg-bg-2 text-text-1' : 'text-text-2 hover:bg-bg-2'
                  }`}
                >
                  {anime.cover_url ? (
                    <img
                      src={anime.cover_url}
                      alt=""
                      className="h-10 w-7 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="h-10 w-7 shrink-0 rounded bg-bg-2" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text-1">{displayTitle(anime)}</p>
                    <p className="text-xs text-text-3">
                      {[anime.format, anime.season_year].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  )
}

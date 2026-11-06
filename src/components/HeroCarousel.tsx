import { useEffect, useState, type ReactNode } from 'react'
import { stripHtml } from '@/lib/watch'

export interface HeroSlide {
  key: string
  title: string
  banner: string | null
  cover: string | null
  synopsis: string | null
  meta: string[]
  /** e.g. "Continue · E5" */
  primaryLabel: string
  onPrimary: () => void
  onDetails: () => void
  onBookmark?: () => void
  bookmarked?: boolean
  tag?: ReactNode
}

const ROTATE_MS = 9000

/** Full-bleed rotating banner at the top of Home. */
export default function HeroCarousel({ slides }: { slides: HeroSlide[] }) {
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => { if (i >= slides.length) setI(0) }, [slides.length, i])
  useEffect(() => {
    if (paused || slides.length < 2) return
    const t = setTimeout(() => setI(n => (n + 1) % slides.length), ROTATE_MS)
    return () => clearTimeout(t)
  }, [i, paused, slides.length])

  // Reserve the hero's height while data loads so the page doesn't jump.
  if (!slides.length) return <div className="h-[72vh] min-h-[460px] max-h-[760px] w-full bg-gradient-to-b from-bg-1 to-bg-0" />
  const s = slides[Math.min(i, slides.length - 1)]

  return (
    <div className="relative h-[72vh] min-h-[460px] max-h-[760px] w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {/* Art (cross-fade) */}
      {slides.map((sl, idx) => (
        <div key={sl.key} className={`absolute inset-0 transition-opacity duration-700 ${idx === i ? 'opacity-100' : 'opacity-0'}`}>
          {sl.banner ? (
            <img src={sl.banner} alt="" className="h-full w-full object-cover" />
          ) : sl.cover ? (
            <img src={sl.cover} alt="" className="h-full w-full scale-110 object-cover blur-2xl opacity-60" />
          ) : <div className="h-full w-full bg-bg-1" />}
        </div>
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-bg-0 via-bg-0/70 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg-0 via-transparent to-bg-0/40" />

      {/* Copy */}
      <div className="absolute inset-x-0 bottom-[14%] px-4 lg:px-10">
        <div key={s.key} className="max-w-xl animate-[fadein_.5s_ease]">
          {s.tag && <div className="mb-3">{s.tag}</div>}
          <h1 className="font-display text-4xl font-black leading-tight text-white drop-shadow-lg lg:text-5xl line-clamp-2">{s.title}</h1>
          {s.meta.length > 0 && <p className="mt-3 text-sm text-text-2">{s.meta.filter(Boolean).join(' · ')}</p>}
          {s.synopsis && <p className="mt-3 text-sm leading-relaxed text-text-2 line-clamp-3">{stripHtml(s.synopsis)}</p>}
          <div className="mt-6 flex items-center gap-3">
            <button onClick={s.onPrimary}
              className="flex items-center gap-2 rounded-[4px] bg-accent px-6 py-3 text-sm font-bold uppercase tracking-wide text-white hover:bg-accent-hover">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
              {s.primaryLabel}
            </button>
            {s.onBookmark && (
              <button onClick={s.onBookmark} title={s.bookmarked ? 'In your watchlist' : 'Add to watchlist'}
                className={`flex h-12 w-12 items-center justify-center rounded-[4px] border-2 ${s.bookmarked ? 'border-accent text-accent' : 'border-accent/70 text-accent hover:bg-accent/10'}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill={s.bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>
              </button>
            )}
            <button onClick={s.onDetails} className="rounded-[4px] px-4 py-3 text-sm font-bold uppercase tracking-wide text-text-2 hover:text-text-1">
              More info
            </button>
          </div>
        </div>
      </div>

      {/* Pager */}
      {slides.length > 1 && (
        <div className="absolute bottom-[22%] right-4 z-10 flex gap-2 lg:right-10">
          {slides.map((sl, idx) => (
            <button key={sl.key} onClick={() => setI(idx)} aria-label={`Slide ${idx + 1}`}
              className={`h-1.5 rounded-full transition-all ${idx === i ? 'w-8 bg-accent' : 'w-4 bg-white/30 hover:bg-white/60'}`} />
          ))}
        </div>
      )}
    </div>
  )
}

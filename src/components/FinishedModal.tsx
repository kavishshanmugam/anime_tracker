import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAnimeById } from '@/lib/anilist'
import { getFranchise, type FranchiseEntry } from '@/lib/franchise'
import { displayTitle } from '@/lib/title'
import { ensureLocal, watchPath } from '@/lib/watch'
import type { Anime } from '@/types'

/** Fire after a show becomes Completed anywhere in the app. */
export function announceCompleted(animeId: number) {
  window.dispatchEvent(new CustomEvent('senpai:completed', { detail: { animeId } }))
}

/**
 * "You finished it!" — quick 5-star rating (→ 2–10 score) and the next entry in the series.
 * Mounted once at the app root; listens for `senpai:completed`.
 */
export default function FinishedModal() {
  const navigate = useNavigate()
  const [anime, setAnime] = useState<Anime | null>(null)
  const [stars, setStars] = useState(0)
  const [hover, setHover] = useState(0)
  const [sequel, setSequel] = useState<FranchiseEntry | null | undefined>(undefined)
  const [sequelLocal, setSequelLocal] = useState<{ id: number; status: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [added, setAdded] = useState(false)

  useEffect(() => {
    const onDone = async (e: Event) => {
      const id = (e as CustomEvent<{ animeId: number }>).detail?.animeId
      if (!id || !window.api) return
      const a = await window.api.db.getAnime(id)
      if (!a) return
      const entry = await window.api.db.getLibraryEntry(id)
      setAnime(a)
      setStars(entry?.my_score ? Math.round(entry.my_score / 2) : 0)
      setSequel(undefined)
      setSequelLocal(null)
      setAdded(false)
      if (!a.anilist_id) { setSequel(null); return }
      try {
        const list = await getFranchise(a.anilist_id)
        const i = list.findIndex(f => f.id === a.anilist_id)
        // Next main-series entry or movie after this one, in release order.
        const next = list.slice(i + 1).find(f => f.kind === 'main' || f.kind === 'movie') ?? null
        setSequel(next)
        if (next) {
          const local = await window.api.db.getAnimeByAnilistId(next.id)
          const le = local ? await window.api.db.getLibraryEntry(local.id) : null
          setSequelLocal(local ? { id: local.id, status: le?.my_status ?? null } : null)
        }
      } catch { setSequel(null) }
    }
    window.addEventListener('senpai:completed', onDone)
    return () => window.removeEventListener('senpai:completed', onDone)
  }, [])

  if (!anime) return null
  const close = () => setAnime(null)

  const rate = async (n: number) => {
    setStars(n)
    await window.api.db.upsertLibraryEntry({ anime_id: anime.id, my_score: n * 2 }).catch(() => {})
  }

  const openSequel = async (play: boolean) => {
    if (!sequel) return
    setBusy(true)
    try {
      const localId = sequelLocal?.id ?? await ensureLocal(await getAnimeById(sequel.id))
      if (!sequelLocal?.status) {
        await window.api.db.upsertLibraryEntry({ anime_id: localId, my_status: 'plan_to_watch', progress: 0, source: 'sequel' })
      }
      if (play) {
        const a = await window.api.db.getAnime(localId)
        close()
        if (a) navigate(watchPath(a, 1))
      } else {
        setAdded(true)
      }
    } finally { setBusy(false) }
  }

  const released = sequel && sequel.status !== 'NOT_YET_RELEASED'
  const shown = hover || stars
  const LABELS = ['', 'Not for me', 'It was okay', 'Good', 'Great', 'Loved it']

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={close}>
      <div className="w-full max-w-md overflow-hidden rounded-card border border-border bg-bg-1 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="relative h-28 overflow-hidden">
          {(anime.banner_url || anime.cover_url) && <img src={anime.banner_url ?? anime.cover_url!} alt="" className="h-full w-full object-cover opacity-60" />}
          <div className="absolute inset-0 bg-gradient-to-t from-bg-1 to-transparent" />
          <button onClick={close} className="absolute right-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-sm text-white hover:bg-black/80">✕</button>
        </div>
        <div className="space-y-5 px-6 pb-6">
          <div className="-mt-6 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-status-completed">Completed 🎉</p>
            <p className="mt-1 font-display text-xl font-bold text-text-1">{displayTitle(anime)}</p>
          </div>

          <div className="text-center">
            <p className="text-sm text-text-2">How was it?</p>
            <div className="mt-2 flex justify-center gap-1" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onMouseEnter={() => setHover(n)} onClick={() => rate(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  className={`text-4xl leading-none transition-transform hover:scale-110 ${n <= shown ? 'text-yellow-400' : 'text-bg-2'}`}>★</button>
              ))}
            </div>
            <p className="mt-1 h-4 text-xs text-text-3">{LABELS[shown]}{stars && !hover ? ' · saved' : ''}</p>
          </div>

          {sequel === undefined ? (
            <p className="text-center text-xs text-text-3">Checking for a sequel…</p>
          ) : sequel ? (
            <div className="rounded-card border border-border bg-bg-0 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-text-3">Next in the series</p>
              <div className="flex items-center gap-3">
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-[4px] bg-bg-2">
                  {sequel.cover && <img src={sequel.cover} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm font-semibold text-text-1">{sequel.title}</p>
                  <p className="text-xs text-text-3">
                    {[sequel.format === 'MOVIE' ? 'Movie' : 'TV', sequel.episodes ? `${sequel.episodes} eps` : null, sequel.year,
                      sequel.status === 'RELEASING' ? 'Airing now' : sequel.status === 'NOT_YET_RELEASED' ? 'Not out yet' : null].filter(Boolean).join(' · ')}
                  </p>
                  {sequelLocal?.status && <p className="text-xs text-accent">Already in your lists</p>}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {released && (
                  <button disabled={busy} onClick={() => openSequel(true)}
                    className="flex-1 rounded-[4px] bg-accent px-3 py-2 text-sm font-bold uppercase text-white hover:bg-accent-hover disabled:opacity-50">▶ Start watching</button>
                )}
                {!sequelLocal?.status && (
                  <button disabled={busy || added} onClick={() => openSequel(false)}
                    className="flex-1 rounded-[4px] border border-accent/60 px-3 py-2 text-sm font-bold uppercase text-accent hover:bg-accent/10 disabled:opacity-60">
                    {added ? '✓ On your watchlist' : released ? '+ Watchlist' : '+ Watchlist — tell me when it airs'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-text-3">No sequel announced yet — you'll get a notification if one shows up.</p>
          )}

          <button onClick={close} className="w-full text-center text-sm text-text-3 hover:text-text-1">{stars ? 'Done' : 'Skip'}</button>
        </div>
      </div>
    </div>
  )
}

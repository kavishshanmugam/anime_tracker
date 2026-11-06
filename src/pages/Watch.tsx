import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { Anime, LibraryEntry, PlayerState, ResolveResult, SkipTime } from '@/types'
import TopNav from '@/components/TopNav'
import AudioToggle from '@/components/AudioToggle'
import EpisodeCard from '@/components/EpisodeCard'
import { airedFromMeta, getEpisodeMeta, type EpisodeMeta } from '@/lib/episodes'
import { stripHtml } from '@/lib/watch'
import { progressAfterWatching } from '@/lib/progress'
import { displayTitle } from '@/lib/title'

const MAX_AUTO_SWITCHES = 3
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
type QualityPref = 'max' | 'auto'
type Audio = 'sub' | 'dub'
interface PlayerPrefs { rate: number; quality: QualityPref; subs: { on: boolean; lang: string } }
const DEFAULT_PREFS: PlayerPrefs = { rate: 1, quality: 'max', subs: { on: true, lang: 'en' } }
// Page states that mean "this domain is broken" (as opposed to a Cloudflare challenge the user can solve).
const DEAD_PAGE = /\b(404|not found|page not found|domain.*for sale|buy this domain|account suspended|coming soon|bad gateway|service unavailable|error 52\d|web server is down)\b/i
const CHALLENGE = /just a moment|checking your browser|attention required|verify you are human|ddos-guard/i

export default function Watch() {
  const { id, ep } = useParams<{ id: string; ep: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const title = searchParams.get('title') ?? ''
  const titleEn = searchParams.get('titleEn') ?? undefined
  const malId = searchParams.get('malId') ? Number(searchParams.get('malId')) : undefined
  const totalEps = searchParams.get('total') ? Number(searchParams.get('total')) : undefined
  const epNum = Number(ep)

  const webviewRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(true)
  const [result, setResult] = useState<ResolveResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [skips, setSkips] = useState<SkipTime[]>([])
  const [activeSkip, setActiveSkip] = useState<SkipTime | null>(null)
  const [watchMarked, setWatchMarked] = useState(false)
  const [nearEnd, setNearEnd] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [onEpisodePage, setOnEpisodePage] = useState(false)
  const [sourceMenu, setSourceMenu] = useState(false)
  const [player, setPlayer] = useState<PlayerState | null>(null)
  const [prefs, setPrefs] = useState<PlayerPrefs>(DEFAULT_PREFS)
  const prefsRef = useRef<PlayerPrefs>(DEFAULT_PREFS)
  const [anime, setAnime] = useState<Anime | null>(null)
  const [entry, setEntry] = useState<LibraryEntry | null>(null)
  const [watchedSet, setWatchedSet] = useState<Set<number>>(new Set())
  const [epMeta, setEpMeta] = useState<Map<number, EpisodeMeta>>(new Map())
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const upNextRef = useRef<HTMLDivElement>(null)

  // Series info for the title block + Up Next list.
  useEffect(() => {
    if (!id || !window.api) return
    const animeId = Number(id)
    window.api.db.getAnime(animeId).then(a => {
      setAnime(a)
      anilistIdRef.current = a?.anilist_id ?? undefined
      if (a?.anilist_id) getEpisodeMeta(a.anilist_id).then(setEpMeta).catch(() => {})
    }).catch(() => {})
    window.api.db.getLibraryEntry(animeId).then(setEntry).catch(() => {})
    window.api.db.getWatchEvents(animeId).then(ev => setWatchedSet(new Set(ev.map(e => e.episode)))).catch(() => {})
  }, [id, epNum])

  // Keep the current episode in view in the Up Next list.
  useEffect(() => {
    const el = upNextRef.current?.querySelector('[data-current="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [epNum, anime])

  // Refs mirror state for use inside long-lived webview listeners.
  const excludedRef = useRef<string[]>([])
  const switchesRef = useRef(0)
  const resultRef = useRef<ResolveResult | null>(null)
  const watchMarkedRef = useRef(false)
  useEffect(() => { resultRef.current = result }, [result])
  useEffect(() => { watchMarkedRef.current = watchMarked }, [watchMarked])
  useEffect(() => { prefsRef.current = prefs }, [prefs])

  // Speed + quality preferences persist across episodes and restarts.
  useEffect(() => {
    window.api?.db.getAppState('player_prefs').then(v => {
      if (!v) return
      try { setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(v) }) } catch { /* */ }
    }).catch(() => {})
  }, [])
  const savePrefs = useCallback((next: PlayerPrefs) => {
    setPrefs(next)
    window.api?.db.setAppState('player_prefs', JSON.stringify(next)).catch(() => {})
  }, [])

  const wcId = (): number | null => {
    try { return webviewRef.current?.getWebContentsId() ?? null } catch { return null }
  }

  const setSpeed = useCallback((rate: number) => {
    savePrefs({ ...prefsRef.current, rate })
    const id = wcId()
    if (id != null) window.api.stream.player(id, { type: 'rate', rate }).catch(() => {})
    setPlayer(p => p ? { ...p, rate } : p)
  }, [savePrefs])

  const stepSpeed = useCallback((dir: 1 | -1) => {
    const cur = prefsRef.current.rate
    const i = SPEEDS.findIndex(sp => sp >= cur - 0.001)
    const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))]
    setSpeed(next)
    setNotice(`Speed ${next}x`)
  }, [setSpeed])

  // Sub/Dub is chosen per show (falls back to the default from Settings).
  const [audio, setAudio] = useState<Audio | null>(null)
  const audioRef = useRef<Audio>('sub')
  const anilistIdRef = useRef<number | undefined>(undefined)
  const skipResolveRef = useRef(false)
  useEffect(() => {
    if (!id || !window.api) { setAudio('sub'); return }
    Promise.all([window.api.db.getAppState(`audio_show_${id}`), window.api.db.getAppState('audio_pref'), window.api.db.getAnime(Number(id))])
      .then(([show, def, animeRow]) => {
        anilistIdRef.current = animeRow?.anilist_id ?? undefined
        const a: Audio = (show ?? def) === 'dub' ? 'dub' : 'sub'
        audioRef.current = a
        setAudio(a)
      })
      .catch(() => setAudio('sub'))
  }, [id])

  /** Switch this show to Sub or Dub (all episodes). `reload` re-resolves the current episode. */
  const changeAudio = useCallback((a: Audio, reload = true) => {
    if (a === audioRef.current) return
    audioRef.current = a
    if (id) window.api?.db.setAppState(`audio_show_${id}`, a).catch(() => {})
    if (!reload) skipResolveRef.current = true
    setAudio(a)
    setNotice(`${a === 'dub' ? 'Dub' : 'Sub'} selected for every episode of this show`)
  }, [id])

  const resolve = useCallback(async (opts: { providerId?: string; reason?: string } = {}) => {
    setResolving(true)
    setLoading(true)
    setOnEpisodePage(false)
    try {
      const r = await window.api.stream.resolveEpisode(title, epNum, {
        titleEn, providerId: opts.providerId, excludeOrigins: excludedRef.current, audio: audioRef.current, anilistId: anilistIdRef.current,
      })
      setResult(r)
      if (r.audioFallback) setNotice(`No dub found for episode ${epNum} — playing the sub instead`)
      if (opts.reason && r.url) setNotice(`${opts.reason} — switched to ${r.providerName ?? 'another source'} (${new URL(r.url).hostname})`)
      if (!r.url) setLoading(false)
    } catch {
      setResult(null)
      setLoading(false)
    } finally {
      setResolving(false)
    }
  }, [title, titleEn, epNum])

  // Resolve on episode or language change.
  useEffect(() => {
    if (!audio) return
    if (skipResolveRef.current) { skipResolveRef.current = false; return }
    excludedRef.current = []
    switchesRef.current = 0
    setWatchMarked(false)
    setNearEnd(false)
    setActiveSkip(null)
    setSkips([])
    setNotice(null)
    resolve()
    if (malId) window.api?.stream.getSkipTimes(malId, epNum).then(s => { if (s?.length) setSkips(s) }).catch(() => {})
  }, [title, epNum, malId, resolve, audio])

  /** Mark the current origin as failed and try the next domain/provider. */
  const failover = useCallback((reason: string) => {
    const r = resultRef.current
    if (!r?.origin) return
    window.api.stream.reportFailure(r.url, reason).catch(() => {})
    if (switchesRef.current >= MAX_AUTO_SWITCHES) {
      setNotice(`${reason}. Stopped after ${MAX_AUTO_SWITCHES} automatic switches — pick a source manually.`)
      setLoading(false)
      return
    }
    switchesRef.current++
    excludedRef.current = [...excludedRef.current, r.origin]
    resolve({ reason: `${new URL(r.origin).hostname}: ${reason}` })
  }, [resolve])

  // Blocked navigations / downloads / popups from the hardened session.
  useEffect(() => window.api?.stream.onBlocked(info => {
    const what = info.kind === 'download' ? 'Blocked a download' : info.kind === 'popup' ? 'Blocked a popup' : 'Blocked navigation'
    setNotice(`${what}: ${info.detail}`)
  }), [])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  const markWatched = useCallback(async () => {
    if (!id || watchMarkedRef.current) return
    watchMarkedRef.current = true
    setWatchMarked(true)
    setWatchedSet(prev => new Set(prev).add(epNum))
    try {
      // One progress per show regardless of Sub/Dub; the language is only noted in the history.
      await window.api?.db.addWatchEvent({
        anime_id: Number(id), episode: epNum, source: `in-app · ${audioRef.current}`, watched_at: new Date().toISOString(),
      })
      const entry = await window.api?.db.getLibraryEntry(Number(id))
      const total = totalEps ?? (await window.api?.db.getAnime(Number(id)))?.episodes_total
      const update = progressAfterWatching({ entry, episode: epNum, episodesTotal: total })
      if (update) await window.api?.db.upsertLibraryEntry({ anime_id: Number(id), ...(entry ? {} : { source: 'in-app' }), ...update })
      if (update?.my_status === 'completed') setNotice('Series completed 🎉 — marked as Completed in your lists')
    } catch { /* non-fatal */ }
  }, [id, epNum, totalEps])

  // Poll the in-page controller (reaches cross-origin player iframes via the main process).
  useEffect(() => {
    if (!onEpisodePage) { setPlayer(null); return }
    const timer = setInterval(async () => {
      const id = wcId()
      if (id == null) return
      const info = await window.api.stream.player(id, {
        type: 'state', prefs: { rate: prefsRef.current.rate, mode: prefsRef.current.quality, subs: prefsRef.current.subs, audio: audioRef.current },
      }).catch(() => null)
      setPlayer(info)
      for (const req of info?.requests ?? []) if (req.type === 'audio') changeAudio(req.value)
      if (!info || !info.duration) return
      // Speed/quality picked in the in-player ⚙ menu → remember for next episodes.
      const pr = prefsRef.current
      const mode: QualityPref | null = info.mode === 'max' || info.mode === 'auto' ? info.mode : null
      const subsChanged = info.subs.tracks.length > 0 && (info.subs.on !== pr.subs.on || info.subs.lang !== pr.subs.lang)
      if (Math.abs(info.rate - pr.rate) > 0.01 || (mode && mode !== pr.quality) || subsChanged)
        savePrefs({ rate: info.rate, quality: mode ?? pr.quality, subs: subsChanged ? { on: info.subs.on, lang: info.subs.lang } : pr.subs })
      if (info.events.length) setNotice(info.events[info.events.length - 1])
      setActiveSkip(skips.find(sk => info.time >= sk.startTime && info.time < sk.endTime) ?? null)
      if (info.time / info.duration > 0.85) markWatched()
      setNearEnd(info.duration - info.time < 30)
    }, 1500)
    return () => clearInterval(timer)
  }, [skips, onEpisodePage, markWatched, savePrefs, changeAudio])

  const handleSkip = useCallback(() => {
    const id = wcId()
    if (!activeSkip || id == null) return
    window.api.stream.player(id, { type: 'seek', time: activeSkip.endTime }).catch(() => {})
    setActiveSkip(null)
  }, [activeSkip])

  const openInBrowser = () => {
    window.open(`https://www.google.com/search?q=${encodeURIComponent(`${title} episode ${epNum} watch online sub`)}`, '_blank')
  }

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return
    if (document.fullscreenElement) document.exitFullscreen()
    else containerRef.current.requestFullscreen()
  }, [])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const navigateEp = useCallback((next: number) => {
    const params = new URLSearchParams({ title })
    if (titleEn) params.set('titleEn', titleEn)
    if (malId) params.set('malId', String(malId))
    if (totalEps) params.set('total', String(totalEps))
    navigate(`/watch/${id}/${next}?${params}`, { replace: true })
  }, [title, titleEn, malId, totalEps, id, navigate])

  const hasNext = !totalEps || epNum < totalEps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      switch (e.key) {
        case 's': if (activeSkip) handleSkip(); break
        case 'f': toggleFullscreen(); break
        case 'n': if (hasNext) navigateEp(epNum + 1); break
        case 'p': if (epNum > 1) navigateEp(epNum - 1); break
        case ']': case '>': stepSpeed(1); break
        case '[': case '<': stepSpeed(-1); break
        case 'Escape':
          if (isFullscreen) document.exitFullscreen()
          else navigate(`/anime/${id}`, { replace: true })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSkip, isFullscreen, id, handleSkip, toggleFullscreen, navigate, navigateEp, epNum, hasNext, stepSpeed])

  const skipLabel = activeSkip?.type === 'op' ? 'Skip Intro'
    : activeSkip?.type === 'ed' ? 'Skip Outro'
    : activeSkip?.type === 'recap' ? 'Skip Recap'
    : activeSkip ? 'Skip' : ''

  // Webview listeners are attached once per element; they read state through refs.
  const attachWebview = useCallback((wv: any) => {
    const detect = async (url: string) => {
      try {
        const learned = await window.api.stream.learnFromUrl(title, url, epNum)
        if (!learned) { setOnEpisodePage(false); return }
        if (learned.onEpisode && learned.audio !== audioRef.current) changeAudio(learned.audio, false)
        if (learned.redirect && learned.redirect !== url) { wv.loadURL(learned.redirect); return }
        setOnEpisodePage(learned.onEpisode)
      } catch { /* */ }
    }

    wv.addEventListener('did-navigate', () => detect(wv.getURL()))
    wv.addEventListener('did-navigate-in-page', (e: any) => { if (e.isMainFrame) detect(wv.getURL()) })

    wv.addEventListener('did-finish-load', async () => {
      setLoading(false)
      wv.insertCSS(`
        [class*="ads"]:not(video):not([class*="player"]), [id*="ads"]:not(video), [class*="popup"], .adsbygoogle,
        div[data-ad], iframe[src*="/ads"], iframe[src*="doubleclick"], [class*="sponsor"] { display: none !important; }
      `).catch(() => {})
      // Detect dead/parked pages that loaded "successfully".
      try {
        const page = await wv.executeJavaScript(`({ title: document.title, text: (document.body?.innerText || '').slice(0, 600) })`)
        const sample = `${page.title}\n${page.text}`
        if (CHALLENGE.test(sample)) {
          setNotice('This site is showing a bot check — complete it below and playback will continue.')
        } else if (DEAD_PAGE.test(page.title)) {
          failover('page is dead or parked')
        }
      } catch { /* */ }
    })

    wv.addEventListener('did-fail-load', (e: any) => {
      // -3 = aborted (normal when navigating away)
      if (!e.isMainFrame || e.errorCode === -3) return
      failover(e.errorDescription || `load error ${e.errorCode}`)
    })
  }, [title, epNum, failover, changeAudio])

  const providers = result?.providers ?? []
  const total = totalEps ?? anime?.episodes_total ?? undefined
  const progress = entry?.progress ?? 0
  const currentMeta = epMeta.get(epNum)
  // Only list episodes that have aired (airing shows), never fewer than the one playing.
  const metaAired = airedFromMeta(epMeta)
  const upNextCount = Math.max(epNum,
    anime?.airing_status === 'RELEASING' && metaAired != null ? metaAired : (total ?? metaAired ?? Math.max(epNum + 12, progress + 1)))

  const submitLink = async () => {
    if (!linkValue.trim()) return
    setLinkBusy(true)
    try {
      const r = await window.api.stream.useLink(title, linkValue.trim(), epNum)
      setNotice(r.message)
      if (r.ok && r.url) {
        const origin = new URL(r.url).origin
        setResult(prev => ({
          url: r.url!, isSearch: false, providerId: r.providerId, origin,
          providerName: new URL(r.url!).hostname, tried: prev?.tried ?? [], providers: prev?.providers ?? [],
        }))
        setLinkOpen(false)
        setLinkValue('')
        setLoading(true)
      }
    } finally {
      setLinkBusy(false)
    }
  }

  const toolBtn = 'rounded-[4px] border border-border bg-bg-1 px-3 py-1.5 text-xs font-semibold text-text-2 hover:text-text-1 hover:bg-bg-2 disabled:opacity-50'

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-0">
      <TopNav />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-6 px-4 py-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
          {/* ---------- Player column ---------- */}
          <div className="min-w-0 space-y-4">
            <div ref={containerRef}
              className={`relative w-full overflow-hidden bg-black ${isFullscreen ? 'h-screen' : 'aspect-video rounded-[6px] shadow-2xl'}`}>
              {result?.url && (
                <webview
                  key={result.url}
                  ref={(el: any) => {
                    if (el && el !== webviewRef.current) {
                      webviewRef.current = el
                      attachWebview(el)
                    }
                  }}
                  src={result.url}
                  className="absolute inset-0 h-full w-full"
                  // @ts-ignore
                  partition="persist:streaming"
                />
              )}

              {loading && (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/60">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-accent/30 border-t-accent" />
                  <div className="text-sm text-text-2">{resolving ? 'Finding a safe source…' : 'Loading…'}</div>
                </div>
              )}

              {!resolving && !result?.url && (
                <div className="absolute inset-0 flex items-center justify-center bg-bg-1 p-6">
                  <div className="max-w-md space-y-3 text-center">
                    <p className="font-display text-lg font-bold text-text-1">Couldn't find this episode</p>
                    <p className="text-sm text-text-3">
                      No source has a domain that passed the safety checks. Paste a link from a site you trust, or add one in Settings.
                    </p>
                    {!!result?.tried.length && (
                      <ul className="space-y-0.5 text-left text-xs text-text-3">
                        {result.tried.map((t, i) => <li key={i}>• {t.providerId}{t.origin ? ` (${new URL(t.origin).hostname})` : ''}: {t.reason}</li>)}
                      </ul>
                    )}
                    <div className="flex justify-center gap-2 pt-1">
                      <button onClick={() => setLinkOpen(true)} className="rounded-[4px] bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover">Paste a link</button>
                      <button onClick={() => navigate('/settings')} className={toolBtn}>Sources</button>
                      <button onClick={openInBrowser} className={toolBtn}>Search in browser</button>
                    </div>
                  </div>
                </div>
              )}

              {activeSkip && (
                <button onClick={handleSkip}
                  className="absolute bottom-16 right-6 z-30 rounded-[4px] border border-white/40 bg-black/70 px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white backdrop-blur-sm hover:bg-accent hover:border-accent">
                  {skipLabel} ›
                </button>
              )}
              {nearEnd && !activeSkip && hasNext && (
                <button onClick={() => navigateEp(epNum + 1)}
                  className="absolute bottom-16 right-6 z-30 rounded-[4px] bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-white shadow-lg hover:bg-accent-hover">
                  Next episode ›
                </button>
              )}
            </div>

            {notice && (
              <div className="rounded-[4px] border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">{notice}</div>
            )}
            {result?.isSearch && result.url && !onEpisodePage && !loading && (
              <div className="rounded-[4px] border border-accent/20 bg-accent/10 px-3 py-2 text-sm text-accent">
                Couldn't match this show automatically on {result.providerName}. Click it in the results above — future episodes will load automatically.
              </div>
            )}

            {/* Title block */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <button onClick={() => navigate(`/anime/${id}`)} className="text-sm font-bold uppercase tracking-wide text-accent hover:text-accent-hover">
                  {anime ? displayTitle(anime) : (titleEn ?? title)}
                </button>
                <h1 className="mt-1 font-display text-2xl font-bold text-text-1">
                  E{epNum}{currentMeta?.title ? ` - ${currentMeta.title}` : ''}
                </h1>
                <p className="mt-1 text-sm text-text-3">
                  {[anime?.format, total ? `Episode ${epNum} of ${total}` : `Episode ${epNum}`, result?.origin ? `via ${new URL(result.origin).hostname}` : null,
                    player?.height ? `${player.height}p` : null, player && player.rate !== 1 ? `${player.rate}x` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {epNum > 1 && <button onClick={() => navigateEp(epNum - 1)} className={toolBtn}>‹ Prev</button>}
                {hasNext && <button onClick={() => navigateEp(epNum + 1)} className={toolBtn}>Next ›</button>}
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Source */}
              <div className="relative">
                <button onClick={() => setSourceMenu(v => !v)} disabled={resolving} className={toolBtn}>
                  {resolving ? 'Finding source…' : result?.origin ? `Source: ${new URL(result.origin).hostname}` : 'No source'} ▾
                </button>
                {sourceMenu && (
                  <div className="absolute left-0 z-40 mt-1 w-64 rounded-card border border-border bg-bg-1 p-1 shadow-2xl">
                    {providers.length === 0 && <div className="px-3 py-2 text-xs text-text-3">No sources configured</div>}
                    {providers.map(p => (
                      <button key={p.id} disabled={!p.available}
                        onClick={() => { setSourceMenu(false); excludedRef.current = []; switchesRef.current = 0; resolve({ providerId: p.id }) }}
                        className={`w-full rounded px-3 py-2 text-left text-sm hover:bg-bg-2 disabled:opacity-40 ${p.id === result?.providerId ? 'text-accent' : 'text-text-2'}`}>
                        {p.name} {!p.available && <span className="text-xs">(no safe domain)</span>}
                      </button>
                    ))}
                    {result?.origin && (
                      <button onClick={() => { setSourceMenu(false); failover('skipped by user') }}
                        className="mt-1 w-full rounded border-t border-border px-3 py-2 text-left text-xs text-text-3 hover:bg-bg-2">
                        Try next mirror
                      </button>
                    )}
                    <button onClick={() => { setSourceMenu(false); setLinkOpen(true) }}
                      className="w-full rounded px-3 py-2 text-left text-xs text-accent hover:bg-bg-2">
                      Paste a link from another site…
                    </button>
                  </div>
                )}
              </div>

              <button onClick={markWatched} disabled={watchMarked} className={`${toolBtn} ${watchMarked ? '!text-status-completed' : ''}`}>
                {watchMarked ? '✓ Watched' : 'Mark watched'}
              </button>
              <button onClick={toggleFullscreen} className={toolBtn}>{isFullscreen ? 'Exit fullscreen' : '⛶ Fullscreen'}</button>
              <button onClick={openInBrowser} className={toolBtn}>Open in browser</button>
            </div>

            {linkOpen && (
              <div className="space-y-2 rounded-card border border-accent/30 bg-accent/5 p-3">
                <p className="text-sm text-text-2">
                  Found this episode (or show) on another site? Paste the link. It's safety-checked first, then played here,
                  and Senpai learns the site so future episodes load automatically.
                </p>
                <div className="flex gap-2">
                  <input autoFocus value={linkValue} onChange={e => setLinkValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') submitLink(); if (e.key === 'Escape') { e.stopPropagation(); setLinkOpen(false) } }}
                    placeholder="https://…"
                    className="flex-1 rounded-[4px] border border-border bg-bg-0 px-3 py-1.5 text-sm text-text-1 outline-none placeholder:text-text-3/50 focus:border-accent" />
                  <button onClick={submitLink} disabled={linkBusy || !linkValue.trim()}
                    className="rounded-[4px] bg-accent px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-50">
                    {linkBusy ? 'Checking…' : 'Check & play'}
                  </button>
                  <button onClick={() => setLinkOpen(false)} className={toolBtn}>Cancel</button>
                </div>
              </div>
            )}

            {anime?.synopsis && (
              <p className="max-w-4xl text-sm leading-relaxed text-text-3 line-clamp-4">{stripHtml(anime.synopsis)}</p>
            )}
            <p className="text-xs text-text-3/60">⚙ on the video: speed & quality · S skip · N/P next/prev · [ ] speed · F fullscreen · Esc back</p>
          </div>

          {/* ---------- Up Next ---------- */}
          <aside className="min-w-0 lg:sticky lg:top-5 lg:max-h-[calc(100vh-100px)] lg:self-start">
            <div className="flex h-full flex-col rounded-card border border-border bg-bg-1">
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wide text-text-3">Up next</p>
                  <p className="truncate text-sm font-semibold text-text-1">{anime ? displayTitle(anime) : (titleEn ?? title)}</p>
                </div>
                <AudioToggle value={audio ?? 'sub'} onChange={a => changeAudio(a)} />
              </div>
              <div ref={upNextRef} className="flex-1 space-y-1 overflow-y-auto p-2 lg:max-h-[calc(100vh-170px)]">
                {Array.from({ length: Math.min(upNextCount, epNum + 40) - Math.max(1, epNum - 10) + 1 }, (_, i) => Math.max(1, epNum - 10) + i).map(n => {
                  const meta = epMeta.get(n)
                  return (
                    <div key={n} data-current={n === epNum ? 'true' : undefined}>
                      <EpisodeCard layout="row" episode={n} episodeTitle={meta?.title}
                        thumbnail={meta?.thumbnail} fallback={anime?.banner_url ?? anime?.cover_url}
                        current={n === epNum} watched={n <= progress || watchedSet.has(n)}
                        onClick={() => n !== epNum && navigateEp(n)} />
                    </div>
                  )
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

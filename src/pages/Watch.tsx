import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { SkipTime } from '@/types'

export default function Watch() {
  const { id, ep } = useParams<{ id: string; ep: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const title = searchParams.get('title') ?? ''
  const titleEn = searchParams.get('titleEn') ?? undefined
  const malId = searchParams.get('malId') ? Number(searchParams.get('malId')) : undefined
  const totalEps = searchParams.get('total') ? Number(searchParams.get('total')) : undefined

  const webviewRef = useRef<any>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [pageUrl, setPageUrl] = useState('')
  const [isSearch, setIsSearch] = useState(false)
  const [skips, setSkips] = useState<SkipTime[]>([])
  const [activeSkip, setActiveSkip] = useState<SkipTime | null>(null)
  const [watchMarked, setWatchMarked] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [onEpisodePage, setOnEpisodePage] = useState(false)
  const skipPollRef = useRef<ReturnType<typeof setInterval>>()
  const epNum = Number(ep)
  const webviewSetup = useRef(false)

  // Resolve URL
  useEffect(() => {
    setLoading(true)
    setWatchMarked(false)
    setActiveSkip(null)
    setOnEpisodePage(false)
    webviewSetup.current = false

    window.api?.stream.resolveEpisode(title, epNum).then((result: any) => {
      if (result) {
        setPageUrl(result.url)
        setIsSearch(!!result.isSearch)
      }
      setLoading(false)
    }).catch(() => setLoading(false))

    if (malId) {
      window.api?.stream.getSkipTimes(malId, epNum).then(s => {
        if (s?.length) setSkips(s)
      }).catch(() => {})
    }
  }, [title, epNum, malId])

  const markWatched = useCallback(async () => {
    if (!id) return
    try {
      await window.api?.db.addWatchEvent({
        anime_id: Number(id), episode: epNum, source: 'in-app',
        watched_at: new Date().toISOString(),
      })
      const entry = await window.api?.db.getLibraryEntry(Number(id))
      if (entry && epNum > (entry.progress ?? 0)) {
        await window.api?.db.upsertLibraryEntry({
          anime_id: Number(id), progress: epNum,
          my_status: entry.my_status === 'plan_to_watch' ? 'watching' : entry.my_status,
          last_watched_at: new Date().toISOString(),
        })
      }
    } catch {}
  }, [id, epNum])

  // Skip button polling
  useEffect(() => {
    if (!skips.length || !onEpisodePage) return
    skipPollRef.current = setInterval(() => {
      const wv = webviewRef.current
      if (!wv) return
      try {
        wv.executeJavaScript(`
          (function() {
            var v = document.querySelector('video');
            if (!v) { try { var fs = document.querySelectorAll('iframe');
              for (var i = 0; i < fs.length; i++) { try { v = fs[i].contentDocument.querySelector('video'); } catch(e) {} if (v) break; }
            } catch(e) {} }
            return v ? { time: v.currentTime, duration: v.duration } : null;
          })()
        `).then((info: { time: number; duration: number } | null) => {
          if (!info) return
          setActiveSkip(skips.find(s => info.time >= s.startTime && info.time < s.endTime) ?? null)
          if (!watchMarked && info.duration > 0 && info.time / info.duration > 0.8) {
            setWatchMarked(true)
            markWatched()
          }
        }).catch(() => {})
      } catch {}
    }, 2000)
    return () => { if (skipPollRef.current) clearInterval(skipPollRef.current) }
  }, [skips, watchMarked, onEpisodePage, markWatched])

  const handleSkip = useCallback(() => {
    if (!activeSkip || !webviewRef.current) return
    webviewRef.current.executeJavaScript(`
      (function() {
        var v = document.querySelector('video');
        if (!v) { try { var fs = document.querySelectorAll('iframe');
          for (var i = 0; i < fs.length; i++) { try { v = fs[i].contentDocument.querySelector('video'); } catch(e) {} if (v) break; }
        } catch(e) {} }
        if (v) v.currentTime = ${activeSkip.endTime};
      })()
    `).catch(() => {})
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 's': if (activeSkip) handleSkip(); break
        case 'f': toggleFullscreen(); break
        case 'Escape':
          if (isFullscreen) document.exitFullscreen()
          else navigate(`/anime/${id}`, { replace: true })
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeSkip, isFullscreen, id, handleSkip, toggleFullscreen, navigate])

  const navigateEp = (next: number) => {
    const params = new URLSearchParams({ title })
    if (titleEn) params.set('titleEn', titleEn)
    if (malId) params.set('malId', String(malId))
    if (totalEps) params.set('total', String(totalEps))
    navigate(`/watch/${id}/${next}?${params}`, { replace: true })
  }

  const skipLabel = activeSkip?.type === 'op' ? 'Skip Intro'
    : activeSkip?.type === 'ed' ? 'Skip Outro'
    : activeSkip?.type === 'recap' ? 'Skip Recap'
    : activeSkip ? 'Skip' : ''

  // Webview setup
  const onWebviewReady = useCallback(() => {
    const wv = webviewRef.current
    if (!wv || webviewSetup.current) return
    webviewSetup.current = true

    wv.addEventListener('did-finish-load', () => {
      setLoading(false)
      // Hide ads
      wv.insertCSS(`
        [class*="ads"], [class*="Ads"], [id*="ads"], [id*="Ads"],
        [class*="banner"]:not([class*="anime"]), [class*="popup"],
        iframe[src*="ad"], div[data-ad], .adsbygoogle,
        [class*="sponsor"], [class*="promo"] { display: none !important; }
      `).catch(() => {})
    })

    // Detect episode page navigation — learn slug + auto-redirect
    // Pattern: /slug-episode-N (anitaku/gogoanime style)
    const detectSlug = (url: string) => {
      try {
        const epMatch = url.match(/\/([a-z0-9][\w-]*)-episode-(\d+)/)
        if (epMatch) {
          const slug = epMatch[1]
          const detectedEp = Number(epMatch[2])
          setOnEpisodePage(true)
          setIsSearch(false)
          window.api?.stream.learnSlug(title, slug).catch(() => {})

          if (detectedEp !== epNum) {
            const correctUrl = url.replace(`-episode-${detectedEp}`, `-episode-${epNum}`)
            wv.loadURL(correctUrl)
          }
        } else {
          setOnEpisodePage(false)
        }
      } catch {}
    }

    wv.addEventListener('did-navigate', () => detectSlug(wv.getURL()))
    wv.addEventListener('did-navigate-in-page', () => detectSlug(wv.getURL()))

    wv.addEventListener('did-fail-load', () => setLoading(false))
  }, [title, epNum])

  return (
    <div ref={containerRef} className="relative flex flex-col h-screen bg-black">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-bg-0 border-b border-border shrink-0 z-20">
        <button onClick={() => navigate(`/anime/${id}`, { replace: true })}
          className="text-text-3 hover:text-text-1 text-sm">← Back</button>
        <span className="text-text-1 font-medium truncate">{title}</span>
        <span className="text-text-3 text-sm">Ep {epNum}</span>
        <div className="flex-1" />
        <button onClick={openInBrowser} className="text-text-3 hover:text-text-1 text-xs px-2">
          Open in browser
        </button>
        {epNum > 1 && (
          <button onClick={() => navigateEp(epNum - 1)} className="text-text-3 hover:text-text-1 text-sm px-2">← Prev</button>
        )}
        {totalEps && epNum < totalEps && (
          <button onClick={() => navigateEp(epNum + 1)} className="text-text-3 hover:text-text-1 text-sm px-2">Next →</button>
        )}
        <button onClick={toggleFullscreen} className="text-text-3 hover:text-text-1 text-sm px-2">
          {isFullscreen ? 'Exit FS' : 'Fullscreen'}
        </button>
      </div>

      {/* Search hint — shown when we don't have a cached slug yet */}
      {isSearch && !onEpisodePage && !loading && (
        <div className="bg-accent/10 border-b border-accent/20 px-4 py-2 text-sm text-accent z-20">
          Click your anime from the results below. Future episodes will load automatically.
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/50">
          <div className="text-text-2 text-lg">Loading...</div>
        </div>
      )}

      {/* Error state when episode cannot be resolved */}
      {!loading && !pageUrl && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-text-2 text-lg">Could not find this episode</p>
            <p className="text-text-3 text-sm">Try opening in browser or check the streaming site URL in Settings.</p>
            <button onClick={openInBrowser} className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-text-1 hover:bg-accent-hover">
              Search in browser
            </button>
          </div>
        </div>
      )}

      {/* Webview */}
      {pageUrl && (
        <webview
          ref={(el: any) => {
            if (el && el !== webviewRef.current) {
              webviewRef.current = el
              onWebviewReady()
            }
          }}
          src={pageUrl}
          className="flex-1 w-full"
          // @ts-ignore
          partition="persist:streaming"
          allowpopups={false}
          style={{ minHeight: 0 }}
        />
      )}

      {/* Skip button */}
      {activeSkip && (
        <button onClick={handleSkip}
          className="absolute bottom-8 right-8 z-30 rounded-lg border border-accent/60 bg-black/80 backdrop-blur-sm px-6 py-3 text-base font-semibold text-accent hover:bg-accent/20 transition-colors">
          {skipLabel} →
        </button>
      )}

      <div className="absolute bottom-2 left-4 text-white/20 text-xs z-10">
        S: skip · F: fullscreen · Esc: back
      </div>
    </div>
  )
}

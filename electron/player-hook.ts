// In-page playback controller, injected into every frame of the streaming webview
// (via the session preload, and lazily from the main process as a fallback).
//
// It exposes window.__senpai with:
//   state(prefs)        -> playback + quality info for the Watch page
//   setRate(rate)       -> playback speed (re-applied when the player loads a new source)
//   setQuality(mode, i) -> 'max'    : start at the highest resolution, step down on buffering,
//                                     cautiously step back up after a long stable period
//                          'auto'   : hand control back to the site player's own ABR
//                          'manual' : lock to level i
//
// Quality control goes through whichever player API is present: hls.js, JW Player,
// video.js (qualityLevels) or Plyr. Speed works on any <video>.
//
// IMPORTANT: this function is serialised with toString() and run inside third-party pages,
// so it must be fully self-contained (no imports, no outer-scope references).

/* eslint-disable @typescript-eslint/no-explicit-any */
export function playerHook() {
  const w = window as any
  if (w.__senpai) return

  const STALL_DOWNGRADE_MS = 2500   // a single stall this long → lower quality
  const STALLS_PER_MINUTE = 3       // or this many shorter stalls within 60s
  const GRACE_MS = 8000             // ignore stalls right after a quality change / seek
  const UPGRADE_AFTER_MS = 180000   // stable this long → try one level higher
  const MAX_FAILS_PER_LEVEL = 2     // a level that stalled twice is not retried

  const S: any = {
    hlsList: [], rate: null, mode: 'max', idx: 0, applied: false, failed: {}, stalls: [] as number[],
    stallStart: 0, graceUntil: 0, lastChange: 0, lastStall: 0, downgrades: 0, video: null, levelKey: '',
    events: [] as string[], settingRate: false,
    subPref: null as null | { on: boolean; lang: string }, subKey: '', audio: 'sub', requests: [] as any[],
  }
  w.__senpai = S

  // ---- capture hls.js instances created after we load (UMD builds assign window.Hls) ----
  const wrap = (H: any) => {
    if (typeof H !== 'function' || H.__senpai) return H
    const W: any = function (this: any, ...args: any[]) { const inst = new H(...args); S.hlsList.push(inst); return inst }
    Object.setPrototypeOf(W, H)
    W.prototype = H.prototype
    W.__senpai = true
    return W
  }
  try {
    let current = w.Hls ? wrap(w.Hls) : undefined
    Object.defineProperty(w, 'Hls', { configurable: true, enumerable: true, get: () => current, set: (v: any) => { current = wrap(v) } })
  } catch { /* non-configurable on this page */ }

  const heightOf = (label: any, fallback?: number) => {
    const m = String(label ?? '').match(/(\d{3,4})\s*p/i) || String(label ?? '').match(/^(\d{3,4})$/)
    return m ? Number(m[1]) : (fallback || 0)
  }
  const desc = (a: any, b: any) => (b.height - a.height) || ((b.bitrate || 0) - (a.bitrate || 0))
  const labelOf = (l: any) => l.label || (l.height ? `${l.height}p` : 'unknown')

  const findVideo = (): HTMLVideoElement | null => {
    const vs = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]
    return vs.find(v => v.duration > 0 && !v.paused) || vs.find(v => v.duration > 0) || vs[0] || null
  }

  // ---- player adapters: levels() sorted high → low; set(k) selects levels()[k] ----
  const adapter = (v: HTMLVideoElement): any => {
    // hls.js
    const hlsCands = S.hlsList.concat([w.hls, w.player && w.player.hls, (v as any).hls].filter(Boolean))
    const h = hlsCands.find((x: any) => x && x.media === v && Array.isArray(x.levels) && x.levels.length)
    if (h) {
      const levels = () => h.levels.map((l: any, i: number) => ({ i, height: l.height || 0, bitrate: l.bitrate || 0 })).sort(desc)
        .map((l: any) => ({ ...l, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)}k` }))
      return {
        name: 'hls.js', levels,
        set: (k: number, up: boolean) => { const l = levels()[k]; if (!l) return; if (up) h.nextLevel = l.i; else h.currentLevel = l.i },
        auto: () => { h.currentLevel = -1 },
        isAuto: () => h.autoLevelEnabled,
      }
    }
    // JW Player
    if (typeof w.jwplayer === 'function') {
      try {
        const p = w.jwplayer()
        const ql = p && p.getQualityLevels && p.getQualityLevels()
        if (ql && ql.length > 1) {
          const levels = () => (p.getQualityLevels() || []).map((q: any, i: number) => ({ i, label: q.label, height: heightOf(q.label, q.height), bitrate: q.bitrate }))
            .filter((l: any) => !/auto/i.test(l.label)).sort(desc)
          const autoIdx = () => (p.getQualityLevels() || []).findIndex((q: any) => /auto/i.test(q.label))
          return {
            name: 'JW Player', levels,
            set: (k: number) => { const l = levels()[k]; if (l) p.setCurrentQuality(l.i) },
            auto: () => { const a = autoIdx(); if (a >= 0) p.setCurrentQuality(a) },
            isAuto: () => p.getCurrentQuality() === autoIdx(),
            setRate: (r: number) => { try { p.setPlaybackRate(r) } catch { /* */ } },
          }
        }
      } catch { /* not a JW page */ }
    }
    // video.js with quality levels plugin
    if (w.videojs && typeof w.videojs.getPlayers === 'function') {
      for (const p of Object.values(w.videojs.getPlayers()) as any[]) {
        if (!p || !p.el || !p.el() || !p.el().contains(v) || typeof p.qualityLevels !== 'function') continue
        const q = p.qualityLevels()
        if (!q || q.length < 2) continue
        const levels = () => Array.from({ length: q.length }, (_, i) => ({ i, height: q[i].height || 0, bitrate: q[i].bitrate || 0 }))
          .sort(desc).map((l: any) => ({ ...l, label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)}k` }))
        return {
          name: 'video.js', levels,
          set: (k: number) => { const t = levels()[k]; if (!t) return; for (let i = 0; i < q.length; i++) q[i].enabled = i === t.i },
          auto: () => { for (let i = 0; i < q.length; i++) q[i].enabled = true },
          isAuto: () => { let n = 0; for (let i = 0; i < q.length; i++) if (q[i].enabled) n++; return n === q.length },
        }
      }
    }
    // Plyr
    const container = v.closest && v.closest('.plyr')
    const pl = (v as any).plyr || (container && (container as any).plyr)
    const opts = pl && pl.options && pl.options.quality && pl.options.quality.options
    if (opts && opts.length > 1) {
      const levels = () => opts.map((o: any, i: number) => ({ i, height: Number(o) || 0, label: Number(o) ? `${o}p` : String(o) }))
        .filter((l: any) => l.height > 0).sort(desc)
      return {
        name: 'Plyr', levels,
        set: (k: number) => { const l = levels()[k]; if (l) pl.quality = l.height },
        auto: () => { if (opts.includes(0)) pl.quality = 0 },
        isAuto: () => pl.quality === 0,
      }
    }
    return null
  }

  // ---- subtitle tracks: JW Player, hls.js, video.js, Plyr, or native <track> ----
  const findHls = (v: HTMLVideoElement) => S.hlsList.concat([w.hls, w.player && w.player.hls, (v as any).hls].filter(Boolean))
    .find((x: any) => x && x.media === v)
  const captions = (v: HTMLVideoElement): any => {
    if (typeof w.jwplayer === 'function') {
      try {
        const p = w.jwplayer()
        const list = p && p.getCaptionsList && p.getCaptionsList()
        if (list && list.length > 1) return {
          tracks: () => (p.getCaptionsList() || []).slice(1).map((c: any) => ({ label: c.label || c.language || 'Subtitles', lang: c.language || '' })),
          current: () => (p.getCurrentCaptions() || 0) - 1, // JW index 0 = Off
          set: (i: number) => p.setCurrentCaptions(i < 0 ? 0 : i + 1),
        }
      } catch { /* not JW */ }
    }
    const h = findHls(v)
    if (h && h.subtitleTracks && h.subtitleTracks.length) return {
      tracks: () => h.subtitleTracks.map((t: any) => ({ label: t.name || t.lang || 'Subtitles', lang: t.lang || '' })),
      current: () => (h.subtitleDisplay === false ? -1 : h.subtitleTrack),
      set: (i: number) => { if (i < 0) { h.subtitleDisplay = false; h.subtitleTrack = -1 } else { h.subtitleTrack = i; h.subtitleDisplay = true } },
    }
    const container = v.closest && v.closest('.plyr')
    const pl = (v as any).plyr || (container && (container as any).plyr)
    if (pl && typeof pl.toggleCaptions === 'function' && pl.media && pl.media.textTracks && pl.media.textTracks.length) {
      const list = () => Array.from(pl.media.textTracks as TextTrackList).filter((t: any) => t.kind === 'subtitles' || t.kind === 'captions') as any[]
      return {
        tracks: () => list().map(t => ({ label: t.label || t.language || 'Subtitles', lang: t.language || '' })),
        current: () => (pl.captions && pl.captions.active ? pl.currentTrack : -1),
        set: (i: number) => { if (i < 0) pl.toggleCaptions(false); else { pl.currentTrack = i; pl.toggleCaptions(true) } },
      }
    }
    if (w.videojs && typeof w.videojs.getPlayers === 'function') {
      for (const p of Object.values(w.videojs.getPlayers()) as any[]) {
        if (!p || !p.el || !p.el() || !p.el().contains(v) || typeof p.textTracks !== 'function') continue
        const list = () => Array.from(p.textTracks() as any[]).filter((t: any) => t.kind === 'subtitles' || t.kind === 'captions')
        if (!list().length) continue
        return {
          tracks: () => list().map((t: any) => ({ label: t.label || t.language || 'Subtitles', lang: t.language || '' })),
          current: () => list().findIndex((t: any) => t.mode === 'showing'),
          set: (i: number) => list().forEach((t: any, j: number) => { t.mode = j === i ? 'showing' : 'disabled' }),
        }
      }
    }
    const native = () => Array.from(v.textTracks || []).filter(t => t.kind === 'subtitles' || t.kind === 'captions')
    if (native().length) return {
      tracks: () => native().map(t => ({ label: t.label || t.language || 'Subtitles', lang: t.language || '' })),
      current: () => native().findIndex(t => t.mode === 'showing'),
      set: (i: number) => native().forEach((t, j) => { t.mode = j === i ? 'showing' : 'disabled' }),
    }
    return null
  }
  /** Best track for a language: full subtitles over "Signs & Songs"/"Forced" tracks. */
  const pickTrack = (tracks: any[], lang: string) => {
    const want = (lang || 'en').toLowerCase()
    const matches = tracks.map((t, i) => ({ ...t, i })).filter(t =>
      String(t.lang).toLowerCase().startsWith(want) || (want === 'en' && /english/i.test(t.label)) || String(t.label).toLowerCase() === want)
    if (!matches.length) return -1
    const full = matches.find(t => !/sign|song|forced|commentary/i.test(t.label))
    return (full || matches[0]).i
  }
  const applySubs = (v: HTMLVideoElement) => {
    const c = captions(v)
    if (!c || !S.subPref) return
    const tracks = c.tracks()
    const key = tracks.map((t: any) => t.label).join('|')
    if (!tracks.length || key === S.subKey) return
    S.subKey = key
    if (!S.subPref.on) { c.set(-1); return }
    const i = pickTrack(tracks, S.subPref.lang)
    if (i >= 0) { c.set(i); note(`Subtitles: ${tracks[i].label}`) }
    else if (c.current() < 0) { c.set(0); note(`Subtitles: ${tracks[0].label} (no ${S.subPref.lang} track)`) }
  }

  const note = (msg: string) => { S.events.push(msg); if (S.events.length > 5) S.events.shift() }

  const applyRate = () => {
    const v = S.video as HTMLVideoElement | null
    if (!v || !S.rate) return
    if (Math.abs(v.playbackRate - S.rate) > 0.01) {
      S.settingRate = true
      v.playbackRate = S.rate
      const a = adapter(v)
      if (a && a.setRate) a.setRate(S.rate)
      setTimeout(() => { S.settingRate = false }, 100)
    }
  }

  const select = (k: number, up = false) => {
    const v = S.video as HTMLVideoElement | null
    const a = v && adapter(v)
    if (!a) return false
    a.set(k, up)
    S.idx = k
    S.lastChange = Date.now()
    S.graceUntil = Date.now() + GRACE_MS
    S.stalls = []
    return true
  }

  const downgrade = (why: string) => {
    if (S.mode !== 'max') return
    const a = S.video && adapter(S.video)
    if (!a) return
    const levels = a.levels()
    if (S.idx >= levels.length - 1) return
    S.failed[S.idx] = (S.failed[S.idx] || 0) + 1
    S.downgrades++
    S.lastStall = Date.now()
    if (select(S.idx + 1)) note(`Lowered to ${levels[S.idx].label} (${why})`)
  }

  const onStall = (ms: number) => {
    const now = Date.now()
    S.lastStall = now
    S.stalls = S.stalls.filter((t: number) => now - t < 60000)
    S.stalls.push(now)
    if (ms >= STALL_DOWNGRADE_MS) downgrade(`buffered ${(ms / 1000).toFixed(1)}s`)
    else if (S.stalls.length >= STALLS_PER_MINUTE) downgrade(`${S.stalls.length} stalls in a minute`)
  }

  const bind = (v: HTMLVideoElement) => {
    if (S.video === v) return
    S.video = v
    S.applied = false
    S.idx = S.mode === 'manual' ? S.idx : 0
    S.failed = {}
    S.stalls = []
    S.stallStart = 0
    v.addEventListener('waiting', () => {
      if (v.seeking || v.currentTime < 2 || Date.now() < S.graceUntil) return
      S.stallStart = Date.now()
    })
    v.addEventListener('playing', () => {
      if (!S.stallStart) return
      const ms = Date.now() - S.stallStart
      S.stallStart = 0
      if (ms > 400) onStall(ms)
    })
    v.addEventListener('seeking', () => { S.graceUntil = Date.now() + 5000; S.stallStart = 0 })
    v.addEventListener('loadedmetadata', () => { S.applied = false; applyRate() })
    v.addEventListener('ratechange', () => {
      // The site's own speed menu changed it: adopt that as the new preference.
      if (!S.settingRate && S.rate && v.playbackRate > 0 && Math.abs(v.playbackRate - S.rate) > 0.01) S.rate = v.playbackRate
    })
    applyRate()
  }

  const tick = () => {
    const v = findVideo()
    if (!v) return
    bind(v)
    try { applySubs(v) } catch { /* player mid-load */ }
    const a = adapter(v)
    if (!a) return
    const levels = a.levels()
    if (!levels.length) return
    const key = levels.map((l: any) => l.label).join(',')
    if (key !== S.levelKey) { S.levelKey = key; S.applied = false; if (S.mode === 'max') { S.idx = 0; S.failed = {} } }
    if (!S.applied) {
      S.applied = true
      if (S.mode === 'auto') a.auto()
      else select(Math.min(S.idx, levels.length - 1))
      return
    }
    const now = Date.now()
    // Detect buffering from the media state too: 'waiting' doesn't fire again if a stall
    // began during a seek or the player swallowed the event.
    // (A seek stays "seeking" until its data arrives, so a stuck seek counts once the grace period ends.)
    const starving = !v.paused && !v.ended && v.readyState < 3 && v.currentTime > 0.5
    if (starving && !S.stallStart && now > S.graceUntil) S.stallStart = now
    else if (!starving && S.stallStart) {
      const ms = now - S.stallStart
      S.stallStart = 0
      if (ms > 400) onStall(ms)
    }
    if (S.mode !== 'max') return
    // A stall still in progress for too long: don't wait for it to end.
    // Each step gets a grace period to load before we judge it.
    if (S.stallStart && now > S.graceUntil && now - Math.max(S.stallStart, S.graceUntil - GRACE_MS) > STALL_DOWNGRADE_MS + 500) {
      S.stallStart = 0
      downgrade('stuck buffering')
    }
    // Long stable stretch below the top level: probe one level up (unless that level already failed).
    if (S.idx > 0 && !S.stallStart && !v.paused && now - S.lastChange > UPGRADE_AFTER_MS && now - (S.lastStall || 0) > UPGRADE_AFTER_MS &&
        (S.failed[S.idx - 1] || 0) < MAX_FAILS_PER_LEVEL) {
      if (select(S.idx - 1, true)) note(`Trying ${levels[S.idx].label} again`)
    }
  }
  setInterval(tick, 1000)

  S.state = (prefs: any, drain = true) => {
    const v = findVideo()
    if (!v) return null
    if (prefs && S.rate == null) {
      S.rate = prefs.rate || 1
      if (prefs.mode === 'auto' || prefs.mode === 'max') S.mode = prefs.mode
    }
    if (prefs && prefs.subs && !S.subPref) S.subPref = { on: prefs.subs.on !== false, lang: prefs.subs.lang || 'en' }
    if (prefs && prefs.audio) S.audio = prefs.audio
    bind(v)
    const a = adapter(v)
    const levels = a ? a.levels() : []
    return {
      time: v.currentTime, duration: v.duration || 0, paused: v.paused, rate: v.playbackRate,
      height: v.videoHeight || 0, buffering: !!S.stallStart || v.readyState < 3,
      adapter: a ? a.name : null, levels: levels.map(labelOf), mode: S.mode,
      selected: a && !(S.mode === 'auto') ? S.idx : -1, playerAuto: a ? !!a.isAuto() : false,
      downgrades: S.downgrades, events: drain ? S.events.splice(0) : S.events.slice(),
      subs: (() => {
        const c = captions(v)
        const tracks = c ? c.tracks().map((t: any) => t.label) : []
        return { tracks, current: c ? c.current() : -1, on: S.subPref ? S.subPref.on : true, lang: S.subPref ? S.subPref.lang : 'en' }
      })(),
      audio: S.audio,
      requests: drain ? S.requests.splice(0) : [],
    }
  }
  S.setRate = (r: number) => { S.rate = r; applyRate(); return true }
  S.setSubs = (i: number) => {
    const v = S.video as HTMLVideoElement | null
    const c = v && captions(v)
    if (!c) return false
    c.set(i)
    const t = i >= 0 ? c.tracks()[i] : null
    S.subPref = t ? { on: true, lang: t.lang || t.label } : { on: false, lang: (S.subPref && S.subPref.lang) || 'en' }
    return true
  }
  /** Ask the app to switch Sub/Dub (needs a new source, so the app handles it). */
  S.requestAudio = (a: string) => { S.requests.push({ type: 'audio', value: a === 'dub' ? 'dub' : 'sub' }); S.audio = a; return true }
  S.setQuality = (mode: string, index?: number) => {
    S.mode = mode
    S.idx = mode === 'manual' ? (index || 0) : 0
    S.failed = {}
    S.applied = false
    tick()
    return true
  }
}

/**
 * In-player settings button (⚙) + menu, injected next to the <video> inside the site's own
 * player frame so it shows/hides with mouse movement and works in the site's fullscreen —
 * like YouTube's settings gear. Lives in a closed shadow root so page CSS can't touch it.
 * Self-contained (serialised with toString()).
 */
export function playerUi() {
  const w = window as any
  const S = w.__senpai
  if (!S || S.ui) return
  S.ui = true

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]
  const host = document.createElement('div')
  host.setAttribute('data-senpai', '')
  host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;width:0;height:0;'
  const root = host.attachShadow({ mode: 'closed' })
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
    .wrap { position: fixed; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      transition: opacity .2s ease; opacity: 0; pointer-events: none; }
    .wrap.show { opacity: 1; pointer-events: auto; }
    .btn { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 0; border-radius: 17px;
      background: rgba(15,17,19,.82); color: #ECEEF0; font-size: 13px; font-weight: 600; cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,.5); backdrop-filter: blur(6px); }
    .btn:hover { background: rgba(126,123,242,.95); }
    .btn svg { width: 16px; height: 16px; }
    .panel { display: none; width: 250px; max-height: 70vh; overflow-y: auto; padding: 6px; border-radius: 10px;
      background: rgba(22,25,28,.96); border: 1px solid #262B30; box-shadow: 0 8px 30px rgba(0,0,0,.6); color: #ECEEF0; }
    .panel.open { display: block; }
    .row { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 9px 10px; border: 0;
      border-radius: 6px; background: transparent; color: #ECEEF0; font-size: 13px; cursor: pointer; text-align: left; }
    .row:hover { background: #1D2125; }
    .row .val { color: #A2ACB4; font-size: 12px; }
    .row.sel { color: #9492F5; font-weight: 700; }
    .row .sub { display: block; color: #6B767E; font-size: 11px; font-weight: 400; margin-top: 1px; }
    .head { display: flex; align-items: center; gap: 6px; padding: 6px 8px 8px; margin-bottom: 4px; border-bottom: 1px solid #262B30;
      font-size: 13px; font-weight: 700; }
    .back { border: 0; background: transparent; color: #A2ACB4; cursor: pointer; font-size: 16px; padding: 0 4px; }
    .note { padding: 8px 10px; color: #6B767E; font-size: 12px; line-height: 1.4; }
  </style>
  <div class="wrap">
    <div class="panel"></div>
    <button class="btn" title="Playback settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      <span class="label"></span>
    </button>
  </div>`
  const wrap = root.querySelector('.wrap') as HTMLDivElement
  const panel = root.querySelector('.panel') as HTMLDivElement
  const btn = root.querySelector('.btn') as HTMLButtonElement
  const label = root.querySelector('.label') as HTMLSpanElement
  let view: 'main' | 'speed' | 'quality' | 'subs' | 'audio' | null = null
  let hideTimer: any = 0

  const info = () => S.state ? S.state(null, false) : null
  const fmtRate = (r: number) => `${Math.round(r * 100) / 100}x`
  const qualityText = (st: any) => {
    if (!st) return ''
    const now = st.height ? `${st.height}p` : ''
    if (!st.adapter) return now
    if (st.mode === 'auto') return `Auto${now ? ` (${now})` : ''}`
    if (st.mode === 'manual') return st.levels[st.selected] || now
    return `Best${now ? ` (${now})` : ''}`
  }
  const subsText = (st: any) => {
    if (!st || !st.subs || !st.subs.tracks.length) return 'Built-in'
    return st.subs.current >= 0 ? st.subs.tracks[st.subs.current] : 'Off'
  }
  const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])

  const render = () => {
    const st = info()
    label.textContent = st ? `${fmtRate(st.rate)}${st.height ? ` · ${st.height}p` : ''}` : ''
    if (!view) { panel.classList.remove('open'); return }
    panel.classList.add('open')
    if (view === 'main') {
      panel.innerHTML = `
        <button class="row" data-go="speed">Playback speed <span class="val">${st ? fmtRate(st.rate) : ''} ›</span></button>
        <button class="row" data-go="quality">Quality <span class="val">${esc(qualityText(st))} ›</span></button>
        <button class="row" data-go="subs">Subtitles <span class="val">${esc(subsText(st))} ›</span></button>
        <button class="row" data-go="audio">Audio <span class="val">${st && st.audio === 'dub' ? 'Dub' : 'Sub'} ›</span></button>`
    } else if (view === 'speed') {
      panel.innerHTML = `<div class="head"><button class="back" data-go="main">‹</button>Playback speed</div>` +
        SPEEDS.map(r => `<button class="row ${st && Math.abs(st.rate - r) < 0.01 ? 'sel' : ''}" data-rate="${r}">${r === 1 ? 'Normal' : fmtRate(r)}${st && Math.abs(st.rate - r) < 0.01 ? '<span class="val">✓</span>' : ''}</button>`).join('')
    } else if (view === 'subs') {
      let html = `<div class="head"><button class="back" data-go="main">‹</button>Subtitles</div>`
      const subs = st && st.subs
      if (!subs || !subs.tracks.length) {
        html += `<div class="note">No separate subtitle tracks in this video. Sub episodes on most sites have the subtitles built into the picture.</div>`
      } else {
        html += `<button class="row ${subs.current < 0 ? 'sel' : ''}" data-sub="-1">Off</button>`
        html += subs.tracks.map((l: string, i: number) => `<button class="row ${subs.current === i ? 'sel' : ''}" data-sub="${i}">${esc(l)}${subs.current === i ? '<span class="val">✓</span>' : ''}</button>`).join('')
      }
      panel.innerHTML = html
    } else if (view === 'audio') {
      const a = st && st.audio === 'dub' ? 'dub' : 'sub'
      panel.innerHTML = `<div class="head"><button class="back" data-go="main">‹</button>Audio</div>
        <button class="row ${a === 'sub' ? 'sel' : ''}" data-audio="sub"><span>Sub<span class="sub">Japanese audio, subtitled</span></span></button>
        <button class="row ${a === 'dub' ? 'sel' : ''}" data-audio="dub"><span>Dub<span class="sub">English audio — reloads the episode</span></span></button>`
    } else {
      let html = `<div class="head"><button class="back" data-go="main">‹</button>Quality</div>`
      if (!st || !st.adapter) {
        html += `<div class="note">This site's player picks the quality itself${st && st.height ? ` (now ${st.height}p)` : ''}.</div>`
      } else {
        html += `<button class="row ${st.mode === 'max' ? 'sel' : ''}" data-q="max"><span>Best available<span class="sub">Highest resolution, lowers only if it buffers</span></span></button>`
        html += `<button class="row ${st.mode === 'auto' ? 'sel' : ''}" data-q="auto"><span>Auto<span class="sub">Let the site's player decide</span></span></button>`
        html += st.levels.map((l: string, i: number) =>
          `<button class="row ${st.mode === 'manual' && st.selected === i ? 'sel' : ''}" data-level="${i}">${esc(l)}${st.mode === 'max' && st.selected === i ? '<span class="val">playing</span>' : ''}</button>`).join('')
      }
      panel.innerHTML = html
    }
  }

  panel.addEventListener('click', (e) => {
    e.stopPropagation()
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null
    if (!t) return
    if (t.dataset.go) view = t.dataset.go as any
    else if (t.dataset.rate) { S.setRate(Number(t.dataset.rate)); view = null }
    else if (t.dataset.q) { S.setQuality(t.dataset.q); view = null }
    else if (t.dataset.level) { S.setQuality('manual', Number(t.dataset.level)); view = null }
    else if (t.dataset.sub) { S.setSubs(Number(t.dataset.sub)); view = null }
    else if (t.dataset.audio) { S.requestAudio(t.dataset.audio); view = null }
    render()
    poke()
  })
  btn.addEventListener('click', (e) => { e.stopPropagation(); view = view ? null : 'main'; render(); poke() })
  // Clicks inside our UI must not reach the page (which would toggle play/pause).
  for (const ev of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick']) wrap.addEventListener(ev, e => e.stopPropagation())
  document.addEventListener('click', () => { if (view) { view = null; render() } }, true)

  const place = () => {
    const v = (S.video as HTMLVideoElement) || document.querySelector('video')
    if (!v) { wrap.classList.remove('show'); return false }
    const r = v.getBoundingClientRect()
    if (r.width < 200 || r.height < 120) return false
    // Bottom-right, raised above the site's own control bar.
    wrap.style.right = `${Math.max(8, window.innerWidth - r.right + 14)}px`
    wrap.style.bottom = `${Math.max(8, window.innerHeight - r.bottom + 64)}px`
    return true
  }
  const poke = () => {
    if (!place()) return
    wrap.classList.add('show')
    clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      const v = S.video as HTMLVideoElement | null
      if (!view && v && !v.paused) wrap.classList.remove('show')
    }, 2800)
  }

  const attach = () => {
    const target = (document.fullscreenElement as HTMLElement) || document.body || document.documentElement
    if (host.parentNode !== target) target.appendChild(host)
  }
  document.addEventListener('fullscreenchange', () => { attach(); poke() })
  for (const ev of ['mousemove', 'touchstart', 'keydown']) document.addEventListener(ev, poke, { passive: true, capture: true })
  window.addEventListener('resize', () => place())
  setInterval(() => {
    attach()
    const v = S.video as HTMLVideoElement | null
    if (v && v.paused && place()) wrap.classList.add('show')
    render()
  }, 1000)
  attach()
}

export const PLAYER_HOOK_SOURCE =
  `(${playerHook.toString()})();(function(){var go=function(){try{(${playerUi.toString()})()}catch(e){}};` +
  `if(document.querySelector('video'))go();else{var t=setInterval(function(){if(document.querySelector('video')){clearInterval(t);go()}},1000)}})();`

import { BrowserWindow, ipcMain, net, session, webContents } from 'electron'
import path from 'path'
import { PLAYER_HOOK_SOURCE } from './player-hook'
import { SourceEngine } from './sources/engine'
import { setFetchImpl, getJson } from './sources/http'
import { hostOf } from './sources/domain'

// IPC glue between the renderer and the SourceEngine, plus hardening of the
// 'persist:streaming' session used by the player <webview>.

const ANISKIP_BASE = 'https://api.aniskip.com/v2'
export const STREAM_PARTITION = 'persist:streaming'
const HEALTH_INTERVAL = 20 * 60_000

let engine: SourceEngine | null = null
export function getEngine() { return engine }

interface SkipTime { type: 'op' | 'ed' | 'recap' | 'mixed-op' | 'mixed-ed'; startTime: number; endTime: number }

async function fetchSkipTimes(malId: number, ep: number, duration?: number): Promise<SkipTime[]> {
  const len = Math.round(duration ?? 1440)
  const result = await getJson<{ found: boolean; results: { skipType: string; interval: { startTime: number; endTime: number } }[] }>(
    `${ANISKIP_BASE}/skip-times/${malId}/${ep}?types=op&types=ed&types=recap&types=mixed-op&types=mixed-ed&episodeLength=${len}`)
  if (!result?.found || !result.results) return []
  return result.results.map(r => ({ type: r.skipType as SkipTime['type'], startTime: r.interval.startTime, endTime: r.interval.endTime }))
}

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

/** Lock down the player session: ad blocking, no downloads, no permissions, no popups. */
function hardenStreamingSession() {
  const ses = session.fromPartition(STREAM_PARTITION)
  // Playback controller (speed + adaptive quality) in every frame, before page scripts.
  const preload = path.join(__dirname, 'stream-preload.js')
  const anySes = ses as any
  if (typeof anySes.registerPreloadScript === 'function') anySes.registerPreloadScript({ type: 'frame', filePath: preload })
  else anySes.setPreloads([preload])
  ses.setUserAgent(ses.getUserAgent().replace(/\s?(Electron|senpai)\/\S+/gi, ''))

  ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
    const host = hostOf(details.url)
    if (engine?.isAdHost(host)) return cb({ cancel: true })
    // Never load plain-HTTP top-level documents in the player.
    if (details.resourceType === 'mainFrame' && details.url.startsWith('http:')) return cb({ cancel: true })
    cb({})
  })

  ses.on('will-download', (event, item) => {
    // Read details first; preventDefault() alone cancels it (calling item.cancel() as well is invalid).
    let detail = ''
    try { detail = item.getFilename() || hostOf(item.getURL()) } catch { /* */ }
    event.preventDefault()
    broadcast('stream:blocked', { kind: 'download', detail })
  })

  // Only fullscreen (for the video player) is granted. No notifications, camera, location, clipboard, etc.
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'))
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen')
}

/** Guard every <webview>: top-level navigation must stay on vetted domains. */
export function guardWebview(contents: Electron.WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    broadcast('stream:blocked', { kind: 'popup', detail: hostOf(url) || url })
    return { action: 'deny' }
  })
  const guard = (event: Electron.Event, url: string, isMainFrame = true) => {
    if (!isMainFrame || !engine) return
    if (!engine.isAllowedNavigation(url)) {
      event.preventDefault()
      broadcast('stream:blocked', { kind: 'navigation', detail: hostOf(url) || url })
    }
  }
  // Newer Electron passes details on the event; older versions as positional args.
  contents.on('will-navigate', (e: any, url: string) => guard(e, e?.url ?? url, e?.isMainFrame ?? true))
  contents.on('will-redirect', (e: any, url: string, _inPlace: boolean, isMainFrame: boolean) => guard(e, e?.url ?? url, e?.isMainFrame ?? isMainFrame))
}

function streamWebview(wcId: number): Electron.WebContents | null {
  const wc = webContents.fromId(wcId)
  if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.session !== session.fromPartition(STREAM_PARTITION)) return null
  return wc
}

/** Run `script` in the first frame of the player webview that has a <video>
 *  (players usually live in cross-origin iframes the renderer can't reach). */
async function inVideoFrame<T>(wcId: number, script: string): Promise<T | null> {
  const wc = streamWebview(wcId)
  if (!wc) return null
  // Only committed, live http(s) frames — scripting a frame that's mid-navigation or detached is unsafe.
  const frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter(f => f !== wc.mainFrame)]
    .filter(f => !(f as any).detached && /^https?:/.test(f.url))
  const timed = <R>(p: Promise<R>) => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), 3000))])
  for (const f of frames) {
    try {
      // Install the controller lazily if the preload didn't run in this frame.
      const has = await timed(f.executeJavaScript(
        `(() => { if (!document.querySelector('video')) return false; if (!window.__senpai) { ${PLAYER_HOOK_SOURCE} } return !!window.__senpai })()`))
      if (!has) continue
      const r = await timed(f.executeJavaScript(script))
      if (r !== null && r !== undefined) return r as T
    } catch { /* frame gone or detached */ }
  }
  return null
}

type PlayerCommand =
  | { type: 'state'; prefs?: { rate?: number; mode?: 'max' | 'auto'; subs?: { on?: boolean; lang?: string }; audio?: 'sub' | 'dub'; flags?: { autoplay?: boolean; autoSkip?: boolean } } }
  | { type: 'rate'; rate: number }
  | { type: 'quality'; mode: 'max' | 'auto' | 'manual'; index?: number }
  | { type: 'seek'; time: number }

function playerScript(cmd: PlayerCommand): string | null {
  switch (cmd?.type) {
    case 'state': {
      const rate = Number(cmd.prefs?.rate)
      const lang = String(cmd.prefs?.subs?.lang ?? 'en').replace(/[^\w -]/g, '').slice(0, 20) || 'en'
      const prefs = {
        rate: Number.isFinite(rate) ? Math.min(4, Math.max(0.25, rate)) : 1,
        mode: cmd.prefs?.mode === 'auto' ? 'auto' : 'max',
        subs: { on: cmd.prefs?.subs?.on !== false, lang },
        audio: cmd.prefs?.audio === 'dub' ? 'dub' : 'sub',
        flags: { autoplay: cmd.prefs?.flags?.autoplay !== false, autoSkip: cmd.prefs?.flags?.autoSkip === true },
      }
      return `window.__senpai.state(${JSON.stringify(prefs)})`
    }
    case 'rate': {
      const rate = Number(cmd.rate)
      if (!Number.isFinite(rate)) return null
      return `window.__senpai.setRate(${Math.min(4, Math.max(0.25, rate))})`
    }
    case 'quality': {
      const mode = ['max', 'auto', 'manual'].includes(cmd.mode) ? cmd.mode : 'max'
      const index = Math.max(0, Math.floor(Number(cmd.index) || 0))
      return `window.__senpai.setQuality(${JSON.stringify(mode)}, ${index})`
    }
    case 'seek': {
      const t = Number(cmd.time)
      if (!Number.isFinite(t) || t < 0) return null
      return `(() => { const v = [...document.querySelectorAll('video')].find(x => x.duration > 0); if (v) { v.currentTime = ${t}; return true } return null })()`
    }
  }
  return null
}

export function registerStreamHandlers(getAppState: (key: string) => string | null, setAppState: (key: string, value: string) => void) {
  setFetchImpl((url, init) => net.fetch(url, init as any))
  engine = new SourceEngine({ get: getAppState, set: setAppState })
  hardenStreamingSession()

  // Background maintenance: manifest refresh, safety checks, health, discovery.
  const tick = async () => {
    try { await engine!.refreshManifest() } catch { /* */ }
    try { await engine!.healthTick() } catch (e) { console.error('[sources] health tick failed', e) }
  }
  setTimeout(tick, 4000)
  setInterval(tick, HEALTH_INTERVAL)

  let pending: ReturnType<typeof setTimeout> | null = null
  engine.onChange(() => {
    if (pending) return
    pending = setTimeout(() => { pending = null; broadcast('stream:stateChanged', null) }, 300)
  })

  const e = engine
  ipcMain.handle('stream:resolveEpisode', (_ev, title: string, ep: number, opts?: { titleEn?: string; providerId?: string; excludeOrigins?: string[]; audio?: 'sub' | 'dub'; anilistId?: number }) =>
    e.resolveEpisode(title, ep, opts ?? {}))
  ipcMain.handle('stream:prefetch', (_ev, title: string, titleEn?: string) => { e.prefetch(title, titleEn).catch(() => {}) })
  ipcMain.handle('stream:cancelPrefetch', (_ev, title: string) => e.cancelPrefetch(title))
  ipcMain.handle('stream:learnFromUrl', (_ev, title: string, url: string, ep: number) => e.learnFromUrl(title, url, ep))
  ipcMain.handle('stream:reportFailure', (_ev, url: string, reason: string) => e.reportFailure(url, reason))
  ipcMain.handle('stream:clearCache', (_ev, title?: string) => e.clearCache(title))
  ipcMain.handle('stream:getSkipTimes', (_ev, malId: number, ep: number, duration?: number) => fetchSkipTimes(malId, ep, duration))

  ipcMain.handle('stream:player', (_ev, wcId: number, cmd: PlayerCommand) => {
    const script = playerScript(cmd)
    return script ? inVideoFrame(Number(wcId), script) : null
  })

  // Settings
  ipcMain.handle('sources:snapshot', () => e.snapshot())
  ipcMain.handle('sources:refreshManifest', () => e.refreshManifest(true))
  ipcMain.handle('sources:discover', async (_ev, providerId?: string) => {
    const ids = providerId ? [providerId] : e.providers().map(p => p.id)
    const found = (await Promise.all(ids.map(id => e.discover(id)))).flat()
    return { found }
  })
  ipcMain.handle('sources:recheck', async (_ev, origin?: string) => {
    const origins = origin ? [origin] : Object.keys(e.state.domains).filter(o => !e.state.domains[o].removed)
    await Promise.all(origins.map(o => e.ensureSafety(o, true)))
    await e.healthTick()
  })
  ipcMain.handle('sources:approve', (_ev, origin: string, approved: boolean) => e.approveDomain(origin, approved))
  ipcMain.handle('sources:removeDomain', (_ev, origin: string) => e.removeDomain(origin))
  ipcMain.handle('sources:addDomain', (_ev, providerId: string, url: string) => e.addUserDomain(providerId, url))
  ipcMain.handle('sources:addProvider', (_ev, input) => e.addCustomProvider(input))
  ipcMain.handle('sources:addSiteByLink', (_ev, url: string) => e.addSiteByLink(String(url)))
  ipcMain.handle('sources:testSearch', (_ev, id: string, title: string) => e.testSearch(String(id), String(title)))
  ipcMain.handle('stream:episodeCount', (_ev, title: string, audio: 'sub' | 'dub', opts?: { titleEn?: string; anilistId?: number }) =>
    e.episodeCount(String(title), audio === 'dub' ? 'dub' : 'sub', opts ?? {}))
  ipcMain.handle('stream:useLink', (_ev, title: string, url: string, ep: number) => e.useLink(String(title), String(url), Number(ep)))
  ipcMain.handle('sources:removeProvider', (_ev, id: string) => e.removeCustomProvider(id))
  ipcMain.handle('sources:setProvider', (_ev, id: string, pref: { enabled?: boolean }) => e.setProviderPref(id, pref))
  ipcMain.handle('sources:moveProvider', (_ev, id: string, dir: -1 | 1) => e.moveProvider(id, dir))
  ipcMain.handle('sources:setOptions', (_ev, opts) => e.setOptions(opts))
}

export function flushStreamState() { engine?.flush() }

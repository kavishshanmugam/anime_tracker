// AniList + MyAnimeList two-way-ish sync: log in once, then every library change is pushed
// (status, progress, score, start/finish dates). Tokens are encrypted with safeStorage.
import { BrowserWindow, ipcMain, net, safeStorage, shell } from 'electron'
import crypto from 'node:crypto'
import { getAllEntryAnimeIds, getAnimeRow, getAppState, getEntryRow, onEntryChanged, setAppState } from './database'

type Service = 'anilist' | 'mal'
interface Account { clientId: string; token?: string; refresh?: string; expiresAt?: number; user?: string; lastSync?: number; lastError?: string }
interface AccountsState { anilist?: Account; mal?: Account }

const KEY = 'accounts'
const MAL_REDIRECT = 'http://localhost:52713/senpai-mal-callback'
const ANILIST_REDIRECT = 'https://anilist.co/api/v2/oauth/pin'

// ---- persistence (tokens encrypted at rest) ----
function enc(v?: string) { if (!v) return v; try { return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : v } catch { return v } }
function dec(v?: string) { if (!v?.startsWith('enc:')) return v; try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')) } catch { return undefined } }
function load(): AccountsState {
  try {
    const s = JSON.parse(getAppState(KEY) ?? '{}') as AccountsState
    for (const k of ['anilist', 'mal'] as const) if (s[k]) { s[k]!.token = dec(s[k]!.token); s[k]!.refresh = dec(s[k]!.refresh) }
    return s
  } catch { return {} }
}
function save(s: AccountsState) {
  const out: AccountsState = JSON.parse(JSON.stringify(s))
  for (const k of ['anilist', 'mal'] as const) if (out[k]) { out[k]!.token = enc(out[k]!.token); out[k]!.refresh = enc(out[k]!.refresh) }
  setAppState(KEY, JSON.stringify(out))
}

// ---- OAuth in a separate, node-less window; the redirect is intercepted, never loaded ----
function authWindow(url: string, isRedirect: (u: string) => boolean): Promise<string | null> {
  return new Promise(resolve => {
    const win = new BrowserWindow({ width: 520, height: 720, autoHideMenuBar: true, title: 'Sign in',
      webPreferences: { partition: 'persist:auth', nodeIntegration: false, contextIsolation: true, sandbox: true } })
    let done = false
    const finish = (u: string | null) => { if (done) return; done = true; resolve(u); if (!win.isDestroyed()) win.close() }
    const check = (e: Electron.Event, u: string) => { if (isRedirect(u)) { e.preventDefault(); finish(u) } }
    win.webContents.on('will-redirect', check)
    win.webContents.on('will-navigate', check)
    win.webContents.on('did-navigate', (_e, u) => { if (isRedirect(u)) finish(u) })
    win.webContents.on('did-navigate-in-page', (_e, u) => { if (isRedirect(u)) finish(u) })
    win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u).catch(() => {}); return { action: 'deny' } })
    win.on('closed', () => finish(null))
    win.loadURL(url)
  })
}

async function gqlAniList(token: string, query: string, variables: Record<string, unknown> = {}) {
  const r = await net.fetch('https://graphql.anilist.co', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.errors?.length) throw new Error(j.errors?.[0]?.message ?? `AniList HTTP ${r.status}`)
  return j.data
}

async function malToken(body: Record<string, string>) {
  const r = await net.fetch('https://myanimelist.net/v1/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) throw new Error(j.message ?? j.error ?? `MAL HTTP ${r.status}`)
  return j as { access_token: string; refresh_token: string; expires_in: number }
}

async function login(service: Service): Promise<{ ok: boolean; message: string }> {
  const s = load()
  const acct = s[service]
  if (!acct?.clientId) return { ok: false, message: 'Enter your client ID first' }
  try {
    if (service === 'anilist') {
      const url = await authWindow(
        `https://anilist.co/api/v2/oauth/authorize?client_id=${encodeURIComponent(acct.clientId)}&response_type=token`,
        u => u.startsWith(ANILIST_REDIRECT) && u.includes('access_token='))
      if (!url) return { ok: false, message: 'Sign-in cancelled' }
      const h = new URLSearchParams(url.split('#')[1] ?? '')
      acct.token = h.get('access_token') ?? undefined
      acct.expiresAt = Date.now() + Number(h.get('expires_in') ?? 31_536_000) * 1000
      const me = await gqlAniList(acct.token!, 'query { Viewer { name } }')
      acct.user = me.Viewer?.name
    } else {
      const verifier = crypto.randomBytes(48).toString('base64url') // MAL supports only the "plain" PKCE method
      const state = crypto.randomBytes(12).toString('hex')
      const url = await authWindow(
        `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(acct.clientId)}` +
        `&code_challenge=${verifier}&code_challenge_method=plain&state=${state}&redirect_uri=${encodeURIComponent(MAL_REDIRECT)}`,
        u => u.startsWith(MAL_REDIRECT))
      if (!url) return { ok: false, message: 'Sign-in cancelled' }
      const q = new URL(url).searchParams
      if (q.get('state') !== state || !q.get('code')) return { ok: false, message: 'Sign-in failed (state mismatch)' }
      const t = await malToken({ client_id: acct.clientId, grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: MAL_REDIRECT, code_verifier: verifier })
      acct.token = t.access_token; acct.refresh = t.refresh_token; acct.expiresAt = Date.now() + t.expires_in * 1000
      const me = await (await net.fetch('https://api.myanimelist.net/v2/users/@me', { headers: { Authorization: `Bearer ${acct.token}` } })).json()
      acct.user = me.name
    }
    acct.lastError = undefined
    save(s)
    return { ok: true, message: `Connected as ${acct.user ?? 'you'}` }
  } catch (e: any) {
    return { ok: false, message: `Sign-in failed: ${e?.message ?? e}` }
  }
}

async function malAccessToken(s: AccountsState): Promise<string | null> {
  const a = s.mal
  if (!a?.token) return null
  if (a.expiresAt && Date.now() < a.expiresAt - 60_000) return a.token
  if (!a.refresh) return null
  const t = await malToken({ client_id: a.clientId, grant_type: 'refresh_token', refresh_token: a.refresh })
  a.token = t.access_token; a.refresh = t.refresh_token; a.expiresAt = Date.now() + t.expires_in * 1000
  save(s)
  return a.token
}

const AL_STATUS: Record<string, string> = { watching: 'CURRENT', completed: 'COMPLETED', plan_to_watch: 'PLANNING', on_hold: 'PAUSED', dropped: 'DROPPED' }
const MAL_STATUS: Record<string, string> = { watching: 'watching', completed: 'completed', plan_to_watch: 'plan_to_watch', on_hold: 'on_hold', dropped: 'dropped' }
const fuzzy = (d?: string | null) => { if (!d) return null; const [y, m, dd] = d.split('-').map(Number); return { year: y || null, month: m || null, day: dd || null } }

/** Push one library entry to every connected service. */
async function push(animeId: number): Promise<void> {
  const s = load()
  const anime = getAnimeRow(animeId), entry = getEntryRow(animeId)
  if (!anime || !entry) return
  const errors: string[] = []
  if (s.anilist?.token && anime.anilist_id) {
    try {
      await gqlAniList(s.anilist.token, `mutation ($id: Int, $status: MediaListStatus, $progress: Int, $score: Float, $s: FuzzyDateInput, $c: FuzzyDateInput, $r: Int) {
        SaveMediaListEntry(mediaId: $id, status: $status, progress: $progress, score: $score, startedAt: $s, completedAt: $c, repeat: $r) { id } }`, {
        id: anime.anilist_id, status: entry.rewatch_count > 0 && entry.my_status === 'watching' ? 'REPEATING' : AL_STATUS[entry.my_status] ?? 'PLANNING',
        progress: entry.progress ?? 0, score: entry.my_score ?? 0, s: fuzzy(entry.started_at), c: fuzzy(entry.finished_at), r: entry.rewatch_count ?? 0,
      })
      s.anilist.lastSync = Date.now()
    } catch (e: any) { errors.push(`AniList: ${e?.message ?? e}`); s.anilist.lastError = String(e?.message ?? e) }
  }
  if (s.mal?.token && anime.mal_id) {
    try {
      const token = await malAccessToken(s)
      if (token) {
        const body = new URLSearchParams({ status: MAL_STATUS[entry.my_status] ?? 'plan_to_watch', num_watched_episodes: String(entry.progress ?? 0), score: String(entry.my_score ?? 0), is_rewatching: String(entry.rewatch_count > 0 && entry.my_status === 'watching') })
        if (entry.started_at) body.set('start_date', entry.started_at)
        if (entry.finished_at) body.set('finish_date', entry.finished_at)
        const r = await net.fetch(`https://api.myanimelist.net/v2/anime/${anime.mal_id}/my_list_status`, {
          method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        s.mal!.lastSync = Date.now()
      }
    } catch (e: any) { errors.push(`MAL: ${e?.message ?? e}`); if (s.mal) s.mal.lastError = String(e?.message ?? e) }
  }
  if (!errors.length) { if (s.anilist) s.anilist.lastError = undefined; if (s.mal) s.mal.lastError = undefined }
  save(s)
}

// Debounce per show: several quick edits (progress + status + date) → one push.
const pending = new Map<number, ReturnType<typeof setTimeout>>()
function schedule(animeId: number) {
  const s = load()
  if (!s.anilist?.token && !s.mal?.token) return
  clearTimeout(pending.get(animeId))
  pending.set(animeId, setTimeout(() => { pending.delete(animeId); push(animeId).catch(() => {}) }, 4000))
}

export function registerAccountHandlers() {
  onEntryChanged(schedule)
  const status = () => {
    const s = load()
    const view = (a?: Account) => a ? { clientId: a.clientId, connected: !!a.token, user: a.user ?? null, lastSync: a.lastSync ?? null, lastError: a.lastError ?? null, expiresAt: a.expiresAt ?? null } : null
    return { anilist: view(s.anilist), mal: view(s.mal), anilistRedirect: ANILIST_REDIRECT, malRedirect: MAL_REDIRECT }
  }
  ipcMain.handle('accounts:status', status)
  ipcMain.handle('accounts:setClientId', (_e, service: Service, clientId: string) => {
    const s = load()
    const id = String(clientId ?? '').trim().slice(0, 200)
    s[service] = { ...(s[service] ?? { clientId: '' }), clientId: id }
    save(s)
    return status()
  })
  ipcMain.handle('accounts:login', (_e, service: Service) => login(service === 'mal' ? 'mal' : 'anilist'))
  ipcMain.handle('accounts:logout', (_e, service: Service) => {
    const s = load()
    if (s[service]) s[service] = { clientId: s[service]!.clientId }
    save(s)
    return status()
  })
  ipcMain.handle('accounts:syncAll', async () => {
    const ids = getAllEntryAnimeIds()
    let done = 0
    for (const id of ids) { await push(id).catch(() => {}); done++; await new Promise(r => setTimeout(r, 800)) } // ~75/min, under AniList's limit
    return { pushed: done, ...status() }
  })
}

// "Resume where you left off": playback position per episode, persisted in app_state.
// Not stored for the first 30s (nothing to resume) or the last 60s (credits — treat as finished).

export interface ResumePos { t: number; d: number; at: number }

const KEY = 'resume_positions'
const MAX = 300
let map: Record<string, ResumePos> | null = null
let loading: Promise<Record<string, ResumePos>> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

const k = (animeId: number, ep: number) => `${animeId}:${ep}`

export function loadResume(): Promise<Record<string, ResumePos>> {
  if (map) return Promise.resolve(map)
  loading ??= (async () => {
    try { map = JSON.parse((await window.api?.db.getAppState(KEY)) ?? '{}') ?? {} } catch { map = {} }
    return map!
  })()
  return loading
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (!map) return
    const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, MAX)
    map = Object.fromEntries(entries)
    window.api?.db.setAppState(KEY, JSON.stringify(map)).catch(() => {})
  }, 3000)
}

export function getResume(animeId: number, ep: number): ResumePos | undefined {
  return map?.[k(animeId, ep)]
}

export function setResume(animeId: number, ep: number, t: number, d: number) {
  if (!map || !Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return
  if (t < 30 || d - t < 60) { if (map[k(animeId, ep)]) { delete map[k(animeId, ep)]; persist() } return }
  map[k(animeId, ep)] = { t: Math.round(t), d: Math.round(d), at: Date.now() }
  persist()
}

export function clearResume(animeId: number, ep: number) {
  if (map?.[k(animeId, ep)]) { delete map[k(animeId, ep)]; persist() }
}

export const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

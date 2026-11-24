// Your local profile (name, avatar) and a few app preferences. Stored in app_state as one JSON blob;
// nothing here leaves this computer.
import { useEffect, useState } from 'react'

export interface Profile {
  name: string
  /** Avatar background when there is no picture. */
  color: string
  /** Small square picture as a data URL, or null. */
  avatar: string | null
  startPage: 'home' | 'library'
  notify: { episodes: boolean; sequels: boolean; dubs: boolean }
}

export const AVATAR_COLORS = ['#7c6cf0', '#e5484d', '#f5a524', '#30a46c', '#0ea5e9', '#d6409f', '#8b8d98']
const DEFAULTS: Profile = { name: '', color: AVATAR_COLORS[0], avatar: null, startPage: 'home', notify: { episodes: true, sequels: true, dubs: true } }

let cache: Profile | null = null
const listeners = new Set<(p: Profile) => void>()

export async function loadProfile(): Promise<Profile> {
  if (cache) return cache
  let saved: Partial<Profile> = {}
  try { saved = JSON.parse((await window.api?.db.getAppState('profile')) ?? '{}') ?? {} } catch { /* first run / corrupt → defaults */ }
  cache = { ...DEFAULTS, ...saved, notify: { ...DEFAULTS.notify, ...saved.notify } }
  return cache
}

export async function saveProfile(patch: Partial<Profile>) {
  cache = { ...(await loadProfile()), ...patch }
  listeners.forEach(l => l(cache!))
  await window.api?.db.setAppState('profile', JSON.stringify(cache))
}

export function useProfile(): Profile {
  const [p, setP] = useState<Profile>(cache ?? DEFAULTS)
  useEffect(() => {
    loadProfile().then(setP).catch(() => {})
    listeners.add(setP)
    return () => { listeners.delete(setP) }
  }, [])
  return p
}

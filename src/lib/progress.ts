// Episode-watched → library update. Progress is per show, never per language:
// watching E1–3 in sub and E4+ in dub is one continuous progress, and finishing in
// either language completes the show.
import type { LibraryEntry } from '@/types'

export interface ProgressInput {
  entry: Pick<LibraryEntry, 'my_status' | 'progress' | 'started_at' | 'finished_at'> | null
  episode: number
  episodesTotal: number | null | undefined
  now?: Date
}

/** Library fields to update after watching `episode`, or null if nothing changes. */
export function progressAfterWatching({ entry, episode, episodesTotal, now = new Date() }: ProgressInput): Partial<LibraryEntry> | null {
  const iso = now.toISOString()
  const day = iso.split('T')[0]
  const progress = entry?.progress ?? 0
  const finished = !!episodesTotal && episode >= episodesTotal
  // Rewatching an earlier episode doesn't move progress back.
  if (episode <= progress && !(finished && entry?.my_status !== 'completed')) return { last_watched_at: iso }
  const update: Partial<LibraryEntry> = { progress: Math.max(progress, episode), last_watched_at: iso }
  if (!entry || entry.my_status === 'plan_to_watch' || entry.my_status === 'on_hold' || entry.my_status === 'dropped') update.my_status = 'watching'
  if (!entry?.started_at) update.started_at = day
  if (finished) {
    update.my_status = 'completed'
    update.finished_at = entry?.finished_at && entry.my_status === 'completed' ? entry.finished_at : day
  }
  return update
}

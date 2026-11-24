// Status follows progress. Every library write goes through db:upsertLibraryEntry, so this one rule
// covers the player, +1 buttons, typing an episode number, bulk edits and imports alike.
// It only acts when the caller changed progress WITHOUT choosing a status — an explicit choice always wins.

export interface AutoStatusInput {
  /** Fields being written. */
  data: { my_status?: string; progress?: number; started_at?: string | null; finished_at?: string | null }
  /** Entry as it is now (null = new). */
  current: { my_status: string; progress: number; started_at: string | null; finished_at: string | null } | null
  episodesTotal: number | null | undefined
  airingStatus: string | null | undefined
  today: string
}

/** Extra fields to write along with `data` (empty object = nothing to add). */
export function autoStatus({ data, current, episodesTotal, airingStatus, today }: AutoStatusInput): Record<string, string> {
  if (data.progress === undefined || data.my_status !== undefined) return {}
  const status = current?.my_status ?? 'plan_to_watch'
  const out: Record<string, string> = {}
  // Watched every episode of a show that has finished airing → Completed.
  if (episodesTotal && data.progress >= episodesTotal && airingStatus !== 'RELEASING' && airingStatus !== 'NOT_YET_RELEASED') {
    if (status !== 'completed') out.my_status = 'completed'
    if (!current?.finished_at && data.finished_at === undefined) out.finished_at = today
  }
  // First episode watched → Watching. (On hold / dropped stay put for manual edits; the player handles those itself.)
  else if (data.progress > 0 && status === 'plan_to_watch') out.my_status = 'watching'
  if (data.progress > 0 && !current?.started_at && data.started_at === undefined) out.started_at = today
  return out
}

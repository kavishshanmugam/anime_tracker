import type { IpcMain } from 'electron'
import { app, dialog } from 'electron'
import fs from 'fs'
import initSqlJs, { type Database } from 'sql.js'

let db: Database

const SCHEMA = `
CREATE TABLE IF NOT EXISTS anime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mal_id INTEGER UNIQUE,
  anilist_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  title_en TEXT,
  title_jp TEXT,
  cover_url TEXT,
  banner_url TEXT,
  cover_accent TEXT,
  episodes_total INTEGER,
  airing_status TEXT,
  season TEXT,
  season_year INTEGER,
  studio TEXT,
  genres TEXT,
  tags TEXT,
  synopsis TEXT,
  mean_score INTEGER,
  format TEXT,
  source TEXT,
  duration INTEGER,
  relations TEXT,
  external_links TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS library_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL UNIQUE REFERENCES anime(id),
  my_status TEXT NOT NULL DEFAULT 'plan_to_watch',
  my_score INTEGER,
  progress INTEGER NOT NULL DEFAULT 0,
  rewatch_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  last_watched_at TEXT,
  notes TEXT,
  custom_tags TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS airing_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL REFERENCES anime(id),
  episode INTEGER NOT NULL,
  airing_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'scheduled',
  UNIQUE(anime_id, episode)
);

CREATE TABLE IF NOT EXISTS franchise_watch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_anime_id INTEGER NOT NULL REFERENCES anime(id),
  related_anime_id INTEGER NOT NULL REFERENCES anime(id),
  relation_type TEXT NOT NULL,
  release_status TEXT,
  start_date TEXT,
  surfaced_at TEXT DEFAULT (datetime('now')),
  state TEXT NOT NULL DEFAULT 'watching',
  UNIQUE(root_anime_id, related_anime_id)
);

CREATE TABLE IF NOT EXISTS not_interested (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL UNIQUE REFERENCES anime(id),
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pending_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL REFERENCES anime(id),
  detected_range TEXT,
  source_url_host TEXT,
  state TEXT NOT NULL DEFAULT 'pending',
  detected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watch_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anime_id INTEGER NOT NULL REFERENCES anime(id),
  episode INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  watched_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_library_status ON library_entry(my_status);
CREATE INDEX IF NOT EXISTS idx_library_anime ON library_entry(anime_id);
CREATE INDEX IF NOT EXISTS idx_airing_date ON airing_schedule(airing_at);
CREATE INDEX IF NOT EXISTS idx_watch_event_anime ON watch_event(anime_id);
CREATE INDEX IF NOT EXISTS idx_anime_mal ON anime(mal_id);
CREATE INDEX IF NOT EXISTS idx_anime_anilist ON anime(anilist_id);
`

let dbPath: string

function save(): void {
  const data = db.export()
  // ponytail: atomic write via temp file + rename to prevent corruption on crash
  const tmpPath = dbPath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, Buffer.from(data))
    fs.renameSync(tmpPath, dbPath)
  } catch (e) {
    try { fs.unlinkSync(tmpPath) } catch { /* cleanup best-effort */ }
    throw e
  }
}

export async function initDatabase(wasmPath: string, path: string): Promise<void> {
  dbPath = path
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  })

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(SCHEMA)
  save()
}

// Helper: run SELECT, return array of row objects
function query(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: any[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

// Helper: run INSERT/UPDATE/DELETE, save, return changes info
function run(sql: string, params: any[] = []): { lastId: number } {
  db.run(sql, params)
  const lastId = (query('SELECT last_insert_rowid() as id')[0] as any).id
  save()
  return { lastId }
}

// --- Anime columns for building upsert ---
const ANIME_COLS = [
  'mal_id', 'anilist_id', 'title', 'title_en', 'title_jp',
  'cover_url', 'banner_url', 'cover_accent', 'episodes_total',
  'airing_status', 'season', 'season_year', 'studio', 'genres',
  'tags', 'synopsis', 'mean_score', 'format', 'source', 'duration',
  'relations', 'external_links',
] as const

// ponytail: direct accessors for use by other main-process modules (stream-resolver)
export function getAppState(key: string): string | null {
  const rows = query('SELECT value FROM app_state WHERE key = ?', [key])
  return rows[0]?.value ?? null
}

export function setAppState(key: string, value: string): void {
  run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [key, value])
}

export function registerAllHandlers(ipcMain: IpcMain): void {
  // ---- DB handlers ----

  ipcMain.handle('db:getAllAnime', () => {
    return query('SELECT * FROM anime ORDER BY title')
  })

  ipcMain.handle('db:getAnime', (_e, id: number) => {
    const rows = query('SELECT * FROM anime WHERE id = ?', [id])
    return rows[0] ?? null
  })

  ipcMain.handle('db:getAnimeByMalId', (_e, malId: number) => {
    const rows = query('SELECT * FROM anime WHERE mal_id = ?', [malId])
    return rows[0] ?? null
  })

  ipcMain.handle('db:getAnimeByAnilistId', (_e, anilistId: number) => {
    const rows = query('SELECT * FROM anime WHERE anilist_id = ?', [anilistId])
    return rows[0] ?? null
  })

  ipcMain.handle('db:upsertAnime', (_e, data: any) => {
    // Dedup: check by mal_id or anilist_id first to get existing id
    let existingId: number | null = null
    if (data.mal_id) {
      const row = query('SELECT id FROM anime WHERE mal_id = ?', [data.mal_id])
      if (row.length) existingId = row[0].id
    }
    if (!existingId && data.anilist_id) {
      const row = query('SELECT id FROM anime WHERE anilist_id = ?', [data.anilist_id])
      if (row.length) existingId = row[0].id
    }

    if (existingId) {
      // UPDATE
      const sets = ANIME_COLS
        .filter(c => data[c] !== undefined)
        .map(c => `${c} = ?`)
      sets.push("updated_at = datetime('now')")
      const vals = ANIME_COLS
        .filter(c => data[c] !== undefined)
        .map(c => data[c])
      vals.push(existingId)
      db.run(`UPDATE anime SET ${sets.join(', ')} WHERE id = ?`, vals)
      save()
      return existingId
    } else {
      // INSERT
      const cols = ANIME_COLS.filter(c => data[c] !== undefined)
      const placeholders = cols.map(() => '?')
      const vals = cols.map(c => data[c])
      // title is required
      if (!cols.includes('title')) {
        throw new Error('title is required for new anime')
      }
      const { lastId } = run(
        `INSERT INTO anime (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
        vals
      )
      return lastId
    }
  })

  ipcMain.handle('db:getLibrary', () => {
    const rows = query(`
      SELECT a.*,
        le.id as entry_id, le.anime_id, le.my_status, le.my_score, le.progress,
        le.rewatch_count, le.started_at, le.finished_at, le.last_watched_at,
        le.notes, le.custom_tags, le.source as entry_source, le.updated_at as entry_updated_at
      FROM library_entry le
      JOIN anime a ON a.id = le.anime_id
      ORDER BY le.updated_at DESC
    `)
    return rows.map(r => ({
      ...r,
      entry: {
        id: r.entry_id, anime_id: r.anime_id, my_status: r.my_status,
        my_score: r.my_score, progress: r.progress, rewatch_count: r.rewatch_count,
        started_at: r.started_at, finished_at: r.finished_at,
        last_watched_at: r.last_watched_at, notes: r.notes,
        custom_tags: r.custom_tags, source: r.entry_source, updated_at: r.entry_updated_at,
      },
    }))
  })

  ipcMain.handle('db:getLibraryEntry', (_e, animeId: number) => {
    const rows = query(`
      SELECT * FROM library_entry WHERE anime_id = ?
    `, [animeId])
    return rows[0] ?? null
  })

  ipcMain.handle('db:upsertLibraryEntry', (_e, data: any) => {
    const { lastId } = run(`
      INSERT INTO library_entry (anime_id, my_status, my_score, progress, rewatch_count, started_at, finished_at, last_watched_at, notes, custom_tags, source, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(anime_id) DO UPDATE SET
        my_status = COALESCE(excluded.my_status, my_status),
        my_score = COALESCE(excluded.my_score, my_score),
        progress = COALESCE(excluded.progress, progress),
        rewatch_count = COALESCE(excluded.rewatch_count, rewatch_count),
        started_at = COALESCE(excluded.started_at, started_at),
        finished_at = COALESCE(excluded.finished_at, finished_at),
        last_watched_at = COALESCE(excluded.last_watched_at, last_watched_at),
        notes = COALESCE(excluded.notes, notes),
        custom_tags = COALESCE(excluded.custom_tags, custom_tags),
        source = COALESCE(excluded.source, source),
        updated_at = datetime('now')
    `, [
      data.anime_id,
      data.my_status ?? 'plan_to_watch',
      data.my_score ?? null,
      data.progress ?? 0,
      data.rewatch_count ?? 0,
      data.started_at ?? null,
      data.finished_at ?? null,
      data.last_watched_at ?? null,
      data.notes ?? null,
      data.custom_tags ?? null,
      data.source ?? 'manual',
    ])
    return lastId
  })

  ipcMain.handle('db:deleteLibraryEntry', (_e, animeId: number) => {
    run('DELETE FROM library_entry WHERE anime_id = ?', [animeId])
    return true
  })

  ipcMain.handle('db:getAiringSchedule', (_e, from: string, to: string) => {
    const rows = query(`
      SELECT s.id as schedule_id, s.anime_id, s.episode, s.airing_at, s.state,
        a.id as a_id, a.title, a.title_en, a.cover_url, a.cover_accent, a.episodes_total, a.anilist_id
      FROM airing_schedule s
      JOIN anime a ON a.id = s.anime_id
      WHERE s.airing_at BETWEEN ? AND ?
      ORDER BY s.airing_at ASC
    `, [from, to])
    return rows.map(r => ({
      id: r.schedule_id, anime_id: r.anime_id, episode: r.episode,
      airing_at: r.airing_at, state: r.state,
      anime: { id: r.a_id, title: r.title, title_en: r.title_en, cover_url: r.cover_url, cover_accent: r.cover_accent, episodes_total: r.episodes_total, anilist_id: r.anilist_id },
    }))
  })

  ipcMain.handle('db:upsertAiringSchedule', (_e, data: any) => {
    const { lastId } = run(`
      INSERT INTO airing_schedule (anime_id, episode, airing_at, state)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(anime_id, episode) DO UPDATE SET
        airing_at = excluded.airing_at,
        state = excluded.state
    `, [data.anime_id, data.episode, data.airing_at, data.state ?? 'scheduled'])
    return lastId
  })

  ipcMain.handle('db:getFranchiseWatches', () => {
    const rows = query(`
      SELECT fw.*,
        root.id as root_id, root.title as root_title, root.cover_url as root_cover_url,
        rel.id as rel_id, rel.title as related_title, rel.cover_url as related_cover_url,
        rel.airing_status as related_airing_status, rel.episodes_total as related_episodes_total
      FROM franchise_watch fw
      JOIN anime root ON root.id = fw.root_anime_id
      JOIN anime rel ON rel.id = fw.related_anime_id
      WHERE fw.state != 'dismissed'
      ORDER BY fw.surfaced_at DESC
    `)
    return rows.map(r => ({
      id: r.id, root_anime_id: r.root_anime_id, related_anime_id: r.related_anime_id,
      relation_type: r.relation_type, release_status: r.release_status,
      start_date: r.start_date, surfaced_at: r.surfaced_at, state: r.state,
      root: { id: r.root_id, title: r.root_title, cover_url: r.root_cover_url },
      related: { id: r.rel_id, title: r.related_title, cover_url: r.related_cover_url, airing_status: r.related_airing_status, episodes_total: r.related_episodes_total },
    }))
  })

  ipcMain.handle('db:upsertFranchiseWatch', (_e, data: any) => {
    const { lastId } = run(`
      INSERT INTO franchise_watch (root_anime_id, related_anime_id, relation_type, release_status, start_date, state)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(root_anime_id, related_anime_id) DO UPDATE SET
        relation_type = excluded.relation_type,
        release_status = excluded.release_status,
        start_date = excluded.start_date,
        state = excluded.state
    `, [
      data.root_anime_id, data.related_anime_id, data.relation_type,
      data.release_status ?? null, data.start_date ?? null, data.state ?? 'watching',
    ])
    return lastId
  })

  ipcMain.handle('db:updateFranchiseWatchState', (_e, id: number, state: string) => {
    run('UPDATE franchise_watch SET state = ? WHERE id = ?', [state, id])
    return true
  })

  ipcMain.handle('db:addWatchEvent', (_e, data: any) => {
    const { lastId } = run(`
      INSERT INTO watch_event (anime_id, episode, source) VALUES (?, ?, ?)
    `, [data.anime_id, data.episode, data.source ?? 'manual'])
    return lastId
  })

  ipcMain.handle('db:getWatchEvents', (_e, animeId: number) => {
    return query('SELECT * FROM watch_event WHERE anime_id = ? ORDER BY watched_at DESC', [animeId])
  })

  ipcMain.handle('db:addNotInterested', (_e, animeId: number, reason?: string) => {
    const { lastId } = run(`
      INSERT OR REPLACE INTO not_interested (anime_id, reason) VALUES (?, ?)
    `, [animeId, reason ?? null])
    return lastId
  })

  ipcMain.handle('db:getNotInterested', () => {
    return query('SELECT anime_id FROM not_interested').map(r => r.anime_id)
  })

  ipcMain.handle('db:exportData', () => {
    const tables = ['anime', 'library_entry', 'airing_schedule', 'franchise_watch',
      'not_interested', 'pending_review', 'watch_event', 'app_state']
    const data: Record<string, any[]> = {}
    for (const table of tables) {
      data[table] = query(`SELECT * FROM ${table}`)
    }
    return JSON.stringify(data, null, 2)
  })

  ipcMain.handle('db:importData', (_e, json: string) => {
    let data: any
    try { data = JSON.parse(json) } catch { return { imported: 0, error: 'Invalid JSON' } }
    let count = 0
    const tables = ['anime', 'library_entry', 'airing_schedule', 'franchise_watch',
      'not_interested', 'pending_review', 'watch_event', 'app_state']

    // ponytail: whitelist valid column names per table to prevent SQL injection via crafted keys
    const tableColumns: Record<string, Set<string>> = {}
    for (const table of tables) {
      const info = query(`PRAGMA table_info(${table})`)
      tableColumns[table] = new Set(info.map((r: any) => r.name))
    }

    db.run('BEGIN TRANSACTION')
    try {
      for (const table of tables) {
        const rows = data[table]
        if (!Array.isArray(rows) || !rows.length) continue
        const validCols = tableColumns[table]

        for (const row of rows) {
          const cols = Object.keys(row).filter(c => validCols.has(c))
          if (!cols.length) continue
          const placeholders = cols.map(() => '?')
          const vals = cols.map(c => row[c])
          db.run(
            `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
            vals
          )
          count++
        }
      }
      db.run('COMMIT')
    } catch (e) {
      db.run('ROLLBACK')
      throw e
    }
    save()
    return { imported: count }
  })

  ipcMain.handle('db:getStats', () => {
    const statusRows = query(`SELECT my_status, COUNT(*) as count FROM library_entry GROUP BY my_status`)
    const byStatus: Record<string, number> = {}
    let totalAnime = 0
    for (const r of statusRows) { byStatus[r.my_status] = r.count; totalAnime += r.count }

    const totalEpisodes = query(`SELECT COALESCE(SUM(progress), 0) as total FROM library_entry`)[0]?.total ?? 0
    const totalMinutes = query(`
      SELECT COALESCE(SUM(le.progress * COALESCE(a.duration, 24)), 0) as total
      FROM library_entry le JOIN anime a ON a.id = le.anime_id
    `)[0]?.total ?? 0

    // Genre breakdown
    const genreRows = query(`SELECT a.genres FROM library_entry le JOIN anime a ON a.id = le.anime_id WHERE a.genres IS NOT NULL`)
    const genreCounts: Record<string, number> = {}
    for (const row of genreRows) {
      let genres: string[]
      try { genres = JSON.parse(row.genres) } catch { genres = (row.genres as string).split(',').map((g: string) => g.trim()) }
      for (const g of genres) { if (g) genreCounts[g] = (genreCounts[g] || 0) + 1 }
    }
    const byGenre = Object.entries(genreCounts).map(([genre, count]) => ({ genre, count })).sort((a, b) => b.count - a.count)

    // Score distribution
    const scoreRows = query(`SELECT my_score, COUNT(*) as count FROM library_entry WHERE my_score IS NOT NULL AND my_score > 0 GROUP BY my_score ORDER BY my_score`)
    const scoreDistribution = scoreRows.map(r => ({ score: r.my_score, count: r.count }))

    // By year (finished_at year)
    const yearRows = query(`SELECT substr(finished_at, 1, 4) as year, COUNT(*) as count FROM library_entry WHERE finished_at IS NOT NULL GROUP BY year ORDER BY year DESC`)
    const byYear = yearRows.filter(r => r.year && r.year !== '0000').map(r => ({ year: Number(r.year), count: r.count }))

    // Recently completed
    const recentlyCompleted = query(`
      SELECT a.* FROM library_entry le JOIN anime a ON a.id = le.anime_id
      WHERE le.my_status = 'completed' ORDER BY le.finished_at DESC LIMIT 5
    `)

    // Personal mean score
    const meanRow = query(`SELECT AVG(my_score) as avg FROM library_entry WHERE my_score IS NOT NULL AND my_score > 0`)
    const meanScore = meanRow[0]?.avg ? Math.round(meanRow[0].avg * 10) / 10 : null

    // Watch pace: episodes per week over last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const recentEvents = query(`SELECT COUNT(*) as count FROM watch_event WHERE watched_at >= ?`, [thirtyDaysAgo])
    const epsLast30 = recentEvents[0]?.count ?? 0
    const epsPerWeek = Math.round((epsLast30 / 30) * 7 * 10) / 10

    // Watch heatmap: daily episode counts for the last 365 days
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
    const heatmapRows = query(`
      SELECT date(watched_at) as day, COUNT(*) as count
      FROM watch_event WHERE watched_at >= ?
      GROUP BY day ORDER BY day
    `, [oneYearAgo])
    const heatmap: Record<string, number> = {}
    for (const r of heatmapRows) { if (r.day) heatmap[r.day] = r.count }

    return { totalAnime, totalEpisodes, totalHours: Math.round(totalMinutes / 60), byStatus, byGenre, scoreDistribution, byYear, recentlyCompleted, meanScore, epsPerWeek, heatmap }
  })

  ipcMain.handle('db:getAppState', (_e, key: string) => {
    const rows = query('SELECT value FROM app_state WHERE key = ?', [key])
    return rows[0]?.value ?? null
  })

  ipcMain.handle('db:setAppState', (_e, key: string, value: string) => {
    run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [key, value])
    return true
  })

  ipcMain.handle('db:search', (_e, q: string) => {
    const like = `%${q}%`
    return query(`
      SELECT * FROM anime
      WHERE title LIKE ? OR title_en LIKE ? OR title_jp LIKE ?
      ORDER BY title LIMIT 50
    `, [like, like, like])
  })

  // ---- FS handlers ----

  ipcMain.handle('fs:selectFile', async (_e, filters?: any[]) => {
    const result = await dialog.showOpenDialog({
      filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
      properties: ['openFile'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('fs:readFile', (_e, filePath: string) => {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (e: any) {
      throw new Error(`Failed to read file: ${e.message}`)
    }
  })

  ipcMain.handle('fs:selectSavePath', async (_e, defaultName?: string, filters?: any[]) => {
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
    })
    return result.canceled ? null : result.filePath
  })

  ipcMain.handle('fs:writeFile', (_e, filePath: string, content: string) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (e: any) {
      throw new Error(`Failed to write file: ${e.message}`)
    }
  })

  // ---- App handlers ----

  ipcMain.handle('app:getDataPath', () => {
    return app.getPath('userData')
  })
}

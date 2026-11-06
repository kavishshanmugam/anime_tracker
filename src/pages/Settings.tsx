import { useState, useEffect } from 'react'
import { useToast } from '@/hooks/useToast'
import { parseMALExport, type MALImportResult } from '@/lib/mal-import'
import { enrichBareEntries } from '@/lib/sync'
import { getUserAnimeList, mapAniListToAnime } from '@/lib/anilist'
import type { MyStatus } from '@/types'
import SourcesSettings from '@/components/SourcesSettings'

const STATUS_LABELS: Record<MyStatus, string> = {
  watching: 'Watching',
  completed: 'Completed',
  plan_to_watch: 'Plan to Watch',
  on_hold: 'On Hold',
  dropped: 'Dropped',
}

export default function Settings() {
  const { toast } = useToast()
  const [dataPath, setDataPath] = useState('')
  const [malResult, setMalResult] = useState<MALImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [enriching, setEnriching] = useState(false)
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 })
  const [lastExport, setLastExport] = useState<string | null>(null)
  const [anilistUsername, setAnilistUsername] = useState('')
  const [anilistImporting, setAnilistImporting] = useState(false)
  const [streamingServices, setStreamingServices] = useState<string[]>([])

  const ALL_STREAMING_SERVICES = [
    'Crunchyroll', 'Netflix', 'Hulu', 'Amazon Prime Video', 'Disney Plus',
    'HIDIVE', 'Funimation', 'VRV', 'Bilibili', 'iQIYI', 'Wakanim', 'AnimeLab',
  ]

  useEffect(() => {
    if (window.api) {
      window.api.app.getDataPath().then(setDataPath).catch(() => {})
      window.api.db.getAppState('last_export').then(v => setLastExport(v)).catch(() => {})
      window.api.db.getAppState('streaming_services').then(v => {
        if (v) setStreamingServices(JSON.parse(v))
      }).catch(() => {})
    }
  }, [])

  const handleExport = async () => {
    if (!window.api) return
    try {
      const data = await window.api.db.exportData()
      const path = await window.api.fs.selectSavePath('senpai-backup.json')
      if (!path) return
      await window.api.fs.writeFile(path, data)
      await window.api.db.setAppState('last_export', new Date().toISOString())
      toast('Library exported')
    } catch { toast('Export failed') }
  }

  const handleExportMAL = async () => {
    if (!window.api) return
    try {
      const library = await window.api.db.getLibrary()
      const statusMap: Record<string, string> = {
        watching: 'Watching', completed: 'Completed', plan_to_watch: 'Plan to Watch',
        on_hold: 'On-Hold', dropped: 'Dropped',
      }
      const entries = library.filter(e => e.mal_id).map(e => `
    <anime>
      <series_animedb_id>${e.mal_id}</series_animedb_id>
      <series_title><![CDATA[${e.title}]]></series_title>
      <series_episodes>${e.episodes_total ?? 0}</series_episodes>
      <my_watched_episodes>${e.entry.progress}</my_watched_episodes>
      <my_start_date>${e.entry.started_at ?? '0000-00-00'}</my_start_date>
      <my_finish_date>${e.entry.finished_at ?? '0000-00-00'}</my_finish_date>
      <my_score>${e.entry.my_score ?? 0}</my_score>
      <my_status>${statusMap[e.entry.my_status] ?? 'Plan to Watch'}</my_status>
      <my_times_watched>${e.entry.rewatch_count}</my_times_watched>
      <update_on_import>1</update_on_import>
    </anime>`)
      const xml = `<?xml version="1.0" encoding="UTF-8" ?>\n<myanimelist>\n  <myinfo>\n    <user_export_type>1</user_export_type>\n  </myinfo>${entries.join('')}\n</myanimelist>`
      const path = await window.api.fs.selectSavePath('animelist_export.xml')
      if (!path) return
      await window.api.fs.writeFile(path, xml)
      toast(`Exported ${entries.length} entries as MAL XML`)
    } catch { toast('MAL export failed') }
  }

  const handleImportBackup = async () => {
    if (!window.api) return
    try {
      const path = await window.api.fs.selectFile([{ name: 'JSON Files', extensions: ['json'] }])
      if (!path) return
      const content = await window.api.fs.readFile(path)
      const result = await window.api.db.importData(content)
      toast(`Imported ${result.imported} entries`)
    } catch { toast('Import failed') }
  }

  const handleMALSelect = async () => {
    if (!window.api) return
    const path = await window.api.fs.selectFile([{ name: 'XML Files', extensions: ['xml'] }])
    if (!path) return
    const content = await window.api.fs.readFile(path)
    setMalResult(parseMALExport(content))
  }

  const handleMALImport = async () => {
    if (!malResult || !window.api) return
    setImporting(true)
    let count = 0

    for (const entry of malResult.entries) {
      const animeId = await window.api.db.upsertAnime({
        mal_id: entry.malId,
        anilist_id: null,
        title: entry.title,
        title_en: null, title_jp: null,
        cover_url: null, banner_url: null, cover_accent: null,
        episodes_total: null, airing_status: null,
        season: null, season_year: null, studio: null,
        genres: null, tags: null, synopsis: null,
        mean_score: null, format: null, source: null,
        duration: null, relations: null, external_links: null,
      })

      await window.api.db.upsertLibraryEntry({
        anime_id: animeId,
        my_status: entry.status,
        my_score: entry.score || null,
        progress: entry.progress,
        rewatch_count: 0,
        started_at: entry.startDate,
        finished_at: entry.finishDate,
        source: 'mal_import',
      })

      count++
      setImportProgress(Math.round((count / malResult.total) * 100))
    }

    toast(`Imported ${count} entries from MAL. Enriching with AniList data...`)
    setImporting(false)
    setMalResult(null)
    setImportProgress(0)

    // Auto-start enrichment after MAL import
    handleEnrich()
  }

  const handleAniListImport = async () => {
    if (!window.api || !anilistUsername.trim()) return
    setAnilistImporting(true)
    try {
      const list = await getUserAnimeList(anilistUsername.trim())
      let count = 0
      for (const entry of list) {
        const mapped = mapAniListToAnime(entry.media)
        const animeId = await window.api.db.upsertAnime(mapped)
        await window.api.db.upsertLibraryEntry({
          anime_id: animeId,
          my_status: entry.status as MyStatus,
          my_score: entry.score || null,
          progress: entry.progress,
          rewatch_count: entry.repeat,
          started_at: entry.startedAt,
          finished_at: entry.completedAt,
          source: 'anilist_import',
        })
        count++
      }
      toast(`Imported ${count} entries from AniList`)
    } catch (e: any) {
      toast(e?.message?.includes('User') ? 'User not found' : 'AniList import failed')
    }
    setAnilistImporting(false)
  }

  const handleEnrich = async () => {
    setEnriching(true)
    setEnrichProgress({ done: 0, total: 0 })
    try {
      const count = await enrichBareEntries((done, total) => setEnrichProgress({ done, total }))
      toast(count > 0 ? `Enriched ${count} entries with cover art & metadata` : 'All entries already enriched')
    } catch {
      toast('Enrichment failed')
    }
    setEnriching(false)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="font-display text-3xl font-black text-text-1">Settings</h1>

      {/* Export */}
      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-text-1">Export Data</h2>
        <p className="text-sm text-text-3">Export your library as a backup file.</p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleExport}
            className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-text-1 hover:bg-accent-hover"
          >Export JSON backup</button>
          <button
            onClick={handleExportMAL}
            className="rounded-card border border-border px-4 py-2 text-sm text-text-2 hover:bg-bg-1"
          >Export MAL XML</button>
        </div>
        {lastExport && (
          <p className="text-xs text-text-3">
            Last exported: {new Date(lastExport).toLocaleDateString()} {new Date(lastExport).toLocaleTimeString()}
            {Date.now() - new Date(lastExport).getTime() > 7 * 24 * 60 * 60 * 1000 && (
              <span className="ml-2 text-status-onhold font-medium">It's been over a week — consider backing up!</span>
            )}
          </p>
        )}
        {!lastExport && (
          <p className="text-xs text-status-onhold">You haven't exported a backup yet. Consider doing so!</p>
        )}
      </section>

      {/* Import backup */}
      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-text-1">Import Data</h2>
        <p className="text-sm text-text-3">Import from a Senpai JSON backup. This will merge with your existing data.</p>
        <button
          onClick={handleImportBackup}
          className="rounded-card border border-border px-4 py-2 text-sm text-text-2 hover:bg-bg-1"
        >Import from backup</button>
      </section>

      {/* MAL Import */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-text-1">MAL Import</h2>
        <p className="text-sm text-text-3">Import from a MyAnimeList XML export file.</p>
        <button
          onClick={handleMALSelect}
          className="rounded-card border border-border px-4 py-2 text-sm text-text-2 hover:bg-bg-1"
        >Select MAL export file</button>

        {malResult && (
          <div className="space-y-3">
            <div className="rounded-card border border-border bg-bg-1 p-4 space-y-2">
              <p className="text-sm font-medium text-text-1">{malResult.total} entries</p>
              {(Object.entries(malResult.byStatus) as [MyStatus, number][])
                .filter(([, count]) => count > 0)
                .map(([status, count]) => (
                  <div key={status} className="flex justify-between text-xs">
                    <span className="text-text-2">{STATUS_LABELS[status]}</span>
                    <span className="text-text-3 font-mono">{count}</span>
                  </div>
                ))}
            </div>

            {importing ? (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${importProgress}%` }} />
                </div>
                <p className="text-xs text-text-3 text-center">{importProgress}%</p>
              </div>
            ) : (
              <button
                onClick={handleMALImport}
                className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-text-1 hover:bg-accent-hover"
              >Import {malResult.total} entries</button>
            )}
          </div>
        )}
      </section>

      {/* AniList Import */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-text-1">AniList Import</h2>
        <p className="text-sm text-text-3">Import your anime list from AniList by username (must be a public profile).</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="AniList username"
            value={anilistUsername}
            onChange={e => setAnilistUsername(e.target.value)}
            className="rounded-card border border-border bg-bg-1 px-3 py-2 text-sm text-text-1 placeholder:text-text-3 w-48"
            onKeyDown={e => { if (e.key === 'Enter') handleAniListImport() }}
          />
          <button
            onClick={handleAniListImport}
            disabled={anilistImporting || !anilistUsername.trim()}
            className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-text-1 hover:bg-accent-hover disabled:opacity-50"
          >{anilistImporting ? 'Importing...' : 'Import'}</button>
        </div>
      </section>

      {/* Enrich library */}
      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-text-1">Enrich Library</h2>
        <p className="text-sm text-text-3">Fetch cover art, genres, and metadata from AniList for entries that are missing it.</p>
        {enriching ? (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: enrichProgress.total ? `${Math.round((enrichProgress.done / enrichProgress.total) * 100)}%` : '0%' }} />
            </div>
            <p className="text-xs text-text-3 text-center">
              {enrichProgress.done} / {enrichProgress.total} entries
            </p>
          </div>
        ) : (
          <button
            onClick={handleEnrich}
            className="rounded-card border border-border px-4 py-2 text-sm text-text-2 hover:bg-bg-1"
          >Enrich bare entries</button>
        )}
      </section>

      {/* Playback defaults */}
      <PlaybackDefaults />

      {/* Streaming Services */}
      <section className="space-y-3">
        <h2 className="font-display text-base font-semibold text-text-1">Streaming Services</h2>
        <p className="text-sm text-text-3">
          Toggle services you have accounts for. Episode links will prefer these; otherwise free sites are used.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {ALL_STREAMING_SERVICES.map(service => {
            const active = streamingServices.includes(service)
            return (
              <button
                key={service}
                onClick={async () => {
                  const next = active
                    ? streamingServices.filter(s => s !== service)
                    : [...streamingServices, service]
                  setStreamingServices(next)
                  await window.api?.db.setAppState('streaming_services', JSON.stringify(next))
                }}
                className={`rounded-card border px-3 py-2 text-sm text-left transition-colors ${
                  active
                    ? 'border-accent bg-accent/10 text-text-1'
                    : 'border-border text-text-3 hover:bg-bg-1'
                }`}
              >{service}</button>
            )
          })}
        </div>
        <SourcesSettings />
      </section>

      {/* Data info */}
      <section className="space-y-2">
        <h2 className="font-display text-base font-semibold text-text-1">Data Info</h2>
        {dataPath && (
          <p className="text-sm text-text-3">
            Data directory: <span className="font-mono text-text-2">{dataPath}</span>
          </p>
        )}
      </section>

      {/* About */}
      <section className="space-y-1">
        <h2 className="font-display text-base font-semibold text-text-1">About</h2>
        <p className="text-sm text-text-2">Senpai - Anime Tracker</p>
        <p className="text-xs text-text-3">A desktop app for tracking your anime watching habits.</p>
      </section>
    </div>
  )
}

function PlaybackDefaults() {
  const [audio, setAudio] = useState<'sub' | 'dub'>('sub')
  const [subsOn, setSubsOn] = useState(true)
  useEffect(() => {
    window.api?.db.getAppState('audio_pref').then(v => setAudio(v === 'dub' ? 'dub' : 'sub')).catch(() => {})
    window.api?.db.getAppState('player_prefs').then(v => {
      try { if (v && JSON.parse(v).subs?.on === false) setSubsOn(false) } catch { /* */ }
    }).catch(() => {})
  }, [])
  const saveSubs = async (on: boolean) => {
    setSubsOn(on)
    let prefs: any = {}
    try { prefs = JSON.parse((await window.api?.db.getAppState('player_prefs')) ?? '{}') } catch { /* */ }
    await window.api?.db.setAppState('player_prefs', JSON.stringify({ ...prefs, subs: { on, lang: prefs.subs?.lang ?? 'en' } }))
  }
  const seg = (active: boolean) => `px-4 py-1.5 text-sm font-semibold ${active ? 'bg-accent text-white' : 'bg-bg-0 text-text-3 hover:text-text-1'}`
  return (
    <section className="space-y-3">
      <h2 className="font-display text-base font-semibold text-text-1">Playback</h2>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-1">Default audio</p>
          <p className="text-xs text-text-3">Used for shows you haven't picked Sub/Dub for. Change it per show from the episode list.</p>
        </div>
        <div className="flex overflow-hidden rounded-[4px] border border-border">
          <button className={seg(audio === 'sub')} onClick={() => { setAudio('sub'); window.api?.db.setAppState('audio_pref', 'sub') }}>Sub</button>
          <button className={seg(audio === 'dub')} onClick={() => { setAudio('dub'); window.api?.db.setAppState('audio_pref', 'dub') }}>Dub</button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-text-1">Subtitles</p>
          <p className="text-xs text-text-3">Turns on English subtitles whenever a video has a subtitle track. Sub episodes usually have them built into the picture anyway.</p>
        </div>
        <div className="flex overflow-hidden rounded-[4px] border border-border">
          <button className={seg(subsOn)} onClick={() => saveSubs(true)}>English</button>
          <button className={seg(!subsOn)} onClick={() => saveSubs(false)}>Off</button>
        </div>
      </div>
    </section>
  )
}

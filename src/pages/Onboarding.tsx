import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseMALExport, type MALImportResult } from '@/lib/mal-import'
import { enrichBareEntries } from '@/lib/sync'
import type { MyStatus } from '@/types'

const STATUS_LABELS: Record<MyStatus, string> = {
  watching: 'Watching',
  completed: 'Completed',
  plan_to_watch: 'Plan to Watch',
  on_hold: 'On Hold',
  dropped: 'Dropped',
}

export default function Onboarding({ onSkip }: { onSkip?: () => void }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [malResult, setMalResult] = useState<MALImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importedCount, setImportedCount] = useState(0)

  const handleSelectFile = async () => {
    if (!window.api) return
    const path = await window.api.fs.selectFile([{ name: 'XML Files', extensions: ['xml'] }])
    if (!path) return
    const content = await window.api.fs.readFile(path)
    const result = parseMALExport(content)
    setMalResult(result)
  }

  const handleImport = async () => {
    if (!malResult || !window.api) return
    setImporting(true)
    let count = 0

    for (const entry of malResult.entries) {
      // Create anime record with mal_id
      const animeId = await window.api.db.upsertAnime({
        mal_id: entry.malId,
        anilist_id: null,
        title: entry.title,
        title_en: null,
        title_jp: null,
        cover_url: null,
        banner_url: null,
        cover_accent: null,
        episodes_total: null,
        airing_status: null,
        season: null,
        season_year: null,
        studio: null,
        genres: null,
        tags: null,
        synopsis: null,
        mean_score: null,
        format: null,
        source: null,
        duration: null,
        relations: null,
        external_links: null,
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

    setImportedCount(count)
    setStep(2)
    setImporting(false)
    // ponytail: kick off enrichment in background as promised by the UI text
    enrichBareEntries().catch(() => {})
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg-0">
      <div className="w-full max-w-lg px-6">
        {/* Step indicators */}
        <div className="mb-8 flex justify-center gap-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className={`h-2 w-2 rounded-full transition-colors ${i === step ? 'bg-accent' : 'bg-bg-2'}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="text-center space-y-6">
            <h1 className="font-display text-3xl font-bold text-text-1">Welcome to Senpai</h1>
            <p className="text-text-2">Let's set up your anime library.</p>
            <div className="space-y-3">
              <button
                onClick={() => setStep(1)}
                className="w-full rounded-card bg-accent py-3 text-sm font-medium text-text-1 hover:bg-accent-hover transition-colors"
              >Import from MyAnimeList</button>
              <button
                onClick={() => { onSkip?.(); navigate('/') }}
                className="text-sm text-text-3 hover:text-text-1 transition-colors"
              >Start fresh</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(0)} className="text-text-3 hover:text-text-1">&larr;</button>
              <h2 className="font-display text-xl font-bold text-text-1">MAL Import</h2>
            </div>

            <button
              onClick={handleSelectFile}
              className="w-full rounded-card border-2 border-dashed border-border py-8 text-sm text-text-2 hover:border-accent hover:text-text-1 transition-colors"
            >
              {malResult ? `${malResult.total} entries found` : 'Select your MAL export file (.xml)'}
            </button>

            {malResult && (
              <>
                <div className="rounded-card border border-border bg-bg-1 p-4 space-y-2">
                  <p className="text-sm font-medium text-text-1">{malResult.total} entries</p>
                  <div className="space-y-1">
                    {(Object.entries(malResult.byStatus) as [MyStatus, number][])
                      .filter(([, count]) => count > 0)
                      .map(([status, count]) => (
                        <div key={status} className="flex justify-between text-xs">
                          <span className="text-text-2">{STATUS_LABELS[status]}</span>
                          <span className="text-text-3 font-mono">{count}</span>
                        </div>
                      ))}
                  </div>
                </div>

                {importing ? (
                  <div className="space-y-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-bg-2">
                      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${importProgress}%` }} />
                    </div>
                    <p className="text-xs text-text-3 text-center">{importProgress}%</p>
                  </div>
                ) : (
                  <button
                    onClick={handleImport}
                    className="w-full rounded-card bg-accent py-3 text-sm font-medium text-text-1 hover:bg-accent-hover transition-colors"
                  >Import {malResult.total} entries</button>
                )}

                <p className="text-xs text-text-3 text-center">
                  Full metadata will be fetched from AniList in the background.
                </p>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="text-center space-y-6">
            <h2 className="font-display text-2xl font-bold text-text-1">You're all set!</h2>
            <p className="text-text-2">
              Imported <span className="font-mono text-text-1">{importedCount}</span> entries into your library.
            </p>
            <button
              onClick={() => { onSkip?.(); navigate('/') }}
              className="w-full rounded-card bg-accent py-3 text-sm font-medium text-text-1 hover:bg-accent-hover transition-colors"
            >Go to your library</button>
          </div>
        )}
      </div>
    </div>
  )
}

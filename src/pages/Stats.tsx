import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import EmptyState from '@/components/EmptyState'
import { SkeletonText } from '@/components/Skeleton'
import type { MyStatus, Anime } from '@/types'
import { displayTitle } from '@/lib/title'

interface StatsData {
  totalAnime: number
  totalEpisodes: number
  totalHours: number
  byStatus: Record<MyStatus, number>
  byGenre: { genre: string; count: number }[]
  scoreDistribution: { score: number; count: number }[]
  byYear: { year: number; count: number }[]
  recentlyCompleted: Anime[]
  meanScore: number | null
  epsPerWeek: number
  heatmap: Record<string, number>
}

const STATUS_COLORS: Record<MyStatus, string> = {
  watching: '#7E7BF2',
  completed: '#4FD1A1',
  plan_to_watch: '#8B8B8B',
  on_hold: '#E0A46B',
  dropped: '#E06B6B',
}

const STATUS_LABELS: Record<MyStatus, string> = {
  watching: 'Watching',
  completed: 'Completed',
  plan_to_watch: 'Planned',
  on_hold: 'On Hold',
  dropped: 'Dropped',
}

// ponytail: GitHub-style heatmap, pure divs
function Heatmap({ data }: { data: Record<string, number> }) {
  const cells = useMemo(() => {
    const today = new Date()
    const result: { date: string; count: number }[] = []
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().split('T')[0]
      result.push({ date: key, count: data[key] || 0 })
    }
    return result
  }, [data])

  const max = Math.max(...cells.map(c => c.count), 1)

  const getColor = (count: number) => {
    if (count === 0) return 'var(--color-bg-2, #1a1a2e)'
    const intensity = Math.min(count / max, 1)
    if (intensity <= 0.25) return '#2d4a3e'
    if (intensity <= 0.5) return '#3b6b54'
    if (intensity <= 0.75) return '#4FD1A1'
    return '#3ee89a'
  }

  // Group into weeks (columns)
  const weeks: { date: string; count: number }[][] = []
  let week: { date: string; count: number }[] = []
  // Pad first week so day-of-week alignment is correct
  const firstDay = new Date(cells[0].date).getDay()
  for (let i = 0; i < firstDay; i++) week.push({ date: '', count: -1 })
  for (const cell of cells) {
    week.push(cell)
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length) weeks.push(week)

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div className="overflow-x-auto pb-1">
      <div className="flex gap-[3px]" style={{ minWidth: weeks.length * 13 }}>
        {weeks.map((w, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {wi > 0 && new Date(w.find(c => c.date)?.date || '').getDate() <= 7 && (
              <span className="text-[9px] text-text-3 h-3 leading-3 -mt-4">
                {months[new Date(w.find(c => c.date)?.date || '').getMonth()]}
              </span>
            )}
            {w.map((cell, ci) => (
              <div
                key={ci}
                className="h-[10px] w-[10px] rounded-sm"
                style={{ backgroundColor: cell.count < 0 ? 'transparent' : getColor(cell.count) }}
                title={cell.date ? `${cell.date}: ${cell.count} episode${cell.count !== 1 ? 's' : ''}` : ''}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Bar({ value, max, color, label, count }: { value: number; max: number; color: string; label: string; count: number }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-xs text-text-2 text-right shrink-0 truncate">{label}</span>
      <div className="flex-1 h-5 bg-bg-2 rounded overflow-hidden">
        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 text-xs text-text-3 font-mono text-right">{count}</span>
    </div>
  )
}

export default function Stats() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.api) { setLoading(false); return }
    window.api.db.getStats()
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 4 }, (_, i) => <SkeletonText key={i} height="120px" />)}
      </div>
    )
  }

  if (!stats || stats.totalAnime === 0) {
    return (
      <div>
        <EmptyState
          title="No stats yet"
          description="Start tracking anime to see your watching patterns."
          action={{ label: 'Go to Library', onClick: () => navigate('/library') }}
        />
      </div>
    )
  }

  const statusEntries = Object.entries(stats.byStatus) as [MyStatus, number][]
  const maxStatus = Math.max(...statusEntries.map(([, v]) => v), 1)
  const topGenres = stats.byGenre.slice(0, 10)
  const maxGenre = Math.max(...topGenres.map(g => g.count), 1)
  const maxScore = Math.max(...stats.scoreDistribution.map(s => s.count), 1)
  const maxYear = Math.max(...stats.byYear.map(y => y.count), 1)

  return (
    <div className="p-6 space-y-8">
      <h1 className="font-display text-3xl font-black text-text-1">Stats</h1>

      {/* Overview cards */}
      <div className="grid grid-cols-3 gap-4 md:grid-cols-5">
        {[
          { label: 'Total Anime', value: stats.totalAnime },
          { label: 'Episodes Watched', value: stats.totalEpisodes.toLocaleString() },
          { label: 'Hours Watched', value: Math.round(stats.totalHours).toLocaleString() },
          { label: 'Mean Score', value: stats.meanScore ?? '-' },
          { label: 'Eps / Week', value: stats.epsPerWeek },
        ].map(card => (
          <div key={card.label} className="rounded-card border border-border bg-bg-1 p-4 text-center">
            <p className="text-2xl font-bold font-mono text-text-1">{card.value}</p>
            <p className="text-xs text-text-3 mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Watch Heatmap */}
      {Object.keys(stats.heatmap).length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-text-1">Watch Activity</h2>
          <Heatmap data={stats.heatmap} />
        </section>
      )}

      {/* By Status */}
      <section>
        <h2 className="mb-3 font-display text-base font-semibold text-text-1">By Status</h2>
        <div className="space-y-1.5">
          {statusEntries.filter(([, v]) => v > 0).map(([status, count]) => (
            <Bar key={status} value={count} max={maxStatus} color={STATUS_COLORS[status]} label={STATUS_LABELS[status]} count={count} />
          ))}
        </div>
      </section>

      {/* Genre breakdown */}
      {topGenres.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-text-1">Top Genres</h2>
          <div className="space-y-1.5">
            {topGenres.map(g => (
              <Bar key={g.genre} value={g.count} max={maxGenre} color="#7E7BF2" label={g.genre} count={g.count} />
            ))}
          </div>
        </section>
      )}

      {/* Score distribution */}
      {stats.scoreDistribution.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-text-1">Score Distribution</h2>
          <div className="space-y-1.5">
            {stats.scoreDistribution.map(s => (
              <Bar key={s.score} value={s.count} max={maxScore} color="#4FD1A1" label={`${s.score}`} count={s.count} />
            ))}
          </div>
        </section>
      )}

      {/* By Year */}
      {stats.byYear.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-text-1">By Year</h2>
          <div className="space-y-1.5">
            {stats.byYear.map(y => (
              <Bar key={y.year} value={y.count} max={maxYear} color="#E0A46B" label={`${y.year}`} count={y.count} />
            ))}
          </div>
        </section>
      )}

      {/* Recently completed */}
      {stats.recentlyCompleted.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-text-1">Recently Completed</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {stats.recentlyCompleted.slice(0, 5).map(anime => (
              <button
                key={anime.id}
                onClick={() => navigate(`/anime/${anime.id}`)}
                className="shrink-0 w-28 text-left group"
              >
                <div className="aspect-[2/3] overflow-hidden rounded-card bg-bg-2">
                  {anime.cover_url ? (
                    <img src={anime.cover_url} alt={displayTitle(anime)} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-text-3 p-2">{displayTitle(anime)}</div>
                  )}
                </div>
                <p className="mt-1 text-xs text-text-1 line-clamp-2">{displayTitle(anime)}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

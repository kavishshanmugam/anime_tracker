import { useNavigate } from 'react-router-dom'
import { useLibrary } from '@/hooks/useLibrary'
import { useToast } from '@/hooks/useToast'
import ProgressBar from '@/components/ProgressBar'
import EmptyState from '@/components/EmptyState'
import { SkeletonGrid } from '@/components/Skeleton'
import type { MyStatus } from '@/types'

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

function isStale(lastWatchedAt: string | null): boolean {
  if (!lastWatchedAt) return false
  const diff = Date.now() - new Date(lastWatchedAt).getTime()
  return diff > 90 * 24 * 60 * 60 * 1000
}

export default function Home() {
  const navigate = useNavigate()
  const { entries, loading, updateEntry } = useLibrary()
  const { toast } = useToast()

  if (loading) return <div className="p-6"><SkeletonGrid count={6} /></div>

  if (entries.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="Your library is empty"
          description="Import your anime list or start browsing to build your library."
          action={{ label: 'Go to Settings', onClick: () => navigate('/settings') }}
        />
      </div>
    )
  }

  const continueWatching = entries.filter(
    e => e.entry.my_status === 'watching' && e.entry.progress > 0
  )

  const recentlyUpdated = [...entries]
    .filter(e => e.entry.last_watched_at)
    .sort((a, b) => (b.entry.last_watched_at ?? '').localeCompare(a.entry.last_watched_at ?? ''))
    .slice(0, 10)

  // ponytail: simple reduce, no lib needed
  const statusCounts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.entry.my_status] = (acc[e.entry.my_status] || 0) + 1
    return acc
  }, {})

  const handleIncrement = async (animeId: number, current: number, total: number | null) => {
    try {
      const next = current + 1
      const updates: any = { progress: next, last_watched_at: new Date().toISOString() }
      const anime = entries.find(e => e.id === animeId)
      if (total && next >= total && anime?.airing_status !== 'RELEASING') {
        updates.my_status = 'completed'
        updates.finished_at = new Date().toISOString().split('T')[0]
      }
      await updateEntry(animeId, updates)
      if (window.api) {
        await window.api.db.addWatchEvent({
          anime_id: animeId,
          episode: next,
          source: 'manual',
          watched_at: new Date().toISOString(),
        })
      }
      toast(total && next >= total ? 'Completed!' : `Episode ${next}`)
    } catch { toast('Failed to update') }
  }

  return (
    <div className="space-y-8 p-6">
      {/* Quick Stats */}
      <div className="flex gap-3">
        {(['watching', 'completed', 'plan_to_watch'] as MyStatus[]).map(status => (
          <button
            key={status}
            onClick={() => navigate(`/library?status=${status}`)}
            className="flex items-center gap-2 rounded-card bg-bg-1 px-4 py-2.5 border border-border hover:bg-bg-2 transition-colors cursor-pointer"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[status] }} />
            <span className="text-sm text-text-2">
              <span className="font-medium text-text-1">{statusCounts[status] || 0}</span> {STATUS_LABELS[status]}
            </span>
          </button>
        ))}
      </div>

      {/* Continue Watching */}
      {continueWatching.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-lg font-semibold text-text-1">Continue Watching</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {continueWatching.map(item => {
              const oneLeft = item.episodes_total != null && item.entry.progress === item.episodes_total - 1
              const stale = isStale(item.entry.last_watched_at)
              return (
                <div
                  key={item.id}
                  className="relative flex-shrink-0 w-56 cursor-pointer group"
                  onClick={() => navigate(`/anime/${item.id}`)}
                >
                  <div className="relative aspect-video overflow-hidden rounded-card bg-bg-2">
                    {item.cover_url ? (
                      <img src={item.cover_url} alt={item.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-bg-2">
                        <span className="text-xs text-text-3">{item.title}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute bottom-2 left-2 right-2">
                      <p className="text-sm font-medium text-white line-clamp-1">{item.title}</p>
                    </div>
                    {oneLeft && (
                      <span className="absolute top-2 right-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
                        1 episode left!
                      </span>
                    )}
                    {stale && (
                      <span className="absolute top-2 left-2 rounded bg-status-onhold/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        Untouched 3+ months
                      </span>
                    )}
                  </div>
                  <div className="mt-2" onClick={e => e.stopPropagation()}>
                    <ProgressBar
                      current={item.entry.progress}
                      total={item.episodes_total}
                      accentColor={item.cover_accent ?? undefined}
                      onIncrement={() => handleIncrement(item.id, item.entry.progress, item.episodes_total)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Recently Updated */}
      {recentlyUpdated.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-lg font-semibold text-text-1">Recently Updated</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {recentlyUpdated.map(item => (
              <button
                key={item.id}
                onClick={() => navigate(`/anime/${item.id}`)}
                className="group text-left transition-transform hover:scale-[1.03]"
              >
                <div
                  className="relative aspect-[2/3] overflow-hidden rounded-card bg-bg-2"
                  style={item.cover_accent ? { borderBottom: `3px solid ${item.cover_accent}` } : undefined}
                >
                  {item.cover_url ? (
                    <img src={item.cover_url} alt={item.title} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center p-3">
                      <span className="text-center text-sm text-text-3">{item.title}</span>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-text-1 line-clamp-2">{item.title}</p>
                <p className="font-mono text-xs text-text-3">
                  Ep {item.entry.progress}{item.episodes_total ? `/${item.episodes_total}` : ''}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

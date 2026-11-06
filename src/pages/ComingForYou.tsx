import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/hooks/useToast'
import EmptyState from '@/components/EmptyState'
import { SkeletonGrid } from '@/components/Skeleton'
import type { Anime, FranchiseWatch } from '@/types'

type FranchiseEntry = FranchiseWatch & { root: Anime; related: Anime }

export default function ComingForYou() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [items, setItems] = useState<FranchiseEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.api) { setLoading(false); return }
    window.api.db.getFranchiseWatches()
      .then(data => setItems(data.filter(fw => fw.state === 'watching')))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  const handleMute = async (fw: FranchiseEntry) => {
    if (!window.api) return
    await window.api.db.updateFranchiseWatchState(fw.id, 'muted')
    setItems(prev => prev.filter(i => i.id !== fw.id))
    toast('Muted - you won\'t see this again')
  }

  const handleDismiss = async (fw: FranchiseEntry) => {
    if (!window.api) return
    await window.api.db.updateFranchiseWatchState(fw.id, 'dismissed')
    setItems(prev => prev.filter(i => i.id !== fw.id))
    toast('Dismissed')
  }

  const handleAddToPlan = async (fw: FranchiseEntry) => {
    if (!window.api) return
    try {
      await window.api.db.upsertLibraryEntry({
        anime_id: fw.related.id,
        my_status: 'plan_to_watch',
        progress: 0,
        source: 'franchise',
      })
      toast(`Added "${fw.related.title}" to plan`)
    } catch { toast('Failed to add') }
  }

  if (loading) return <div><SkeletonGrid count={4} /></div>

  if (items.length === 0) {
    return (
      <div>
        <EmptyState
          title="No upcoming sequels or spin-offs detected yet"
          description="Add anime to your library and we'll watch for new seasons."
        />
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-6 font-display text-3xl font-black text-text-1">Coming For You</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {items.map(fw => (
          <div key={fw.id} className="rounded-card border border-border bg-bg-1 p-4">
            <div className="flex gap-4">
              {/* Root anime */}
              <button onClick={() => navigate(`/anime/${fw.root.id}`)} className="shrink-0 w-20">
                <div className="aspect-[2/3] overflow-hidden rounded bg-bg-2">
                  {fw.root.cover_url ? (
                    <img src={fw.root.cover_url} alt={fw.root.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-text-3 p-1">{fw.root.title}</div>
                  )}
                </div>
              </button>

              {/* Arrow */}
              <div className="flex flex-col items-center justify-center shrink-0 text-text-3">
                <span className="text-lg">&rarr;</span>
              </div>

              {/* Related anime */}
              <button onClick={() => navigate(`/anime/${fw.related.id}`)} className="shrink-0 w-20">
                <div className="aspect-[2/3] overflow-hidden rounded bg-bg-2">
                  {fw.related.cover_url ? (
                    <img src={fw.related.cover_url} alt={fw.related.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-text-3 p-1">{fw.related.title}</div>
                  )}
                </div>
              </button>

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm text-text-2 line-clamp-1">
                  You watched <span className="text-text-1 font-medium">{fw.root.title}</span>
                </p>
                <p className="text-sm text-text-1 font-medium line-clamp-1">{fw.related.title}</p>
                <div className="flex flex-wrap gap-1.5">
                  <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[11px] text-text-3">
                    {fw.relation_type.replace(/_/g, ' ')}
                  </span>
                  <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[11px] text-text-3">
                    {fw.release_status}
                  </span>
                  {fw.start_date && (
                    <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[11px] text-text-3">
                      {fw.start_date}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-3 flex gap-2 border-t border-border pt-3">
              <button
                onClick={() => handleAddToPlan(fw)}
                className="rounded-card bg-accent px-3 py-1.5 text-sm font-medium text-text-1 hover:bg-accent-hover"
              >Add to plan</button>
              <button
                onClick={() => handleMute(fw)}
                className="rounded-card border border-border px-3 py-1.5 text-sm text-text-2 hover:bg-bg-2"
              >Mute</button>
              <button
                onClick={() => handleDismiss(fw)}
                className="rounded-card border border-border px-3 py-1.5 text-sm text-text-2 hover:bg-bg-2"
              >Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

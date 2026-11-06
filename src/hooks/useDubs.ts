import { useEffect, useState } from 'react'
import { dubStatus, loadDubs, onDubsLoaded, type DubStatus } from '@/lib/dubs'

/** Returns a lookup MAL id → dub status; re-renders once the dub list has loaded. */
export function useDubs(): (malId: number | null | undefined, airingStatus?: string | null) => DubStatus {
  const [, setVersion] = useState(0)
  useEffect(() => {
    const off = onDubsLoaded(() => setVersion(v => v + 1))
    loadDubs().catch(() => {})
    return off
  }, [])
  return dubStatus
}

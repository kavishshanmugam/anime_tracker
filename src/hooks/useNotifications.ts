import { useState, useEffect, useCallback } from 'react'

export interface AppNotification {
  id: string
  type: 'new_episode' | 'sequel' | 'dub'
  title: string
  body: string
  animeId?: number
  createdAt: string
  read: boolean
}

const STORAGE_KEY = 'notifications'

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([])

  const load = useCallback(async () => {
    if (!window.api) return
    const raw = await window.api.db.getAppState(STORAGE_KEY)
    if (raw) {
      try { setNotifications(JSON.parse(raw)) } catch { setNotifications([]) }
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (items: AppNotification[]) => {
    if (!window.api) return
    await window.api.db.setAppState(STORAGE_KEY, JSON.stringify(items))
  }, [])

  const addNotification = useCallback(async (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => {
    setNotifications(prev => {
      // ponytail: dedupe by title+body
      if (prev.some(p => p.title === n.title && p.body === n.body)) return prev
      const next = [{ ...n, id: Date.now().toString(36), createdAt: new Date().toISOString(), read: false }, ...prev].slice(0, 50)
      save(next)
      return next
    })
  }, [save])

  const markAllRead = useCallback(async () => {
    setNotifications(prev => {
      const next = prev.map(n => ({ ...n, read: true }))
      save(next)
      return next
    })
  }, [save])

  const clearAll = useCallback(async () => {
    setNotifications([])
    save([])
  }, [save])

  const unreadCount = notifications.filter(n => !n.read).length

  return { notifications, unreadCount, addNotification, markAllRead, clearAll, reload: load }
}

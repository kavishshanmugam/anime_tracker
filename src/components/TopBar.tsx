import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import CommandPalette from './CommandPalette'
import { useNotifications } from '@/hooks/useNotifications'
import { syncAiringSchedules } from '@/lib/sync'

export default function TopBar() {
  const navigate = useNavigate()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { notifications, unreadCount, addNotification, markAllRead, clearAll, reload } = useNotifications()
  const dropdownRef = useRef<HTMLDivElement>(null)
  const syncedRef = useRef(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ponytail: sync once on app start, feed notifications
  useEffect(() => {
    if (syncedRef.current) return
    syncedRef.current = true
    syncAiringSchedules().then(({ notifications: notifs }) => {
      for (const n of notifs) addNotification(n)
    }).catch(() => {})
  }, [addNotification])

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen])

  const handleBellClick = () => {
    // Mark read on close (after user has seen them), not on open
    if (dropdownOpen && unreadCount > 0) markAllRead()
    setDropdownOpen(!dropdownOpen)
  }

  return (
    <>
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-bg-0 px-6">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex h-9 w-72 items-center gap-2 rounded-card bg-bg-1 px-4 text-sm text-text-3 transition-colors hover:bg-bg-2"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span className="flex-1 text-left">Search anime...</span>
          <kbd className="rounded bg-bg-2 px-1.5 py-0.5 font-mono text-xs text-text-3">Ctrl+K</kbd>
        </button>

        <div className="flex-1" />

        <div className="relative" ref={dropdownRef}>
          <button
            onClick={handleBellClick}
            className="relative text-text-3 transition-colors hover:text-text-1"
            aria-label="Notifications"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-text-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-card border border-border bg-bg-1 shadow-lg z-50 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-sm font-medium text-text-1">Notifications</span>
                {notifications.length > 0 && (
                  <button onClick={clearAll} className="text-xs text-text-3 hover:text-text-1">Clear all</button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-text-3">No notifications</p>
                ) : (
                  notifications.map(n => (
                    <button
                      key={n.id}
                      onClick={() => { if (n.animeId) { navigate(`/anime/${n.animeId}`); setDropdownOpen(false) } }}
                      className={`w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-bg-2 transition-colors ${!n.read ? 'bg-accent/5' : ''}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${n.type === 'new_episode' ? 'bg-accent' : 'bg-status-completed'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-text-1">{n.title}</p>
                          <p className="text-xs text-text-2 line-clamp-2">{n.body}</p>
                          <p className="text-[10px] text-text-3 mt-0.5">{new Date(n.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}

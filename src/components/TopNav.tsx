import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import CommandPalette from './CommandPalette'
import { useNotifications } from '@/hooks/useNotifications'
import { syncAiringSchedules } from '@/lib/sync'
import { dubChanges } from '@/lib/dubs'
import { loadProfile, useProfile } from '@/hooks/useProfile'
import { Avatar } from './ProfileSettings'

// Every section is a tab in the bar (order = Alt+1…7 in Layout).
export const NAV = [
  { to: '/', label: 'Home', desc: 'Up next, recommendations, what is airing' },
  { to: '/library', label: 'My List', desc: "Everything you've watched, are watching or plan to watch" },
  { to: '/browse', label: 'Browse', desc: 'Every anime — filter by dub, airing, genre, year' },
  { to: '/seasonal', label: 'Seasonal', desc: "What's airing each season" },
  { to: '/calendar', label: 'Calendar', desc: 'Upcoming episodes for your shows' },
  { to: '/for-you', label: 'For You', desc: 'Recommendations from your library' },
  { to: '/coming-for-you', label: 'Sequels', desc: 'Sequels & spin-offs of shows you watched' },
]
// Airing sync runs once per app session (TopNav mounts on several pages).
let syncStarted = false

const Icon = {
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>,
  stats: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>,
  gear: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>,
  bell: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>,
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, close])
  return ref
}

/** Crunchyroll-style top navigation. `overlay` makes it transparent over a hero banner. */
export default function TopNav({ overlay = false }: { overlay?: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menu, setMenu] = useState<'bell' | null>(null)
  const { notifications, unreadCount, addNotification, markAllRead, clearAll } = useNotifications()
  const close = () => setMenu(null)
  const profile = useProfile()
  const bellRef = useOutside(menu === 'bell', close)

  useEffect(close, [location.pathname])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setPaletteOpen(true) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Sync airing schedules once per app start and feed notifications.
  useEffect(() => {
    if (syncStarted) return
    syncStarted = true
    const run = async () => {
      try {
        const { notifications: notifs } = await syncAiringSchedules()
        const { notify } = await loadProfile() // Settings → Profile → Notifications
        for (const n of notifs) if (n.type === 'sequel' ? notify.sequels : notify.episodes) addNotification(n)
      } catch { /* offline */ }
      // English dub news for shows in your lists (new dubs, dubs that finished).
      try {
        const library = await window.api.db.getLibrary()
        if ((await loadProfile()).notify.dubs) for (const c of await dubChanges(library)) addNotification({ type: 'dub', ...c })
      } catch { /* offline */ }
    }
    run()
    // Re-sync every 3 hours so newly announced / delayed episodes are picked up while the app stays open.
    setInterval(run, 3 * 3_600_000) // app-lifetime timer; started once
  }, [addNotification])

  const link = (active: boolean) =>
    `relative flex h-full shrink-0 items-center whitespace-nowrap px-3 xl:px-4 text-sm font-semibold transition-colors ${active ? 'text-text-1' : 'text-text-2 hover:text-text-1'}
     after:absolute after:bottom-0 after:left-3 after:right-3 after:h-[3px] after:rounded-full ${active ? 'after:bg-accent' : 'after:bg-transparent'}`
  const iconBtn = 'relative flex h-10 w-10 items-center justify-center rounded-full text-text-2 hover:text-text-1 hover:bg-white/5 transition-colors'

  return (
    <>
      <header
        className={`sticky top-0 z-40 flex h-[60px] shrink-0 items-stretch px-4 lg:px-8 transition-colors duration-300 ${
          overlay ? 'bg-gradient-to-b from-black/70 to-transparent' : 'bg-bg-1 border-b border-border shadow-[0_2px_12px_rgba(0,0,0,.35)]'
        }`}
      >
        {/* Logo */}
        <button onClick={() => navigate('/')} className="mr-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-black text-white">先</span>
          <span className="font-display text-lg font-bold tracking-wide text-text-1 hidden sm:block">SENPAI</span>
        </button>

        <nav className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} title={n.desc} className={({ isActive }) => link(isActive)}>{n.label}</NavLink>
          ))}
        </nav>

        <div className="min-w-2 flex-1" />

        <div className="flex shrink-0 items-center gap-1">
          {/* Search: a real box on wide windows, an icon on narrow ones */}
          <button onClick={() => setPaletteOpen(true)} title="Search any anime (Ctrl+K)"
            className="mr-1 hidden h-9 w-56 items-center gap-2 rounded-full border border-border bg-black/30 px-3 text-sm text-text-3 transition-colors hover:border-accent hover:text-text-1 xl:flex">
            {Icon.search}<span className="flex-1 text-left">Search anime…</span><kbd className="font-mono text-[10px] opacity-70">Ctrl K</kbd>
          </button>
          <button onClick={() => setPaletteOpen(true)} className={`${iconBtn} xl:hidden`} title="Search (Ctrl+K)">{Icon.search}</button>

          <div ref={bellRef} className="relative">
            <button
              onClick={() => { if (menu === 'bell' && unreadCount > 0) markAllRead(); setMenu(m => m === 'bell' ? null : 'bell') }}
              className={iconBtn} title="Notifications">
              {Icon.bell}
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            {menu === 'bell' && (
              <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-card border border-border bg-bg-1 shadow-2xl">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-sm font-semibold text-text-1">Notifications</span>
                  {notifications.length > 0 && <button onClick={clearAll} className="text-xs text-text-3 hover:text-text-1">Clear all</button>}
                </div>
                <div className="max-h-96 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <p className="px-3 py-8 text-center text-sm text-text-3">You're all caught up</p>
                  ) : notifications.map(n => (
                    <button key={n.id}
                      onClick={() => { if (n.animeId) { navigate(`/anime/${n.animeId}`); close() } }}
                      className={`w-full border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-bg-2 ${!n.read ? 'bg-accent/5' : ''}`}>
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.type === 'new_episode' ? 'bg-accent' : 'bg-status-completed'}`} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-text-1">{n.title}</p>
                          <p className="line-clamp-2 text-xs text-text-2">{n.body}</p>
                          <p className="mt-0.5 text-[10px] text-text-3">{new Date(n.createdAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => navigate('/stats')} title="Stats"
            className={`${iconBtn} ${location.pathname.startsWith('/stats') ? '!text-accent' : ''}`}>{Icon.stats}</button>
          <button onClick={() => navigate('/settings')} title="Settings"
            className={`${iconBtn} ${location.pathname.startsWith('/settings') ? '!text-accent' : ''}`}>{Icon.gear}</button>
          <button onClick={() => navigate('/settings?tab=profile')} title={profile.name ? `${profile.name} — profile` : 'Set up your profile'}
            className="ml-1 flex items-center gap-2 rounded-full p-1 pr-1 text-sm font-semibold text-text-2 hover:bg-white/5 hover:text-text-1 2xl:pr-3">
            <Avatar profile={profile} />
            {profile.name && <span className="hidden max-w-[120px] truncate 2xl:block">{profile.name}</span>}
          </button>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}

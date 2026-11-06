import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import CommandPalette from './CommandPalette'
import { useNotifications } from '@/hooks/useNotifications'
import { syncAiringSchedules } from '@/lib/sync'
import { dubChanges } from '@/lib/dubs'

const BROWSE = [
  { to: '/browse', label: 'Browse All', desc: 'Every anime — filter by dub, airing, genre, year' },
  { to: '/seasonal', label: 'Seasonal', desc: "What's airing each season" },
  { to: '/calendar', label: 'Release Calendar', desc: 'Upcoming episodes for your shows' },
  { to: '/for-you', label: 'For You', desc: 'Recommendations from your library' },
  { to: '/coming-for-you', label: 'Coming for You', desc: 'Sequels & spin-offs you might miss' },
]
// Airing sync runs once per app session (TopNav mounts on several pages).
let syncStarted = false

const PROFILE = [
  { to: '/stats', label: 'Stats' },
  { to: '/library?status=completed', label: 'History' },
  { to: '/settings', label: 'Settings' },
]

const Icon = {
  search: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>,
  bookmark: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" /></svg>,
  bell: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>,
  chevron: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>,
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
  const [menu, setMenu] = useState<'browse' | 'bell' | 'profile' | null>(null)
  const { notifications, unreadCount, addNotification, markAllRead, clearAll } = useNotifications()
  const close = () => setMenu(null)
  const browseRef = useOutside(menu === 'browse', close)
  const bellRef = useOutside(menu === 'bell', close)
  const profileRef = useOutside(menu === 'profile', close)

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
        for (const n of notifs) addNotification(n)
      } catch { /* offline */ }
      // English dub news for shows in your lists (new dubs, dubs that finished).
      try {
        const library = await window.api.db.getLibrary()
        for (const c of await dubChanges(library)) addNotification({ type: 'dub', ...c })
      } catch { /* offline */ }
    }
    run()
    // Re-sync every 3 hours so newly announced / delayed episodes are picked up while the app stays open.
    setInterval(run, 3 * 3_600_000) // app-lifetime timer; started once
  }, [addNotification])

  const browseActive = BROWSE.some(b => location.pathname.startsWith(b.to))
  const link = (active: boolean) =>
    `relative flex h-full items-center px-4 text-sm font-semibold transition-colors ${active ? 'text-text-1' : 'text-text-2 hover:text-text-1'}
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

        <nav className="flex items-stretch">
          <NavLink to="/" end className={({ isActive }) => link(isActive)}>Home</NavLink>

          <div ref={browseRef} className="relative flex">
            <button onClick={() => setMenu(m => m === 'browse' ? null : 'browse')} className={`${link(browseActive || menu === 'browse')} gap-1`}>
              Browse {Icon.chevron}
            </button>
            {menu === 'browse' && (
              <div className="absolute left-0 top-full w-72 rounded-b-card border border-border bg-bg-1 p-2 shadow-2xl">
                {BROWSE.map(b => (
                  <NavLink key={b.to} to={b.to}
                    className={({ isActive }) => `block rounded-card px-3 py-2.5 hover:bg-bg-2 ${isActive ? 'text-accent' : 'text-text-1'}`}>
                    <span className="block text-sm font-semibold">{b.label}</span>
                    <span className="block text-xs text-text-3">{b.desc}</span>
                  </NavLink>
                ))}
              </div>
            )}
          </div>

        </nav>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <button onClick={() => setPaletteOpen(true)} className={iconBtn} title="Search (Ctrl+K)">{Icon.search}</button>
          <button onClick={() => navigate('/library')} title="My Lists (watching, watchlist, completed…)"
            className={`${iconBtn} ${location.pathname.startsWith('/library') ? '!text-accent' : ''}`}>{Icon.bookmark}</button>

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

          <div ref={profileRef} className="relative">
            <button onClick={() => setMenu(m => m === 'profile' ? null : 'profile')}
              className="ml-1 flex items-center gap-1 rounded-full p-1 text-text-2 hover:bg-white/5 hover:text-text-1">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-accent to-status-completed text-xs font-bold text-white">S</span>
              {Icon.chevron}
            </button>
            {menu === 'profile' && (
              <div className="absolute right-0 mt-2 w-52 overflow-hidden rounded-card border border-border bg-bg-1 p-1 shadow-2xl">
                {PROFILE.map(p => (
                  <button key={p.to} onClick={() => navigate(p.to)}
                    className="block w-full rounded px-3 py-2 text-left text-sm text-text-2 hover:bg-bg-2 hover:text-text-1">
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}

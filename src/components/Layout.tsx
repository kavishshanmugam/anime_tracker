import { Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import TopNav from './TopNav'

// Pages with a full-bleed hero banner: the nav floats transparently over it until you scroll.
const HERO_ROUTES = [/^\/$/, /^\/anime\/[^/]+$/]

// Scroll position per history entry, so Back returns exactly where you were.
const scrollByKey = new Map<string, number>()

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const navType = useNavigationType()
  const mainRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const hero = HERO_ROUTES.some(r => r.test(location.pathname))

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Escape' && !document.querySelector('[data-command-palette]')) { navigate(-1); return }
      if (e.altKey && e.key >= '1' && e.key <= '7') {
        const routes = ['/', '/coming-for-you', '/library', '/calendar', '/for-you', '/seasonal', '/stats']
        navigate(routes[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  // New page → top. Back/forward → restore where you were (retry while rows load in).
  useEffect(() => {
    const el = mainRef.current
    if (!el) return
    const target = navType === 'POP' ? scrollByKey.get(location.key) ?? 0 : 0
    el.scrollTo({ top: target })
    setScrolled(target > 40)
    if (!target) return
    let tries = 0
    const t = setInterval(() => {
      if (Math.abs(el.scrollTop - target) < 4 || ++tries > 20) { clearInterval(t); return }
      el.scrollTo({ top: target })
    }, 100)
    return () => clearInterval(t)
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="h-screen overflow-hidden bg-bg-0">
      <main
        ref={mainRef}
        onScroll={e => { const top = (e.target as HTMLElement).scrollTop; setScrolled(top > 40); scrollByKey.set(location.key, top) }}
        className="h-full overflow-y-auto overflow-x-hidden [overflow-anchor:none]"
      >
        <TopNav overlay={hero && !scrolled} />
        {/* Hero pages pull up under the transparent nav; others get the standard page frame. */}
        <div className={hero ? '-mt-[60px]' : 'mx-auto max-w-[1600px] px-4 py-8 lg:px-10'}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

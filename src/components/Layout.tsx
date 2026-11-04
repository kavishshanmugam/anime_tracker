import { Outlet, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function Layout() {
  const navigate = useNavigate()

  // ponytail: global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // Don't navigate back if a modal/palette is open (they handle Escape themselves)
      if (e.key === 'Escape' && !document.querySelector('[data-command-palette]')) { navigate(-1); return }
      // Alt+1-7 for nav
      if (e.altKey && e.key >= '1' && e.key <= '7') {
        const routes = ['/', '/coming-for-you', '/library', '/calendar', '/for-you', '/seasonal', '/stats']
        navigate(routes[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  return (
    <div className="flex h-screen overflow-hidden bg-bg-0">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

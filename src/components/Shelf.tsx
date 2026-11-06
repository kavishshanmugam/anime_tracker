import { useRef, useState, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

/** Horizontal scrolling row with a title, optional "View all" link and paging arrows. */
export default function Shelf({ title, subtitle, viewAll, children }: {
  title: string
  subtitle?: string
  viewAll?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const rowRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const update = () => {
    const el = rowRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }
  useEffect(() => {
    update()
    const el = rowRef.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [children])

  const page = (dir: 1 | -1) => {
    const el = rowRef.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }
  const arrow = 'absolute top-0 bottom-8 z-10 hidden w-12 items-center justify-center text-3xl text-white transition-opacity md:flex'

  return (
    <section className="group/shelf relative">
      <div className="mb-3 flex items-end justify-between px-4 lg:px-10">
        <div>
          <h2 className="font-display text-xl font-bold text-text-1">{title}</h2>
          {subtitle && <p className="text-sm text-text-3">{subtitle}</p>}
        </div>
        {viewAll && (
          <button onClick={() => navigate(viewAll)} className="text-sm font-semibold uppercase tracking-wide text-text-3 hover:text-accent">
            View all ›
          </button>
        )}
      </div>
      <div className="relative">
        {canLeft && (
          <button onClick={() => page(-1)} aria-label="Previous"
            className={`${arrow} left-0 bg-gradient-to-r from-bg-0 to-transparent opacity-0 group-hover/shelf:opacity-100`}>‹</button>
        )}
        <div ref={rowRef} onScroll={update}
          className="flex gap-4 overflow-x-auto scroll-smooth px-4 pb-2 lg:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
        {canRight && (
          <button onClick={() => page(1)} aria-label="Next"
            className={`${arrow} right-0 bg-gradient-to-l from-bg-0 to-transparent opacity-0 group-hover/shelf:opacity-100`}>›</button>
        )}
      </div>
    </section>
  )
}

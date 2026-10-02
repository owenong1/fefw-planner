import Fuse from 'fuse.js'
import { useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { classes, classSpoiler, paralogues, skills, skillSpoiler, units } from '../data'
import { useSettings } from '../lib/settings'
import { SpoilerToggle } from './Spoiler'

const NAV = [
  { to: '/units', label: 'Units' },
  { to: '/classes', label: 'Classes' },
  { to: '/skills', label: 'Skills' },
  { to: '/routes/cai', label: 'Routes', match: '/routes' },
  { to: '/paralogues', label: 'Paralogues' },
  { to: '/builder', label: 'Army Builder' },
  { to: '/rng', label: 'RNG Checker' },
]

type Hit = { kind: string; name: string; to: string; spoiler: number }

function GlobalSearch() {
  const { spoilerLevel } = useSettings()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const fuse = useMemo(() => {
    const items: Hit[] = [
      ...units.map((u) => ({ kind: 'Unit', name: u.name, to: `/units/${u.id}`, spoiler: u.spoiler })),
      ...classes.map((c) => ({ kind: 'Class', name: c.name, to: `/classes/${c.id}`, spoiler: classSpoiler(c) })),
      ...skills.map((s) => ({ kind: 'Skill', name: s.name, to: `/skills?q=${encodeURIComponent(s.name)}`, spoiler: skillSpoiler(s.id) })),
      ...paralogues.map((p) => ({ kind: 'Paralogue', name: p.name, to: `/paralogues#${p.id}`, spoiler: 0 })),
    ]
    return new Fuse(items, { keys: ['name'], threshold: 0.3 })
  }, [])

  const hits = q.trim()
    ? fuse.search(q.trim(), { limit: 12 }).map((r) => r.item).filter((h) => h.spoiler <= spoilerLevel).slice(0, 8)
    : []

  function go(h: Hit) {
    navigate(h.to)
    setQ('')
    inputRef.current?.blur()
  }

  return (
    <div className="relative min-w-0 flex-1 xl:w-56 xl:flex-none">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1))
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          else if (e.key === 'Enter' && hits[active]) go(hits[active])
          else if (e.key === 'Escape') setQ('')
        }}
        placeholder="Search units, classes, skills…"
        aria-label="Search"
        className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm placeholder:text-muted focus:outline-2 focus:outline-accent"
      />
      {hits.length > 0 && (
        <ul className="absolute right-0 left-0 z-20 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-xl">
          {hits.map((h, i) => (
            <li key={h.kind + h.to}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(h)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${i === active ? 'bg-surface-2' : ''}`}
              >
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-muted">{h.kind}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="font-display text-lg font-bold tracking-wide whitespace-nowrap">
            Fortune's Weave <span className="text-accent">Planner</span>
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) => {
                  const on = isActive || (n.match && pathname.startsWith(n.match))
                  return `rounded-md px-2.5 py-1 font-medium ${on ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`
                }}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex w-full min-w-0 items-center gap-2 xl:ml-auto xl:w-auto">
            <GlobalSearch />
            <SpoilerToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted">
        Unofficial fan project. Fire Emblem is © Nintendo / Intelligent Systems. Data compiled from{' '}
        <a className="underline" href="https://game8.co/games/Fire-Emblem-Fortunes-Weave" target="_blank" rel="noreferrer">Game8</a> and the{' '}
        <a className="underline" href="https://fortunesweave.wiki.fextralife.com/" target="_blank" rel="noreferrer">Fextralife wiki</a>.
      </footer>
    </div>
  )
}

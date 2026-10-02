import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { MergePlanner, type MergeCandidate } from '../components/MergePlanner'
import { Avatar, Card, Empty, PageHeader, RouteDot, SectionTitle } from '../components/ui'
import { routes, timingLabel, units } from '../data'
import type { Recruitment, Unit } from '../data/schema'
import { useArmy } from '../lib/army'
import { useSettings } from '../lib/settings'

type Entry = { unit: Unit; r: Recruitment }
type ChipState = 'lord' | 'auto' | 'on' | 'off'

const AUTO_ROW = 0

/** Part I entries on one route: the only recruits that differ between routes. */
function partOneEntries(routeId: string, spoilerLevel: number): Entry[] {
  return units
    .filter((u) => u.spoiler <= spoilerLevel)
    .flatMap((u) => u.recruitment.filter((r) => r.route === routeId && r.part === 1).map((r) => ({ unit: u, r })))
    .sort((a, b) => (a.r.chapter ?? 0) - (b.r.chapter ?? 0) || (a.r.support ?? 0) - (b.r.support ?? 0) || a.unit.order - b.unit.order)
}

function rowOf(r: Recruitment) {
  return r.method === 'automatic' ? AUTO_ROW : (r.renown ?? AUTO_ROW)
}

function entryTitle(e: Entry, routeName: string) {
  const { r } = e
  const req = r.method === 'automatic' ? 'joins automatically' : `Support ${r.support} · Renown ${r.renown}`
  return `${e.unit.name} — ${routeName}\n${timingLabel(r)}, ${req}`
}

const tint = (route: string, pct: number) => `color-mix(in oklab, var(--route-${route}) ${pct}%, transparent)`

function UnitChip({
  unit, state, route, size = 38, title, hovered, onHover, onClick,
}: {
  unit: Unit
  state: ChipState
  route?: string
  size?: number
  title?: string
  hovered: string | null
  onHover: (id: string | null) => void
  onClick?: () => void
}) {
  const color = route ? `var(--route-${route})` : 'var(--muted)'
  const active = state !== 'off'
  const isHovered = hovered === unit.id
  const dimmed = hovered != null && !isHovered
  const ring: CSSProperties = active ? { boxShadow: `0 0 0 2px var(--surface), 0 0 0 4px ${color}` } : {}
  const badge = state === 'lord' ? '♛' : state === 'auto' ? '★' : state === 'on' ? '✓' : null

  return (
    <button
      type="button"
      title={title ?? unit.name}
      aria-pressed={onClick ? state === 'on' : undefined}
      aria-disabled={!onClick || undefined}
      onClick={onClick}
      onMouseEnter={() => onHover(unit.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(unit.id)}
      onBlur={() => onHover(null)}
      className={`group flex w-14 flex-col items-center gap-1 rounded-lg p-1 transition duration-150 focus-visible:outline-2 focus-visible:outline-accent
        ${onClick ? 'cursor-pointer' : 'cursor-default'}
        ${isHovered ? 'z-10 scale-110' : ''}
        ${dimmed ? 'opacity-30' : ''}`}
    >
      <span
        className={`relative rounded-full transition duration-150 ${active ? '' : 'opacity-55 grayscale group-hover:opacity-100 group-hover:grayscale-0'}`}
        style={ring}
      >
        <Avatar name={unit.name} id={unit.id} size={size} />
        {badge && (
          <span
            aria-hidden
            className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full text-[9px] font-bold text-white"
            style={{ background: color, boxShadow: '0 0 0 2px var(--surface)' }}
          >
            {badge}
          </span>
        )}
      </span>
      <span className={`w-full truncate text-center text-[10px] leading-tight ${active ? 'font-semibold text-ink' : 'text-muted'}`}>
        {unit.name}
      </span>
    </button>
  )
}

function Legend() {
  const item = (label: string, el: ReactNode) => (
    <span className="inline-flex items-center gap-1.5">{el}{label}</span>
  )
  const dot = (cls: string, style?: CSSProperties) => <span className={`inline-block size-3 rounded-full ${cls}`} style={style} />
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {item('Not recruited', dot('bg-muted/50'))}
      {item('Recruited', dot('', { background: 'var(--accent)' }))}
      {item('Joins automatically', <span className="font-bold text-ink">★</span>)}
      {item('Lord', <span className="font-bold text-ink">♛</span>)}
      <span>Hover a unit to see it on every route.</span>
    </div>
  )
}

export function BuilderPage() {
  const { spoilerLevel } = useSettings()
  const { army, toggle, clear, finalClasses, setFinalClass } = useArmy()
  const [hovered, setHovered] = useState<string | null>(null)

  const byRoute = useMemo(
    () => Object.fromEntries(routes.map((r) => [r.id, partOneEntries(r.id, spoilerLevel)])),
    [spoilerLevel],
  )

  const renownRows = useMemo(() => {
    const levels = routes.flatMap((r) => byRoute[r.id].filter((e) => e.r.method !== 'automatic').map((e) => rowOf(e.r)))
    if (!levels.length) return []
    const lo = Math.min(...levels)
    const hi = Math.max(...levels)
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  }, [byRoute])

  const stateOf = (route: string, e: Entry): ChipState =>
    e.unit.lord ? 'lord' : e.r.method === 'automatic' ? 'auto' : army[route].includes(e.unit.id) ? 'on' : 'off'

  /** The resolved army per route, ignoring stale saved ids that aren't recruitable there. */
  const armies = useMemo(
    () =>
      Object.fromEntries(
        routes.map((route) => {
          const entries = byRoute[route.id]
          const auto = entries.filter((e) => e.r.method === 'automatic').sort((a, b) => Number(b.unit.lord) - Number(a.unit.lord))
          const picked = entries
            .filter((e) => e.r.method !== 'automatic' && army[route.id].includes(e.unit.id))
            .sort((a, b) => rowOf(a.r) - rowOf(b.r) || a.unit.order - b.unit.order)
          return [route.id, { auto, picked }]
        }),
      ),
    [byRoute, army],
  )

  const unrecruited = useMemo(() => {
    const joined = new Set<string>()
    for (const route of routes) {
      for (const e of [...armies[route.id].auto, ...armies[route.id].picked]) joined.add(e.unit.id)
    }
    const candidates = new Map<string, Unit>()
    for (const route of routes) for (const e of byRoute[route.id]) candidates.set(e.unit.id, e.unit)
    return [...candidates.values()].filter((u) => !joined.has(u.id)).sort((a, b) => a.order - b.order)
  }, [armies, byRoute])

  /** Units in two or more routes' armies, whose copies merge in Part III. */
  const mergeCandidates = useMemo(() => {
    const onRoutes = new Map<string, MergeCandidate>()
    for (const route of routes) {
      for (const e of [...armies[route.id].auto, ...armies[route.id].picked]) {
        const c = onRoutes.get(e.unit.id) ?? { unit: e.unit, routes: [] }
        c.routes.push(route.id)
        onRoutes.set(e.unit.id, c)
      }
    }
    return [...onRoutes.values()].filter((c) => c.routes.length > 1).sort((a, b) => a.unit.order - b.unit.order)
  }, [armies])

  const totalPicked = routes.reduce((n, r) => n + armies[r.id].picked.length, 0)

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Army Builder"
        subtitle="Pick who you'll recruit on each lord's route. Rows are the Renown level each unit needs on that route; click a unit to add it to that route's army."
      >
        {totalPicked > 0 && (
          <button
            onClick={() => window.confirm('Clear every route’s recruits?') && clear()}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:border-bad hover:text-bad"
          >
            Reset all
          </button>
        )}
      </PageHeader>

      {/* Renown × route grid */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <SectionTitle>Recruitment by renown</SectionTitle>
          <Legend />
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <div
            role="table"
            aria-label="Recruitable units by route and renown"
            className="grid min-w-[46rem]"
            style={{ gridTemplateColumns: `4.5rem repeat(${routes.length}, minmax(0, 1fr))` }}
          >
            <div role="row" className="contents">
              <div role="columnheader" className="border-b border-line" />
              {routes.map((route) => (
                <div
                  role="columnheader"
                  key={route.id}
                  className="border-b border-l border-line px-3 pt-3 pb-2"
                  style={{ borderTop: `4px solid var(--route-${route.id})`, background: tint(route.id, 10) }}
                >
                  <Link to={`/routes/${route.id}`} className="flex items-center gap-1.5 font-display font-bold hover:underline">
                    <RouteDot route={route.id} />
                    {route.name}
                  </Link>
                  <p className="text-xs text-muted">
                    {route.army} · <span className="tabular">{armies[route.id].auto.length + armies[route.id].picked.length}</span> units
                  </p>
                </div>
              ))}
            </div>

            {[AUTO_ROW, ...renownRows].map((row, i) => (
              <div role="row" key={row} className="contents">
                <div
                  role="rowheader"
                  className={`flex flex-col items-center justify-center border-line px-1 py-2 text-center ${i > 0 ? 'border-t' : ''} ${i % 2 ? 'bg-surface-2/50' : ''}`}
                >
                  {row === AUTO_ROW ? (
                    <span className="text-[10px] font-semibold tracking-wider text-muted uppercase">Auto</span>
                  ) : (
                    <>
                      <span className="text-[9px] font-semibold tracking-wider text-muted uppercase">Renown</span>
                      <span className="tabular font-display text-2xl leading-none font-bold">{row}</span>
                    </>
                  )}
                </div>
                {routes.map((route) => {
                  const cell = byRoute[route.id].filter((e) => rowOf(e.r) === row)
                  return (
                    <div
                      role="cell"
                      key={route.id}
                      className={`flex flex-wrap content-start gap-0.5 border-l border-line p-1.5 ${i > 0 ? 'border-t' : ''}`}
                      style={{ background: i % 2 ? tint(route.id, 7) : tint(route.id, 3) }}
                    >
                      {cell.length === 0 && <span className="self-center px-2 text-xs text-muted/50">—</span>}
                      {cell.map((e) => {
                        const state = stateOf(route.id, e)
                        return (
                          <UnitChip
                            key={e.unit.id}
                            unit={e.unit}
                            state={state}
                            route={route.id}
                            title={entryTitle(e, route.name)}
                            hovered={hovered}
                            onHover={setHovered}
                            onClick={state === 'on' || state === 'off' ? () => toggle(route.id, e.unit.id) : undefined}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Units not in any army */}
      <Card>
        <div className="flex items-baseline justify-between gap-2">
          <SectionTitle>Unrecruited on every route</SectionTitle>
          <span className="tabular text-xs text-muted">{unrecruited.length}</span>
        </div>
        {unrecruited.length ? (
          <div className="flex flex-wrap gap-0.5">
            {unrecruited.map((u) => {
              const where = routes
                .flatMap((route) => byRoute[route.id].filter((e) => e.unit.id === u.id).map((e) => `${route.name}: Renown ${e.r.renown}`))
                .join('\n')
              return (
                <UnitChip key={u.id} unit={u} state="off" title={`${u.name}\n${where}`} hovered={hovered} onHover={setHovered} />
              )
            })}
          </div>
        ) : (
          <Empty>Every recruitable unit is in at least one route’s army.</Empty>
        )}
      </Card>

      {/* Per-route army */}
      <section>
        <SectionTitle>Armies</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {routes.map((route) => {
            const { auto, picked } = armies[route.id]
            const groups: { label: string; items: Unit[]; removable?: boolean }[] = [
              { label: 'Automatic', items: auto.map((e) => e.unit) },
              { label: 'Recruited', items: picked.map((e) => e.unit), removable: true },
            ]
            return (
              <div
                key={route.id}
                className="flex flex-col rounded-xl border border-line bg-surface"
                style={{ borderTop: `4px solid var(--route-${route.id})` }}
              >
                <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
                  <h3 className="font-display font-bold">{route.army}</h3>
                  <span className="tabular text-xs text-muted">{auto.length + picked.length}</span>
                </div>
                <div className="grid gap-3 p-3">
                  {groups.map((g) => (
                    <div key={g.label}>
                      <p className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-muted uppercase">
                        {g.label} <span className="tabular font-normal">· {g.items.length}</span>
                      </p>
                      {g.items.length ? (
                        <div className="flex flex-wrap gap-0.5">
                          {g.items.map((u) => (
                            <UnitChip
                              key={u.id}
                              unit={u}
                              size={32}
                              state={u.lord ? 'lord' : g.removable ? 'on' : 'auto'}
                              route={route.id}
                              title={g.removable ? `${u.name} — click to remove` : u.name}
                              hovered={hovered}
                              onHover={setHovered}
                              onClick={g.removable ? () => toggle(route.id, u.id) : undefined}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="px-1 text-xs text-muted">
                          {g.removable ? 'Click units in the grid above to add them.' : 'None'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {picked.length > 0 && (
                  <button
                    onClick={() => clear(route.id)}
                    className="mt-auto border-t border-line px-4 py-2 text-left text-xs font-medium text-muted hover:text-bad"
                  >
                    Clear recruits
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <MergePlanner candidates={mergeCandidates} finalClasses={finalClasses} setFinalClass={setFinalClass} />
    </div>
  )
}

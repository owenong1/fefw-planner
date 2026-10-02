import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ClassSelect } from '../components/ClassSelect'
import { MergePlanner, type MergeCandidate } from '../components/MergePlanner'
import { Avatar, Card, ClassIcon, Empty, PageHeader, RouteDot, SectionTitle } from '../components/ui'
import { classById, routeById, routes, timingLabel, unitById, units } from '../data'
import type { Recruitment, Unit } from '../data/schema'
import { mergeCardId, useArmy } from '../lib/army'
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
      // Mouse and keyboard only: a tap would leave every other unit dimmed until the next tap elsewhere.
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHover(unit.id)
      }}
      onPointerLeave={() => onHover(null)}
      onFocus={(e) => {
        if (e.currentTarget.matches(':focus-visible')) onHover(unit.id)
      }}
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

/** One unit in a route's army: the chip, its planned final class, and the other armies its copy merges with. */
function ArmyMember({
  unit, route, state, cls, mergesWith, hovered, onHover, onRemove, onClass,
}: {
  unit: Unit
  route: string
  state: ChipState
  cls: string
  mergesWith: string[]
  hovered: string | null
  onHover: (id: string | null) => void
  onRemove?: () => void
  onClass: (cls: string) => void
}) {
  const picked = cls ? classById.get(cls) : undefined
  return (
    <li className="flex w-44 shrink-0 snap-start flex-col items-center gap-1.5 rounded-lg border border-line p-2 md:w-36" style={{ background: tint(route, 5) }}>
      <div className="flex items-start justify-center">
        <UnitChip
          unit={unit}
          state={state}
          route={route}
          title={onRemove ? `${unit.name} — click to remove` : unit.name}
          hovered={hovered}
          onHover={onHover}
          onClick={onRemove}
        />
        {/* Sized and offset to sit level with the portrait and its route ring */}
        {picked && (
          <span title={picked.name} className="mt-px flex">
            <ClassIcon name={picked.name} id={picked.id} size={44} />
          </span>
        )}
      </div>
      <div className="flex w-full">
        <ClassSelect unit={unit} value={cls} onChange={onClass} emptyLabel="No class" />
      </div>
      {mergesWith.length > 0 && (
        <button
          type="button"
          onClick={() => document.getElementById(mergeCardId(unit.id))?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          title={`Also in ${mergesWith.map((r) => routeById.get(r)?.army).join(', ')}. Jump to the merge plan.`}
          className="flex items-center gap-1 rounded py-1 text-xs font-medium text-muted hover:text-accent focus-visible:outline-2 focus-visible:outline-accent md:py-0 md:text-[10px]"
        >
          Merges with
          {mergesWith.map((r) => <RouteDot key={r} route={r} />)}
        </button>
      )}
    </li>
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
      <span className="[@media(hover:none)]:hidden">Hover a unit to see it on every route.</span>
    </div>
  )
}

export function BuilderPage() {
  const { spoilerLevel } = useSettings()
  const { army, toggle, clear, finalClasses, setFinalClass } = useArmy()
  const [hovered, setHovered] = useState<string | null>(null)
  /** The one route the grid shows below `md`, where four columns don't fit. */
  const [shownRoute, setShownRoute] = useState(routes[0].id)

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

  const mergeRoutes = useMemo(() => new Map(mergeCandidates.map((c) => [c.unit.id, c.routes])), [mergeCandidates])

  const totalPicked = routes.reduce((n, r) => n + armies[r.id].picked.length, 0)

  return (
    <div className="grid grid-cols-1 gap-8">
      <PageHeader
        title="Army Builder"
        subtitle="Pick who you'll recruit on each lord's route. Rows are the Renown level each unit needs on that route; click a unit to add it to that route's army, then choose its final class in the army list."
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
        {/* overflow-clip rather than hidden, so the route tabs can stick to the viewport */}
        <div className="overflow-clip rounded-xl border border-line bg-surface">
          <div
            role="tablist"
            aria-label="Route shown in the grid"
            className="sticky top-0 z-20 grid border-b border-line bg-surface md:hidden"
            style={{ gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))` }}
          >
            {routes.map((route) => {
              const on = route.id === shownRoute
              return (
                <button
                  key={route.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  title={route.name}
                  onClick={() => setShownRoute(route.id)}
                  className={`flex min-w-0 flex-col items-center px-1 pt-1.5 pb-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${on ? 'text-ink' : 'text-muted'}`}
                  style={{ borderTop: `4px solid var(--route-${route.id})`, background: on ? tint(route.id, 16) : undefined }}
                >
                  <span className="w-full truncate text-center font-display text-xs font-bold sm:text-sm">{unitById.get(route.id)?.name ?? route.name}</span>
                  <span className="tabular text-[11px] text-muted">{armies[route.id].auto.length + armies[route.id].picked.length} units</span>
                </button>
              )
            })}
          </div>
          <div
            role="table"
            aria-label="Recruitable units by route and renown"
            className="grid grid-cols-[3.25rem_minmax(0,1fr)] md:grid-cols-[4.5rem_repeat(var(--route-count),minmax(0,1fr))]"
            style={{ '--route-count': routes.length } as CSSProperties}
          >
            <div role="row" className="contents max-md:hidden">
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
                      className={`grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] content-start justify-items-center gap-0.5 border-l border-line p-1.5 md:flex md:flex-wrap ${i > 0 ? 'border-t' : ''} ${route.id === shownRoute ? '' : 'max-md:hidden'}`}
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
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <SectionTitle>Armies</SectionTitle>
          <p className="text-xs text-muted">Choose a final class for each unit. The merge planner below uses the same choices.</p>
        </div>
        <div className="grid gap-3">
          {routes.map((route) => {
            const { auto, picked } = armies[route.id]
            const planned = [...auto, ...picked].filter((e) => finalClasses[route.id][e.unit.id]).length
            return (
              <div
                key={route.id}
                className="min-w-0 rounded-xl border border-line bg-surface"
                style={{ borderLeft: `4px solid var(--route-${route.id})` }}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-3">
                  <h3 className="font-display font-bold">{route.army}</h3>
                  <span className="tabular text-xs text-muted">
                    {auto.length + picked.length} units · {picked.length} recruited · {planned} with a class
                  </span>
                  {picked.length > 0 && (
                    <button onClick={() => clear(route.id)} className="-my-1 ml-auto py-1 text-xs font-medium text-muted hover:text-bad">
                      Clear recruits
                    </button>
                  )}
                </div>
                <ul aria-label={`${route.army} units`} className="flex snap-x scroll-px-3 gap-2 overflow-x-auto p-3">
                  {[...auto, ...picked].map((e) => {
                    const state = stateOf(route.id, e)
                    return (
                      <ArmyMember
                        key={e.unit.id}
                        unit={e.unit}
                        route={route.id}
                        state={state}
                        cls={finalClasses[route.id][e.unit.id] ?? ''}
                        mergesWith={(mergeRoutes.get(e.unit.id) ?? []).filter((r) => r !== route.id)}
                        hovered={hovered}
                        onHover={setHovered}
                        onRemove={state === 'on' ? () => toggle(route.id, e.unit.id) : undefined}
                        onClass={(v) => setFinalClass(route.id, e.unit.id, v)}
                      />
                    )
                  })}
                  {picked.length === 0 && (
                    <li className="flex w-44 shrink-0 snap-start items-center rounded-lg border border-dashed border-line p-3 text-xs text-muted md:w-36">
                      Click units in the grid above to add them.
                    </li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      <MergePlanner candidates={mergeCandidates} finalClasses={finalClasses} setFinalClass={setFinalClass} />
    </div>
  )
}

import { useMemo } from 'react'
import { Link, NavLink, useParams, useSearchParams } from 'react-router'
import { RecruitmentDetail } from '../components/Recruitment'
import { Avatar, PageHeader, RouteDot, Segmented } from '../components/ui'
import { PART_LABELS, recruitmentOn, routeById, routes, units } from '../data'
import type { Recruitment, Unit } from '../data/schema'
import { useSettings } from '../lib/settings'
import { NotFoundPage } from './NotFoundPage'

type Group = 'chapter' | 'renown'

/** Sort key placing prologue first, then Part I chapters, then Part II/III. */
function timeKey(r: Recruitment) {
  return r.part * 1000 + (r.chapter ?? 0) * 10 + (r.section ?? 0)
}

export function RoutePage() {
  const { id } = useParams()
  const route = id ? routeById.get(id) : undefined
  const { spoilerLevel } = useSettings()
  const [params, setParams] = useSearchParams()
  const group = (params.get('group') as Group) ?? 'chapter'

  const groups = useMemo(() => {
    if (!route) return []
    const entries: { unit: Unit; r: Recruitment }[] = units
      .filter((u) => u.spoiler <= spoilerLevel)
      .flatMap((u) => recruitmentOn(u, route.id).map((r) => ({ unit: u, r })))
    const map = new Map<string, { label: string; key: number; items: typeof entries }>()
    for (const e of entries) {
      let key: number, label: string
      if (group === 'renown') {
        key = e.r.renown ?? (e.r.method === 'story' ? 99 : 0)
        label = e.r.renown != null ? `Renown ${e.r.renown}` : e.r.method === 'story' ? 'Story recruits (Part II / III)' : 'Joins automatically'
      } else {
        key = e.r.part * 1000 + (e.r.part === 1 ? (e.r.chapter ?? 0) : 0)
        label = e.r.part === 1 ? `Part I · Chapter ${e.r.chapter}` : PART_LABELS[e.r.part]
      }
      const g = map.get(label) ?? { label, key, items: [] }
      g.items.push(e)
      map.set(label, g)
    }
    return [...map.values()]
      .sort((a, b) => a.key - b.key)
      .map((g) => ({ ...g, items: g.items.sort((a, b) => timeKey(a.r) - timeKey(b.r) || (a.r.renown ?? 0) - (b.r.renown ?? 0)) }))
  }, [route, spoilerLevel, group])

  if (!route) return <NotFoundPage what="route" />
  const count = groups.reduce((n, g) => n + g.items.length, 0)

  return (
    <div>
      <PageHeader title={route.name} subtitle={`${route.army}. ${count} units can join on this route with your current spoiler setting.`}>
        <Segmented
          label="Group by"
          value={group}
          onChange={(v) => setParams(v === 'chapter' ? {} : { group: v }, { replace: true })}
          options={[{ value: 'chapter', label: 'By chapter' }, { value: 'renown', label: 'By renown' }]}
        />
      </PageHeader>

      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Routes">
        {routes.map((r) => (
          <NavLink
            key={r.id}
            to={`/routes/${r.id}${group === 'renown' ? '?group=renown' : ''}`}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium ${
                isActive ? 'border-transparent text-white' : 'border-line bg-surface text-muted hover:text-ink'
              }`
            }
            style={({ isActive }) => (isActive ? { background: `var(--route-${r.id})` } : undefined)}
          >
            <RouteDot route={r.id} />
            {r.name}
          </NavLink>
        ))}
      </nav>

      <ol className="grid gap-6">
        {groups.map((g) => (
          <li key={g.label}>
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
              <span className="h-px w-4" style={{ background: `var(--route-${route.id})` }} />
              {g.label}
              <span className="text-sm font-normal text-muted">({g.items.length})</span>
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map(({ unit, r }, i) => (
                <div key={unit.id + i} className="rounded-xl border border-line bg-surface p-3">
                  <Link to={`/units/${unit.id}`} className="mb-2 flex items-center gap-2 font-semibold hover:text-accent">
                    <Avatar name={unit.name} id={unit.id} size={28} />
                    {unit.name}
                  </Link>
                  <RecruitmentDetail r={r} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

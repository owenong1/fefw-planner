import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router'
import { RouteStrip } from '../components/Recruitment'
import { StatHeaders } from '../components/Stats'
import { growthColor } from '../lib/display'
import { Avatar, Empty, PageHeader, Segmented, Select } from '../components/ui'
import { canUseClass, classById, classes, classSpoiler, combinedGrowths, growthTotal, recruitmentOn, routes, units } from '../data'
import { CLASS_TIERS, STAT_KEYS } from '../data/constants'
import type { StatKey, Stats } from '../data/schema'
import { useSettings } from '../lib/settings'

type View = 'growths' | 'base'
type SortKey = StatKey | 'total' | 'name' | 'default'

export function UnitsPage() {
  const { spoilerLevel } = useSettings()
  const [params, setParams] = useSearchParams()
  const route = params.get('route') ?? 'any'
  const method = params.get('method') ?? 'any'
  const clsId = params.get('class') ?? ''
  const view = (params.get('view') as View) ?? 'growths'
  const q = params.get('q') ?? ''
  const sort = (params.get('sort') as SortKey) ?? 'default'
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc'
  const cls = classById.get(clsId)

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '' || v === 'any') next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const rows = useMemo(() => {
    const filtered = units.filter((u) => {
      if (u.spoiler > spoilerLevel) return false
      if (q && !u.name.toLowerCase().includes(q.toLowerCase())) return false
      const entries = route === 'any' ? u.recruitment : recruitmentOn(u, route)
      if (route !== 'any' && entries.length === 0) return false
      if (method !== 'any' && !entries.some((r) => r.method === method)) return false
      return true
    })
    const withStats = filtered.map((u) => {
      const stats: Stats | null = view === 'growths' ? combinedGrowths(u, cls) : u.baseStats
      return { unit: u, stats, total: stats ? growthTotal(stats) : null, blocked: cls ? !canUseClass(u, cls) : false }
    })
    if (sort === 'default') return withStats
    const sign = dir === 'asc' ? 1 : -1
    return [...withStats].sort((a, b) => {
      if (sort === 'name') return sign * a.unit.name.localeCompare(b.unit.name)
      const av = sort === 'total' ? a.total : a.stats?.[sort]
      const bv = sort === 'total' ? b.total : b.stats?.[sort]
      if (av == null) return 1
      if (bv == null) return -1
      return sign * (av - bv)
    })
  }, [spoilerLevel, q, route, method, view, cls, sort, dir])

  const onSort = (k: SortKey) => {
    if (sort === k) set({ dir: dir === 'asc' ? 'desc' : 'asc' })
    else set({ sort: k, dir: k === 'name' ? 'asc' : 'desc' })
  }

  const classOptions = [
    { value: '', label: 'No class (personal growths)' },
    ...CLASS_TIERS.flatMap((tier) =>
      classes
        .filter((c) => c.tier === tier && tier !== 'base' && (classSpoiler(c) <= spoilerLevel || c.id === clsId))
        .map((c) => ({ value: c.id, label: `${c.name} (${tier})` })),
    ),
  ]

  return (
    <div>
      <PageHeader
        title="Units"
        subtitle={
          view === 'growths'
            ? cls
              ? `Growth rates as a ${cls.name}: the unit's personal growths plus the class modifier.`
              : 'Personal growth rates. Pick a class to see the combined rate a unit would level with.'
            : 'Base stats at the listed level, before class bonuses. Only some units have published base stats so far.'
        }
      >
        <Segmented
          label="Stat view"
          value={view}
          onChange={(v) => set({ view: v === 'growths' ? null : v })}
          options={[{ value: 'growths', label: 'Growths' }, { value: 'base', label: 'Base stats' }]}
        />
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Name
          <input
            value={q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Filter…"
            className="w-40 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        </label>
        <Select
          label="Route"
          value={route}
          onChange={(v) => set({ route: v })}
          options={[{ value: 'any', label: 'Any route' }, ...routes.map((r) => ({ value: r.id, label: r.name }))]}
        />
        <Select
          label="How they join"
          value={method}
          onChange={(v) => set({ method: v })}
          options={[
            { value: 'any', label: 'Any' },
            { value: 'automatic', label: 'Automatic' },
            { value: 'recruit', label: 'Recruit (support + renown)' },
            { value: 'story', label: 'Story (Part II / III)' },
          ]}
        />
        {view === 'growths' && <Select label="Class" value={clsId} onChange={(v) => set({ class: v })} options={classOptions} />}
        <span className="ml-auto text-sm text-muted">{rows.length} units</span>
      </div>

      {rows.length === 0 ? (
        <Empty>No units match these filters.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left">
                  <button onClick={() => onSort('name')} className="font-semibold hover:text-ink">
                    Unit{sort === 'name' && (dir === 'asc' ? ' ▲' : ' ▼')}
                  </button>
                </th>
                <th className="px-2 py-2 text-left font-semibold" title="Cai · Dietrich · Theodora · Leda. R = renown needed.">
                  Routes
                </th>
                {view === 'base' && <th className="px-2 py-2 text-right font-semibold">Lv</th>}
                <StatHeaders onSort={onSort} sortKey={sort} dir={dir} />
                <th className="px-3 py-2 text-right">
                  <button onClick={() => onSort('total')} className="font-semibold hover:text-ink">
                    Total{sort === 'total' && (dir === 'asc' ? ' ▲' : ' ▼')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ unit, stats, total, blocked }) => (
                <tr key={unit.id} className={`border-b border-line last:border-0 hover:bg-surface-2/60 ${blocked ? 'opacity-45' : ''}`}>
                  <td className="px-3 py-1.5">
                    <Link to={`/units/${unit.id}`} className="flex items-center gap-2.5 font-semibold hover:text-accent">
                      <Avatar name={unit.name} id={unit.id} size={28} />
                      <span>
                        {unit.name}
                        {blocked && <span className="ml-1 text-xs font-normal text-bad">can't use class</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-1.5"><RouteStrip unit={unit} /></td>
                  {view === 'base' && <td className="tabular px-2 py-1.5 text-right text-muted">{unit.baseLevel ?? ''}</td>}
                  {stats
                    ? STAT_KEYS.map((k) => (
                        <td key={k} className="tabular px-2 py-1.5 text-right font-medium" style={view === 'growths' ? { color: growthColor(stats[k]) } : undefined}>
                          {stats[k]}
                        </td>
                      ))
                    : <td colSpan={STAT_KEYS.length} className="px-2 py-1.5 text-center text-xs text-muted">not documented yet</td>}
                  <td className="tabular px-3 py-1.5 text-right font-semibold">{total ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

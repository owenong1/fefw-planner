import { Link, useSearchParams } from 'react-router'
import { ModifierRow, StatHeaders } from '../components/Stats'
import { Badge, ClassIcon, PageHeader } from '../components/ui'
import { classes, classSpoiler, growthTotal } from '../data'
import { CLASS_TIERS, STAT_KEYS } from '../data/constants'
import type { GameClass, StatKey } from '../data/schema'
import { TIER_INFO, weaponReqText } from '../lib/display'
import { useSettings } from '../lib/settings'

type SortKey = StatKey | 'total' | 'name' | 'default'
const SORT_KEYS: readonly string[] = [...STAT_KEYS, 'total', 'name']

export function ClassesPage() {
  const { spoilerLevel } = useSettings()
  const [params, setParams] = useSearchParams()
  const rawSort = params.get('sort') ?? ''
  const sort: SortKey = SORT_KEYS.includes(rawSort) ? (rawSort as SortKey) : 'default'
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc'

  const setSort = (next: SortKey, nextDir: 'asc' | 'desc') => {
    const p = new URLSearchParams(params)
    if (next === 'default') {
      p.delete('sort')
      p.delete('dir')
    } else {
      p.set('sort', next)
      p.set('dir', nextDir)
    }
    setParams(p, { replace: true })
  }
  const onSort = (k: SortKey) => {
    if (sort === k) setSort(k, dir === 'asc' ? 'desc' : 'asc')
    else setSort(k, k === 'name' ? 'asc' : 'desc')
  }

  // Tiers stay grouped; the chosen column orders the classes inside each tier.
  const sorted = (list: GameClass[]) => {
    if (sort === 'default') return list
    const sign = dir === 'asc' ? 1 : -1
    const value = (c: GameClass) => (sort === 'total' ? growthTotal(c.growths) : c.growths[sort as StatKey])
    return [...list].sort((a, b) => (sort === 'name' ? sign * a.name.localeCompare(b.name) : sign * (value(a) - value(b))))
  }
  const arrow = (k: SortKey) => sort === k && (dir === 'asc' ? ' ▲' : ' ▼')
  const ariaSort = (k: SortKey) => (sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined)

  const visible = classes.filter((c) => classSpoiler(c) <= spoilerLevel)
  const hidden = classes.length - visible.length
  return (
    <div>
      <PageHeader
        title="Classes"
        subtitle={`Class growth modifiers are added to a unit's personal growth rates while they are in that class. Click a column to sort every tier by it.${
          hidden ? ` ${hidden} late-game classes are hidden by your spoiler setting.` : ''
        }`}
      >
        {sort !== 'default' && (
          <button
            onClick={() => setSort('default', 'desc')}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
          >
            Reset order
          </button>
        )}
      </PageHeader>
      <div className="grid gap-8">
        {CLASS_TIERS.map((tier) => {
          const list = sorted(visible.filter((c) => c.tier === tier))
          if (!list.length) return null
          return (
            <section key={tier}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                <h2 className="font-display text-xl font-bold">{TIER_INFO[tier].label}</h2>
                <span className="text-sm text-muted">{TIER_INFO[tier].blurb}</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[1040px] table-fixed text-sm">
                  {/* Fixed widths so the stat columns line up from one tier's table to the next. */}
                  <colgroup>
                    <col className="w-72" />
                    <col />
                    {STAT_KEYS.map((k) => <col key={k} className="w-14" />)}
                    <col className="w-20" />
                  </colgroup>
                  <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left" aria-sort={ariaSort('name')}>
                        <button onClick={() => onSort('name')} className="font-semibold hover:text-ink">
                          Class{arrow('name')}
                        </button>
                      </th>
                      <th className="px-2 py-2 text-left font-semibold">Weapon skills</th>
                      <StatHeaders onSort={onSort} sortKey={sort} dir={dir} />
                      <th className="px-3 py-2 text-right whitespace-nowrap" aria-sort={ariaSort('total')}>
                        <button onClick={() => onSort('total')} className="font-semibold hover:text-ink">
                          Total{arrow('total')}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => {
                      const total = growthTotal(c.growths)
                      return (
                        <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2.5">
                              <ClassIcon name={c.name} id={c.id} size={32} />
                              <span>
                                <Link to={`/classes/${c.id}`} className="font-semibold hover:text-accent">{c.name}</Link>
                                <span className="ml-2 inline-flex gap-1">
                                  {c.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-xs text-muted">{weaponReqText(c)}</td>
                          <ModifierRow stats={c.growths} highlight={sort} />
                          <td className={`tabular px-3 py-2 text-right font-semibold ${sort === 'total' ? 'bg-surface-2/60' : ''}`}>
                            {total > 0 ? '+' : ''}
                            {total}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

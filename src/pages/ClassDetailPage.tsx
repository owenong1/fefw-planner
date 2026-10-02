import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Avatar, Badge, Card, Segmented, SectionTitle } from '../components/ui'
import { aptitudeFit, canUseClass, classById, combinedGrowths, growthTotal, skillById, units } from '../data'
import { STAT_KEYS, STAT_LABELS } from '../data/constants'
import { useSettings } from '../lib/settings'
import { TIER_INFO, weaponReqText } from '../lib/display'
import { NotFoundPage } from './NotFoundPage'

export function ClassDetailPage() {
  const { id } = useParams()
  const cls = id ? classById.get(id) : undefined
  const { spoilerLevel } = useSettings()
  const [filter, setFilter] = useState<'favored' | 'all'>('favored')

  const ranked = useMemo(() => {
    if (!cls) return []
    return units
      .filter((u) => u.spoiler <= spoilerLevel && u.growths && canUseClass(u, cls))
      .map((u) => ({ unit: u, fit: aptitudeFit(u, cls), growths: combinedGrowths(u, cls)! }))
      .filter((x) => filter === 'all' || x.fit === 'favored')
      .sort((a, b) => growthTotal(b.growths) - growthTotal(a.growths))
  }, [cls, spoilerLevel, filter])

  if (!cls) return <NotFoundPage what="class" />
  const req = cls.requirements
  const blocked = units.filter((u) => u.spoiler <= spoilerLevel && !canUseClass(u, cls))

  return (
    <div>
      <div className="mb-2 text-sm text-muted">
        <Link to="/classes" className="hover:underline">Classes</Link> /
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold tracking-wide">{cls.name}</h1>
        <Badge tone="accent">{TIER_INFO[cls.tier].label}</Badge>
        {cls.tags.map((t) => <Badge key={t}>{t}</Badge>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle>Requirements</SectionTitle>
          {req ? (
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-sm">
              {req.license && (<><dt className="text-muted">License</dt><dd>{req.license}</dd></>)}
              {req.level != null && (<><dt className="text-muted">Ideal level</dt><dd>{req.level}</dd></>)}
              {req.renown != null && (<><dt className="text-muted">Renown</dt><dd>{req.renown}</dd></>)}
              {weaponReqText(cls) && (<><dt className="text-muted">Weapon skills</dt><dd>{weaponReqText(cls)}</dd></>)}
              {req.unlock && (<><dt className="text-muted">Unlock</dt><dd>{req.unlock}</dd></>)}
            </dl>
          ) : (
            <p className="text-sm text-muted">{TIER_INFO[cls.tier].blurb}</p>
          )}
        </Card>

        <Card>
          <SectionTitle>Skills</SectionTitle>
          <div className="grid gap-2 text-sm">
            {cls.skills.map((sid) => {
              const s = skillById.get(sid)!
              return (
                <div key={sid}>
                  <span className="font-semibold">{s.name}</span>
                  {s.effect && <p className="text-muted">{s.effect}</p>}
                </div>
              )
            })}
            {cls.masterySkill && (
              <div className="border-t border-line pt-2">
                <span className="font-semibold">{skillById.get(cls.masterySkill)!.name}</span>
                <Badge tone="good">Mastery</Badge>
                <p className="text-muted">{skillById.get(cls.masterySkill)!.effect ?? 'Effect not documented yet.'}</p>
              </div>
            )}
            {cls.skills.length === 0 && !cls.masterySkill && <p className="text-muted">None.</p>}
          </div>
        </Card>

        <Card>
          <SectionTitle>Growth modifiers</SectionTitle>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
            {STAT_KEYS.map((k) => {
              const v = cls.growths[k]
              return (
                <div key={k} className="rounded-lg bg-surface-2 py-2 text-center">
                  <div className="text-[11px] font-semibold text-muted">{STAT_LABELS[k]}</div>
                  <div className={`tabular text-lg font-bold ${v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'text-muted'}`}>
                    {v > 0 ? '+' : ''}{v}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {blocked.length > 0 && (
          <Card>
            <SectionTitle>Can't use this class</SectionTitle>
            <div className="flex flex-wrap gap-2">
              {blocked.map((u) => (
                <Link key={u.id} to={`/units/${u.id}`} className="text-sm font-medium hover:text-accent">{u.name}</Link>
              ))}
            </div>
          </Card>
        )}
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">Who grows best as a {cls.name}</h2>
            <p className="text-sm text-muted">Ranked by total combined growth (personal + class).</p>
          </div>
          <Segmented
            label="Unit filter"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'favored', label: 'Favored weapon' }, { value: 'all', label: 'All units' }]}
          />
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-left">Unit</th>
                {STAT_KEYS.map((k) => <th key={k} className="px-2 py-2 text-right">{STAT_LABELS[k]}</th>)}
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ unit, growths, fit }) => (
                <tr key={unit.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                  <td className="px-3 py-1.5">
                    <Link to={`/units/${unit.id}`} className="flex items-center gap-2 font-semibold hover:text-accent">
                      <Avatar name={unit.name} id={unit.id} size={24} />
                      {unit.name}
                      {fit === 'unfavored' && <Badge tone="bad">unfavored</Badge>}
                    </Link>
                  </td>
                  {STAT_KEYS.map((k) => <td key={k} className="tabular px-2 py-1.5 text-right">{growths[k]}</td>)}
                  <td className="tabular px-3 py-1.5 text-right font-semibold">{growthTotal(growths)}</td>
                </tr>
              ))}
              {ranked.length === 0 && (
                <tr><td colSpan={11} className="p-6 text-center text-muted">No units list this class's weapon skills as favored.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

import { Link } from 'react-router'
import { StatHeaders, StatRow } from '../components/Stats'
import { Badge, PageHeader } from '../components/ui'
import { classes } from '../data'
import { CLASS_TIERS } from '../data/constants'
import { TIER_INFO, weaponReqText } from '../lib/display'

export function ClassesPage() {
  return (
    <div>
      <PageHeader
        title="Classes"
        subtitle="Class growth modifiers are added to a unit's personal growth rates while they are in that class."
      />
      <div className="grid gap-8">
        {CLASS_TIERS.map((tier) => {
          const list = classes.filter((c) => c.tier === tier)
          return (
            <section key={tier}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                <h2 className="font-display text-xl font-bold">{TIER_INFO[tier].label}</h2>
                <span className="text-sm text-muted">{TIER_INFO[tier].blurb}</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Class</th>
                      <th className="px-2 py-2 text-left">Weapon skills</th>
                      <StatHeaders />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                        <td className="px-3 py-2">
                          <Link to={`/classes/${c.id}`} className="font-semibold hover:text-accent">{c.name}</Link>
                          <span className="ml-2 inline-flex gap-1">
                            {c.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-xs text-muted">{weaponReqText(c)}</td>
                        <StatRow stats={c.growths} signed colorize />
                      </tr>
                    ))}
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

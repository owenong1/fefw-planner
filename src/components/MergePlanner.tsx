import { Link } from 'react-router'
import { canUseClass, classById, classes, combinedGrowths, growthTotal, routeById } from '../data'
import { CLASS_TIERS, STAT_KEYS, STAT_LABELS } from '../data/constants'
import type { Stats, Unit } from '../data/schema'
import type { FinalClasses } from '../lib/army'
import { growthColor, TIER_INFO } from '../lib/display'
import { Avatar, Badge, Empty, SectionTitle } from './ui'

/** Game8: Merge Causality costs 300 Karma Shards per character. */
const MERGE_COST = 300

export type MergeCandidate = { unit: Unit; routes: string[] }

type Copy = { route: string; cls: string; growths: Stats }

function ClassSelect({ unit, value, onChange }: { unit: Unit; value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`${unit.name}'s final class`}
      className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink focus:outline-2 focus:outline-accent"
    >
      <option value="">No class (personal growths)</option>
      {CLASS_TIERS.filter((t) => t !== 'base').map((tier) => (
        <optgroup key={tier} label={TIER_INFO[tier].label}>
          {classes
            .filter((c) => c.tier === tier && canUseClass(unit, c))
            .map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

/** One bar per route copy for each stat; the copy that sets the merged value is drawn solid. */
function SynergyBars({ copies, merged }: { copies: Copy[]; merged: Stats }) {
  return (
    <div className="grid gap-1.5">
      {STAT_KEYS.map((k) => {
        const winners = copies.filter((c) => c.growths[k] === merged[k])
        const decisive = winners.length < copies.length
        return (
          <div key={k} className="grid grid-cols-[2.25rem_1fr_3.25rem] items-center gap-2">
            <span className="text-xs font-semibold text-muted">{STAT_LABELS[k]}</span>
            <div className="grid gap-[3px]">
              {copies.map((c) => {
                const top = c.growths[k] === merged[k]
                return (
                  <div key={c.route} className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      title={`${routeById.get(c.route)?.army}: ${c.growths[k]}%`}
                      style={{
                        width: `${Math.max(0, Math.min(c.growths[k], 100))}%`,
                        background: `var(--route-${c.route})`,
                        opacity: top ? 1 : 0.3,
                      }}
                    />
                  </div>
                )
              })}
            </div>
            <span className="tabular flex items-center justify-end gap-1 text-sm font-semibold" style={{ color: growthColor(merged[k]) }}>
              {decisive && (
                <span
                  className="inline-block size-2 rounded-full"
                  title={`From ${winners.map((w) => routeById.get(w.route)?.army).join(', ')}`}
                  style={{ background: winners.length === 1 ? `var(--route-${winners[0].route})` : 'var(--muted)' }}
                />
              )}
              {merged[k]}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MergeCard({
  unit, routes, finalClasses, setFinalClass,
}: MergeCandidate & { finalClasses: FinalClasses; setFinalClass: (route: string, unit: string, cls: string) => void }) {
  const copies: Copy[] = routes.flatMap((route) => {
    const cls = finalClasses[route]?.[unit.id] ?? ''
    const growths = combinedGrowths(unit, cls ? classById.get(cls) : undefined)
    return growths ? [{ route, cls, growths }] : []
  })
  if (!copies.length) return null

  const merged = Object.fromEntries(STAT_KEYS.map((k) => [k, Math.max(...copies.map((c) => c.growths[k]))])) as Stats
  const best = copies.reduce((a, b) => (growthTotal(b.growths) > growthTotal(a.growths) ? b : a))
  const synergy = growthTotal(merged) - growthTotal(best.growths)
  /** How many stats each copy contributes on its own, to show which route carries the merge. */
  const sole = (route: string) =>
    STAT_KEYS.filter((k) => copies.every((c) => c.route === route || c.growths[k] < merged[k])).length

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <Avatar name={unit.name} id={unit.id} size={44} />
        <div className="min-w-0 flex-1">
          <Link to={`/units/${unit.id}`} className="font-display font-bold hover:text-accent">{unit.name}</Link>
          <p className="tabular text-xs text-muted">
            {growthTotal(merged)}% merged · best single copy {growthTotal(best.growths)}%
          </p>
        </div>
        <Badge tone={synergy > 0 ? 'good' : 'neutral'} title="Merged growth total minus the best single copy's total">
          {synergy > 0 ? `+${synergy}% synergy` : 'No synergy'}
        </Badge>
      </div>

      <div className="grid gap-1.5">
        {copies.map((c) => {
          const n = sole(c.route)
          return (
            <div key={c.route} className="flex items-center gap-2">
              <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: `var(--route-${c.route})` }} />
              <span className="w-28 shrink-0 truncate text-xs font-medium" title={routeById.get(c.route)?.name}>
                {routeById.get(c.route)?.army}
              </span>
              <ClassSelect unit={unit} value={c.cls} onChange={(v) => setFinalClass(c.route, unit.id, v)} />
              <span className="tabular w-10 shrink-0 text-right text-[10px] text-muted" title="Stats only this copy has the best growth in">
                {n > 0 ? `${n} best` : ''}
              </span>
            </div>
          )
        })}
      </div>

      <SynergyBars copies={copies} merged={merged} />
    </div>
  )
}

export function MergePlanner({
  candidates, finalClasses, setFinalClass,
}: { candidates: MergeCandidate[]; finalClasses: FinalClasses; setFinalClass: (route: string, unit: string, cls: string) => void }) {
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <SectionTitle>Merge planner</SectionTitle>
        {candidates.length > 0 && (
          <span className="tabular text-xs text-muted">
            {candidates.length} candidate{candidates.length === 1 ? '' : 's'} · {(candidates.length * MERGE_COST).toLocaleString()} Karma Shards to merge all
          </span>
        )}
      </div>
      <p className="mb-3 max-w-3xl text-sm text-muted">
        In Part III, Merge Causality keeps each stat's highest value across every route a unit was recruited on. Give each copy a
        different final class so their growths cover different stats. Growths shown are personal + class.
      </p>
      {candidates.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {candidates.map((c) => (
            <MergeCard key={c.unit.id} {...c} finalClasses={finalClasses} setFinalClass={setFinalClass} />
          ))}
        </div>
      ) : (
        <Empty>Recruit the same unit on two or more routes to plan a merge.</Empty>
      )}
    </section>
  )
}

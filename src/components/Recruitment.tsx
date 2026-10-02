import { Link } from 'react-router'
import { paralogueById, recruitmentOn, routes, timingLabel } from '../data'
import type { Condition, Recruitment, Unit } from '../data/schema'
import { Badge, RouteName } from './ui'

const CONDITION_ICON: Record<Condition['type'], string> = {
  paralogue: '📜', gold: '🪙', item: '🎁', chapter: '⏳', request: '❗', dialogue: '💬',
  survive: '🛡️', battle: '⚔️', other: '•',
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function ConditionLine({ c, route }: { c: Condition; route?: string }) {
  if (c.type === 'paralogue') {
    const p = paralogueById.get(c.paralogue)
    const when = p?.availability.find((a) => a.route === route)
    return (
      <li className="flex gap-2">
        <span aria-hidden>{CONDITION_ICON.paralogue}</span>
        <span>
          Clear <Link to={`/paralogues#${c.paralogue}`} className="font-medium text-accent hover:underline">{p?.name ?? c.paralogue}</Link>
          {when && (
            <span className="text-muted"> (Ch. {when.chapter}{when.dates ? `, ${when.dates}` : ''})</span>
          )}
          {p && route && !when && <span className="text-bad"> (not listed as available on this route)</span>}
        </span>
      </li>
    )
  }
  const text =
    c.type === 'gold' ? `Pay ${c.amount.toLocaleString()} gold` : c.type === 'item' ? `Give ${c.qty}× ${c.item}` : capitalize(c.text)
  return (
    <li className="flex gap-2">
      <span aria-hidden>{CONDITION_ICON[c.type]}</span>
      <span>{text}</span>
    </li>
  )
}

export function RecruitmentDetail({ r }: { r: Recruitment }) {
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge>{timingLabel(r)}</Badge>
        {r.method === 'automatic' && <Badge tone="good">Joins automatically</Badge>}
        {r.method === 'story' && <Badge tone="accent">Story recruit</Badge>}
        {r.support != null && <Badge tone="accent" title="Support level with the lord">Support {r.support}</Badge>}
        {r.renown != null && <Badge tone="accent" title="Renown level">Renown {r.renown}</Badge>}
      </div>
      {r.conditions.length > 0 && (
        <ul className="grid gap-1">
          {r.conditions.map((c, i) => (
            <ConditionLine key={i} c={c} route={r.route === 'all' ? undefined : r.route} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One card per route, showing how (or whether) the unit joins there. */
export function RecruitmentByRoute({ unit }: { unit: Unit }) {
  const routeSpecific = unit.recruitment.filter((r) => r.route !== 'all')
  const shared = unit.recruitment.filter((r) => r.route === 'all')
  return (
    <div className="grid gap-3">
      {routeSpecific.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {routes.map((route) => {
            const entries = recruitmentOn(unit, route.id).filter((r) => r.route !== 'all')
            return (
              <div
                key={route.id}
                className="rounded-lg border border-line p-3"
                style={{ borderLeft: `4px solid var(--route-${route.id})` }}
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <RouteName route={route.id} link />
                  <span className="text-xs text-muted">{route.army}</span>
                </div>
                {entries.length ? entries.map((r, i) => <RecruitmentDetail key={i} r={r} />) : (
                  <p className="text-sm text-muted">Not recruitable on this route.</p>
                )}
              </div>
            )
          })}
        </div>
      )}
      {shared.map((r, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <div className="mb-2"><RouteName route="all" /></div>
          <RecruitmentDetail r={r} />
        </div>
      ))}
    </div>
  )
}

/** Compact per-route availability strip used in tables. */
export function RouteStrip({ unit }: { unit: Unit }) {
  return (
    <div className="flex gap-1">
      {routes.map((route) => {
        const r = recruitmentOn(unit, route.id)[0]
        const label = !r ? '–' : r.method === 'automatic' ? 'Auto' : r.method === 'story' ? 'Story' : `R${r.renown}`
        const title = !r
          ? `${route.name}: not recruitable`
          : `${route.name}: ${timingLabel(r)}${r.renown != null ? `, Support ${r.support}, Renown ${r.renown}` : ''}`
        return (
          <span
            key={route.id}
            title={title}
            className={`tabular w-12 rounded px-1 py-0.5 text-center text-[11px] font-semibold ${r ? 'text-white' : 'bg-surface-2 text-muted'}`}
            style={r ? { background: `var(--route-${route.id})` } : undefined}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

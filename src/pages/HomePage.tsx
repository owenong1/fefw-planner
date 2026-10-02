import { Link } from 'react-router'
import { Avatar, RouteDot } from '../components/ui'
import { classes, paralogues, routes, skills, unitById, units } from '../data'

const TOOLS = [
  {
    title: 'Unit Database',
    body: 'Growths, base stats, skills and how to recruit every unit on each lord’s route.',
    to: '/units',
    ready: true,
  },
  {
    title: 'Army Builder',
    body: 'Plan who to recruit on each lord’s route by Renown, and see who you haven’t recruited anywhere.',
    to: '/builder',
    ready: true,
  },
  {
    title: 'RNG Checker',
    body: 'Enter a unit’s level, stats and class history to see how well they rolled, from E- to S.',
    to: '/rng',
    ready: true,
  },
]

export function HomePage() {
  return (
    <div>
      <section className="mb-10">
        <h1 className="font-display text-4xl font-bold tracking-wide sm:text-5xl">
          Plan your <span className="text-accent">Heroic Games</span>.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          A planner for Fire Emblem: Fortune’s Weave. {units.length} units, {classes.length} classes, {skills.length} skills
          and {paralogues.length} paralogues across four routes.
        </p>
      </section>

      <section className="mb-10 grid gap-4 md:grid-cols-3">
        {TOOLS.map((t) => {
          const inner = (
            <>
              <div className="mb-1 flex items-center justify-between">
                <h2 className="font-display text-xl font-bold">{t.title}</h2>
                {!t.ready && <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">Coming soon</span>}
              </div>
              <p className="text-sm text-muted">{t.body}</p>
            </>
          )
          return t.ready && t.to ? (
            <Link key={t.title} to={t.to} className="rounded-xl border border-line bg-surface p-5 transition-colors hover:border-accent">
              {inner}
            </Link>
          ) : (
            <div key={t.title} className="rounded-xl border border-dashed border-line p-5 opacity-75">{inner}</div>
          )
        })}
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold tracking-[0.12em] text-muted uppercase">Routes</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {routes.map((r) => {
            const lord = unitById.get(r.lord)!
            return (
              <Link
                key={r.id}
                to={`/routes/${r.id}`}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 hover:border-accent"
                style={{ borderTop: `4px solid var(--route-${r.id})` }}
              >
                <Avatar name={lord.name} id={lord.id} size={44} />
                <div>
                  <p className="flex items-center gap-1.5 font-semibold"><RouteDot route={r.id} />{r.name}</p>
                  <p className="text-sm text-muted">{r.army}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}

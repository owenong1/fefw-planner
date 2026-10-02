import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { Badge, Card, PageHeader, RouteName } from '../components/ui'
import { paralogues, routes, unitById } from '../data'
import { useSettings } from '../lib/settings'

export function ParaloguesPage() {
  const { hash } = useLocation()
  const { spoilerLevel } = useSettings()

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <div>
      <PageHeader
        title="Paralogues"
        subtitle="Side chapters with limited windows. Several are required to recruit a unit on another lord's route. Dates are in-game calendar windows to accept the paralogue."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {paralogues.map((p) => {
          const recruits = p.recruitmentFor.map((id) => unitById.get(id)!).filter((u) => u.spoiler <= spoilerLevel)
          return (
            <Card key={p.id} className={`scroll-mt-24 ${hash === `#${p.id}` ? 'outline-2 outline-accent' : ''}`}>
              <div id={p.id} className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-display text-lg font-bold">{p.name}</h2>
                {p.location && <span className="text-sm text-muted">{p.location}</span>}
              </div>
              <table className="mb-3 w-full text-sm">
                <tbody>
                  {routes.map((r) => {
                    const a = p.availability.find((x) => x.route === r.id)
                    return (
                      <tr key={r.id} className="border-t border-line">
                        <td className="py-1.5"><RouteName route={r.id} /></td>
                        <td className="py-1.5 text-right">
                          {a ? (
                            <span>Ch. {a.chapter}<span className="ml-2 text-muted">{a.dates}</span></span>
                          ) : (
                            <span className="text-muted">Not available</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {p.rewards.map((rw) => <Badge key={rw}>{rw}</Badge>)}
              </div>
              {recruits.length > 0 && (
                <p className="mt-3 text-sm">
                  <span className="text-muted">Needed to recruit </span>
                  {recruits.map((u, i) => (
                    <span key={u.id}>
                      {i > 0 && ', '}
                      <Link to={`/units/${u.id}`} className="font-semibold text-accent hover:underline">{u.name}</Link>
                    </span>
                  ))}
                </p>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}

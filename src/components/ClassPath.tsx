import { Fragment } from 'react'
import { Link } from 'react-router'
import { classById, classSpoiler } from '../data'
import type { RolePath, UnitPaths } from '../data/schema'
import { TIER_INFO } from '../lib/display'
import { useSettings } from '../lib/settings'
import { ClassIcon } from './ui'

/** A recommended path as class chips in order. Classes above the spoiler level are named by tier only. */
export function PathSteps({ unit, path }: { unit: UnitPaths; path: RolePath['path'] }) {
  const { spoilerLevel } = useSettings()
  if (!path.length) {
    return <span className="text-sm text-muted">Stays {classById.get(unit.joinClass)?.name ?? 'in its class'}</span>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 gap-y-1">
      {path.map((step, i) => {
        const cls = classById.get(step.class)!
        const level = step.late && <span className="tabular text-xs text-muted">Lv {step.level}</span>
        return (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden className="text-xs text-muted">›</span>}
            {classSpoiler(cls) > spoilerLevel ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-sm text-muted italic" title="Hidden by your spoiler setting">
                {TIER_INFO[cls.tier].label} class {level}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <ClassIcon name={cls.name} id={cls.id} size={20} />
                <Link to={`/classes/${cls.id}`} className="text-sm font-medium hover:text-accent">{cls.name}</Link>
                {level}
              </span>
            )}
          </Fragment>
        )
      })}
    </span>
  )
}

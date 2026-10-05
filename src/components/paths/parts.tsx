import type { ReactNode } from 'react'
import { STAT_KEYS, STAT_LABELS } from '../../data/constants'
import type { RoleView } from '../../data/pathModel'
import type { Stats } from '../../data/schema'
import { roleColor } from '../../lib/display'

/** A role named beside its colour, which it keeps everywhere on the page. */
export function RoleChip({ role, className = '' }: { role: Pick<RoleView, 'id' | 'label'> & { edited?: boolean }; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <i className="inline-block size-2.5 flex-none rounded-[3px]" style={{ background: roleColor(role.id) }} />
      {role.label}
      {role.edited && <span className="rounded border border-line px-1 text-[10px] font-medium tracking-wide text-muted uppercase" title="Scored with your weights, not the simulator's">edited</span>}
    </span>
  )
}

export function Section({ id, title, lede, children }: { id: string; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-12 flex min-w-0 scroll-mt-24 flex-col gap-4">
      <h2 className="font-display text-xl font-bold tracking-wide">{title}</h2>
      {lede && <p className="max-w-3xl text-muted">{lede}</p>}
      {children}
    </section>
  )
}

export function Panel({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 ${className}`}>
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      {children}
    </div>
  )
}

export const NOTE = 'max-w-4xl text-xs text-muted'

const HATCH = 'repeating-linear-gradient(135deg, var(--muted) 0 2px, transparent 2px 5px)'

/**
 * A unit's growth rates in one class, each bar split into the unit's own rate and what the class adds
 * (in `color`) or takes away (hatched): the chance each stat rises on a level-up.
 */
export function GrowthStack({ own, cls, unitName, className, color }: { own: Stats; cls: Stats; unitName: string; className: string; color: string }) {
  const max = Math.max(100, ...STAT_KEYS.map((k) => Math.max(own[k], own[k] + cls[k])))
  const pct = (v: number) => `${((v / max) * 100).toFixed(2)}%`
  return (
    <div>
      <div className="grid grid-cols-[2.25rem_1fr_max-content] items-center gap-x-2.5 gap-y-1.5">
        {STAT_KEYS.map((k) => {
          const add = cls[k], total = Math.max(0, own[k] + add)
          return (
            <div key={k} className="contents">
              <span className="text-xs font-semibold text-muted">{STAT_LABELS[k]}</span>
              <div className="relative flex h-3 gap-0.5 border-b border-line">
                <i className="block h-full bg-muted" style={{ width: pct(add < 0 ? total : own[k]) }} />
                {add > 0 && <i className="block h-full rounded-r-[3px]" style={{ width: pct(add), background: color }} />}
                {add < 0 && <i className="block h-full rounded-r-[3px] border border-muted" style={{ width: pct(own[k] - total), background: HATCH }} />}
                {max > 100 && <span className="absolute -inset-y-0.5 w-px bg-muted/60" style={{ left: pct(100) }} />}
              </div>
              <span className="tabular text-xs whitespace-nowrap text-muted">
                {own[k]} {add < 0 ? '−' : '+'} {Math.abs(add)} = <b className="font-semibold text-ink">{total}%</b>
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px] bg-muted" />{unitName}'s own growth</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px]" style={{ background: color }} />added by {className}</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-[3px] border border-muted" style={{ background: HATCH }} />taken away by {className}</span>
      </div>
    </div>
  )
}

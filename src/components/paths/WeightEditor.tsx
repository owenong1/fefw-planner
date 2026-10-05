import { useMemo, useState } from 'react'
import { classPaths, unitById } from '../../data'
import type { PathsView } from '../../data/pathModel'
import { roleColor } from '../../lib/display'
import { useSettings } from '../../lib/settings'
import { NOTE, Panel, RoleChip } from './parts'
import { defaultSliders } from './shared'

const { axes } = classPaths

/**
 * Sliders for one role's weights. Moving one re-scores every unit's candidate paths for that role in the browser,
 * so the results, the cast average and the best-fit roles all follow. `status` is the candidates file's.
 */
export function WeightEditor({
  view, sliders, onChange, status, initialRole,
}: {
  view: PathsView
  sliders: Record<string, number[]>
  onChange: (roleId: string, values: number[] | null) => void
  status: 'idle' | 'loading' | 'ready' | 'error'
  initialRole: string
}) {
  const { spoilerLevel } = useSettings()
  const [editing, setEditing] = useState(initialRole)
  const role = view.roles.find((r) => r.id === editing) ?? view.roles[0]
  const values = sliders[role.id] ?? defaultSliders(role.id)
  const total = values.reduce((t, v) => t + v, 0)
  const touched = !!sliders[role.id]

  // What the edit did: each unit's path and place under the role's own weights and under the reader's, scored the same way.
  const summary = useMemo(() => {
    if (!role.baseline) return null
    const { results: stored, standings: before } = role.baseline
    const moved = view.data.units.flatMap((u) => {
      const was = before.get(u.unit), now = role.standings.get(u.unit)
      if (!was || !now) return []
      return [{ unit: unitById.get(u.unit)!, was: was.rank, now: now.rank, path: JSON.stringify(stored.get(u.unit)!.path) !== JSON.stringify(role.results.get(u.unit)!.path) }]
    })
    const shown = moved.filter((m) => m.unit.spoiler <= spoilerLevel)
    return {
      paths: moved.filter((m) => m.path).length,
      count: moved.length,
      leader: shown.reduce((best, m) => (m.now < best.now ? m : best), shown[0]),
      up: [...shown].sort((x, y) => (y.was - y.now) - (x.was - x.now)).filter((m) => m.was > m.now).slice(0, 3),
      down: [...shown].sort((x, y) => (x.was - x.now) - (y.was - y.now)).filter((m) => m.was < m.now).slice(0, 3),
    }
  }, [role, view.data, spoilerLevel])
  const list = (ms: NonNullable<typeof summary>['up']) => ms.map((m) => `${m.unit.name} #${m.was} → #${m.now}`).join(', ')

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <h3 className="text-sm font-semibold">Try different weights</h3>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Role to edit">
          {view.roles.map((r) => (
            <button
              key={r.id} onClick={() => setEditing(r.id)} aria-pressed={r.id === role.id}
              className={`rounded-md border bg-surface px-2.5 py-1 text-sm font-medium ${r.id === role.id ? 'border-ink' : 'border-line hover:border-muted'}`}
            >
              <RoleChip role={r} />
            </button>
          ))}
        </div>
        <button onClick={() => onChange(role.id, null)} disabled={!touched} className="rounded-md border border-line bg-surface px-2.5 py-1 text-sm font-medium hover:border-muted disabled:opacity-50">
          Reset this role
        </button>
      </div>
      <p className={NOTE}>
        Drag an axis to 0 to drop it, or raise one that the role ignores. The numbers on the right are each axis's share of the score. Every unit's path, score and
        place in the cast for that role update as you drag, here and in the results above.
      </p>
      <div className="grid gap-x-7 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {axes.map((a, i) => (
          <label key={a.id} className={`grid grid-cols-[5rem_1fr_2.75rem] items-center gap-2.5 text-sm ${values[i] ? '' : 'text-muted'}`}>
            <span>{a.label}</span>
            <input
              type="range" min={0} max={100} step={2.5} value={values[i]} className="w-full min-w-0" style={{ accentColor: roleColor(role.id) }}
              onChange={(e) => onChange(role.id, values.map((v, k) => (k === i ? Number(e.target.value) : v)))}
            />
            <output className="tabular text-right text-xs font-medium">{total ? Math.round((values[i] / total) * 100) : 0}%</output>
          </label>
        ))}
      </div>
      <p className="max-w-4xl text-sm text-muted" aria-live="polite">
        {total === 0 ? (
          'Give at least one axis some weight. Until then the results show the original weights.'
        ) : touched && status === 'loading' ? (
          'Loading the candidate paths…'
        ) : touched && status === 'error' ? (
          'The candidate paths could not be loaded, so the weights cannot be changed right now. Reload the page to try again.'
        ) : !summary ? (
          <><b className="text-ink">{role.label}</b> is on its original weights.</>
        ) : (
          <>
            <b className="text-ink">{role.label}</b> is now {axes.filter((a) => role.weights[a.id]).map((a) => `${Math.round(role.weights[a.id] * 100)}% ${a.label}`).join(' + ')}.{' '}
            <b className="text-ink">{summary.paths} of {summary.count}</b> units get a different path.
            {summary.leader && <> Top of the role: <b className="text-ink">{summary.leader.unit.name}</b>.</>}
            {summary.up.length > 0 && ` Biggest climbs: ${list(summary.up)}.`}
            {summary.down.length > 0 && ` Biggest drops: ${list(summary.down)}.`}{' '}
            <a href="#results" className="underline">See the results</a>
          </>
        )}
      </p>
      <p className={NOTE}>
        Edited weights are re-scored in your browser from the {view.data.units.reduce((n, u) => n + u.paths, 0).toLocaleString('en-US')} paths the search kept, narrowed to the
        ones that could lead under some weighting, using expected stats. Level-ups are not re-rolled, so near-ties are settled by score and then by the least training.
        The class table below keeps the original weights. The edit lasts until you leave the page.
      </p>
    </Panel>
  )
}

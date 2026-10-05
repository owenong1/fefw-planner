import { useState } from 'react'
import { Link } from 'react-router'
import { classById, classPaths, unitById } from '../../data'
import type { PathsView } from '../../data/pathModel'
import type { UnitPaths } from '../../data/schema'
import { roleColor, signed, trainLabel } from '../../lib/display'
import { PathSteps } from '../ClassPath'
import { Legend, LineChart, TipRow } from '../LineChart'
import { AXIS_TEXT, chapterAxis } from './shared'
import { GrowthStack, NOTE, RoleChip } from './parts'

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col">
      <b className="tabular text-lg font-semibold">{value}</b>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

/** One unit opened up in the results table: its path for a role, where it stands, its profile and its score chapter by chapter. */
export function UnitDetail({ u, view, initialRole }: { u: UnitPaths; view: PathsView; initialRole: string }) {
  const [roleId, setRoleId] = useState(initialRole)
  const role = view.roles.find((r) => r.id === roleId) ?? view.roles[0]
  const unit = unitById.get(u.unit)!
  const r = role.results.get(u.unit)!
  const s = role.standings.get(u.unit)
  const color = roleColor(role.id)
  const first = classById.get(r.path[0]?.class ?? u.joinClass)
  const { checkpoints, axes } = classPaths
  const own = new Map(r.chapters.map((v, k) => [u.firstChapter + k, v]))

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Role shown">
        {view.roles.map((ro) => (
          <button
            key={ro.id} onClick={() => setRoleId(ro.id)} aria-pressed={ro.id === role.id}
            className={`rounded-md border bg-surface px-2.5 py-1 text-sm font-medium ${ro.id === role.id ? 'border-ink' : 'border-line hover:border-muted'}`}
          >
            <RoleChip role={ro} />
            {view.best.get(u.unit) === ro.id && <span className="text-muted"> (best fit)</span>}
          </button>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-semibold">{unit.name} as {role.label.toLowerCase()}</h3>
          <PathSteps unit={u} path={r.path} />
          {s ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <Figure value={`#${s.rank}`} label={`of ${role.standings.size} in this role`} />
              <Figure value={signed(s.vsCast)} label="vs cast average" />
              <Figure value={s.score.toFixed(1)} label={view.ranged ? 'score in these chapters' : 'campaign score'} />
              <Figure value={s.endgame.toFixed(1)} label={view.to < checkpoints.length - 1 ? checkpoints[view.to].label : 'final chapter'} />
              <Figure value={trainLabel(r.train)} label="ranks to train" />
            </div>
          ) : (
            <p className={NOTE}>{unit.name} has not joined in the chosen chapters.</p>
          )}
          <p className={NOTE}>
            Joins as Lv {u.joinLevel} {classById.get(u.joinClass)?.name}{u.estimated && ' (base stats estimated)'}. Present for {u.chapters} chapters; {u.paths.toLocaleString('en-US')} paths
            compared. {u.caveats.join(' ')}{' '}
            <Link to={`/sim?cmd=char&unit=${encodeURIComponent(unit.name)}&role=${role.id}`} className="underline">Ranked paths in the simulator</Link>
          </p>
          {unit.growths && first && (
            <>
              <h3 className="mt-1 text-sm font-semibold">Growth in the first class</h3>
              <GrowthStack own={unit.growths} cls={first.growths} unitName={unit.name} className={first.name} color={color} />
            </>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-semibold">Profile on this path</h3>
          <div className="grid grid-cols-[max-content_1fr_2rem_max-content] items-center gap-x-2.5 gap-y-1.5 text-sm">
            {axes.map((a, i) => {
              const w = role.weights[a.id]
              return (
                <div key={a.id} className="contents" title={AXIS_TEXT[a.id]}>
                  <span>{a.label}</span>
                  <div className="h-2.5 border-b border-line">
                    <i className="block h-full min-w-px rounded-r" style={{ width: `${Math.max(0, Math.min(r.axes[i], 100))}%`, background: w ? color : 'var(--line)' }} />
                  </div>
                  <span className="tabular text-right text-xs">{Math.round(r.axes[i])}</span>
                  <span className="tabular text-[11px] text-muted">{w ? `×${Math.round(w * 1000) / 1000}` : ''}</span>
                </div>
              )
            })}
          </div>
          <Legend items={[{ label: 'counts toward this role (× weight)', color }, { label: 'shown for reference', color: 'var(--line)' }]} />
          <h3 className="mt-1 text-sm font-semibold">Score by chapter</h3>
          <Legend items={[{ label: unit.name, color }, { label: 'cast average (dashed)', color: 'var(--muted)', dashed: true }]} />
          <LineChart
            label={`${unit.name}: score by chapter against the cast average`} {...chapterAxis} y0={0} y1={100} ticks={[0, 25, 50, 75, 100]} height={200}
            band={view.ranged ? [view.from, view.to] : undefined}
            series={[
              { color: 'var(--muted)', dashed: true, points: role.castAvg.flatMap((v, i) => (v == null ? [] : [[i, v] as [number, number]])) },
              { color, points: r.chapters.map((v, k) => [u.firstChapter + k, v]) },
            ]}
            tip={(i) => (
              <>
                <b>{checkpoints[i].label}</b>
                {own.has(i) ? <TipRow label={unit.name} value={own.get(i)!.toFixed(1)} color={color} /> : <div className="text-muted">{unit.name} has not joined yet</div>}
                {role.castAvg[i] != null && <TipRow label="Cast average" value={role.castAvg[i]!.toFixed(1)} color="var(--muted)" />}
              </>
            )}
          />
        </div>
      </div>
    </div>
  )
}

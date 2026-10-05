import { Link, useSearchParams } from 'react-router'
import { PathSteps } from '../components/ClassPath'
import { Avatar, Badge, Empty, PageHeader, Segmented } from '../components/ui'
import { classById, classPaths, roleAxes, unitById } from '../data'
import { trainLabel } from '../lib/display'
import { useSettings } from '../lib/settings'

const SCOPE_ROUTE: Record<string, string> = { common: 'classes every route unlocks', any: 'every class, route exclusives included' }

export function PathsPage() {
  const { spoilerLevel } = useSettings()
  const [params, setParams] = useSearchParams()
  const role = classPaths.roles.find((r) => r.id === params.get('role')) ?? classPaths.roles[0]
  const axes = roleAxes(role.id)
  const { scope } = classPaths

  const ranked = [...classPaths.units].sort((a, b) => a.roles[role.id].rank - b.roles[role.id].rank)
  const rows = ranked.filter((u) => unitById.get(u.unit)!.spoiler <= spoilerLevel)
  const hidden = ranked.length - rows.length

  return (
    <div>
      <PageHeader
        title="Class Paths"
        subtitle="The class path the growth simulator recommends for each unit in each role. A unit's growth rates are its own plus its current class's, so the classes it passes through decide the stats it ends up with."
      >
        <Link to={`/sim?cmd=all${role.id === classPaths.roles[0].id ? '' : `&role=${role.id}`}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent">
          Re-run with other rules
        </Link>
      </PageHeader>
      <div className="mb-4 overflow-x-auto pb-1">
        <Segmented
          label="Role"
          value={role.id}
          onChange={(id) => setParams(id === classPaths.roles[0].id ? {} : { role: id }, { replace: true })}
          options={classPaths.roles.map((r) => ({ value: r.id, label: r.label }))}
        />
      </div>
      <p className="mb-3 text-sm text-muted">
        {role.label} score = {axes.map((a) => `${Math.round(a.weight * 100)}% ${a.label}`).join(' + ')}. Units are ordered by how far they sit above
        the cast's average in the chapters they are present for.
        {hidden > 0 && ` ${hidden} units are hidden by your spoiler setting, so places skip numbers.`}
      </p>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-3 py-2 text-right font-semibold">#</th>
                <th className="px-2 py-2 text-left font-semibold">Unit</th>
                <th className="px-2 py-2 text-left font-semibold">Path</th>
                <th className="px-2 py-2 text-right font-semibold" title="Campaign average of the role score, 0–100">Score</th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap" title="Points above the cast's average, chapter by chapter">vs cast</th>
                <th className="px-2 py-2 text-right font-semibold" title="Role score in the final chapter">Endgame</th>
                <th className="px-2 py-2 text-right font-semibold" title="Skill ranks the path's exams need beyond what its classes train">Train</th>
                {axes.map((a) => <th key={a.id} className="px-2 py-2 text-right font-semibold whitespace-nowrap">{a.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const unit = unitById.get(u.unit)!
                const r = u.roles[role.id]
                return (
                  <tr key={u.unit} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                    <td className="tabular px-3 py-2 text-right text-muted">{r.rank}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={unit.name} id={unit.id} size={32} />
                        <div>
                          <Link to={`/units/${unit.id}`} className="font-semibold hover:text-accent">{unit.name}</Link>
                          {u.bestRole === role.id && <span className="ml-1.5"><Badge tone="accent" title="The role this unit places highest in">Best role</Badge></span>}
                          <div className="text-xs whitespace-nowrap text-muted">
                            Lv {u.joinLevel} {classById.get(u.joinClass)?.name}
                            {u.estimated && <span title="Base stats are estimated, not published"> *</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2"><PathSteps unit={u} path={r.path} /></td>
                    <td className="tabular px-2 py-2 text-right font-semibold">{r.score.toFixed(1)}</td>
                    <td className={`tabular px-2 py-2 text-right ${r.vsCast >= 0 ? 'text-good' : 'text-bad'}`}>
                      {r.vsCast >= 0 ? '+' : ''}
                      {r.vsCast.toFixed(1)}
                    </td>
                    <td className="tabular px-2 py-2 text-right">{r.endgame.toFixed(1)}</td>
                    <td className="tabular px-2 py-2 text-right">{trainLabel(r.train)}</td>
                    {axes.map((a) => <td key={a.id} className="tabular px-2 py-2 text-right text-muted">{Math.round(r.axes[a.index])}</td>)}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No units to show at this spoiler level.</Empty>
      )}

      <div className="mt-6 rounded-xl border border-line bg-surface-2 p-4 text-sm">
        <p className="mb-1 font-semibold">Before trusting a number</p>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>
            These are simulated, not played: {SCOPE_ROUTE[scope.route] ?? `classes on ${scope.route}'s route`}, {scope.hard ? 'hard' : 'normal'} difficulty,
            {scope.divine ? ' Divine classes included' : ' no Divine classes'}
            {scope.runs > 0 && `, each role's leading paths replayed ${scope.runs} times with level-ups rolled`}.
          </li>
          <li>Scores compare paths and units within one role. A unit's scores in different roles are not comparable with each other.</li>
          <li>Enemy stats are mostly modelled from a few published stat lines, and Part III is extrapolation.</li>
          <li>Units marked * have base stats estimated from their growth rates. Units that join late start from their join class.</li>
          <li>Train is the number of skill ranks the path's exams ask for beyond what its classes teach, to make up at the Arena or with manuals.</li>
          <li>A level beside a class means the change is taken later than the tier's usual level (5 / 20 / 35 / 45).</li>
          <li>Within a role, one or two classes often lead for most of the cast, and near-identical paths are hard to separate.</li>
          <li>
            The <Link to="/sim" className="underline">simulator</Link> runs the same search in your browser: other routes, hard difficulty, Divine classes, one unit's
            ranked paths chapter by chapter, or a path of your own.
          </li>
        </ul>
      </div>
    </div>
  )
}

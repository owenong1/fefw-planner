import { Fragment, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import candidatesUrl from '../../data/pathCandidates.json?url'
import candidatesP2Url from '../../data/pathCandidates.p2.json?url'
import candidatesP3Url from '../../data/pathCandidates.p3.json?url'
import pathsP2Url from '../../data/classPaths.p2.json?url'
import pathsP3Url from '../../data/classPaths.p3.json?url'
import { PathSteps } from '../components/ClassPath'
import { CaveatsSection, ChaptersSection, ClassesSection, HowSection, InputsSection, RolesSection } from '../components/paths/Explain'
import { NOTE, RoleChip } from '../components/paths/parts'
import { UnitDetail } from '../components/paths/UnitDetail'
import { WeightEditor } from '../components/paths/WeightEditor'
import { Avatar, Badge, Empty, PageHeader, Select } from '../components/ui'
import { classById, classPaths, classSpoiler, roleAxes, unitById } from '../data'
import { buildView, PLANS } from '../data/pathModel'
import type { ClassPaths, PathCandidates } from '../data/schema'
import { signed, trainLabel, vsCastTint } from '../lib/display'
import { useSettings } from '../lib/settings'

const FIT = 'fit'
const SECTIONS = [
  ['results', 'Results by unit'], ['how', 'How a number is made'], ['inputs', 'What goes in'], ['roles', 'Axes and roles'],
  ['chapters', 'Chapters'], ['classes', 'Classes'], ['caveats', 'Before trusting a number'],
]
const TH = 'px-2 py-2 font-semibold whitespace-nowrap'

type PlanId = (typeof PLANS)[number]['id']
/** Each plan's results and candidate paths. The whole campaign's results are in the bundle; the rest are fetched. */
const PLAN_FILES: Record<PlanId, { paths: string | null; candidates: string }> = {
  '': { paths: null, candidates: candidatesUrl },
  p2: { paths: pathsP2Url, candidates: candidatesP2Url },
  p3: { paths: pathsP3Url, candidates: candidatesP3Url },
}

/** A data file fetched by URL once it is wanted (`url` null: not yet): another plan's results, or the candidate paths behind the weight sliders, which are several megabytes. */
function useJson<T>(url: string | null) {
  const [state, setState] = useState<{ url: string; data: T | null } | null>(null)
  useEffect(() => {
    if (!url) return
    let live = true
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: T) => live && setState({ url, data }), () => live && setState({ url, data: null }))
    return () => { live = false }
  }, [url])
  const current = state?.url === url ? state : null
  return { data: current?.data ?? null, status: !url ? 'idle' as const : !current ? 'loading' as const : current.data ? 'ready' as const : 'error' as const }
}

export function PathsPage() {
  const { spoilerLevel } = useSettings()
  const [params, setParams] = useSearchParams()
  // ?plan= is the stretch of the campaign the paths are picked for. Until its file has loaded the whole campaign's stay on show.
  const planId = PLANS.find((p) => p.id === params.get('plan'))?.id ?? ''
  const fetched = useJson<ClassPaths>(PLAN_FILES[planId].paths)
  const data = fetched.data ?? classPaths
  const plan = PLANS.find((p) => p.id === (fetched.data ? planId : ''))!
  const { checkpoints, units } = data
  const first = classPaths.roles[0].id
  const roleParam = params.get('role')
  const viewId = roleParam === FIT || classPaths.roles.some((r) => r.id === roleParam) ? roleParam! : first

  // ?from= and ?to= are checkpoint ids; a missing or unknown one means that end of the campaign.
  const last = checkpoints.length - 1
  const index = (key: string, fallback: number) => {
    const i = checkpoints.findIndex((c) => c.id === params.get(key))
    return i < 0 ? fallback : i
  }
  const start = Math.max(0, checkpoints.findIndex((c) => c.id === plan.from))
  const from = Math.max(start, index('from', start))
  const to = Math.max(from, index('to', last))
  const setQuery = (next: { role?: string; plan?: PlanId; from?: number; to?: number }) => {
    const q = { role: viewId, plan: planId, from, to, ...next }
    setParams({
      ...(q.role !== first && { role: q.role }),
      ...(q.plan && { plan: q.plan }),
      ...(q.from > start && { from: checkpoints[q.from].id }),
      ...(q.to < last && { to: checkpoints[Math.max(q.from, q.to)].id }),
    }, { replace: true })
  }

  // Slider positions per role the reader has touched. They only take effect once the candidate paths have loaded.
  const [sliders, setSliders] = useState<Record<string, number[]>>({})
  const { data: candidates, status } = useJson<PathCandidates>(Object.keys(sliders).length > 0 ? PLAN_FILES[plan.id].candidates : null)
  const view = buildView(data, candidates, sliders, from, to)
  const { ranged } = view

  const [query, setQueryText] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const role = view.roles.find((r) => r.id === viewId) ?? null
  const axes = role ? roleAxes(role.id).map((a) => ({ ...a, weight: role.weights[a.id] ?? 0 })) : []
  const shownAxes = role?.edited
    ? classPaths.axes.map((a, i) => ({ ...a, index: i, weight: role.weights[a.id] ?? 0 })).filter((a) => a.weight > 0).sort((a, b) => b.weight - a.weight)
    : axes

  // A row is a unit in the role on show: the picked role, or in the best-fit view the unit's own best role.
  const order = (id: string) => view.roles.findIndex((r) => r.id === id)
  const ranked = units
    .flatMap((u) => {
      const r = role ?? view.roles.find((x) => x.id === view.best.get(u.unit))
      const s = r?.standings.get(u.unit)
      return r && s ? [{ u, r, s, result: r.results.get(u.unit)! }] : []
    })
    .sort((a, b) => (role ? 0 : order(a.r.id) - order(b.r.id)) || a.s.rank - b.s.rank)
  const visible = ranked.filter(({ u }) => unitById.get(u.unit)!.spoiler <= spoilerLevel)
  const q = query.trim().toLowerCase()
  const rows = visible.filter(({ u, r, result }) => {
    if (!q) return true
    const classes = [u.joinClass, ...result.path.map((s) => s.class)].map((id) => classById.get(id)!).filter((c) => classSpoiler(c) <= spoilerLevel)
    return `${unitById.get(u.unit)!.name} ${classes.map((c) => c.name).join(' ')} ${r.label}`.toLowerCase().includes(q)
  })
  const hidden = ranked.length - visible.length
  const absent = units.length - ranked.length
  const caveats = visible.flatMap(({ u }) => u.caveats)
  const simQuery = `cmd=all${role && role.id !== first ? `&role=${role.id}` : ''}${from > 0 ? `&from=${checkpoints[from].id}` : ''}${to < last ? `&to=${checkpoints[to].id}` : ''}`
  const columns = (role ? 7 + shownAxes.length : 7 + view.roles.length)
  const anyEdited = view.roles.some((r) => r.edited)

  return (
    <div>
      <PageHeader
        title="Class Paths"
        subtitle="The class path the growth simulator recommends for each unit in each role, how it gets there, and what it found. A unit's growth rates are its own plus its current class's, so the classes it passes through decide the stats it ends up with."
      >
        <Link to={`/sim?${simQuery}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent">
          Re-run with other rules
        </Link>
      </PageHeader>
      <nav aria-label="Sections" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 border-y border-line py-2 text-sm font-medium">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="text-muted hover:text-ink hover:underline">{label}</a>)}
      </nav>

      <section id="results" className="scroll-mt-24">
        <div className="mb-4 flex flex-wrap gap-1" role="group" aria-label="Rank by">
          {[...view.roles, { id: FIT, label: 'Best-fit role', edited: false }].map((r) => (
            <button
              key={r.id} onClick={() => { setQuery({ role: r.id }); setOpen(null) }} aria-pressed={r.id === viewId}
              className={`rounded-md border bg-surface px-2.5 py-1 text-sm font-medium ${r.id === viewId ? 'border-ink' : 'border-line hover:border-muted'}`}
            >
              {r.id === FIT ? r.label : <RoleChip role={r} />}
            </button>
          ))}
        </div>
        <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
          <Select
            label="Best path for" value={planId} onChange={(v) => { setParams({ ...(viewId !== first && { role: viewId }), ...(v && { plan: v }) }, { replace: true }); setOpen(null) }}
            options={PLANS.map((p) => ({ value: p.id, label: p.label }))}
          />
          <Select
            label="From chapter" value={String(from)} onChange={(v) => setQuery({ from: +v, to: Math.max(+v, to) })}
            options={checkpoints.flatMap((c, i) => (i >= start ? [{ value: String(i), label: c.label }] : []))}
          />
          <Select
            label="To chapter" value={String(to)} onChange={(v) => setQuery({ to: +v })}
            options={checkpoints.flatMap((c, i) => (i >= from ? [{ value: String(i), label: c.label }] : []))}
          />
          {ranged && (
            <button onClick={() => setQuery({ from: start, to: last })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent">
              All its chapters
            </button>
          )}
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Find
            <input
              type="search" value={query} onChange={(e) => setQueryText(e.target.value)} placeholder="A unit or class"
              className="w-48 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-accent"
            />
          </label>
          {!role && (
            <span className="inline-flex items-center gap-2 pb-2 text-xs text-muted">
              below cast <i className="block h-2.5 w-28 rounded-[3px]" style={{ background: `linear-gradient(90deg, ${vsCastTint(-15)}, var(--viz-mid), ${vsCastTint(15)})` }} /> above cast (±15 points)
            </span>
          )}
        </div>
        <p className="mb-3 max-w-4xl text-sm text-muted">
          {role ? (
            <>
              {role.label} score = {shownAxes.map((a) => `${Math.round(a.weight * 100)}% ${a.label}`).join(' + ')}
              {role.edited && <> (your weights, <a href="#roles" className="underline">edited below</a>)</>}. Units are ordered by how far they sit above the cast's average in the
              chapters they are present for.
            </>
          ) : (
            <>
              Each unit under the role it places highest in. A role cell shows the unit's place in the cast (#1 is best) and its points above or below the cast
              average{anyEdited && '; edited roles use your weights'}.
            </>
          )}
          {' '}Click a unit for its path, profile and chapter-by-chapter score.
          {plan.id && (
            <>
              {' '}These paths are the ones that score best from {checkpoints[start].label} on. The classes taken before then are still part of the path, chosen for
              what they leave the unit with and not for how it fights in them.
            </>
          )}
          {fetched.status === 'loading' && ' Loading that plan…'}
          {fetched.status === 'error' && ' That plan could not be loaded, so these are the whole campaign\'s paths.'}
          {ranged && (
            <>
              {' '}Score, vs cast and place count {checkpoints[from].label}{to > from && ` to ${checkpoints[to].label}`} only
              {absent > 0 && `, which leaves out ${absent} ${absent === 1 ? 'unit that has' : 'units that have'} not joined by then`}. The paths and the profile columns are
              still {plan.id ? `the ones picked for ${plan.label}` : "the whole campaign's"}: <Link to={`/sim?${simQuery}`} className="underline">run the simulator over these chapters</Link> for the paths that are best in
              them alone.
            </>
          )}
          {hidden > 0 && ` ${hidden} units are hidden by your spoiler setting, so places skip numbers.`}
        </p>

        {rows.length ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className={`w-full text-sm ${role ? 'min-w-[960px]' : 'min-w-[1320px]'}`}>
              <thead className="border-b border-line bg-surface-2 text-xs text-muted">
                <tr>
                  {role && <th className={`${TH} pl-3 text-right`}>#</th>}
                  <th className={`${TH} text-left ${role ? '' : 'pl-3'}`}>Unit</th>
                  {!role && <th className={`${TH} text-left`}>Best fit</th>}
                  {!role && view.roles.map((r) => <th key={r.id} className={`${TH} text-right`}><RoleChip role={r} className="justify-end" /></th>)}
                  <th className={`${TH} text-left`}>{role ? 'Path' : 'Best-fit path'}</th>
                  <th className={`${TH} text-right`} title={ranged ? 'Average of the role score over the chosen chapters, 0–100' : 'Campaign average of the role score, 0–100'}>Score</th>
                  {role && <th className={`${TH} text-right`} title="Points above the cast's average, chapter by chapter">vs cast</th>}
                  <th className={`${TH} text-right`} title={ranged ? `Role score in ${checkpoints[to].label}` : 'Role score in the final chapter'}>{to < last ? 'Last ch.' : 'Endgame'}</th>
                  <th className={`${TH} text-right`} title="Skill ranks the path's exams need beyond what its classes train">Train</th>
                  {role && shownAxes.map((a) => <th key={a.id} className={`${TH} text-right`} title="Campaign average, 0–100">{a.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ u, r, s, result }) => {
                  const unit = unitById.get(u.unit)!
                  const isOpen = open === u.unit
                  return (
                    <Fragment key={u.unit}>
                      <tr className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2/60" onClick={() => setOpen(isOpen ? null : u.unit)}>
                        {role && <td className="tabular px-3 py-2 text-right text-muted">{s.rank}</td>}
                        <td className={`px-2 py-2 ${role ? '' : 'pl-3'}`}>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={unit.name} id={unit.id} size={32} />
                            <div>
                              <button aria-expanded={isOpen} className="font-semibold hover:text-accent">{unit.name}</button>
                              {u.caveats.length > 0 && <span className="cursor-help text-muted" title={u.caveats.join(' ')}> †</span>}
                              {role && view.best.get(u.unit) === role.id && <span className="ml-1.5"><Badge tone="accent" title="The role this unit places highest in">Best role</Badge></span>}
                              <div className="text-xs whitespace-nowrap text-muted">
                                Lv {u.joinLevel} {classById.get(u.joinClass)?.name}
                                {u.estimated && <span title="Base stats are estimated, not published"> *</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        {!role && <td className="px-2 py-2 whitespace-nowrap"><RoleChip role={r} /></td>}
                        {!role && view.roles.map((ro) => {
                          const x = ro.standings.get(u.unit)
                          return (
                            <td key={ro.id} className="p-[3px]">
                              {x && (
                                <div
                                  className="tabular flex min-w-[52px] flex-col items-end rounded px-1.5 py-0.5 leading-tight" style={{ background: vsCastTint(x.vsCast) }}
                                  title={`${unit.name} as ${ro.label.toLowerCase()}: #${x.rank} in the cast, ${signed(x.vsCast)} vs the cast average, score ${x.score.toFixed(1)}`}
                                >
                                  <b className="text-[13px] font-medium">#{x.rank}</b>
                                  <small className="text-[11px] opacity-80">{signed(x.vsCast)}</small>
                                </div>
                              )}
                            </td>
                          )
                        })}
                        <td className="min-w-[17rem] px-2 py-2" onClick={(e) => e.stopPropagation()}><PathSteps unit={u} path={result.path} /></td>
                        <td className="tabular px-2 py-2 text-right font-semibold">{s.score.toFixed(1)}</td>
                        {role && <td className={`tabular px-2 py-2 text-right ${s.vsCast >= 0 ? 'text-good' : 'text-bad'}`}>{signed(s.vsCast)}</td>}
                        <td className="tabular px-2 py-2 text-right">{s.endgame.toFixed(1)}</td>
                        <td className="tabular px-2 py-2 text-right">{trainLabel(result.train)}</td>
                        {role && shownAxes.map((a) => <td key={a.id} className="tabular px-2 py-2 text-right text-muted">{Math.round(result.axes[a.index])}</td>)}
                      </tr>
                      {isOpen && (
                        <tr className="border-b-2 border-line bg-bg">
                          <td colSpan={columns} className="p-4">
                            <div className="sticky left-4 w-[min(100%,calc(100vw-4rem))] max-w-[70rem]">
                              <UnitDetail key={`${u.unit}:${r.id}`} u={u} view={view} initialRole={r.id} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{q ? `No unit or class matches "${query.trim()}".` : ranked.length ? 'No units to show at this spoiler level.' : 'No unit is present in these chapters.'}</Empty>
        )}
        <p className={`${NOTE} mt-2`}>
          * base stats estimated from growth rates. † the score assumes a way of playing the unit (hover the mark). Train = skill ranks the path's exams ask for beyond
          what the unit's classes give it.
        </p>
      </section>

      <HowSection view={view} />
      <InputsSection data={data} />
      <RolesSection view={view}>
        <WeightEditor
          view={view} sliders={sliders} status={status} initialRole={role?.id ?? first}
          onChange={(id, values) => setSliders((s) => {
            const next = { ...s }
            if (values) next[id] = values
            else delete next[id]
            return next
          })}
        />
      </RolesSection>
      <ChaptersSection view={view} />
      <ClassesSection data={data} />
      <CaveatsSection caveats={caveats} />
    </div>
  )
}

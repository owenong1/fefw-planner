import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { classById, classPaths, classSpoiler, unitById } from '../../data'
import type { PathsView } from '../../data/pathModel'
import { classFitTint, roleColor, TIER_INFO } from '../../lib/display'
import { useSettings } from '../../lib/settings'
import { Legend, LineChart, TipRow } from '../LineChart'
import { ClassIcon, Select } from '../ui'
import { GrowthStack, NOTE, Panel, RoleChip, Section } from './parts'
import { AXIS_TEXT, chapterAxis } from './shared'

const { counts, checkpoints, axes, tiers, units, scope } = classPaths
const nf = (n: number) => n.toLocaleString('en-US')
const TH = 'border-b border-line px-2 py-1.5 text-xs font-semibold text-muted whitespace-nowrap'

/** The five steps behind every score, and the first of them worked through for one unit. */
export function HowSection({ view }: { view: PathsView }) {
  const { spoilerLevel } = useSettings()
  const shown = units.filter((u) => unitById.get(u.unit)!.spoiler <= spoilerLevel && unitById.get(u.unit)!.growths)
    .sort((a, b) => unitById.get(a.unit)!.name.localeCompare(unitById.get(b.unit)!.name))
  const [unitId, setUnitId] = useState(shown[0]?.unit ?? '')
  const [picked, setPicked] = useState<string | null>(null)
  const u = shown.find((x) => x.unit === unitId) ?? shown[0]
  const role = view.roles.find((r) => r.id === (picked ?? (u && view.best.get(u.unit)))) ?? view.roles[0]
  const unit = u && unitById.get(u.unit)!
  const first = u && classById.get(role.results.get(u.unit)?.path[0]?.class ?? u.joinClass)
  const steps: [string, ReactNode][] = [
    ['Growth', 'On each level-up every stat rises by 1 with a chance of unit growth + class growth.'],
    ['Class path', `Classes change at ${tiers.map((t) => `Lv${t.level}`).join(' / ')} or later. Each change must pass an exam${classPaths.maxExamGap == null ? '' : ` within ${classPaths.maxExamGap} skill rank of what the unit would have`}.`],
    ['Combat', `At each of ${checkpoints.length} chapters the unit fights that chapter's reference enemies. Every exchange is resolved exactly, with no dice.`],
    ['Profile', `The fights become ${axes.length} axes from 0 to 100: damage, safety, bulk, avoid, survival, support, reach.`],
    ['Role score', "A role weights the axes. Paths are ranked inside a role, and units are placed against the cast's average in each chapter."],
  ]
  return (
    <Section
      id="how" title="How a number is made"
      lede="Every score on this page comes out of the same five steps. A unit's growth rates are its own plus its current class's, so the classes it passes through decide the stats it ends up with."
    >
      <ol className="grid gap-2.5 lg:grid-cols-5">
        {steps.map(([title, text], i) => (
          <li key={title} className="relative flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-surface p-3">
            <span className="tabular text-xs font-medium text-muted">{i + 1}</span>
            <b className="text-sm">{title}</b>
            <span className="text-[13px] leading-snug text-muted">{text}</span>
            {i < steps.length - 1 && <span aria-hidden className="absolute top-2.5 -right-2.5 z-[1] hidden text-xs text-muted lg:block">→</span>}
          </li>
        ))}
      </ol>
      {u && unit && first && (
        <Panel>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
            <h3 className="pb-1.5 text-sm font-semibold">Step 1 for one unit</h3>
            <Select label="Unit" value={u.unit} onChange={(id) => { setUnitId(id); setPicked(null) }} options={shown.map((x) => ({ value: x.unit, label: unitById.get(x.unit)!.name }))} />
            <Select label="Path for" value={role.id} onChange={setPicked} options={view.roles.map((r) => ({ value: r.id, label: r.label }))} />
          </div>
          <p className={NOTE}>
            {unit.name} in {first.name}, the first class of the recommended {role.label.toLowerCase()} path. Each bar is the chance that stat rises on a level-up.
          </p>
          <GrowthStack own={unit.growths!} cls={first.growths} unitName={unit.name} className={first.name} color={roleColor(role.id)} />
        </Panel>
      )}
    </Section>
  )
}

function Stack({ parts }: { parts: { n: number; label: string; color: string }[] }) {
  return (
    <div>
      <div className="flex h-3.5 gap-0.5">
        {parts.map((p) => <i key={p.label} className="block min-w-[3px] rounded-[3px]" style={{ flex: `${p.n} 1 0`, background: p.color }} title={`${p.n} ${p.label}`} />)}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-muted">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1.5">
            <i className="inline-block size-2.5 rounded-[3px]" style={{ background: p.color }} />
            <b className="tabular font-semibold text-ink">{p.n}</b> {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** How much data went in, and how much of it is published rather than estimated or assumed. */
export function InputsSection() {
  const facts: [string, string][] = [
    [String(counts.units), 'units'], [String(counts.classes), 'classes'], [String(counts.weapons), 'weapons and spells'],
    [String(checkpoints.length), 'chapters measured'], [nf(counts.paths), 'class paths kept and compared'],
  ]
  return (
    <Section id="inputs" title="What goes in">
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="The data">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {facts.map(([n, label]) => (
              <div key={label} className="flex flex-col">
                <b className="tabular text-xl font-semibold">{n}</b>
                <span className="text-xs text-muted">{label}</span>
              </div>
            ))}
          </div>
          <p className={NOTE}>Growths, classes and weapons come from Serenes Forest and Game8. Base stats and enemy stat lines come from the Fire Emblem Wiki.</p>
        </Panel>
        <Panel title="How firm it is">
          <div className="grid grid-cols-[max-content_1fr] items-center gap-x-3.5 gap-y-2.5">
            <span className="text-[13px] font-medium">Unit base stats</span>
            <Stack parts={[{ n: counts.units - counts.estimatedBases, label: 'published', color: 'var(--viz-1)' }, { n: counts.estimatedBases, label: 'estimated from growth rates (marked *)', color: 'var(--viz-3)' }]} />
            <span className="text-[13px] font-medium">Abilities</span>
            <Stack parts={[{ n: counts.abilitiesScored, label: 'scored', color: 'var(--viz-1)' }, { n: counts.abilities - counts.abilitiesScored, label: 'not scored (need allies, positioning or Blaze arts)', color: 'var(--viz-3)' }]} />
            <span className="text-[13px] font-medium">Rules</span>
            <Stack parts={[{ n: counts.basis.documented ?? 0, label: 'documented by the game', color: 'var(--viz-1)' }, { n: counts.basis.observed ?? 0, label: 'observed', color: 'var(--viz-2)' }, { n: counts.basis.assumed ?? 0, label: 'assumed', color: 'var(--viz-3)' }]} />
          </div>
          <p className={NOTE}>Enemies: {counts.observedEnemies} stat lines are published. Every reference enemy is drawn from a model fitted to those lines.</p>
        </Panel>
      </div>
    </Section>
  )
}

/** The role weights as a table, the sliders that change them (`children`), and what each axis means. */
export function RolesSection({ view, children }: { view: PathsView; children: ReactNode }) {
  return (
    <Section
      id="roles" title="Axes and roles"
      lede="A role is a weighting of the profile axes. Each role keeps one colour everywhere on this page. Scores compare paths and units inside a role; a unit's scores in two different roles are not comparable."
    >
      <Panel className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Role</th>
              {axes.map((a) => <th key={a.id} className={`${TH} text-right`} title={AXIS_TEXT[a.id]}>{a.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.roles.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className="px-2 py-1.5 whitespace-nowrap"><RoleChip role={r} /></td>
                {axes.map((a) => {
                  const w = r.weights[a.id]
                  return (
                    <td key={a.id} className="p-[3px]">
                      {w ? (
                        <div
                          className="tabular rounded px-1.5 py-1 text-center text-xs font-medium text-white"
                          style={{ background: `color-mix(in oklab, ${roleColor(r.id)} ${Math.round(45 + w * 55)}%, #14120f)` }}
                          title={`${r.label}: ${Math.round(w * 100)}% of the score is ${a.label}`}
                        >
                          {Math.round(w * 1000) / 10}%
                        </div>
                      ) : null}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {children}
      <Panel title="What each axis measures">
        <dl className="grid gap-x-3.5 gap-y-1.5 text-[13px] sm:grid-cols-[max-content_1fr]">
          {axes.map((a) => (
            <div key={a.id} className="contents">
              <dt className="font-semibold">{a.label}</dt>
              <dd className="mb-1.5 text-muted sm:mb-0">{AXIS_TEXT[a.id]}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </Section>
  )
}

/** The levels the simulator expects through the story, and how high the cast scores in each chapter. */
export function ChaptersSection({ view }: { view: PathsView }) {
  const { spoilerLevel } = useSettings()
  const top = Math.ceil(Math.max(...checkpoints.map((c) => Math.max(c.playerLevel, c.enemyLevel, c.bossLevel ?? 0))) / 10) * 10
  const band: [number, number] | undefined = view.ranged ? [view.from, view.to] : undefined
  const enemy = (id: string) => {
    const cls = classById.get(id)!
    return classSpoiler(cls) > spoilerLevel ? `${TIER_INFO[cls.tier].label} class` : cls.name
  }
  return (
    <Section
      id="chapters" title="Chapters"
      lede="Everything is measured chapter by chapter. Levels rise through the story, class tiers open along the way, and the same unit scores very differently early and late."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Expected level by chapter">
          <Legend items={[{ label: 'your units', color: 'var(--viz-pos)' }, { label: 'enemies', color: 'var(--ink)' }, { label: 'boss (dashed)', color: 'var(--muted)', dashed: true }]} />
          <LineChart
            label="Expected player, enemy and boss level in each chapter" {...chapterAxis} y0={0} y1={top} band={band}
            ticks={Array.from({ length: top / 10 + 1 }, (_, i) => i * 10)}
            refs={tiers.map((t) => ({ value: t.level, label: `${t.tier} Lv${t.level}` }))}
            series={[
              { color: 'var(--muted)', dashed: true, points: checkpoints.flatMap((c, i) => (c.bossLevel == null ? [] : [[i, c.bossLevel] as [number, number]])) },
              { color: 'var(--ink)', points: checkpoints.map((c, i) => [i, c.enemyLevel]) },
              { color: 'var(--viz-pos)', points: checkpoints.map((c, i) => [i, c.playerLevel]) },
            ]}
            tip={(i) => (
              <>
                <b>{checkpoints[i].label}</b>
                <TipRow label="Your units" value={`Lv${checkpoints[i].playerLevel}`} color="var(--viz-pos)" />
                <TipRow label="Enemies" value={`Lv${checkpoints[i].enemyLevel}`} color="var(--ink)" />
                {checkpoints[i].bossLevel != null && <TipRow label="Boss" value={`Lv${checkpoints[i].bossLevel}`} color="var(--muted)" />}
                <div className="mt-1 text-muted">Reference enemies: {checkpoints[i].refs.map((r) => `${enemy(r.class)} (${r.archetype})`).join(', ')}</div>
              </>
            )}
          />
          <p className={NOTE}>Dotted lines mark the level each class tier opens. Hover a chapter for its reference enemies.</p>
        </Panel>
        <Panel title="Cast average score by chapter, per role">
          <Legend items={view.roles.map((r) => ({ label: r.label, color: roleColor(r.id) }))} />
          <LineChart
            label="Cast average score per role in each chapter" {...chapterAxis} y0={0} y1={100} ticks={[0, 25, 50, 75, 100]} band={band}
            series={view.roles.map((r) => ({ color: roleColor(r.id), points: r.castAvg.flatMap((v, i) => (v == null ? [] : [[i, v] as [number, number]])) }))}
            tip={(i) => (
              <>
                <b>{checkpoints[i].label}</b>
                {view.roles.filter((r) => r.castAvg[i] != null).sort((a, b) => b.castAvg[i]! - a.castAvg[i]!)
                  .map((r) => <TipRow key={r.id} label={r.label} value={r.castAvg[i]!.toFixed(1)} color={roleColor(r.id)} />)}
              </>
            )}
          />
          <p className={NOTE}>
            Each line is the average, over every unit present, of its recommended path for that role. Because chapters differ this much, units are ranked on how far
            they sit above this line, not on a raw campaign average.{view.ranged && ' The shaded chapters are the ones the results count.'}
          </p>
        </Panel>
      </div>
    </Section>
  )
}

/** What passing through each class costs a unit, per role and tier. */
export function ClassesSection() {
  const { spoilerLevel } = useSettings()
  const { roles } = classPaths
  return (
    <Section
      id="classes" title="Classes"
      lede="For each role, the points a unit loses on average by passing through this class instead of its best option at that tier. 0.0 means the class is always the best choice. The small figure is how many units it is the best option for."
    >
      <div className="inline-flex items-center gap-2 text-xs text-muted">
        costs 6+ points <i className="block h-2.5 w-28 rounded-[3px]" style={{ background: `linear-gradient(90deg, ${classFitTint(-6)}, ${classFitTint(0)})` }} /> always best
      </div>
      {classPaths.classTiers.map((t) => {
        const best = (c: (typeof t.classes)[number]) => Math.max(...roles.map((r) => c.roles[r.id]?.gap ?? -99))
        const list = t.classes.filter((c) => classSpoiler(classById.get(c.class)!) <= spoilerLevel).sort((a, b) => best(b) - best(a))
        if (!list.length) return <p key={t.tier} className={NOTE}>The {t.tier} classes are hidden by your spoiler setting.</p>
        return (
          <Panel key={t.tier} title={<span className="capitalize">{t.tier}</span>} className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr>
                  <th className={`${TH} text-left`}>Class</th>
                  <th className={`${TH} text-left`}>Type</th>
                  <th className={`${TH} text-right`}>Mov</th>
                  {roles.map((r) => <th key={r.id} className={`${TH} text-right`}><RoleChip role={r} className="justify-end" /></th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const cls = classById.get(c.class)!
                  return (
                    <tr key={c.class} className="border-b border-line last:border-0">
                      <td className="px-2 py-1 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <ClassIcon name={cls.name} id={cls.id} size={20} />
                          <Link to={`/classes/${cls.id}`} className="font-semibold hover:text-accent">{cls.name}</Link>
                        </span>
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap text-muted">{c.types.join(' / ')}</td>
                      <td className="tabular px-2 py-1 text-right">{c.mov}</td>
                      {roles.map((r) => {
                        const x = c.roles[r.id]
                        return x ? (
                          <td key={r.id} className="p-[3px]">
                            <div
                              className="tabular flex min-w-[52px] flex-col items-end rounded px-1.5 py-0.5 leading-tight"
                              style={{ background: classFitTint(x.gap) }}
                              title={`${cls.name} for ${r.label.toLowerCase()}: ${Math.abs(x.gap).toFixed(1)} points lost on average; best option for ${x.best} of ${x.n} units`}
                            >
                              <b className="text-[13px] font-medium">{x.gap > -0.05 ? '0.0' : `−${Math.abs(x.gap).toFixed(1)}`}</b>
                              <small className="text-[11px] opacity-80">{x.best}/{x.n}</small>
                            </div>
                          </td>
                        ) : (
                          <td key={r.id} className="px-2 py-1 text-right text-muted">–</td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
        )
      })}
    </Section>
  )
}

const SCOPE_ROUTE: Record<string, string> = { common: 'classes every route unlocks', any: 'every class, route exclusives included' }

/** What to keep in mind before reading a number as fact. `caveats` are the play-style assumptions of the units on show. */
export function CaveatsSection({ caveats }: { caveats: string[] }) {
  const items: [string, ReactNode][] = [
    ['These are simulated, not played.', <>
      The search used {SCOPE_ROUTE[scope.route] ?? `classes on ${scope.route}'s route`}, {scope.hard ? 'hard' : 'normal'} difficulty,
      {scope.divine ? ' Divine classes included' : ' no Divine classes'}
      {scope.runs > 0 && `, with each role's leading paths replayed ${scope.runs} times with level-ups rolled`}.
    </>],
    ['Enemy stats are mostly modelled.', `Only ${counts.observedEnemies} enemy stat lines are published, none above Lv45. Out of sample the model is off by 3 to 7 points per stat, and Part III is extrapolation.`],
    [`${counts.estimatedBases} of ${counts.units} units have estimated base stats,`, 'from a regression on their growth rates. They carry a * everywhere. Units that join late start from their join class.'],
    ['Skill ranks are estimated, not simulated.', "Train is the number of skill ranks a path's exams ask for beyond what its classes teach: a guide to how much Arena or manual work it needs, not a guarantee."],
    ['One or two classes often lead a role for most of the cast.', 'The tool is better at telling you which role a unit suits than at separating near-identical paths.'],
    [`${counts.abilities - counts.abilitiesScored} of ${counts.abilities} abilities are not scored`, 'because they depend on allies, positioning, Blaze arts or earlier fights in the map.'],
    ...(caveats.length ? [['Units marked † only earn their score if they are played a certain way.', `${caveats.join(' ')} The combat arts themselves are not simulated, only the abilities' bonuses for using them.`] as [string, ReactNode]] : []),
    ['Role weights, the Dance value and the enemy mix are judgment calls.', 'The sliders above change the weights; the rest are settings of the simulator.'],
    ['Not modelled:', 'combat arts themselves, gambits, mastery abilities, mounts, shields, terrain, supports and stat caps.'],
    ['A level beside a class', `means the change is taken later than the tier's usual level (${tiers.map((t) => t.level).join(' / ')}).`],
  ]
  return (
    <Section id="caveats" title="Before trusting a number">
      <ul className="flex max-w-4xl list-disc flex-col gap-2 pl-5 text-sm text-muted">
        {items.map(([head, body]) => <li key={head}><b className="font-semibold text-ink">{head}</b> {body}</li>)}
        <li>
          The <Link to="/sim" className="underline">simulator</Link> runs the same search in your browser: other routes, hard difficulty, Divine classes, one unit's ranked
          paths chapter by chapter, or a path of your own.
        </li>
      </ul>
    </Section>
  )
}

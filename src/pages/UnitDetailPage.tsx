import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { RecruitmentByRoute } from '../components/Recruitment'
import { SpoilerGate } from '../components/Spoiler'
import { GrowthBars } from '../components/Stats'
import { Avatar, Badge, Card, SectionTitle, Select } from '../components/ui'
import {
  APTITUDE_LABELS, aptitudeFit, canUseClass, classById, classes, classRestrictions, classSpoiler, combinedGrowths,
  growthTotal, skillById, unitById,
} from '../data'
import { CLASS_TIERS, STAT_KEYS, STAT_LABELS } from '../data/constants'
import { useSettings } from '../lib/settings'
import { NotFoundPage } from './NotFoundPage'

export function UnitDetailPage() {
  const { id } = useParams()
  const unit = id ? unitById.get(id) : undefined
  const [clsId, setClsId] = useState('')
  const { spoilerLevel } = useSettings()
  if (!unit) return <NotFoundPage what="unit" />

  const cls = classById.get(clsId)
  const personal = unit.personalSkill ? skillById.get(unit.personalSkill) : undefined
  const growths = combinedGrowths(unit, cls)
  const restrictions = classRestrictions(unit)
  const shown = classes.filter((c) => c.tier !== 'base' && (classSpoiler(c) <= spoilerLevel || c.id === clsId))
  const usable = shown.filter((c) => classSpoiler(c) <= spoilerLevel && canUseClass(unit, c))
  const favoredClasses = usable.filter((c) => aptitudeFit(unit, c) === 'favored')

  return (
    <SpoilerGate level={unit.spoiler}>
      <div className="mb-2 text-sm text-muted">
        <Link to="/units" className="hover:underline">Units</Link> /
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar name={unit.name} id={unit.id} size={64} />
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wide">{unit.name}</h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {unit.lord && <Badge tone="accent">Flame Lord</Badge>}
            {unit.faction && <Badge>{unit.faction}</Badge>}
            {unit.startingClass && (
              <Badge title="Starting class (Fextralife)">
                Starts as <Link to={`/classes/${unit.startingClass}`} className="underline">{classById.get(unit.startingClass)?.name}</Link>
              </Badge>
            )}
            {unit.spoiler > 0 && <Badge tone="bad">Spoiler</Badge>}
          </div>
        </div>
        {unit.growths && (
          <Link
            to={`/rng?u=${unit.id}`}
            className="ml-auto rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent"
          >
            Check {unit.name}’s RNG
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
        <div className="grid content-start gap-4">
          <Card>
            <SectionTitle>Personal skill</SectionTitle>
            {personal ? (
              <div>
                <p className="font-semibold">{personal.name}</p>
                <p className="mt-0.5 text-sm text-muted">{personal.effect}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">Not documented yet.</p>
            )}
            {unit.levelSkills.length > 0 && (
              <div className="mt-4 grid gap-2 border-t border-line pt-3">
                <p className="text-xs font-semibold text-muted">Level abilities</p>
                {unit.levelSkills.map((ls) => {
                  const s = skillById.get(ls.skill)!
                  return (
                    <div key={ls.skill} className="text-sm">
                      <span className="font-semibold">{s.name}</span>
                      {ls.level != null && <span className="ml-1.5 text-xs text-muted">Lv {ls.level}</span>}
                      <p className="text-muted">{s.effect}</p>
                    </div>
                  )
                })}
              </div>
            )}
            {unit.bloodmarks.length > 0 && (
              <div className="mt-4 grid gap-2 border-t border-line pt-3">
                <p className="text-xs font-semibold text-muted">Bloodmarks</p>
                {unit.bloodmarks.map((b) => {
                  const s = skillById.get(b)!
                  return (
                    <div key={b} className="text-sm">
                      <span className="font-semibold">{s.name}</span>
                      {s.crest && <span className="ml-1.5 text-xs text-muted">Crest: {s.crest}</span>}
                      <p className="text-muted">{s.effect}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>Aptitudes</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {unit.aptitudes.favored.map((a) => <Badge key={a} tone="good">▲ {APTITUDE_LABELS[a]}</Badge>)}
              {unit.aptitudes.unfavored.map((a) => <Badge key={a} tone="bad">▼ {APTITUDE_LABELS[a]}</Badge>)}
              {unit.aptitudes.favored.length + unit.aptitudes.unfavored.length === 0 && (
                <span className="text-sm text-muted">Not documented yet.</span>
              )}
            </div>
            {restrictions.length > 0 && (
              <p className="mt-3 text-sm text-bad">Cannot change to mounted or flying classes.</p>
            )}
            {favoredClasses.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="mb-1.5 text-xs font-semibold text-muted">Classes that use a favored weapon skill</p>
                <div className="flex flex-wrap gap-1">
                  {favoredClasses.map((c) => (
                    <Link key={c.id} to={`/classes/${c.id}`} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs hover:text-accent">
                      {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {unit.magic && (
            <Card>
              <SectionTitle>Magic learned by rank</SectionTitle>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-1 text-left">Rank</th>
                    <th className="py-1 text-left">White</th>
                    <th className="py-1 text-left">Black</th>
                  </tr>
                </thead>
                <tbody>
                  {(['D', 'C', 'B', 'A', 'S'] as const).map((r) => (
                    <tr key={r} className="border-t border-line">
                      <td className="py-1 font-semibold">{r}</td>
                      <td className="py-1">{unit.magic!.white[r] ?? <span className="text-muted">–</span>}</td>
                      <td className="py-1">{unit.magic!.black[r] ?? <span className="text-muted">–</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
              <SectionTitle>Growth rates</SectionTitle>
              <Select
                label="As class"
                value={clsId}
                onChange={setClsId}
                options={[
                  { value: '', label: 'Personal (no class)' },
                  ...CLASS_TIERS.flatMap((tier) =>
                    shown
                      .filter((c) => c.tier === tier)
                      .map((c) => ({ value: c.id, label: `${c.name}${canUseClass(unit, c) ? '' : ' (unavailable)'}` })),
                  ),
                ]}
              />
            </div>
            {growths ? (
              <>
                <GrowthBars growths={growths} compareTo={cls ? unit.growths! : undefined} />
                <p className="mt-3 text-right text-xs text-muted">Total {growthTotal(growths)}%</p>
              </>
            ) : (
              <p className="text-sm text-muted">Not documented yet.</p>
            )}
          </Card>

          <Card>
            <SectionTitle>Base stats{unit.baseLevel != null && ` · Lv ${unit.baseLevel}, no class`}</SectionTitle>
            {unit.baseStats ? (
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-9">
                {STAT_KEYS.map((k) => (
                  <div key={k} className="rounded-lg bg-surface-2 py-2 text-center">
                    <div className="text-[11px] font-semibold text-muted">{STAT_LABELS[k]}</div>
                    <div className="tabular text-lg font-bold">{unit.baseStats![k]}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted">Not published by any source yet.</p>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card>
          <SectionTitle>How to recruit</SectionTitle>
          {unit.recruitment.length ? <RecruitmentByRoute unit={unit} /> : <p className="text-sm text-muted">Not documented yet.</p>}
        </Card>
      </div>

      {unit.notes.length > 0 && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-4 text-sm">
          <p className="mb-1 font-semibold">Notes</p>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            {unit.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </div>
      )}
    </SpoilerGate>
  )
}

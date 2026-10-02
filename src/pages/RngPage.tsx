import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Avatar, Card, Empty, PageHeader, SectionTitle } from '../components/ui'
import { canUseClass, classById, classes, skillById, unitById, units } from '../data'
import { CLASS_TIERS, STAT_KEYS, STAT_LABELS, type StatKey } from '../data/constants'
import type { Unit } from '../data/schema'
import {
  analyzeOverall, analyzeStat, levelUpGrowths, type ClassSegment, type Rank, type StatResult,
} from '../engine/growth'
import { ordinal, percentileColor, RANK_COLOR, TIER_INFO } from '../lib/display'
import { hasFixedBase, parseInput, serializeInput, type ClassEntry, type RngInput } from '../lib/rngInput'
import { useSettings } from '../lib/settings'

const inputCls =
  'w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink tabular focus:outline-2 focus:outline-accent'

/** Classes whose growths rise with level by an unpublished formula (Charioteer's / Elephant Rider's Path). */
const SCALING_CLASSES = new Set(
  classes
    .filter((c) => c.skills.some((s) => /growth rate increases with level/i.test(skillById.get(s)?.effect ?? '')))
    .map((c) => c.id),
)

const sign = (n: number) => (n > 0 ? `+${n}` : String(n))

function NumberInput({
  value, onChange, label, placeholder, className = '',
}: { value: number | null; onChange: (v: number | null) => void; label: string; placeholder?: string; className?: string }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Math.trunc(Number(e.target.value)))}
      className={`${inputCls} ${className}`}
    />
  )
}

function ClassSelect({ unit, value, onChange, label }: { unit: Unit; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {CLASS_TIERS.map((tier) => (
        <optgroup key={tier} label={TIER_INFO[tier].label}>
          {classes
            .filter((c) => c.tier === tier)
            .map((c) => (
              <option key={c.id} value={c.id} disabled={!canUseClass(unit, c) && c.id !== value}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  )
}

function RankBadge({ rank, size = 'sm' }: { rank: Rank | null; size?: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? 'h-16 w-16 text-3xl rounded-xl' : 'h-7 w-8 text-sm rounded-md'
  if (!rank) {
    return <span className={`${dims} inline-flex shrink-0 items-center justify-center border border-dashed border-line text-muted`}>–</span>
  }
  return (
    <span
      className={`${dims} inline-flex shrink-0 items-center justify-center font-display font-bold`}
      style={{ background: RANK_COLOR[rank], color: 'var(--bg)' }}
      title={`Rank ${rank}`}
    >
      {rank}
    </span>
  )
}

/** Percentile as a filled track, with a tick at the median (an exactly average run). */
function PercentileBar({ pct }: { pct: number | null }) {
  return (
    <div className="relative h-2 rounded-full bg-surface-2">
      {pct != null && (
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: percentileColor(pct) }} />
      )}
      <div aria-hidden className="absolute -top-0.5 -bottom-0.5 left-1/2 w-px bg-muted/60" />
    </div>
  )
}

function ChangeCell({ r }: { r: StatResult | undefined }) {
  if (!r) return <span className="text-xs text-muted">Enter the base stat</span>
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-xs whitespace-nowrap tabular">
          <span>
            {r.gain != null ? <span className="text-sm font-semibold">{sign(r.gain)}</span> : <span className="text-muted">—</span>}
            <span className="ml-1.5 hidden text-muted sm:inline">
              avg +{r.mean.toFixed(1)} ± {r.sd.toFixed(1)}
            </span>
          </span>
          {r.percentile != null && <span className="hidden text-muted sm:inline">{ordinal(Math.floor(r.percentile))} pct</span>}
        </div>
        <PercentileBar pct={r.percentile} />
      </div>
      <RankBadge rank={r.rank} />
    </div>
  )
}

function issueText(k: StatKey, r: StatResult, base: number, levelUps: number) {
  if (r.issue === 'below-base') return `${STAT_LABELS[k]} is below its base of ${base}. Did a debuff lower it?`
  if (r.issue === 'unreachable') {
    return `${STAT_LABELS[k]} ${base + r.gain!} is unreachable: at most ${sign(r.maxGain)} over ${levelUps} level-ups (max ${base + r.maxGain}). Subtract stat boosters and class bonuses.`
  }
  return null
}

/** Notes for one class-history entry, in the order the entries were entered. */
function classNotes(entries: ClassEntry[], i: number, startLevel: number | null, level: number | null): string[] {
  const e = entries[i]
  const cls = classById.get(e.classId)
  const notes: string[] = []
  if (i > 0) {
    const prev = i === 1 ? startLevel : entries[i - 1].fromLevel
    if (e.fromLevel == null) notes.push('Enter the level you changed class at.')
    else if (startLevel != null && e.fromLevel <= startLevel) notes.push(`Must be after the start level (Lv ${startLevel}).`)
    else if (level != null && e.fromLevel > level) notes.push(`After the current level (Lv ${level}), so it has no effect.`)
    else if (prev != null && e.fromLevel <= prev) notes.push('Must be after the previous class change.')
    const req = cls?.requirements?.level
    if (req && e.fromLevel != null && e.fromLevel < req) notes.push(`${cls!.name} needs Lv ${req}.`)
  }
  if (SCALING_CLASSES.has(e.classId)) notes.push('Growths rise with level in this class by an unpublished formula, so results are approximate.')
  return notes
}

function levelsIn(entries: ClassEntry[], i: number, startLevel: number | null, level: number | null) {
  const from = i === 0 ? startLevel : entries[i].fromLevel
  const to = entries[i + 1]?.fromLevel ?? level
  if (from == null || to == null) return null
  return { from, to, ups: Math.max(0, to - from) }
}

export function RngPage() {
  const [params, setParams] = useSearchParams()
  const { spoilerLevel } = useSettings()
  const [copied, setCopied] = useState(false)
  const input = useMemo(() => parseInput(params, unitById), [params])
  const unit = unitById.get(input.unitId)
  const fixedBase = hasFixedBase(unit)

  const update = (patch: Partial<RngInput>) => setParams(serializeInput({ ...input, ...patch }, unit), { replace: true })
  const setStat = (which: 'base' | 'final', k: StatKey, v: number | null) => update({ [which]: { ...input[which], [k]: v } })
  const setClass = (i: number, patch: Partial<ClassEntry>) =>
    update({ classes: input.classes.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  const pickable = units.filter((u) => u.growths && (u.spoiler <= spoilerLevel || u.id === input.unitId))

  const analysis = useMemo(() => {
    const unit = unitById.get(input.unitId)
    if (!unit?.growths || input.startLevel == null || input.level == null) return null
    const segments: ClassSegment[] = input.classes.flatMap((c, i) => {
      const cls = classById.get(c.classId)
      const from = i === 0 ? input.startLevel : c.fromLevel
      return cls && from != null ? [{ fromLevel: from, growths: cls.growths }] : []
    })
    const growths = levelUpGrowths(unit.growths, segments, input.startLevel, input.level)
    const stats: Partial<Record<StatKey, StatResult>> = {}
    for (const k of STAT_KEYS) {
      const base = input.base[k]
      if (base != null) stats[k] = analyzeStat(growths[k], base, input.final[k])
    }
    return { levelUps: Math.max(0, input.level - input.startLevel), stats, overall: analyzeOverall(stats) }
  }, [input])

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: the address bar still has the link
    }
  }

  const levelError =
    input.startLevel != null && input.level != null && input.level < input.startLevel
      ? `Current level is below the start level (Lv ${input.startLevel}).`
      : null
  const enteredFinal = STAT_KEYS.some((k) => input.final[k] != null)

  return (
    <div>
      <PageHeader
        title="RNG Checker"
        subtitle="Enter a unit’s level, current stats and the classes they levelled up in, and see how lucky their level-ups were."
      >
        {unit && (
          <div className="flex gap-2">
            <button onClick={copyLink} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:border-accent">
              {copied ? 'Copied!' : 'Copy link'}
            </button>
            <button
              onClick={() => setParams({ u: unit.id }, { replace: true })}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted hover:text-ink"
            >
              Reset
            </button>
          </div>
        )}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <Card>
            <SectionTitle>Unit</SectionTitle>
            <div className="flex items-center gap-3">
              {unit ? (
                <Link to={`/units/${unit.id}`} title={`${unit.name}’s page`}>
                  <Avatar name={unit.name} id={unit.id} size={44} />
                </Link>
              ) : (
                <span className="size-11 shrink-0 rounded-full border border-dashed border-line" />
              )}
              <select
                aria-label="Unit"
                value={input.unitId}
                onChange={(e) => setParams(e.target.value ? { u: e.target.value } : {}, { replace: true })}
                className={inputCls}
              >
                <option value="">Choose a unit…</option>
                {pickable.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            {unit && (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {fixedBase ? (
                  <div className="flex flex-col gap-1 text-xs font-medium text-muted">
                    Start level
                    <span className="rounded-lg bg-surface-2 px-2 py-1.5 text-sm text-ink tabular">{input.startLevel}</span>
                  </div>
                ) : (
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                    Start level
                    <NumberInput label="Start level" value={input.startLevel} onChange={(v) => update({ startLevel: v })} />
                  </label>
                )}
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                  Current level
                  <NumberInput label="Current level" value={input.level} placeholder="Lv" onChange={(v) => update({ level: v })} />
                </label>
              </div>
            )}
            {levelError && <p className="mt-2 text-sm text-bad">{levelError}</p>}
            {unit && !unit.baseStats && (
              <p className="mt-3 text-sm text-muted">
                {unit.name}’s base stats aren’t published yet. Enter the level and stats they joined with as the base.
              </p>
            )}
          </Card>

          {unit && (
            <Card>
              <SectionTitle>Class history</SectionTitle>
              <ol className="grid gap-3">
                {input.classes.map((c, i) => {
                  const span = levelsIn(input.classes, i, input.startLevel, input.level)
                  const notes = classNotes(input.classes, i, input.startLevel, input.level)
                  return (
                    <li key={i} className="grid gap-1.5">
                      <div className="flex items-center gap-2">
                        {i === 0 ? (
                          <span className="w-16 shrink-0 text-xs font-medium text-muted">From start</span>
                        ) : (
                          <label className="flex w-16 shrink-0 items-center gap-1 text-xs font-medium text-muted">
                            Lv
                            <NumberInput label={`Level of class change ${i}`} value={c.fromLevel} onChange={(v) => setClass(i, { fromLevel: v })} className="px-1.5" />
                          </label>
                        )}
                        <ClassSelect unit={unit} label={i === 0 ? 'Starting class' : `Class change ${i}`} value={c.classId} onChange={(v) => setClass(i, { classId: v })} />
                        {i > 0 && (
                          <button
                            onClick={() => update({ classes: input.classes.filter((_, j) => j !== i) })}
                            aria-label={`Remove class change ${i}`}
                            className="shrink-0 rounded-md px-1.5 py-1 text-muted hover:bg-surface-2 hover:text-bad"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {span && (
                        <p className="pl-[4.5rem] text-xs text-muted tabular">
                          Lv {span.from}–{span.to} · {span.ups} level-up{span.ups === 1 ? '' : 's'}
                        </p>
                      )}
                      {notes.map((n) => (
                        <p key={n} className="pl-[4.5rem] text-xs text-bad">{n}</p>
                      ))}
                    </li>
                  )
                })}
              </ol>
              <button
                onClick={() => {
                  const last = input.classes.at(-1)!
                  const prev = input.classes.length === 1 ? input.startLevel : last.fromLevel
                  const req = classById.get(last.classId)?.requirements?.level
                  update({ classes: [...input.classes, { classId: last.classId, fromLevel: prev != null ? Math.max(prev + 1, req ?? 0) : null }] })
                }}
                className="mt-3 w-full rounded-lg border border-dashed border-line py-1.5 text-sm font-medium text-muted hover:border-accent hover:text-ink"
              >
                + Add class change
              </button>
            </Card>
          )}
        </div>

        <div className="grid content-start gap-4">
          {!unit ? (
            <Empty>Choose a unit to start. Their published base stats and starting class fill in automatically.</Empty>
          ) : (
            <>
              <Card>
                {analysis?.overall && !levelError ? (
                  <div className="flex items-center gap-4">
                    <RankBadge rank={analysis.overall.rank} size="lg" />
                    <div className="min-w-0">
                      <p className="font-display text-2xl font-bold">Rank {analysis.overall.rank}</p>
                      <p className="text-muted">
                        Luckier than {Math.floor(analysis.overall.percentile)}% of possible runs over {analysis.levelUps} level-up
                        {analysis.levelUps === 1 ? '' : 's'}.
                      </p>
                      <p className="mt-1 text-xs text-muted tabular">
                        Total {sign(analysis.overall.gain)} (avg +{analysis.overall.mean.toFixed(1)}) · mean stat percentile{' '}
                        {ordinal(Math.floor(analysis.overall.meanPercentile))}
                        {analysis.overall.stats.length < STAT_KEYS.length && ` · ${analysis.overall.stats.length} of ${STAT_KEYS.length} stats counted`}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <RankBadge rank={null} size="lg" />
                    <p className="text-sm text-muted">
                      {levelError
                        ?? (input.level == null
                          ? 'Enter the unit’s current level.'
                          : enteredFinal
                            ? 'Fix the stats marked below to get a rank.'
                            : 'Enter their current stats on the right to get a rank.')}
                    </p>
                  </div>
                )}
              </Card>

              <Card>
                <div className="grid grid-cols-[2.25rem_3.75rem_minmax(0,1fr)_3.75rem] items-center gap-x-2 gap-y-2 sm:grid-cols-[2.5rem_4.5rem_minmax(0,1fr)_4.5rem] sm:gap-x-4">
                  <span />
                  <span className="text-center text-xs font-semibold text-muted">
                    Base<span className="block font-normal tabular">Lv {input.startLevel ?? '?'}</span>
                  </span>
                  <span className="text-xs font-semibold text-muted">Change · percentile · rank</span>
                  <span className="text-center text-xs font-semibold text-muted">
                    Final<span className="block font-normal tabular">Lv {input.level ?? '?'}</span>
                  </span>

                  {STAT_KEYS.map((k) => {
                    const r = analysis?.stats[k]
                    const issue = r && !levelError ? issueText(k, r, input.base[k]!, analysis!.levelUps) : null
                    return (
                      <div key={k} className="contents">
                        <span className="text-xs font-semibold text-muted">{STAT_LABELS[k]}</span>
                        {fixedBase ? (
                          <span className="rounded-lg bg-surface-2 py-1.5 text-center text-sm font-semibold tabular">{input.base[k]}</span>
                        ) : (
                          <NumberInput label={`Base ${STAT_LABELS[k]}`} value={input.base[k]} onChange={(v) => setStat('base', k, v)} className="text-center" />
                        )}
                        {levelError ? <span /> : <ChangeCell r={r} />}
                        <NumberInput
                          label={`Final ${STAT_LABELS[k]}`}
                          value={input.final[k]}
                          placeholder={r && input.base[k] != null ? String(Math.round(input.base[k]! + r.mean)) : undefined}
                          onChange={(v) => setStat('final', k, v)}
                          className={`text-center ${issue ? 'border-bad' : ''}`}
                        />
                        {issue && <p className="col-span-3 col-start-2 -mt-1 text-xs text-bad">{issue}</p>}
                      </div>
                    )
                  })}
                </div>
              </Card>

              <details className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
                <summary className="cursor-pointer font-semibold">How this is calculated</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                  <li>
                    Each level-up rolls every stat independently, at the unit’s personal growth plus the growth of the class held
                    when levelling. The checker builds the exact odds of every possible total and places your gain within them.
                  </li>
                  <li>
                    The percentile counts ties as half, so an exactly average result is the 50th. The overall rank scores the sum of all
                    counted gains. Ranks: S ≥ 95, A ≥ 80, B ≥ 60, C ≥ 40, D ≥ 20, E ≥ 5, E- below.
                  </li>
                  <li>
                    Class stat bonuses aren’t published. If the stats you see include a class bonus that the base doesn’t, subtract
                    it, or the result will look luckier than it was. The same goes for stat boosters and equipment.
                  </li>
                  <li>
                    Unknowns: stat caps (not applied) and growths over 100% (treated as +1 plus a chance of +2). See{' '}
                    <span className="font-medium">data/MECHANICS.md</span> in the repository.
                  </li>
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

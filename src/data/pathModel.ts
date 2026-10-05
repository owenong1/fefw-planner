// The Class Paths page's arithmetic: a role's results over part of the campaign, and with other weights.
// It follows the simulator's own ranking (rankCast in src/sim/engine/commands.js) on the numbers the
// importer stored, so the page can re-read the results without running the simulator.

import type { ClassPaths, PathCandidates, RolePath } from './schema'

/**
 * The stretches of the campaign the paths are optimised for. Each is a search of its own (the importer runs the
 * simulator once per plan, scoring from checkpoint `from` on): the path that makes a unit best in the late game is
 * not the one that is best overall.
 */
export const PLANS = [
  { id: '', label: 'The whole campaign', from: null },
  { id: 'p2', label: 'Part II onwards', from: 'P2-01' },
  { id: 'p3', label: 'Part III onwards (late game)', from: 'P3-01' },
] as const
/**
 * How the units are played, also a search each: attacking with combat arts whenever they can, so abilities that
 * need an art always count, or never, so they count for nothing. The truth for a unit lies between the two.
 */
export const ARTS = [
  { id: '', label: 'Always used' },
  { id: 'noarts', label: 'Never used' },
] as const
/** A variant's part of its file names: `classPaths<suffix>.json`. The first of each list is the file in the bundle. */
export const variantSuffix = (plan: string, arts: string) => `${plan && `.${plan}`}${arts && `.${arts}`}`

/** One unit's path for a role and how it profiles: what the page needs of a `RolePath`, stored or re-scored. */
export type RoleResult = Pick<RolePath, 'path' | 'train' | 'axes' | 'chapters'>
export interface Standing { rank: number; vsCast: number; score: number; endgame: number }
/** Share of the score per axis id; axes left out weigh nothing. */
export type Weights = Record<string, number>
type Units = ClassPaths['units']

/** The cast's average score at each checkpoint (null where no unit is present), from every unit's chapter scores. */
export function castAverage(units: Units, results: Map<string, RoleResult>, checkpoints: number) {
  const sum = new Array<number>(checkpoints).fill(0)
  const count = new Array<number>(checkpoints).fill(0)
  for (const u of units) {
    results.get(u.unit)?.chapters.forEach((score, k) => {
      sum[u.firstChapter + k] += score
      count[u.firstChapter + k]++
    })
  }
  return sum.map((s, i) => (count[i] ? s / count[i] : null))
}

/**
 * Each unit's standing in a role over the chapters `from`..`to` only (checkpoint indices): `score` is the average
 * over the chapters in range the unit is present for, `vsCast` its margin over the cast's average in those same
 * chapters, and `rank` its place on that margin. `endgame` is its score in the range's last chapter. Units absent
 * for the whole range are left out. This re-reads the paths it is given; it does not search for better ones
 * (a plan in `PLANS` does).
 */
export function standingsOver(units: Units, results: Map<string, RoleResult>, from: number, to: number) {
  const avg = castAverage(units, results, to + 1)
  const rows = units.flatMap((u) => {
    const scores = results.get(u.unit)?.chapters ?? []
    const lo = Math.max(from, u.firstChapter)
    const hi = Math.min(to, u.firstChapter + scores.length - 1)
    if (lo > hi) return []
    let score = 0
    let vsCast = 0
    for (let i = lo; i <= hi; i++) {
      score += scores[i - u.firstChapter]
      vsCast += scores[i - u.firstChapter] - avg[i]!
    }
    const n = hi - lo + 1
    return [{ unit: u.unit, score: score / n, vsCast: vsCast / n, endgame: scores[hi - u.firstChapter] }]
  }).sort((a, b) => b.vsCast - a.vsCast)
  return new Map<string, Standing>(rows.map(({ unit, ...r }, i) => [unit, { ...r, rank: i + 1 }]))
}

/** The role each unit places highest in (ties: the larger margin over the cast), given every role's standings. */
export function bestRoles(units: Units, standings: Record<string, Map<string, Standing>>) {
  const best = new Map<string, string>()
  for (const u of units) {
    let pick: string | null = null
    for (const [role, map] of Object.entries(standings)) {
      const s = map.get(u.unit)
      const p = pick ? standings[pick].get(u.unit)! : null
      if (s && (!p || s.rank < p.rank || (s.rank === p.rank && s.vsCast > p.vsCast))) pick = role
    }
    if (pick) best.set(u.unit, pick)
  }
  return best
}

/**
 * A role re-scored with other weights: for each unit, the candidate path with the best campaign average under
 * `weights` (near-ties, within 0.05 points, go to the path needing the least training), with its profile and its
 * score chapter by chapter. Expected stats only: level-ups are not re-rolled as the simulator does for its picks.
 */
export function rescore(axes: ClassPaths['axes'], candidates: PathCandidates, weights: Weights) {
  const n = axes.length
  const w = axes.map((a) => weights[a.id] ?? 0)
  const out = new Map<string, RoleResult>()
  for (const [unit, cands] of Object.entries(candidates.units)) {
    const scored = cands.map((c) => {
      const chapters = c.ch.length / n
      const avg = new Array<number>(n).fill(0)
      c.ch.forEach((v, k) => { avg[k % n] += v / 10 / chapters })
      return { c, avg, chapters, score: avg.reduce((t, v, k) => t + w[k] * v, 0) }
    })
    if (!scored.length) continue
    const top = Math.max(...scored.map((x) => x.score))
    const { c, avg, chapters } = scored.filter((x) => x.score > top - 0.05).sort((x, y) => x.c.train - y.c.train || y.score - x.score)[0]
    out.set(unit, {
      path: c.path, train: c.train, axes: avg,
      chapters: Array.from({ length: chapters }, (_, i) => { let t = 0; for (let k = 0; k < n; k++) t += w[k] * c.ch[i * n + k]; return t / 10 }),
    })
  }
  return out
}

/** Slider positions (any non-negative numbers, one per axis) as shares that sum to 1; null when all are zero. */
export function normalizeWeights(axes: ClassPaths['axes'], values: number[]): Weights | null {
  const total = values.reduce((t, v) => t + v, 0)
  if (!(total > 0)) return null
  return Object.fromEntries(axes.flatMap((a, i) => (values[i] > 0 ? [[a.id, values[i] / total]] : [])))
}

/** One role as the page shows it: the weights in effect, each unit's path under them, and the standings over the chosen chapters. */
export interface RoleView {
  id: string
  label: string
  weights: Weights
  /** The weights are the reader's, not the simulator's. */
  edited: boolean
  results: Map<string, RoleResult>
  standings: Map<string, Standing>
  /** The cast's average score per checkpoint. */
  castAvg: (number | null)[]
  /**
   * For an edited role: the same re-scoring under the role's own weights, to measure the edit against. The
   * simulator's stored picks will not do, because it settles near-ties by rolling level-ups, which this cannot.
   */
  baseline: { results: Map<string, RoleResult>; standings: Map<string, Standing> } | null
}
export interface PathsView {
  /** The plan's results, which everything else here is read from. */
  data: ClassPaths
  roles: RoleView[]
  /** Each unit's best-fit role under these weights and chapters. */
  best: Map<string, string>
  /** The first checkpoint the plan counts; `from` is never before it. */
  start: number
  from: number
  to: number
  /** Only part of the plan's chapters is counted. */
  ranged: boolean
}

/**
 * Everything the page derives from the stored results, the reader's slider positions per role (`sliders`, one number
 * per axis; a role left alone has none) and the chosen chapters. Untouched roles over the whole campaign are read
 * exactly as the simulator ranked them; anything else is worked out here. Edited weights need `candidates`, and
 * count for nothing until it has loaded.
 */
export function buildView(data: ClassPaths, candidates: PathCandidates | null, sliders: Record<string, number[]>, from: number, to: number): PathsView {
  const { units, axes } = data
  const start = Math.min(...units.map((u) => u.firstChapter))
  const ranged = from > start || to < data.checkpoints.length - 1
  const roles = data.roles.map((role): RoleView => {
    const custom = sliders[role.id] ? normalizeWeights(axes, sliders[role.id]) : null
    const same = !custom || axes.every((a) => Math.abs((custom[a.id] ?? 0) - (role.weights[a.id] ?? 0)) < 1e-6)
    const edited = !same && !!candidates
    const results = edited ? rescore(axes, candidates!, custom!) : new Map<string, RoleResult>(units.map((u) => [u.unit, u.roles[role.id]]))
    const standings = edited || ranged
      ? standingsOver(units, results, from, to)
      : new Map<string, Standing>(units.map((u) => [u.unit, u.roles[role.id]]))
    const own = edited ? rescore(axes, candidates!, role.weights) : null
    return {
      id: role.id, label: role.label, weights: edited ? custom! : role.weights, edited, results, standings,
      castAvg: castAverage(units, results, data.checkpoints.length),
      baseline: own && { results: own, standings: standingsOver(units, own, from, to) },
    }
  })
  const best = ranged || roles.some((r) => r.edited)
    ? bestRoles(units, Object.fromEntries(roles.map((r) => [r.id, r.standings])))
    : new Map(units.map((u) => [u.unit, u.bestRole]))
  return { data, roles, best, start, from, to, ranged }
}

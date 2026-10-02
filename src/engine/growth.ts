import { STAT_KEYS, type StatKey } from '../data/constants'
import type { Stats } from '../data/schema'

/** Probability of each total gain: dist[k] = P(gain = k). */
export type Dist = number[]

/** A class held from `fromLevel` until the next segment starts. Level-up L→L+1 uses the class held at L. */
export type ClassSegment = { fromLevel: number; growths: Stats }

/**
 * One level-up's gain for a growth of p%. No source documents growths over 100%,
 * so for now that's +1 guaranteed plus (p−100)% for +2 (see data/MECHANICS.md).
 */
export function levelUpDist(p: number): Dist {
  const q = Math.min(Math.max(p, 0), 200) / 100
  return q <= 1 ? [1 - q, q] : [0, 2 - q, q - 1]
}

export function convolve(a: Dist, b: Dist): Dist {
  const out = new Array<number>(a.length + b.length - 1).fill(0)
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j]
  }
  return out
}

/** Poisson-binomial distribution of the total gain over a series of level-ups. */
export function gainDist(growths: number[]): Dist {
  return growths.reduce<Dist>((d, p) => convolve(d, levelUpDist(p)), [1])
}

export function mean(d: Dist) {
  return d.reduce((s, p, k) => s + p * k, 0)
}

export function stdDev(d: Dist) {
  const m = mean(d)
  return Math.sqrt(d.reduce((s, p, k) => s + p * (k - m) ** 2, 0))
}

/** Mid-rank percentile (0–100) of x, so ties count half: P(X < x) + ½·P(X = x). */
export function percentile(d: Dist, x: number) {
  let below = 0
  for (let k = 0; k < Math.min(x, d.length); k++) below += d[k]
  const at = d[x] ?? 0
  return Math.min(100, Math.max(0, (below + at / 2) * 100))
}

/** Tier thresholds, best first. A percentile gets the first rank whose minimum it meets. */
export const RANKS = [
  { rank: 'S', min: 95 },
  { rank: 'A', min: 80 },
  { rank: 'B', min: 60 },
  { rank: 'C', min: 40 },
  { rank: 'D', min: 20 },
  { rank: 'E', min: 5 },
  { rank: 'E-', min: -Infinity },
] as const
export type Rank = (typeof RANKS)[number]['rank']

export function rankFor(pct: number): Rank {
  return RANKS.find((r) => pct >= r.min)!.rank
}

/** Effective growth (personal + class) for every level-up from startLevel to endLevel, per stat. */
export function levelUpGrowths(
  personal: Stats,
  segments: ClassSegment[],
  startLevel: number,
  endLevel: number,
): Record<StatKey, number[]> {
  const sorted = [...segments].sort((a, b) => a.fromLevel - b.fromLevel)
  const out = Object.fromEntries(STAT_KEYS.map((k) => [k, [] as number[]])) as Record<StatKey, number[]>
  for (let lv = startLevel; lv < endLevel; lv++) {
    const seg = sorted.findLast((s) => s.fromLevel <= lv) ?? sorted[0]
    for (const k of STAT_KEYS) out[k].push(personal[k] + (seg?.growths[k] ?? 0))
  }
  return out
}

export type StatIssue = 'below-base' | 'unreachable'

export type StatResult = {
  dist: Dist
  mean: number
  sd: number
  /** null when the final stat hasn't been entered. */
  gain: number | null
  percentile: number | null
  rank: Rank | null
  issue: StatIssue | null
  maxGain: number
}

export function analyzeStat(growths: number[], base: number, final: number | null): StatResult {
  const dist = gainDist(growths)
  const maxGain = dist.length - 1
  const result = { dist, mean: mean(dist), sd: stdDev(dist), maxGain }
  if (final == null) return { ...result, gain: null, percentile: null, rank: null, issue: null }
  const gain = final - base
  const issue: StatIssue | null = gain < 0 ? 'below-base' : gain > maxGain ? 'unreachable' : null
  const pct = issue ? null : percentile(dist, gain)
  return { ...result, gain, percentile: pct, rank: pct == null ? null : rankFor(pct), issue }
}

export type OverallResult = {
  /** Stats that counted: entered and reachable. */
  stats: StatKey[]
  gain: number
  mean: number
  /** Percentile of the summed gain across the counted stats. */
  percentile: number
  rank: Rank
  /** Mean of the counted stats' own percentiles. */
  meanPercentile: number
}

export function analyzeOverall(results: Partial<Record<StatKey, StatResult>>): OverallResult | null {
  const counted = STAT_KEYS.filter((k) => results[k]?.percentile != null)
  if (!counted.length) return null
  const rs = counted.map((k) => results[k]!)
  const dist = rs.reduce<Dist>((d, r) => convolve(d, r.dist), [1])
  const gain = rs.reduce((s, r) => s + r.gain!, 0)
  const pct = percentile(dist, gain)
  return {
    stats: counted,
    gain,
    mean: mean(dist),
    percentile: pct,
    rank: rankFor(pct),
    meanPercentile: rs.reduce((s, r) => s + r.percentile!, 0) / rs.length,
  }
}

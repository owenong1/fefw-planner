import { describe, expect, it } from 'vitest'
import { STAT_KEYS } from '../data/constants'
import type { Stats } from '../data/schema'
import {
  analyzeOverall, analyzeStat, gainDist, levelUpDist, levelUpGrowths, mean, percentile, rankFor, stdDev,
} from './growth'

const flat = (v: number) => Object.fromEntries(STAT_KEYS.map((k) => [k, v])) as Stats
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('gainDist', () => {
  it('one 50% level-up is a coin flip', () => {
    expect(gainDist([50])).toEqual([0.5, 0.5])
  })

  it('two 50% level-ups are binomial', () => {
    expect(gainDist([50, 50])).toEqual([0.25, 0.5, 0.25])
  })

  it('mixed growths match a hand computation', () => {
    const d = gainDist([20, 70])
    expect(d[0]).toBeCloseTo(0.8 * 0.3)
    expect(d[1]).toBeCloseTo(0.2 * 0.3 + 0.8 * 0.7)
    expect(d[2]).toBeCloseTo(0.2 * 0.7)
  })

  it('always sums to 1', () => {
    expect(sum(gainDist([35, 60, 15, 90, 120, 45, 5]))).toBeCloseTo(1)
  })

  it('clamps negative growths to 0% and treats >100% as +1 plus a chance of +2', () => {
    expect(levelUpDist(-10)).toEqual([1, 0])
    expect(levelUpDist(100)).toEqual([0, 1])
    const d = levelUpDist(130)
    expect(d[0]).toBe(0)
    expect(d[1]).toBeCloseTo(0.7)
    expect(d[2]).toBeCloseTo(0.3)
  })

  it('mean and SD match the binomial formulas', () => {
    const d = gainDist(Array(20).fill(40))
    expect(mean(d)).toBeCloseTo(8)
    expect(stdDev(d)).toBeCloseTo(Math.sqrt(20 * 0.4 * 0.6))
  })
})

describe('percentile', () => {
  it('uses mid-rank so ties count half', () => {
    const d = [0.25, 0.5, 0.25]
    expect(percentile(d, 0)).toBeCloseTo(12.5)
    expect(percentile(d, 1)).toBeCloseTo(50)
    expect(percentile(d, 2)).toBeCloseTo(87.5)
  })

  it('a run with no level-ups is exactly average', () => {
    expect(percentile([1], 0)).toBe(50)
  })
})

describe('rankFor', () => {
  it.each([
    [99, 'S'], [95, 'S'], [94.9, 'A'], [80, 'A'], [70, 'B'], [50, 'C'], [30, 'D'], [10, 'E'], [4.9, 'E-'], [0, 'E-'],
  ] as const)('%d → %s', (pct, rank) => {
    expect(rankFor(pct)).toBe(rank)
  })
})

describe('levelUpGrowths', () => {
  it('adds the class held at each level-up to personal growths', () => {
    const personal = flat(30)
    const segments = [
      { fromLevel: 1, growths: flat(0) },
      { fromLevel: 3, growths: flat(10) },
    ]
    // Level-ups 1→2, 2→3 as the first class, 3→4, 4→5 as the second.
    expect(levelUpGrowths(personal, segments, 1, 5).str).toEqual([30, 30, 40, 40])
  })

  it('returns no level-ups when the level has not risen', () => {
    expect(levelUpGrowths(flat(30), [{ fromLevel: 5, growths: flat(0) }], 5, 5).hp).toEqual([])
  })
})

describe('analyzeStat', () => {
  it('flags stats below base and above the maximum', () => {
    expect(analyzeStat([50, 50], 10, 9).issue).toBe('below-base')
    expect(analyzeStat([50, 50], 10, 13).issue).toBe('unreachable')
    expect(analyzeStat([50, 50], 10, 12)).toMatchObject({ issue: null, gain: 2, percentile: 87.5, rank: 'A' })
  })

  it('leaves the result empty when the final stat is missing', () => {
    expect(analyzeStat([50], 10, null)).toMatchObject({ gain: null, percentile: null, rank: null, mean: 0.5 })
  })
})

describe('analyzeOverall', () => {
  it('scores the summed gain and skips stats that were not entered or are impossible', () => {
    const a = analyzeStat([50], 0, 1)
    const b = analyzeStat([50], 0, 1)
    const c = analyzeStat([50], 0, 5)
    const overall = analyzeOverall({ hp: a, str: b, mag: c, spd: analyzeStat([50], 0, null) })!
    expect(overall.stats).toEqual(['hp', 'str'])
    expect(overall.gain).toBe(2)
    expect(overall.percentile).toBeCloseTo(87.5)
    expect(overall.meanPercentile).toBeCloseTo(75)
  })

  it('returns null when nothing can be scored', () => {
    expect(analyzeOverall({ hp: analyzeStat([50], 0, null) })).toBeNull()
  })
})

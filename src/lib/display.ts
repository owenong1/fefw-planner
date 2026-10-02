import { APTITUDE_LABELS } from '../data'
import type { ClassTier, GameClass } from '../data/schema'

export const SPOILER_LABELS = ['Spoilers: none', 'Spoilers: Part II–III', 'Spoilers: all'] as const

export const ROUTE_COLOR: Record<string, string> = {
  cai: 'var(--route-cai)',
  dietrich: 'var(--route-dietrich)',
  theodora: 'var(--route-theodora)',
  leda: 'var(--route-leda)',
}

/** Stepped colour for a growth value so 30% and 60% read differently at a glance. */
export function growthColor(v: number) {
  if (v <= 20) return 'var(--bad)'
  if (v <= 35) return 'var(--muted)'
  if (v <= 45) return 'var(--ink)'
  if (v <= 55) return 'var(--good-soft)'
  return 'var(--good)'
}

export const TIER_INFO: Record<ClassTier, { label: string; blurb: string }> = {
  base: { label: 'Base', blurb: 'Starting classes. They add nothing to growth rates.' },
  beginner: { label: 'Beginner', blurb: 'Beginner License · Lv 5 · Renown 1' },
  specialty: { label: 'Specialty', blurb: 'Specialty License · Lv 20 · Renown 4' },
  advanced: { label: 'Advanced', blurb: 'Advanced License · Lv 35 · Renown 8 (Elephant Rider: Elephant License · Lv 35)' },
  master: { label: 'Master', blurb: 'Master License · Lv 45' },
  divine: { label: 'Divine', blurb: 'Divine license item from the Temple of the Diadem (Part III, Section 4)' },
}

export function weaponReqText(c: GameClass) {
  const r = c.requirements
  if (!r) return null
  const fmt = (xs: typeof r.primarySkills) => xs.map((s) => `${APTITUDE_LABELS[s.skill]} ${s.rank}`).join(', ')
  return [r.primarySkills.length ? fmt(r.primarySkills) : null, r.secondarySkills.length ? `${fmt(r.secondarySkills)} (secondary)` : null]
    .filter(Boolean)
    .join(' · ')
}


/** Red below the median, through muted, to green above it. Used for RNG percentiles and ranks. */
export function percentileColor(pct: number) {
  return pct < 50
    ? `color-mix(in oklab, var(--bad) ${Math.round((50 - pct) * 2)}%, var(--muted))`
    : `color-mix(in oklab, var(--good) ${Math.round((pct - 50) * 2)}%, var(--muted))`
}

/** Colour for a rank, taken from the middle of its percentile band. */
export const RANK_COLOR: Record<string, string> = {
  S: percentileColor(100), A: percentileColor(88), B: percentileColor(70), C: percentileColor(50),
  D: percentileColor(30), E: percentileColor(12), 'E-': percentileColor(0),
}

export function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

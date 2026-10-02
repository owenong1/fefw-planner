import { STAT_KEYS, type StatKey } from '../data/constants'
import type { Unit } from '../data/schema'

export type StatInputs = Record<StatKey, number | null>

/** A class the unit held. The first entry starts at the start level, so its fromLevel is null. */
export type ClassEntry = { classId: string; fromLevel: number | null }

export type RngInput = {
  unitId: string
  startLevel: number | null
  base: StatInputs
  level: number | null
  final: StatInputs
  classes: ClassEntry[]
}

const blankStats = () => Object.fromEntries(STAT_KEYS.map((k) => [k, null])) as StatInputs

/** Starting point for a unit: its published base level, base stats and starting class. */
export function defaultInput(unit: Unit | undefined): RngInput {
  return {
    unitId: unit?.id ?? '',
    startLevel: unit?.baseLevel ?? 1,
    base: unit?.baseStats ? { ...unit.baseStats } : blankStats(),
    level: null,
    final: blankStats(),
    classes: [{ classId: unit?.startingClass ?? 'commoner', fromLevel: null }],
  }
}

const int = (s: string | null | undefined) => {
  if (s == null || s.trim() === '') return null
  const n = Number(s)
  return Number.isInteger(n) ? n : null
}

const encodeStats = (s: StatInputs) => STAT_KEYS.map((k) => s[k] ?? '').join('.')

function decodeStats(s: string): StatInputs {
  const parts = s.split('.')
  return Object.fromEntries(STAT_KEYS.map((k, i) => [k, int(parts[i])])) as StatInputs
}

/** Every unit starts with the same stats, so only units with unpublished bases take them as input. */
export const hasFixedBase = (unit: Unit | undefined) => unit?.baseStats != null

/**
 * URL format, e.g. `?u=peter&lv=20&s=…&c=commoner.gladiator~5`, plus `sl` and `b` (start level and base stats)
 * for units whose bases aren't published. Missing keys fall back to the unit's defaults, so `?u=peter` alone is a
 * valid prefill link.
 */
export function parseInput(params: URLSearchParams, unitById: Map<string, Unit>): RngInput {
  const unit = unitById.get(params.get('u') ?? '')
  const d = defaultInput(unit)
  const fixed = hasFixedBase(unit)
  const c = params.get('c')
  return {
    unitId: d.unitId,
    startLevel: !fixed && params.has('sl') ? int(params.get('sl')) : d.startLevel,
    base: !fixed && params.has('b') ? decodeStats(params.get('b')!) : d.base,
    level: int(params.get('lv')),
    final: params.has('s') ? decodeStats(params.get('s')!) : d.final,
    classes: c
      ? c.split('.').map((part, i) => {
          const [classId, lv] = part.split('~')
          return { classId, fromLevel: i === 0 ? null : int(lv) }
        })
      : d.classes,
  }
}

export function serializeInput(input: RngInput, unit: Unit | undefined): URLSearchParams {
  const p = new URLSearchParams()
  if (!input.unitId) return p
  p.set('u', input.unitId)
  if (!hasFixedBase(unit)) {
    if (input.startLevel != null) p.set('sl', String(input.startLevel))
    p.set('b', encodeStats(input.base))
  }
  if (input.level != null) p.set('lv', String(input.level))
  if (STAT_KEYS.some((k) => input.final[k] != null)) p.set('s', encodeStats(input.final))
  p.set('c', input.classes.map((c, i) => (i === 0 ? c.classId : `${c.classId}~${c.fromLevel ?? ''}`)).join('.'))
  return p
}

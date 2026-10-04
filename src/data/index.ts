import unitsJson from '../../data/units.json'
import classesJson from '../../data/classes.json'
import skillsJson from '../../data/skills.json'
import routesJson from '../../data/routes.json'
import paraloguesJson from '../../data/paralogues.json'
import classPathsJson from '../../data/classPaths.json'
import { STAT_KEYS } from './constants'
import type { Aptitude, ClassPaths, GameClass, Paralogue, Recruitment, Route, Skill, Stats, Unit } from './schema'

// The JSON is validated against the Zod schemas in data.test.ts, so a cast is safe here.
export const units = unitsJson as Unit[]
export const classes = classesJson as GameClass[]
export const skills = skillsJson as Skill[]
export const routes = routesJson as Route[]
export const paralogues = paraloguesJson as Paralogue[]
// Role weights name different axes per role, so the inferred JSON type is a union the cast has to go around.
export const classPaths = classPathsJson as unknown as ClassPaths

const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]))
export const unitById = byId(units)
export const classById = byId(classes)
export const skillById = byId(skills)
export const routeById = byId(routes)
export const paralogueById = byId(paralogues)
export const classPathsByUnit = new Map(classPaths.units.map((u) => [u.unit, u]))

export const APTITUDE_LABELS: Record<Aptitude, string> = {
  sword: 'Sword', spear: 'Spear', axe: 'Axe', bow: 'Bow', gauntlet: 'Gauntlet',
  whiteMagic: 'White Magic', blackMagic: 'Black Magic', riding: 'Riding', flying: 'Flying',
  heavyArmor: 'Heavy Armor', authority: 'Authority', infantry: 'Infantry',
}

export const PART_LABELS = ['Prologue', 'Part I', 'Part II: War', 'Part III: Salvation'] as const

/** Personal growth + class modifier per stat. Game8: class growths are added to the unit's. */
export function combinedGrowths(unit: Unit, cls: GameClass | undefined): Stats | null {
  if (!unit.growths) return null
  if (!cls) return unit.growths
  return Object.fromEntries(STAT_KEYS.map((k) => [k, unit.growths![k] + cls.growths[k]])) as Stats
}

export function growthTotal(s: Stats) {
  return STAT_KEYS.reduce((sum, k) => sum + s[k], 0)
}

/** The unit's recruitment entry on a route, including shared ('all') story entries. */
export function recruitmentOn(unit: Unit, routeId: string): Recruitment[] {
  return unit.recruitment.filter((r) => r.route === routeId || r.route === 'all')
}

export function isRecruitableOn(unit: Unit, routeId: string) {
  return recruitmentOn(unit, routeId).length > 0
}

/** Units whose personal skill forbids mounted/flying classes (e.g. Goliath, Orchel). */
export function classRestrictions(unit: Unit): GameClass['tags'] {
  const effect = unit.personalSkill ? skillById.get(unit.personalSkill)?.effect ?? '' : ''
  return /cannot change to cavalry or flying/i.test(effect) ? ['mounted', 'flying'] : []
}

export function canUseClass(unit: Unit, cls: GameClass) {
  const banned = classRestrictions(unit)
  return !cls.tags.some((t) => banned.includes(t))
}

/** Spoiler level needed to list a class: Master and Divine classes only open up late in the story. */
export function classSpoiler(cls: GameClass) {
  return cls.tier === 'master' || cls.tier === 'divine' ? 1 : 0
}

/** Lowest spoiler level at which some owner of the skill is visible (Infinity when nothing owns it). */
export function skillSpoiler(skillId: string) {
  const owners = skillOwners(skillId)
  return Math.min(...owners.units.map((u) => u.spoiler), ...owners.classes.map(classSpoiler))
}

export function skillOwners(skillId: string): { units: Unit[]; classes: GameClass[] } {
  return {
    units: units.filter(
      (u) => u.personalSkill === skillId || u.bloodmarks.includes(skillId) || u.levelSkills.some((l) => l.skill === skillId),
    ),
    classes: classes.filter((c) => c.skills.includes(skillId) || c.masterySkill === skillId),
  }
}

/** Units that list one of the class's required weapon skills as a favored aptitude. */
export function aptitudeFit(unit: Unit, cls: GameClass): 'favored' | 'unfavored' | 'neutral' {
  const req = cls.requirements
  if (!req) return 'neutral'
  const needed = [...req.primarySkills, ...req.secondarySkills].map((s) => s.skill)
  if (needed.some((s) => unit.aptitudes.unfavored.includes(s))) return 'unfavored'
  if (needed.some((s) => unit.aptitudes.favored.includes(s))) return 'favored'
  return 'neutral'
}

export function timingLabel(r: Recruitment) {
  const part = PART_LABELS[r.part]
  if (r.part === 0) return `Prologue Ch. ${r.chapter}`
  if (r.section) return `${part}, Section ${r.section}`
  if (r.chapter) return r.part === 1 ? `Ch. ${r.chapter}` : `${part}, Ch. ${r.chapter}`
  return part
}

/** A role's weighted profile axes, heaviest first, with each one's position in a path's `axes`. */
export function roleAxes(roleId: string) {
  const role = classPaths.roles.find((r) => r.id === roleId)
  return Object.entries(role?.weights ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([id, weight]) => {
      const index = classPaths.axes.findIndex((a) => a.id === id)
      return { id, weight, index, label: classPaths.axes[index]?.label ?? id }
    })
}

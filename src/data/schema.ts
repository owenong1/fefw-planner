import { z } from 'zod'
import { APTITUDES, CLASS_TIERS, STAT_KEYS, type StatKey } from './constants'

export * from './constants'

const stats = z.object(Object.fromEntries(STAT_KEYS.map((k) => [k, z.number().int()])) as Record<StatKey, z.ZodNumber>)
export type Stats = z.infer<typeof stats>

const aptitude = z.enum(APTITUDES)

export const routeSchema = z.object({
  id: z.string(),
  lord: z.string(),
  name: z.string(),
  army: z.string(),
})

export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paralogue'), paralogue: z.string(), text: z.string() }),
  z.object({ type: z.literal('gold'), amount: z.number().int(), text: z.string() }),
  z.object({ type: z.literal('item'), item: z.string(), qty: z.number().int(), text: z.string() }),
  z.object({ type: z.literal('chapter'), chapter: z.number().int(), text: z.string() }),
  z.object({ type: z.literal('request'), text: z.string() }),
  z.object({ type: z.literal('dialogue'), text: z.string() }),
  z.object({ type: z.literal('survive'), text: z.string() }),
  z.object({ type: z.literal('battle'), text: z.string() }),
  z.object({ type: z.literal('other'), text: z.string() }),
])
export type Condition = z.infer<typeof conditionSchema>

export const recruitmentSchema = z.object({
  /** A route id, or 'all' for prologue and Part II/III story recruits shared by every route. */
  route: z.string(),
  /** 0 = Prologue, 1 = Part I (route-specific), 2 = Part II: War, 3 = Part III: Salvation */
  part: z.number().int().min(0).max(3),
  chapter: z.number().int().nullable(),
  section: z.number().int().optional(),
  method: z.enum(['automatic', 'recruit', 'story']),
  support: z.number().int().optional(),
  renown: z.number().int().optional(),
  conditions: z.array(conditionSchema),
})
export type Recruitment = z.infer<typeof recruitmentSchema>

const magicTiers = z.record(z.enum(['D', 'C', 'B', 'A', 'S']), z.string().nullable())

export const unitSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  lord: z.boolean(),
  faction: z.string().nullable(),
  growths: stats.nullable(),
  baseStats: stats.nullable(),
  baseLevel: z.number().int().nullable(),
  startingClass: z.string().nullable(),
  personalSkill: z.string().nullable(),
  /** Unit-specific abilities learned at a level (level is null when the source doesn't say). */
  levelSkills: z.array(z.object({ skill: z.string(), level: z.number().int().nullable() })),
  bloodmarks: z.array(z.string()),
  aptitudes: z.object({ favored: z.array(aptitude), unfavored: z.array(aptitude) }),
  magic: z.object({ white: magicTiers, black: magicTiers }).nullable(),
  recruitment: z.array(recruitmentSchema),
  /** 0 = Part I, safe to show. 1 = joins in Part II/III. 2 = secret character. */
  spoiler: z.number().int().min(0).max(2),
  notes: z.array(z.string()),
})
export type Unit = z.infer<typeof unitSchema>

const weaponReq = z.object({ skill: aptitude, rank: z.string() })

export const classSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(CLASS_TIERS),
  growths: stats,
  requirements: z
    .object({
      license: z.string().optional(),
      level: z.number().int().optional(),
      renown: z.number().int().optional(),
      primarySkills: z.array(weaponReq),
      secondarySkills: z.array(weaponReq),
      unlock: z.string().optional(),
    })
    .nullable(),
  skills: z.array(z.string()),
  masterySkill: z.string().nullable(),
  tags: z.array(z.enum(['mounted', 'flying', 'armored'])),
})
export type GameClass = z.infer<typeof classSchema>

export const skillSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['personal', 'level', 'bloodmark', 'class', 'mastery']),
  effect: z.string().nullable(),
  crest: z.string().optional(),
})
export type Skill = z.infer<typeof skillSchema>

export const paralogueSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string().nullable(),
  rewards: z.array(z.string()),
  availability: z.array(z.object({ route: z.string(), chapter: z.number().int(), dates: z.string().nullable() })),
  recruitmentFor: z.array(z.string()),
})
export type Paralogue = z.infer<typeof paralogueSchema>
export type Route = z.infer<typeof routeSchema>

const rolePath = z.object({
  /** Place among every unit in the cast for this role (1 = best), on vsCast. */
  rank: z.number().int().min(1),
  /** Points above the cast's average, chapter by chapter, over the chapters the unit is present for. */
  vsCast: z.number(),
  score: z.number(),
  endgame: z.number(),
  /** Skill ranks the path's exams ask for beyond what its classes train. */
  train: z.number().min(0),
  /** Class changes in order. `late` marks a change not made at its tier's usual level. */
  path: z.array(z.object({ class: z.string(), level: z.number().int(), late: z.boolean() })),
  /** The profile on this path, one value (0-100) per entry of the file's `axes`. */
  axes: z.array(z.number()),
})
export type RolePath = z.infer<typeof rolePath>

/** Growth simulator results (scripts/import/import_class_paths.py): each unit's recommended class path per role. */
export const classPathsSchema = z.object({
  scope: z.object({ route: z.string(), hard: z.boolean(), divine: z.boolean(), runs: z.number().int() }),
  roles: z.array(z.object({ id: z.string(), label: z.string(), weights: z.record(z.string(), z.number()) })),
  axes: z.array(z.object({ id: z.string(), label: z.string() })),
  units: z.array(z.object({
    unit: z.string(),
    joinLevel: z.number().int(),
    joinClass: z.string(),
    /** Base stats are estimated from growth rates, not published. */
    estimated: z.boolean(),
    /** Story chapters the unit is present for, out of the 24 the simulator scores. */
    chapters: z.number().int(),
    bestRole: z.string(),
    roles: z.record(z.string(), rolePath),
  })),
})
export type ClassPaths = z.infer<typeof classPathsSchema>
export type UnitPaths = ClassPaths['units'][number]

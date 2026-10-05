import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { ClassPaths, PathCandidates } from './schema'
import unitsJson from '../../data/units.json'
import classesJson from '../../data/classes.json'
import skillsJson from '../../data/skills.json'
import routesJson from '../../data/routes.json'
import paraloguesJson from '../../data/paralogues.json'
import classPathsJson from '../../data/classPaths.json'
import { classPathsSchema, pathCandidatesSchema, classSchema, paralogueSchema, routeSchema, skillSchema, unitSchema } from './schema'
import {
  aptitudeFit, canUseClass, classById, classPaths, combinedGrowths, isRecruitableOn, paralogueById, routeById, skillById,
  unitById, units,
} from './index'
import { bestRoles, buildView, normalizeWeights, rescore, standingsOver, type RoleResult, ARTS, PLANS, variantSuffix } from './pathModel'

describe('data files match the schema', () => {
  it.each([
    ['units', unitsJson, unitSchema],
    ['classes', classesJson, classSchema],
    ['skills', skillsJson, skillSchema],
    ['routes', routesJson, routeSchema],
    ['paralogues', paraloguesJson, paralogueSchema],
  ] as const)('%s', (_name, json, schema) => {
    const result = z.array(schema as z.ZodType).safeParse(json)
    expect(result.error?.issues ?? []).toEqual([])
  })

  it('classPaths', () => {
    expect(classPathsSchema.safeParse(classPathsJson).error?.issues ?? []).toEqual([])
  })

  it('ids are unique per collection', () => {
    for (const json of [unitsJson, classesJson, skillsJson, routesJson, paraloguesJson]) {
      const ids = (json as { id: string }[]).map((x) => x.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('references resolve', () => {
  const missing: string[] = []
  for (const u of units) {
    if (u.personalSkill && !skillById.has(u.personalSkill)) missing.push(`${u.id}.personalSkill → ${u.personalSkill}`)
    for (const s of [...u.levelSkills.map((l) => l.skill), ...u.bloodmarks]) {
      if (!skillById.has(s)) missing.push(`${u.id} → skill ${s}`)
    }
    if (u.startingClass && !classById.has(u.startingClass)) missing.push(`${u.id}.startingClass → ${u.startingClass}`)
    for (const r of u.recruitment) {
      if (r.route !== 'all' && !routeById.has(r.route)) missing.push(`${u.id} recruitment route → ${r.route}`)
      for (const c of r.conditions) {
        if (c.type === 'paralogue' && !paralogueById.has(c.paralogue)) missing.push(`${u.id} → paralogue ${c.paralogue}`)
      }
    }
  }
  for (const c of classById.values()) {
    for (const s of [...c.skills, ...(c.masterySkill ? [c.masterySkill] : [])]) {
      if (!skillById.has(s)) missing.push(`class ${c.id} → skill ${s}`)
    }
  }
  for (const p of paralogueById.values()) {
    for (const a of p.availability) if (!routeById.has(a.route)) missing.push(`paralogue ${p.id} → route ${a.route}`)
    for (const u of p.recruitmentFor) if (!unitById.has(u)) missing.push(`paralogue ${p.id} → unit ${u}`)
  }

  const roleIds = classPaths.roles.map((r) => r.id)
  const axisIds = classPaths.axes.map((a) => a.id)
  for (const r of classPaths.roles) {
    for (const a of Object.keys(r.weights)) if (!axisIds.includes(a)) missing.push(`classPaths role ${r.id} → axis ${a}`)
  }
  for (const c of classPaths.checkpoints) for (const e of c.refs) if (!classById.has(e.class)) missing.push(`classPaths ${c.id} → class ${e.class}`)
  for (const t of classPaths.classTiers) for (const c of t.classes) if (!classById.has(c.class)) missing.push(`classPaths ${t.tier} → class ${c.class}`)
  for (const u of classPaths.units) {
    if (!unitById.has(u.unit)) missing.push(`classPaths → unit ${u.unit}`)
    if (!classById.has(u.joinClass)) missing.push(`classPaths ${u.unit}.joinClass → ${u.joinClass}`)
    if (!roleIds.includes(u.bestRole)) missing.push(`classPaths ${u.unit}.bestRole → ${u.bestRole}`)
    for (const id of roleIds) {
      const r = u.roles[id]
      if (!r) missing.push(`classPaths ${u.unit} has no ${id} path`)
      else if (r.axes.length !== axisIds.length) missing.push(`classPaths ${u.unit}.${id} has ${r.axes.length} axes`)
      if (r && (r.chapters.length !== u.chapters || u.firstChapter + u.chapters !== classPaths.checkpoints.length)) missing.push(`classPaths ${u.unit}.${id} has ${r.chapters.length} chapter scores`)
      for (const s of r?.path ?? []) if (!classById.has(s.class)) missing.push(`classPaths ${u.unit}.${id} → class ${s.class}`)
    }
  }

  it('every id reference points at an existing record', () => {
    expect(missing).toEqual([])
  })
})

describe('data sanity', () => {
  it('each lord joins automatically on their own route', () => {
    for (const lord of units.filter((u) => u.lord)) {
      const own = lord.recruitment.find((r) => r.route === lord.id)
      expect(own?.method).toBe('automatic')
    }
  })

  it('every non-secret unit has growths and at least one way to join', () => {
    for (const u of units.filter((u) => u.spoiler < 2)) {
      expect(u.growths, u.id).not.toBeNull()
      expect(u.recruitment.length, u.id).toBeGreaterThan(0)
    }
  })

  it('Part I recruits carry support and renown requirements', () => {
    for (const u of units) {
      for (const r of u.recruitment.filter((r) => r.method === 'recruit')) {
        expect(r.support, `${u.id} on ${r.route}`).toBeGreaterThan(0)
        expect(r.renown, `${u.id} on ${r.route}`).toBeGreaterThan(0)
      }
    }
  })

  it('paralogue recruit lists agree with unit conditions', () => {
    for (const p of paralogueById.values()) {
      for (const uid of p.recruitmentFor) {
        const u = unitById.get(uid)!
        const refs = u.recruitment.flatMap((r) => r.conditions).filter((c) => c.type === 'paralogue')
        expect(refs.map((c) => c.type === 'paralogue' && c.paralogue), uid).toContain(p.id)
      }
    }
  })
})

describe('helpers', () => {
  const tialla = unitById.get('tialla')!
  const goliath = unitById.get('goliath')!

  it('combines personal and class growths additively', () => {
    const sniper = classById.get('sniper')!
    const g = combinedGrowths(tialla, sniper)!
    expect(g.dex).toBe(tialla.growths!.dex + sniper.growths.dex)
  })

  it('blocks mounted and flying classes for units whose skill forbids them', () => {
    expect(canUseClass(goliath, classById.get('wing-soldier')!)).toBe(false)
    expect(canUseClass(goliath, classById.get('warrior')!)).toBe(true)
  })

  it('reports route availability', () => {
    expect(isRecruitableOn(unitById.get('gaitz')!, 'dietrich')).toBe(true)
    expect(isRecruitableOn(unitById.get('gaitz')!, 'cai')).toBe(false)
    // Story recruits apply to every route.
    expect(isRecruitableOn(unitById.get('creek')!, 'leda')).toBe(true)
  })

  it('rates aptitude fit from weapon requirements', () => {
    expect(aptitudeFit(unitById.get('peter')!, classById.get('sniper')!)).toBe('favored')
  })
})

describe('class path standings and re-weighting', () => {
  const { units, axes, roles, checkpoints } = classPaths
  const last = checkpoints.length - 1
  const stored = (role: string) => new Map<string, RoleResult>(units.map((u) => [u.unit, u.roles[role]]))
  // Read as text: the file is several megabytes, too much to have the compiler infer a type for.
  const raw = import.meta.glob<string>('../../data/pathCandidates.json', { query: '?raw', import: 'default', eager: true })
  const candidates = JSON.parse(Object.values(raw)[0]) as PathCandidates

  it('the candidates file matches the schema and the units', () => {
    expect(pathCandidatesSchema.safeParse(candidates).error?.issues ?? []).toEqual([])
    for (const u of units) {
      const cands = candidates.units[u.unit]
      expect(cands?.length, u.unit).toBeGreaterThan(0)
      for (const c of cands) {
        expect(c.ch.length, u.unit).toBe(u.chapters * axes.length)
        for (const s of c.path) expect(classById.has(s.class), s.class).toBe(true)
      }
    }
  })

  it('agrees with the simulator over the whole campaign', () => {
    for (const role of roles) {
      const all = standingsOver(units, stored(role.id), 0, last)
      expect(all.size).toBe(units.length)
      for (const u of units) {
        // Chapter scores are stored to one decimal, so the margin can differ from the simulator's by a rounding step.
        expect(Math.abs(all.get(u.unit)!.vsCast - u.roles[role.id].vsCast)).toBeLessThan(0.15)
        expect(all.get(u.unit)!.endgame).toBe(u.roles[role.id].chapters.at(-1))
      }
    }
  })

  it('leaves out units that have not joined yet and ranks the rest 1..n', () => {
    const results = stored(roles[0].id)
    const early = standingsOver(units, results, 0, 2)
    const late = units.filter((u) => u.firstChapter > 2)
    expect(late.length).toBeGreaterThan(0)
    for (const u of late) expect(early.has(u.unit)).toBe(false)
    expect([...early.values()].map((r) => r.rank).sort((a, b) => a - b)).toEqual(Array.from({ length: early.size }, (_, i) => i + 1))
    // A single chapter's margins over the cast average sum to zero.
    const one = [...standingsOver(units, results, last, last).values()]
    expect(Math.abs(one.reduce((sum, r) => sum + r.vsCast, 0))).toBeLessThan(1e-6)
    expect(one.every((r) => r.score === r.endgame)).toBe(true)
  })

  it('re-scoring a role with its own weights gives back nearly the simulator\'s scores', () => {
    for (const role of roles) {
      const again = rescore(axes, candidates, role.weights)
      for (const u of units) {
        const r = again.get(u.unit)!
        expect(r.chapters.length).toBe(u.chapters)
        const score = r.chapters.reduce((t, v) => t + v, 0) / r.chapters.length
        // The simulator's pick is among the candidates, so the best candidate scores at least as well (to rounding).
        expect(score, `${u.unit} ${role.id}`).toBeGreaterThan(u.roles[role.id].score - 0.5)
      }
    }
  })

  it('other weights move the ranking, and all-zero sliders are no weighting', () => {
    const reach = normalizeWeights(axes, axes.map((a) => (a.id === 'reach' ? 40 : 0)))!
    expect(reach).toEqual({ reach: 1 })
    const results = rescore(axes, candidates, reach)
    const index = axes.findIndex((a) => a.id === 'reach')
    for (const u of units) {
      const r = results.get(u.unit)!
      expect(Math.max(...candidates.units[u.unit].map((c) => c.ch.filter((_, k) => k % axes.length === index).reduce((t, v) => t + v, 0) / u.chapters / 10)) - r.axes[index]).toBeLessThan(0.05)
    }
    expect(normalizeWeights(axes, axes.map(() => 0))).toBeNull()

    // The page's view: an untouched role is the stored results, an edited one carries a like-for-like baseline.
    const sliders = { [roles[0].id]: axes.map((a) => (a.id === 'reach' ? 40 : 0)) }
    expect(buildView(classPaths, null, sliders, 0, last).roles[0].edited).toBe(false)
    const view = buildView(classPaths, candidates, sliders, 0, last)
    expect(view.roles[0].edited && view.roles[0].weights).toEqual({ reach: 1 })
    expect(view.roles[0].baseline!.results.size).toBe(units.length)
    expect(view.roles[1].edited || view.roles[1].baseline).toBeFalsy()
    for (const u of units) expect(view.roles[1].standings.get(u.unit)!.rank).toBe(u.roles[roles[1].id].rank)
    const own = buildView(classPaths, candidates, { [roles[0].id]: axes.map((a) => (roles[0].weights[a.id] ?? 0) * 100) }, 0, last)
    expect(own.roles[0].edited).toBe(false)
    expect(normalizeWeights(axes, axes.map((_, i) => (i < 2 ? 30 : 0)))).toEqual({ [axes[0].id]: 0.5, [axes[1].id]: 0.5 })
    const standings = { a: standingsOver(units, stored(roles[0].id), 0, last), b: standingsOver(units, results, 0, last) }
    const best = bestRoles(units, standings)
    for (const u of units) expect(standings[best.get(u.unit) as 'a' | 'b'].get(u.unit)!.rank).toBe(Math.min(standings.a.get(u.unit)!.rank, standings.b.get(u.unit)!.rank))
  })
})

describe('class path variants', () => {
  // Read as text, like the candidates: these files are fetched by the page, never imported.
  const files = import.meta.glob<string>('../../data/{classPaths,pathCandidates}.*.json', { query: '?raw', import: 'default', eager: true })
  const last = classPaths.checkpoints.length - 1
  for (const plan of PLANS) {
    for (const arts of ARTS) {
      const suffix = variantSuffix(plan.id, arts.id)
      if (!suffix) continue
      it(`${plan.label}, combat arts ${arts.label.toLowerCase()}`, () => {
        const paths = JSON.parse(files[`../../data/classPaths${suffix}.json`]) as ClassPaths
        const candidates = JSON.parse(files[`../../data/pathCandidates${suffix}.json`]) as PathCandidates
        expect(classPathsSchema.safeParse(paths).error?.issues ?? []).toEqual([])
        expect(pathCandidatesSchema.safeParse(candidates).error?.issues ?? []).toEqual([])
        // Same chapters, roles, axes and units as the first variant's file, so the page can swap one for the other.
        expect(paths.checkpoints).toEqual(classPaths.checkpoints)
        expect(paths.roles).toEqual(classPaths.roles)
        expect(paths.axes).toEqual(classPaths.axes)
        expect(paths.units.map((u) => u.unit)).toEqual(classPaths.units.map((u) => u.unit))
        expect(paths.scope.arts).toBe(!arts.id)
        if (arts.id) expect(paths.units.flatMap((u) => u.caveats)).toEqual([])
        const start = Math.max(0, classPaths.checkpoints.findIndex((c) => c.id === plan.from))
        expect(start > 0).toBe(!!plan.id)
        for (const u of paths.units) {
          expect(u.firstChapter, u.unit).toBeGreaterThanOrEqual(start)
          expect(u.firstChapter + u.chapters, u.unit).toBe(last + 1)
          for (const r of paths.roles) {
            expect(u.roles[r.id].chapters.length, u.unit).toBe(u.chapters)
            for (const s of u.roles[r.id].path) expect(classById.has(s.class), s.class).toBe(true)
          }
          expect(candidates.units[u.unit]?.length, u.unit).toBeGreaterThan(0)
          for (const c of candidates.units[u.unit]) expect(c.ch.length, u.unit).toBe(u.chapters * paths.axes.length)
        }
        const view = buildView(paths, null, {}, start, last)
        expect(view.start).toBe(start)
        expect(view.ranged).toBe(false)
      })
    }
  }
  it('the first variant is the one in the bundle', () => {
    expect(variantSuffix(PLANS[0].id, ARTS[0].id)).toBe('')
    expect(classPaths.scope.arts).toBe(true)
  })
})

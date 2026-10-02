import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import unitsJson from '../../data/units.json'
import classesJson from '../../data/classes.json'
import skillsJson from '../../data/skills.json'
import routesJson from '../../data/routes.json'
import paraloguesJson from '../../data/paralogues.json'
import { classSchema, paralogueSchema, routeSchema, skillSchema, unitSchema } from './schema'
import {
  aptitudeFit, canUseClass, classById, combinedGrowths, isRecruitableOn, paralogueById, routeById, skillById,
  unitById, units,
} from './index'

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

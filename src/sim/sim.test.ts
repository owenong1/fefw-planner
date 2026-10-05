import { describe as suite, expect, it } from 'vitest'
import { classPaths, classes, units } from '../data'
import { describe, runCommand } from './engine/commands.js'
import type { Block } from './protocol'
import { loadSimData } from './rawData'

// The engine has its own tests in src/sim/test. These check the pieces only the site uses (rawData, the
// document types) and that the simulator's data still lines up with the rest of the site's.
const data = loadSimData()
const env = { data, runCast: () => { throw new Error('not needed') }, template: () => '' }
const run = (...argv: string[]): Promise<Block[]> => runCommand(argv, env)

suite('simulator copy', () => {
  it('names the same units and classes as the site data', () => {
    const meta = describe(data)
    const unitNames = new Set(units.map((u) => u.name))
    const classNames = new Set(classes.map((c) => c.name))
    expect(meta.units.map((u: { name: string }) => u.name).filter((n: string) => !unitNames.has(n))).toEqual([])
    expect(meta.classes.map((c: { name: string }) => c.name).filter((n: string) => !classNames.has(n))).toEqual([])
  })

  it('offers the roles the Class Paths data was generated with', () => {
    const roles = describe(data).roles.map((r: { id: string }) => r.id)
    for (const r of classPaths.roles) expect(roles).toContain(r.id)
  })

  it('runs a command and returns a document', async () => {
    const doc = await run('path', 'Cai', 'Gladiator>Brigand>Warrior>Battlemaster')
    const table = doc.find((b) => b.t === 'table')
    expect(table?.t === 'table' && table.cols.map((c) => c.h)).toContain('Checkpoint')
    expect(doc.some((b) => b.t === 'text' && b.cli)).toBe(true)
  })

  it('reports a mistake in the command as a CommandError', async () => {
    await expect(run('char', 'Nobody')).rejects.toThrow(/Unknown unit/)
  })

  it('agrees with the committed Class Paths data', async () => {
    // Without rolled playthroughs the recommendation can differ from the committed one, but the search itself
    // is the same, so the committed path must score what the copy says it scores.
    const sofia = classPaths.units.find((u) => u.unit === 'sofia')!
    const healer = sofia.roles.healer
    const name = (id: string) => classes.find((c) => c.id === id)!.name
    const doc = await run('path', 'Sofia', healer.path.map((s) => `${name(s.class)}@${s.level}`).join('>'), '--json')
    const out = JSON.parse((doc[0] as { text: string }).text)
    expect(out.roles.healer.score).toBeCloseTo(healer.score, 1)
  })
})

import { describe, expect, it } from 'vitest'
import { unitById, units } from '../data'
import { defaultInput, parseInput, serializeInput } from './rngInput'

const unit = units.find((u) => u.baseStats && u.growths)!
const unpublished = units.find((u) => !u.baseStats && u.growths)!

describe('rng input URL', () => {
  it('a bare unit link prefills its published bases and starting class', () => {
    const input = parseInput(new URLSearchParams({ u: unit.id }), unitById)
    expect(input).toEqual(defaultInput(unit))
    expect(input.base).toEqual(unit.baseStats)
  })

  it('always uses published bases, even if the link says otherwise', () => {
    const params = new URLSearchParams({ u: unit.id, sl: '9', b: '1.1.1.1.1.1.1.1.1' })
    expect(parseInput(params, unitById)).toMatchObject({ startLevel: unit.baseLevel, base: unit.baseStats })
    expect(serializeInput(parseInput(params, unitById), unit).has('b')).toBe(false)
  })

  it('round-trips edited inputs, including blanks', () => {
    const input = {
      ...defaultInput(unpublished),
      base: { ...defaultInput(unpublished).base, str: 7 },
      level: 20,
      startLevel: 3,
      final: { ...defaultInput(unit).final, str: 18, hp: 40 },
      classes: [
        { classId: 'commoner', fromLevel: null },
        { classId: 'ornius-rider', fromLevel: 5 },
        { classId: 'myrmidon', fromLevel: null },
      ],
    }
    expect(parseInput(serializeInput(input, unpublished), unitById)).toEqual(input)
  })
})

import { describe, expect, it } from 'vitest'
import { drawSide } from './draw'

describe('drawSide (R37)', () => {
  it('partage l’intervalle en deux moitiés égales', () => {
    expect(drawSide(() => 0)).toBe('white')
    expect(drawSide(() => 0.499_999)).toBe('white')
    expect(drawSide(() => 0.5)).toBe('black')
    expect(drawSide(() => 0.999_999)).toBe('black')
  })

  it('ne penche d’aucun côté sur un aléa uniforme', () => {
    // Un tirage qui sortirait 51/49 se remarquerait moins qu'un bug franc, et
    // c'est précisément ce que la borne ci-dessus protège.
    const draws = Array.from({ length: 1_000 }, (_, i) => drawSide(() => i / 1_000))
    expect(draws.filter((side) => side === 'white')).toHaveLength(500)
    expect(draws.filter((side) => side === 'black')).toHaveLength(500)
  })
})

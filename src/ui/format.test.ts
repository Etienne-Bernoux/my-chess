import { describe, expect, it } from 'vitest'
import { TENTHS_BELOW_MS, formatRemaining } from './format'

describe('formatRemaining', () => {
  it('rend m:ss au-dessus du seuil', () => {
    expect(formatRemaining(180_000)).toBe('3:00')
    expect(formatRemaining(600_000)).toBe('10:00')
    expect(formatRemaining(65_000)).toBe('1:05')
    expect(formatRemaining(20_000)).toBe('0:20')
  })

  it('rend les dixièmes en dessous du seuil', () => {
    expect(formatRemaining(19_999)).toBe('19.9')
    expect(formatRemaining(19_900)).toBe('19.9')
    expect(formatRemaining(1_050)).toBe('1.0')
    expect(formatRemaining(0)).toBe('0.0')
  })

  it('le seuil bascule au bon millième', () => {
    expect(formatRemaining(TENTHS_BELOW_MS - 1)).toBe('19.9')
    expect(formatRemaining(TENTHS_BELOW_MS)).toBe('0:20')
  })

  it('n’arrondit jamais vers le haut : 999 ms restantes ne s’affichent pas 1,0 s', () => {
    expect(formatRemaining(999)).toBe('0.9')
    expect(formatRemaining(59_999)).toBe('0:59')
  })

  it('ne rend jamais NaN ni de valeur négative', () => {
    for (const input of [-1, -100_000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = formatRemaining(input)
      expect(out).not.toMatch(/NaN|-/)
    }
    expect(formatRemaining(-1)).toBe('0.0')
    expect(formatRemaining(Number.NaN)).toBe('0.0')
  })
})

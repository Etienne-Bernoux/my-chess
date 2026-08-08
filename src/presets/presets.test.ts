import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESET, PRESETS, parseTimeControl, presetById } from './presets'
import { systemClock } from '../domain/clock'

const valid = {
  id: 'x',
  label: 'X',
  mode: 'fischer',
  initialMs: { white: 1000, black: 1000 },
  incrementMs: 0,
}

describe('presets', () => {
  it('charge time-controls.json et rend les deux modes', () => {
    expect(PRESETS.length).toBeGreaterThan(0)
    expect(PRESETS.some((p) => p.mode === 'fischer')).toBe(true)
    expect(PRESETS.some((p) => p.mode === 'bronstein')).toBe(true)
  })

  it('toutes les durées versionnées sont des entiers', () => {
    for (const p of PRESETS) {
      expect(Number.isInteger(p.initialMs.white)).toBe(true)
      expect(Number.isInteger(p.initialMs.black)).toBe(true)
      expect(Number.isInteger(p.incrementMs)).toBe(true)
    }
  })

  it('accepte un incrément nul (R2)', () => {
    expect(parseTimeControl({ ...valid, incrementMs: 0 }).incrementMs).toBe(0)
  })

  it('rejette un incrément négatif ou fractionnaire', () => {
    expect(() => parseTimeControl({ ...valid, incrementMs: -1 })).toThrow()
    expect(() => parseTimeControl({ ...valid, incrementMs: 1.5 })).toThrow()
  })

  it('rejette un temps initial absent, nul ou fractionnaire', () => {
    expect(() => parseTimeControl({ ...valid, initialMs: undefined })).toThrow()
    expect(() => parseTimeControl({ ...valid, initialMs: { white: 0, black: 1000 } })).toThrow()
    expect(() => parseTimeControl({ ...valid, initialMs: { white: 1000.5, black: 1000 } })).toThrow()
  })

  it('rejette un mode inconnu', () => {
    expect(() => parseTimeControl({ ...valid, mode: 'byoyomi' })).toThrow()
  })

  it('R30 : un identifiant inconnu retombe sur le preset par défaut', () => {
    expect(presetById('inexistant')).toBe(DEFAULT_PRESET)
    expect(presetById(null)).toBe(DEFAULT_PRESET)
    expect(presetById(PRESETS[1]!.id)).toBe(PRESETS[1])
  })
})

describe('systemClock', () => {
  it('R23 : rend toujours un entier', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(Number.isInteger(systemClock.now())).toBe(true)
    }
  })
})

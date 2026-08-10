import { describe, expect, it } from 'vitest'
import {
  CUSTOM_ID,
  DEFAULT_DRAFT,
  MAX_INCREMENT_SECONDS,
  MAX_MINUTES,
  buildCustom,
  draftFromTimeControl,
} from './custom'
import { parseTimeControl } from './presets'
import type { CustomDraft } from './custom'

const draft = (over: Partial<CustomDraft> = {}): CustomDraft => ({ ...DEFAULT_DRAFT, ...over })

const built = (over: Partial<CustomDraft> = {}) => {
  const result = buildCustom(draft(over))
  if (!result.ok) throw new Error(`cadence refusée : ${result.reason}`)
  return result.timeControl
}

describe('buildCustom — conversion', () => {
  it('convertit minutes et secondes en millisecondes entières (R23)', () => {
    const control = built({ minutes: 5, incrementSeconds: 3 })
    expect(control.initialMs).toEqual({ white: 300_000, black: 300_000 })
    expect(control.incrementMs).toBe(3_000)
    expect(Number.isInteger(control.initialMs.white)).toBe(true)
  })

  it('porte l’identifiant réservé, jamais celui d’un preset', () => {
    expect(built().id).toBe(CUSTOM_ID)
  })

  it('R2 : un incrément nul est une cadence valide', () => {
    expect(built({ incrementSeconds: 0 }).incrementMs).toBe(0)
  })

  it('R1 : le mode Bronstein traverse la saisie', () => {
    expect(built({ mode: 'bronstein' }).mode).toBe('bronstein')
  })

  it('produit une cadence que le validateur du fichier de presets accepte', () => {
    // C'est ce validateur qui hydrate un journal repris (R27) et la préférence
    // mémorisée (R30) : une cadence qu'il refuserait ne survivrait pas au
    // premier rechargement, sans que rien ne le signale à la saisie.
    const control = built({ handicap: true, whiteMinutes: 5, blackMinutes: 3 })
    expect(() => parseTimeControl(JSON.parse(JSON.stringify(control)))).not.toThrow()
  })
})

describe('buildCustom — handicap (R4)', () => {
  it('donne à chaque camp son temps initial', () => {
    const control = built({ handicap: true, whiteMinutes: 5, blackMinutes: 3 })
    expect(control.initialMs).toEqual({ white: 300_000, black: 180_000 })
  })

  it('ignore les temps par camp tant que le handicap n’est pas coché', () => {
    const control = built({ handicap: false, minutes: 10, whiteMinutes: 5, blackMinutes: 3 })
    expect(control.initialMs).toEqual({ white: 600_000, black: 600_000 })
  })

  it('nomme le handicap dans le label, et seulement quand il change quelque chose', () => {
    expect(built({ minutes: 5, incrementSeconds: 3 }).label).toBe('5+3')
    expect(built({ mode: 'bronstein', minutes: 5, incrementSeconds: 3 }).label).toBe('5+3 Bronstein')
    expect(built({ handicap: true, whiteMinutes: 5, blackMinutes: 3, incrementSeconds: 2 }).label).toBe(
      '5+2 · Noirs 3',
    )
    expect(built({ handicap: true, whiteMinutes: 5, blackMinutes: 5, incrementSeconds: 2 }).label).toBe('5+2')
  })
})

describe('buildCustom — refus', () => {
  const reasonOf = (over: Partial<CustomDraft>): string => {
    const result = buildCustom(draft(over))
    if (result.ok) throw new Error('cadence acceptée alors qu’elle devait être refusée')
    return result.reason
  }

  it('refuse un champ vide — `valueAsNumber` rend alors NaN', () => {
    expect(reasonOf({ minutes: Number.NaN })).toMatch(/entier/)
    expect(reasonOf({ incrementSeconds: Number.NaN })).toMatch(/entier/)
  })

  it('refuse une durée fractionnaire (R23)', () => {
    expect(reasonOf({ minutes: 2.5 })).toMatch(/entier/)
  })

  it('refuse zéro minute et au-delà du plafond', () => {
    expect(reasonOf({ minutes: 0 })).toMatch(/minutes/)
    expect(reasonOf({ minutes: MAX_MINUTES + 1 })).toMatch(/minutes/)
    expect(reasonOf({ incrementSeconds: -1 })).toMatch(/secondes/)
    expect(reasonOf({ incrementSeconds: MAX_INCREMENT_SECONDS + 1 })).toMatch(/secondes/)
  })

  it('nomme le camp fautif quand le handicap est coché', () => {
    expect(reasonOf({ handicap: true, whiteMinutes: 5, blackMinutes: 0 })).toMatch(/^Noirs/)
    expect(reasonOf({ handicap: true, whiteMinutes: 0, blackMinutes: 5 })).toMatch(/^Blancs/)
  })

  it('refuse un mode inconnu venu du DOM', () => {
    expect(reasonOf({ mode: 'byo-yomi' as never })).toMatch(/Mode/)
  })
})

describe('draftFromTimeControl', () => {
  it('réamorce la saisie depuis la cadence en vigueur', () => {
    const control = built({ handicap: true, whiteMinutes: 5, blackMinutes: 3, incrementSeconds: 2 })
    expect(draftFromTimeControl(control)).toMatchObject({
      whiteMinutes: 5,
      blackMinutes: 3,
      incrementSeconds: 2,
      handicap: true,
    })
  })

  it('ne coche le handicap que si les deux camps diffèrent réellement', () => {
    expect(draftFromTimeControl(built({ minutes: 5 })).handicap).toBe(false)
  })

  it('ramène dans les bornes une cadence du fichier de presets inexprimable à la main', () => {
    // Bullet 1+0 tient en une minute ; une cadence de trente secondes ne
    // s'exprime pas en minutes entières et ne doit pas produire un brouillon nul.
    const brief = parseTimeControl({
      id: 'x',
      label: 'X',
      mode: 'fischer',
      initialMs: { white: 30_000, black: 30_000 },
      incrementMs: 0,
    })
    expect(draftFromTimeControl(brief).minutes).toBe(1)
  })
})

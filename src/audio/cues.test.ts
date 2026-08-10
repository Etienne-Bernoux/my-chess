import { describe, expect, it } from 'vitest'
import { createWebAudioCues, cueForTransition, silentSink } from './cues'
import { fold } from '../domain/fold'
import { newJournal, start, tap } from '../domain/commands'
import type { Half, Journal, TimeControl, View } from '../domain/types'

const START_AT = 1_000
const WHITE: Half = 'bottom'

const tc = (over: Partial<TimeControl> = {}): TimeControl => ({
  id: 't',
  label: 'T',
  mode: 'fischer',
  initialMs: { white: 180_000, black: 180_000 },
  incrementMs: 2_000,
  ...over,
})

/** Une partie où les Blancs disposent de 12 s : le seuil des 10 s est proche. */
const short = (): Journal =>
  start(newJournal(tc({ initialMs: { white: 12_000, black: 180_000 } })), START_AT, WHITE)!

const at = (journal: Journal, now: number): View => fold(journal, now)

describe('cueForTransition — seuil des dix secondes (R13)', () => {
  const journal = short()

  it('le franchissement produit exactement un signal', () => {
    const before = at(journal, START_AT + 1_999) // 10 001 ms restantes
    const after = at(journal, START_AT + 2_000) // 10 000 ms — pas encore
    const crossed = at(journal, START_AT + 2_001) // 9 999 ms

    expect(cueForTransition(before, after)).toBeNull()
    expect(cueForTransition(after, crossed)).toBe('urgent')
  })

  it('rester sous le seuil n’en produit plus', () => {
    const a = at(journal, START_AT + 3_000)
    const b = at(journal, START_AT + 4_000)
    expect(cueForTransition(a, b)).toBeNull()
  })

  it('rester au-dessus du seuil n’en produit aucun', () => {
    const a = at(journal, START_AT)
    const b = at(journal, START_AT + 500)
    expect(cueForTransition(a, b)).toBeNull()
  })

  it('la première vue rendue ne déclenche rien', () => {
    expect(cueForTransition(null, at(journal, START_AT + 5_000))).toBeNull()
  })

  it('redessiner deux fois au même instant ne redéclenche pas', () => {
    const v = at(journal, START_AT + 2_001)
    expect(cueForTransition(at(journal, START_AT + 2_000), v)).toBe('urgent')
    expect(cueForTransition(v, v)).toBeNull()
  })

  it('chaque joueur reçoit son propre signal', () => {
    const both = start(
      newJournal(tc({ initialMs: { white: 12_000, black: 12_000 } })),
      START_AT,
      WHITE,
    )!
    const handedOver = tap(both, START_AT + 1_000, WHITE)!

    // Les Noirs franchissent leur propre seuil, indépendamment des Blancs.
    const before = at(handedOver, START_AT + 2_999)
    const after = at(handedOver, START_AT + 3_001)
    expect(cueForTransition(before, after)).toBe('urgent')
  })

  it('un tap ne fabrique pas de franchissement pour le joueur qui reprend la main', () => {
    const journalFischer = start(
      newJournal(tc({ initialMs: { white: 5_000, black: 180_000 } })),
      START_AT,
      WHITE,
    )!
    const before = at(journalFischer, START_AT + 1_000)
    const after = at(tap(journalFischer, START_AT + 1_000, WHITE)!, START_AT + 1_000)
    expect(cueForTransition(before, after)).toBeNull()
  })

  it('un franchissement survenu dans la même frame que le tap n’est pas perdu', () => {
    // Blancs 12 s, mort subite. Ils franchissent les 10 s à START_AT + 2 000 et
    // rendent la main au même instant : leur moitié ne tourne plus dans la vue
    // courante, mais le signal leur est dû — et sous le seuil, la condition ne
    // redeviendrait plus jamais vraie.
    const j = start(
      newJournal(tc({ initialMs: { white: 12_000, black: 180_000 }, incrementMs: 0 })),
      START_AT,
      WHITE,
    )!
    const before = at(j, START_AT + 1_500)
    const after = at(tap(j, START_AT + 2_001, WHITE)!, START_AT + 2_001)

    expect(after.running).toBe('top')
    expect(after.remaining.bottom).toBeLessThan(10_000)
    expect(cueForTransition(before, after)).toBe('urgent')
  })
})

describe('cueForTransition — chute du drapeau (R13, R17)', () => {
  const journal = short()

  it('la chute produit son propre signal', () => {
    const before = at(journal, START_AT + 11_999)
    const after = at(journal, START_AT + 12_000)
    expect(cueForTransition(before, after)).toBe('flag')
  })

  it('passer de trente secondes au drapeau en une transition ne produit que la chute', () => {
    const long = start(newJournal(tc({ initialMs: { white: 30_000, black: 180_000 } })), START_AT, WHITE)!
    const before = at(long, START_AT) // 30 s, bien au-dessus du seuil
    const after = at(long, START_AT + 20 * 60_000) // retour d'arrière-plan
    expect(cueForTransition(before, after)).toBe('flag')
  })

  it('un drapeau déjà tombé ne resignale pas à chaque frame', () => {
    const a = at(journal, START_AT + 12_000)
    const b = at(journal, START_AT + 12_500)
    expect(cueForTransition(a, b)).toBeNull()
  })

  it('les deux signatures sont distinctes', () => {
    const urgent = cueForTransition(at(journal, START_AT + 2_000), at(journal, START_AT + 2_001))
    const flagged = cueForTransition(at(journal, START_AT + 11_999), at(journal, START_AT + 12_000))
    expect(urgent).not.toBe(flagged)
  })
})

describe('cueForTransition — les trois paliers (R33, R34)', () => {
  /** Quatre-vingt-dix secondes : les trois paliers sont armés. */
  const long = (): Journal =>
    start(
      newJournal(tc({ initialMs: { white: 90_000, black: 180_000 }, incrementMs: 0 })),
      START_AT,
      WHITE,
    )!

  it('chaque palier parle une fois, et une seule', () => {
    const j = long()
    const signals: (string | null)[] = []
    let previous = at(j, START_AT)

    for (const elapsed of [30_001, 45_000, 60_001, 75_000, 80_001, 85_000]) {
      const current = at(j, START_AT + elapsed)
      signals.push(cueForTransition(previous, current))
      previous = current
    }

    expect(signals).toEqual(['minute', null, 'half-minute', null, 'urgent', null])
  })

  it('plusieurs paliers franchis en une seule transition ne produisent que le plus urgent', () => {
    // Retour d'arrière-plan : les trois seuils sont derrière nous d'un coup. Trois
    // bips empilés diraient moins que le seul qui compte.
    const j = long()
    const before = at(j, START_AT)
    const after = at(j, START_AT + 85_000)

    expect(after.alert.bottom).toBe('urgent')
    expect(cueForTransition(before, after)).toBe('urgent')
  })

  it('l’incrément qui fait remonter au-dessus du seuil ne rejoue pas le palier', () => {
    const j = start(
      newJournal(tc({ initialMs: { white: 40_000, black: 180_000 }, incrementMs: 10_000 })),
      START_AT,
      WHITE,
    )!

    const crossed = at(j, START_AT + 10_001) // 29 999 ms : le palier tombe
    expect(cueForTransition(at(j, START_AT + 9_999), crossed)).toBe('half-minute')

    // 25 s au tap, plus dix d'incrément : 35 s au tableau, au-dessus du seuil.
    const handedOver = tap(j, START_AT + 15_000, WHITE)!
    const above = at(handedOver, START_AT + 15_000)
    expect(above.remaining[WHITE]).toBe(35_000)
    expect(cueForTransition(crossed, above)).toBeNull()

    // Les Blancs reprennent la main et repassent sous trente secondes : le palier
    // a déjà parlé pour cette partie, il ne parle pas deux fois.
    const back = tap(handedOver, START_AT + 16_000, 'top')!
    const under = at(back, START_AT + 21_001)
    expect(under.remaining[WHITE]).toBeLessThan(30_000)
    expect(cueForTransition(at(back, START_AT + 20_999), under)).toBeNull()
  })
})

describe('createWebAudioCues', () => {
  it('ne crée le contexte qu’au premier armement, et une seule fois (R14)', () => {
    let created = 0
    const cues = createWebAudioCues(() => {
      created += 1
      throw new Error('Web Audio indisponible dans ce test')
    })

    expect(created).toBe(0)
    cues.arm()
    expect(created).toBe(1)
  })

  it('un environnement sans Web Audio ne fait jamais échouer la pendule', () => {
    const cues = createWebAudioCues(() => {
      throw new Error('AudioContext absent')
    })
    expect(() => {
      cues.arm()
      cues.play('flag')
      cues.play('urgent')
    }).not.toThrow()
  })

  it('jouer avant tout armement ne fait rien', () => {
    let created = 0
    const cues = createWebAudioCues(() => {
      created += 1
      throw new Error('ne devrait pas être appelé')
    })
    cues.play('flag')
    expect(created).toBe(0)
  })
})

describe('silentSink', () => {
  it('n’émet rien et ne jette jamais (R15)', () => {
    expect(() => {
      silentSink.arm()
      silentSink.play('urgent')
      silentSink.play('flag')
    }).not.toThrow()
  })
})

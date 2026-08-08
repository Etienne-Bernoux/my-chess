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

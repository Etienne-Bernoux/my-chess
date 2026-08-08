import { describe, expect, it } from 'vitest'
import { fold } from './fold'
import { otherHalf } from './types'
import type { ClockEvent, Half, Journal, TimeControl } from './types'

const START_AT = 1000
const WHITE: Half = 'bottom'
const BLACK: Half = 'top'

const tc = (over: Partial<TimeControl> = {}): TimeControl => ({
  id: 't',
  label: 'T',
  mode: 'fischer',
  initialMs: { white: 180_000, black: 180_000 },
  incrementMs: 2_000,
  ...over,
})

const withEvents = (timeControl: TimeControl, events: readonly ClockEvent[]): Journal => ({
  version: 1,
  timeControl,
  events,
})

/** Construit un journal depuis la suite des durées de réflexion, en alternance. */
function playout(timeControl: TimeControl, elapsed: readonly number[]): Journal {
  const events: ClockEvent[] = [{ type: 'start', at: START_AT, whiteHalf: WHITE }]
  let at = START_AT
  let half: Half = WHITE
  for (const d of elapsed) {
    at += d
    events.push({ type: 'tap', at, half })
    half = otherHalf(half)
  }
  return withEvents(timeControl, events)
}

const lastAt = (j: Journal): number => j.events[j.events.length - 1]!.at

// Cinq coups chacun. Blancs consomment 24 500, Noirs 34 000.
// Un seul coup blanc (500) et un seul coup noir (1 000) sont plus courts que
// l'incrément de 2 000 — c'est ce qui sépare Fischer de Bronstein.
const GAME = [5_000, 3_000, 10_000, 1_000, 500, 20_000, 2_000, 4_000, 7_000, 6_000] as const

/** Instant du dernier tap de GAME : les Blancs viennent de reprendre la main. */
const GAME_END = START_AT + GAME.reduce((a, b) => a + b, 0)

describe('fold — partie complète', () => {
  it('Fischer : chaque coup rend l’incrément entier (R1, R3)', () => {
    const j = playout(tc({ mode: 'fischer' }), GAME)
    const v = fold(j, lastAt(j))

    expect(v.remaining[WHITE]).toBe(180_000 - 24_500 + 5 * 2_000)
    expect(v.remaining[BLACK]).toBe(180_000 - 34_000 + 5 * 2_000)
    expect(v.running).toBe(WHITE)
    expect(v.flagged).toBeNull()
    expect(v.phase).toBe('running')
  })

  it('Bronstein : chaque coup rend min(incrément, consommé) (R1, R3)', () => {
    const j = playout(tc({ mode: 'bronstein' }), GAME)
    const v = fold(j, lastAt(j))

    // Blancs : 2000 + 2000 + 500 + 2000 + 2000 = 8 500
    expect(v.remaining[WHITE]).toBe(180_000 - 24_500 + 8_500)
    // Noirs : 2000 + 1000 + 2000 + 2000 + 2000 = 9 000
    expect(v.remaining[BLACK]).toBe(180_000 - 34_000 + 9_000)
  })

  it('R3 : l’écart entre les deux modes vaut exactement increment − elapsed sur les coups courts', () => {
    const f = fold(playout(tc({ mode: 'fischer' }), GAME), GAME_END)
    const b = fold(playout(tc({ mode: 'bronstein' }), GAME), GAME_END)

    expect(f.remaining[WHITE] - b.remaining[WHITE]).toBe(2_000 - 500)
    expect(f.remaining[BLACK] - b.remaining[BLACK]).toBe(2_000 - 1_000)
  })

  it('R2 : incrément nul — mort subite, et les deux modes coïncident', () => {
    const f = fold(playout(tc({ mode: 'fischer', incrementMs: 0 }), GAME), GAME_END)
    const b = fold(playout(tc({ mode: 'bronstein', incrementMs: 0 }), GAME), GAME_END)

    expect(f.remaining).toEqual(b.remaining)
    expect(f.remaining[WHITE]).toBe(180_000 - 24_500)
    expect(f.remaining[BLACK]).toBe(180_000 - 34_000)
  })

  it('R23 : toutes les durées restent entières tout au long de la partie', () => {
    const j = playout(tc({ mode: 'bronstein' }), GAME)
    for (let at = START_AT; at <= lastAt(j); at += 137) {
      const v = fold(j, at)
      expect(Number.isInteger(v.remaining.top)).toBe(true)
      expect(Number.isInteger(v.remaining.bottom)).toBe(true)
    }
  })
})

describe('fold — démarrage et taps', () => {
  it('journal vide : phase idle, aucune moitié ne tourne', () => {
    const v = fold(withEvents(tc(), []), 999_999)
    expect(v.phase).toBe('idle')
    expect(v.running).toBeNull()
    expect(v.whiteHalf).toBeNull()
    expect(v.remaining[BLACK]).toBe(180_000)
    expect(v.remaining[WHITE]).toBe(180_000)
  })

  it('R8 : la moitié tapée au démarrage est celle des Blancs et c’est elle qui part', () => {
    const j = withEvents(tc(), [{ type: 'start', at: START_AT, whiteHalf: 'top' }])
    const v = fold(j, START_AT)
    expect(v.whiteHalf).toBe('top')
    expect(v.running).toBe('top')
  })

  it('R4 : les temps initiaux sont attribués par joueur, pas par moitié', () => {
    const j = withEvents(tc({ initialMs: { white: 60_000, black: 120_000 } }), [
      { type: 'start', at: START_AT, whiteHalf: 'top' },
    ])
    const v = fold(j, START_AT)
    expect(v.remaining.top).toBe(60_000)
    expect(v.remaining.bottom).toBe(120_000)
  })

  it('R9 : un tap sur la moitié qui ne tourne pas n’a aucun effet', () => {
    const legal = playout(tc(), [5_000])
    const withIllegal = withEvents(tc(), [
      ...legal.events,
      { type: 'tap', at: START_AT + 7_000, half: WHITE },
    ])

    const at = START_AT + 9_000
    expect(fold(withIllegal, at)).toEqual(fold(legal, at))
  })
})

describe('fold — chute du drapeau', () => {
  const short = tc({ initialMs: { white: 5_000, black: 180_000 } })
  const started = withEvents(short, [{ type: 'start', at: START_AT, whiteHalf: WHITE }])

  it('tombe à l’échéance exacte, jamais avant', () => {
    expect(fold(started, START_AT + 4_999).flagged).toBeNull()
    expect(fold(started, START_AT + 4_999).remaining[WHITE]).toBe(1)

    const v = fold(started, START_AT + 5_000)
    expect(v.flagged).toBe(WHITE)
    expect(v.remaining[WHITE]).toBe(0)
    expect(v.phase).toBe('flagged')
  })

  it('ne descend jamais sous zéro, même très au-delà de l’échéance', () => {
    const v = fold(started, START_AT + 5_000_000)
    expect(v.remaining[WHITE]).toBe(0)
    expect(v.remaining[BLACK]).toBe(180_000)
  })

  it('tap trois millisecondes avant l’échéance : le coup passe', () => {
    const j = withEvents(short, [
      ...started.events,
      { type: 'tap', at: START_AT + 4_997, half: WHITE },
    ])
    const v = fold(j, START_AT + 4_997)
    expect(v.flagged).toBeNull()
    expect(v.remaining[WHITE]).toBe(3 + 2_000)
    expect(v.running).toBe(BLACK)
  })

  it('tap trois millisecondes après l’échéance : le drapeau était déjà tombé', () => {
    const j = withEvents(short, [
      ...started.events,
      { type: 'tap', at: START_AT + 5_003, half: WHITE },
    ])
    const v = fold(j, START_AT + 5_003)
    expect(v.flagged).toBe(WHITE)
    expect(v.remaining[WHITE]).toBe(0)
    expect(v.running).toBeNull()
  })

  it('R17 : les événements postérieurs à la chute ne sont plus appliqués', () => {
    const j = withEvents(short, [
      ...started.events,
      { type: 'tap', at: START_AT + 9_000, half: WHITE },
      { type: 'tap', at: START_AT + 12_000, half: BLACK },
    ])
    const v = fold(j, START_AT + 60_000)
    expect(v.flagged).toBe(WHITE)
    expect(v.remaining[BLACK]).toBe(180_000)
  })

  it('R18 : la vue n’expose aucun résultat de partie', () => {
    const v = fold(started, START_AT + 10_000)
    const keys = Object.keys(v)
    expect(keys).not.toContain('winner')
    expect(keys).not.toContain('loser')
    expect(keys).not.toContain('result')
    expect(JSON.stringify(v)).not.toMatch(/win|lose|result/i)
  })
})

describe('fold — arrière-plan et idempotence (R21)', () => {
  it('vingt minutes d’arrière-plan : le drapeau tombe à l’échéance, pas au retour', () => {
    const j = playout(tc(), [5_000, 3_000])
    const echeance = lastAt(j) + (180_000 - 5_000 + 2_000)

    expect(fold(j, echeance - 1).flagged).toBeNull()
    expect(fold(j, echeance).flagged).toBe(WHITE)

    const auRetour = fold(j, lastAt(j) + 20 * 60_000)
    expect(auRetour.flagged).toBe(WHITE)
    expect(auRetour.remaining[WHITE]).toBe(0)
    expect(auRetour.remaining[BLACK]).toBe(180_000 - 3_000 + 2_000)
  })

  it('rejouer le même journal au même instant rend exactement la même vue', () => {
    const j = playout(tc({ mode: 'bronstein' }), GAME)
    const at = lastAt(j) + 4_242
    const first = fold(j, at)
    for (let i = 0; i < 5; i += 1) {
      expect(fold(j, at)).toEqual(first)
    }
  })

  it('le temps restant ne remonte jamais entre deux instants croissants sans tap', () => {
    const j = playout(tc(), [5_000])
    let previous = fold(j, lastAt(j)).remaining[BLACK]
    for (let at = lastAt(j); at < lastAt(j) + 30_000; at += 250) {
      const current = fold(j, at).remaining[BLACK]
      expect(current).toBeLessThanOrEqual(previous)
      previous = current
    }
  })

  it('KTD2 : une horloge qui saute en arrière ne rend jamais de temps', () => {
    const j = playout(tc(), [5_000])
    const reference = fold(j, lastAt(j))
    expect(fold(j, lastAt(j) - 3_000)).toEqual(reference)
  })
})

describe('fold — pause et reprise', () => {
  it('aucun temps n’est consommé entre pause et reprise', () => {
    const j = withEvents(tc(), [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'pause', at: START_AT + 1_000 },
      { type: 'resume', at: START_AT + 61_000 },
    ])
    expect(fold(j, START_AT + 61_000).remaining[WHITE]).toBe(179_000)
    expect(fold(j, START_AT + 61_000).phase).toBe('running')
  })

  it('en pause, le temps ne bouge plus quel que soit l’instant courant', () => {
    const j = withEvents(tc(), [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'pause', at: START_AT + 1_000 },
    ])
    expect(fold(j, START_AT + 1_000).remaining[WHITE]).toBe(179_000)
    expect(fold(j, START_AT + 600_000).remaining[WHITE]).toBe(179_000)
    expect(fold(j, START_AT + 600_000).phase).toBe('paused')
    expect(fold(j, START_AT + 600_000).running).toBeNull()
  })

  it('KTD5 : une pause au milieu d’un coup ne gonfle pas le gain Bronstein', () => {
    const j = withEvents(tc({ mode: 'bronstein' }), [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'pause', at: START_AT + 400 },
      { type: 'resume', at: START_AT + 30_400 },
      { type: 'tap', at: START_AT + 30_800, half: WHITE },
    ])
    // 800 ms réellement consommés → gain 800, pas 2 000.
    expect(fold(j, START_AT + 30_800).remaining[WHITE]).toBe(180_000)
  })

  it('la reprise redonne la main au même joueur', () => {
    const j = withEvents(tc(), [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'tap', at: START_AT + 1_000, half: WHITE },
      { type: 'pause', at: START_AT + 2_000 },
      { type: 'resume', at: START_AT + 90_000 },
    ])
    expect(fold(j, START_AT + 90_000).running).toBe(BLACK)
  })
})

describe('fold — journal incohérent (R27)', () => {
  const cases: Record<string, readonly ClockEvent[]> = {
    'reprise sans pause': [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'resume', at: START_AT + 1_000 },
    ],
    'deux démarrages': [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'start', at: START_AT + 1_000, whiteHalf: BLACK },
    ],
    'tap avant le démarrage': [
      { type: 'tap', at: START_AT - 500, half: WHITE },
      { type: 'start', at: START_AT, whiteHalf: WHITE },
    ],
    'double pause': [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'pause', at: START_AT + 1_000 },
      { type: 'pause', at: START_AT + 2_000 },
    ],
    'horodatages non ordonnés': [
      { type: 'start', at: START_AT, whiteHalf: WHITE },
      { type: 'tap', at: START_AT + 5_000, half: WHITE },
      { type: 'tap', at: START_AT + 2_000, half: BLACK },
    ],
  }

  for (const [name, events] of Object.entries(cases)) {
    it(`${name} : rend une vue exploitable sans jeter`, () => {
      const v = fold(withEvents(tc(), events), START_AT + 100_000)
      expect(Number.isInteger(v.remaining.top)).toBe(true)
      expect(Number.isInteger(v.remaining.bottom)).toBe(true)
      expect(v.remaining.top).toBeGreaterThanOrEqual(0)
      expect(v.remaining.bottom).toBeGreaterThanOrEqual(0)
    })
  }

  it('un démarrage en double ne réinitialise pas la partie', () => {
    const v = fold(withEvents(tc(), cases['deux démarrages']!), START_AT + 10_000)
    expect(v.whiteHalf).toBe(WHITE)
    expect(v.remaining[WHITE]).toBe(170_000)
  })
})

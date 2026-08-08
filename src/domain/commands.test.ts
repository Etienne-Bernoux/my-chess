import { describe, expect, it } from 'vitest'
import { newJournal, pause, resume, start, tap, undo } from './commands'
import { fold } from './fold'
import type { Half, Journal, TimeControl } from './types'

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

/** R8 : les Noirs lancent en tapant la moitié adverse — ici celle du bas. */
const started = (control = tc()): Journal => start(newJournal(control), START_AT, WHITE)!

/** Joue une alternance de coups depuis un journal démarré. */
function play(journal: Journal, durations: readonly number[]): Journal {
  let current = journal
  let at = START_AT
  let half: Half = WHITE
  for (const d of durations) {
    at += d
    current = tap(current, at, half)!
    half = half === 'top' ? 'bottom' : 'top'
  }
  return current
}

describe('start (R8)', () => {
  it('la moitié tapée devient celle des Blancs et c’est elle qui part', () => {
    const bas = start(newJournal(tc()), START_AT, 'bottom')!
    expect(fold(bas, START_AT).whiteHalf).toBe('bottom')
    expect(fold(bas, START_AT).running).toBe('bottom')

    const haut = start(newJournal(tc()), START_AT, 'top')!
    expect(fold(haut, START_AT).whiteHalf).toBe('top')
    expect(fold(haut, START_AT).running).toBe('top')
  })

  it('un second démarrage est refusé et ne grossit pas le journal', () => {
    const j = started()
    expect(start(j, START_AT + 1_000, BLACK)).toBeNull()
    expect(j.events).toHaveLength(1)
  })

  it('les horodatages écrits au journal sont entiers (R23)', () => {
    const j = start(newJournal(tc()), 1000.7, WHITE)!
    expect(j.events[0]!.at).toBe(1000)
  })
})

describe('tap (R7, R9)', () => {
  it('le tap du joueur au trait rend la main et ajoute un seul événement', () => {
    const j = started()
    const after = tap(j, START_AT + 5_000, WHITE)!
    expect(after.events).toHaveLength(2)
    expect(fold(after, START_AT + 5_000).running).toBe(BLACK)
  })

  it('R9 : le tap de l’autre joueur est refusé et ne touche pas au journal', () => {
    const j = started()
    expect(tap(j, START_AT + 5_000, BLACK)).toBeNull()
    expect(j.events).toHaveLength(1)
  })

  it('un tap avant le démarrage est refusé', () => {
    expect(tap(newJournal(tc()), START_AT, WHITE)).toBeNull()
  })

  it('un tap après la chute du drapeau est refusé', () => {
    const j = started(tc({ initialMs: { white: 5_000, black: 180_000 } }))
    expect(tap(j, START_AT + 6_000, WHITE)).toBeNull()
  })

  it('un tap pendant la pause est refusé', () => {
    const paused = pause(started(), START_AT + 1_000)!
    expect(tap(paused, START_AT + 2_000, WHITE)).toBeNull()
  })
})

describe('pause et resume', () => {
  it('pause puis reprise sont acceptées dans cet ordre', () => {
    const p = pause(started(), START_AT + 1_000)!
    expect(fold(p, START_AT + 5_000).phase).toBe('paused')
    const r = resume(p, START_AT + 60_000)!
    expect(fold(r, START_AT + 60_000).phase).toBe('running')
  })

  it('une pause redondante et une reprise sans pause sont refusées', () => {
    const j = started()
    expect(resume(j, START_AT + 1_000)).toBeNull()
    const p = pause(j, START_AT + 1_000)!
    expect(pause(p, START_AT + 2_000)).toBeNull()
  })

  it('pause et reprise sont refusées avant le démarrage et après le drapeau', () => {
    expect(pause(newJournal(tc()), START_AT)).toBeNull()
    const flagged = started(tc({ initialMs: { white: 5_000, black: 180_000 } }))
    expect(pause(flagged, START_AT + 9_000)).toBeNull()
  })
})

describe('undo (R24)', () => {
  const GAME = [5_000, 3_000, 10_000, 1_000, 500, 20_000] as const
  const END = START_AT + GAME.reduce((a, b) => a + b, 0)

  it('undo puis rejeu au même instant restitue exactement la même vue', () => {
    const played = play(started(), GAME)
    const before = fold(played, END)

    const undone = undo(played)!
    const replayed = tap(undone, END, BLACK)!

    expect(fold(replayed, END)).toEqual(before)
    expect(replayed.events).toHaveLength(played.events.length)
  })

  it('undo restitue le temps exact d’avant le tap', () => {
    const played = play(started(), GAME)
    const undone = undo(played)!

    const v = fold(undone, END)
    // Les Noirs tournaient encore et n’ont pas encore touché leur incrément.
    expect(v.running).toBe(BLACK)
    expect(v.remaining[BLACK]).toBe(180_000 - (3_000 + 1_000 + 20_000) + 2 * 2_000)
    expect(v.remaining[WHITE]).toBe(180_000 - (5_000 + 10_000 + 500) + 3 * 2_000)
  })

  it('deux undo successifs remontent de deux taps', () => {
    const played = play(started(), GAME)
    const twice = undo(undo(played)!)!
    expect(twice.events).toHaveLength(played.events.length - 2)
    expect(fold(twice, END).running).toBe(WHITE)
  })

  it('undo est refusé si le dernier événement n’est pas un tap', () => {
    expect(undo(started())).toBeNull()
    expect(undo(pause(play(started(), GAME), END + 1_000)!)).toBeNull()
    expect(undo(newJournal(tc()))).toBeNull()
  })

  it('le tap qui a précédé la chute du drapeau reste annulable', () => {
    const control = tc({ initialMs: { white: 180_000, black: 4_000 } })
    const played = tap(started(control), START_AT + 1_000, WHITE)!
    // Les Noirs disposent de 4 000 ms : le drapeau tombe à START_AT + 5 000.
    expect(fold(played, START_AT + 5_000).flagged).toBe(BLACK)

    const undone = undo(played)!
    const v = fold(undone, START_AT + 5_000)
    expect(v.flagged).toBeNull()
    expect(v.running).toBe(WHITE)
  })
})

describe('append-only (R19)', () => {
  it('aucune commande ne mute le journal reçu', () => {
    const j = started()
    const snapshot = JSON.stringify(j)

    tap(j, START_AT + 1_000, WHITE)
    tap(j, START_AT + 1_000, BLACK)
    pause(j, START_AT + 1_000)
    resume(j, START_AT + 1_000)
    undo(j)
    start(j, START_AT + 1_000, BLACK)

    expect(JSON.stringify(j)).toBe(snapshot)
  })

  it('chaque commande acceptée n’ajoute qu’un événement, en fin de journal', () => {
    const j = started()
    const after = tap(j, START_AT + 1_000, WHITE)!
    expect(after.events.slice(0, -1)).toEqual(j.events)
    expect(after.timeControl).toBe(j.timeControl)
  })
})

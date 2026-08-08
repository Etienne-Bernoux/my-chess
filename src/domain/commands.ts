import { fold } from './fold'
import { JOURNAL_VERSION } from './types'
import type { ClockEvent, Half, Journal, TimeControl } from './types'

/**
 * Seule couche autorisée à faire grandir le journal. Chaque commande rend un
 * nouveau journal, ou `null` quand elle est sans effet.
 *
 * KTD3 : un tap sans effet (R9) n'est pas écrit. Un événement sans effet dans un
 * journal append-only est du bruit qui casserait l'undo de R24 — « retirer le
 * dernier événement » retirerait un non-événement.
 */

export const newJournal = (timeControl: TimeControl): Journal => ({
  version: JOURNAL_VERSION,
  timeControl,
  events: [],
})

/**
 * Invariant du journal : tout horodatage écrit est entier (R23). L'horloge en
 * fournit déjà, mais c'est ici que l'invariant est tenu — au seul point d'entrée.
 */
const append = (journal: Journal, event: ClockEvent): Journal => ({
  ...journal,
  events: [...journal.events, { ...event, at: Math.floor(event.at) }],
})

/**
 * R8 : les Noirs lancent la pendule en tapant la moitié située du côté de leur
 * adversaire, comme sur une pendule physique. La moitié tapée est donc celle des
 * Blancs, et l'orientation des deux camps se déduit de ce seul tap.
 */
export function start(journal: Journal, at: number, tappedHalf: Half): Journal | null {
  if (journal.events.length > 0) return null
  return append(journal, { type: 'start', at, whiteHalf: tappedHalf })
}

/** R7 et R9 : seul le joueur dont le temps s'écoule peut rendre la main. */
export function tap(journal: Journal, at: number, half: Half): Journal | null {
  if (fold(journal, at).running !== half) return null
  return append(journal, { type: 'tap', at, half })
}

export function pause(journal: Journal, at: number): Journal | null {
  if (fold(journal, at).phase !== 'running') return null
  return append(journal, { type: 'pause', at })
}

export function resume(journal: Journal, at: number): Journal | null {
  if (fold(journal, at).phase !== 'paused') return null
  return append(journal, { type: 'resume', at })
}

/**
 * R24 : la vraie réponse au tap accidentel. Retirer le dernier événement et
 * rejouer restitue le temps exact, parce que le fold est pur — il n'y a aucun
 * état sauvegardé à défaire.
 *
 * Reste possible après la chute du drapeau : on a pu taper trop tard, et rendre
 * l'état d'avant ce tap est le comportement attendu. La pendule ne sauve
 * personne pour autant — le drapeau retombe au rejeu.
 */
export function undo(journal: Journal): Journal | null {
  const last = journal.events[journal.events.length - 1]
  if (last?.type !== 'tap') return null
  return { ...journal, events: journal.events.slice(0, -1) }
}

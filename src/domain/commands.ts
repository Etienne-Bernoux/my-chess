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
 * Deux invariants du journal, tenus ici parce que c'est le seul point d'écriture.
 *
 * Horodatages entiers (R23) — l'horloge en fournit déjà ; ce plancher couvre un
 * appelant qui n'en viendrait pas. Les durées de la cadence, elles, sont
 * validées à leur propre frontière (`presets.ts`, `codec.ts`).
 *
 * Horodatages non décroissants — une horloge murale peut sauter en arrière, et
 * un journal dont les instants reculent n'est pas rejouable. On plafonne par le
 * bas plutôt que d'écrire un événement antérieur au précédent : le coup se voit
 * alors attribuer une durée nulle, ce qui est faux mais borné, là où un
 * horodatage en arrière fausserait tous les coups suivants.
 */
const append = (journal: Journal, event: ClockEvent): Journal => {
  const previous = journal.events[journal.events.length - 1]
  const at = Math.max(Math.floor(event.at), previous?.at ?? Number.NEGATIVE_INFINITY)
  return { ...journal, events: [...journal.events, { ...event, at }] }
}

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
 * Refusé une fois le drapeau tombé, et ce n'est pas une précaution : retirer le
 * tap qui précède une chute rend la main au cédant DEPUIS son propre tap, donc
 * lui fait payer la réflexion de son adversaire — le drapeau retombe alors sur
 * l'autre joueur. Un seul geste, irréversible, qui change le perdant. Après la
 * chute, la pendule ne réécrit plus rien.
 */
export function undo(journal: Journal, at: number): Journal | null {
  const last = journal.events[journal.events.length - 1]
  if (last?.type !== 'tap') return null
  if (fold(journal, at).flagged !== null) return null
  return { ...journal, events: journal.events.slice(0, -1) }
}

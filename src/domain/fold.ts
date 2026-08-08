import { otherHalf } from './types'
import type { ClockEvent, Half, IncrementMode, Journal, Phase, View } from './types'

/**
 * R3 : la formule de gain, unique pour les deux modes. Un incrément nul rend 0
 * dans les deux branches — la mort subite (R2) en découle sans code dédié, et
 * aucun mode n'est greffé sur l'autre.
 */
export const gainFor = (mode: IncrementMode, incrementMs: number, elapsedMs: number): number =>
  mode === 'bronstein' ? Math.min(incrementMs, elapsedMs) : incrementMs

type State = {
  started: boolean
  whiteHalf: Half
  remaining: Record<Half, number>
  running: Half | null
  pausedFrom: Half | null
  flagged: Half | null
  elapsedThisMove: number
  lastTapAt: number | null
  lastTapHalf: Half | null
  cursor: number
}

const DEFAULT_WHITE_HALF: Half = 'bottom'

function initial(journal: Journal): State {
  const { initialMs } = journal.timeControl
  const first = journal.events[0]
  return {
    started: false,
    whiteHalf: DEFAULT_WHITE_HALF,
    remaining: assignInitial(DEFAULT_WHITE_HALF, initialMs.white, initialMs.black),
    running: null,
    pausedFrom: null,
    flagged: null,
    elapsedThisMove: 0,
    lastTapAt: null,
    lastTapHalf: null,
    cursor: first?.at ?? 0,
  }
}

const assignInitial = (whiteHalf: Half, white: number, black: number): Record<Half, number> =>
  whiteHalf === 'top' ? { top: white, bottom: black } : { top: black, bottom: white }

/**
 * KTD4 : le seul endroit où le temps restant diminue, et le seul endroit où le
 * drapeau tombe. La consommation est plafonnée au temps disponible, ce qui rend
 * le rejeu après vingt minutes d'arrière-plan identique au direct (R21) : le
 * drapeau tombe à l'échéance, pas à la première frame après le retour.
 */
function advance(state: State, to: number): void {
  // KTD2 : une horloge murale peut sauter en arrière (NTP). On fige, on ne rend jamais de temps.
  const dt = Math.max(0, to - state.cursor)
  const running = state.running

  if (running !== null && dt > 0) {
    const consumed = Math.min(dt, state.remaining[running])
    state.remaining[running] -= consumed
    // KTD5 : le temps du coup en cours s'accumule ici, donc il n'avance jamais
    // pendant une pause — c'est ce qui protège le gain Bronstein.
    state.elapsedThisMove += consumed

    if (state.remaining[running] === 0) {
      state.flagged = running
      state.running = null
      state.pausedFrom = null
    }
  }

  state.cursor = to
}

/**
 * Les événements inapplicables sont ignorés plutôt que rejetés : la couche
 * commande les empêche déjà d'être écrits (KTD3), mais une sauvegarde altérée
 * ou issue d'une version antérieure peut en contenir (R27).
 */
function apply(state: State, event: ClockEvent, journal: Journal): void {
  switch (event.type) {
    case 'start': {
      if (state.started) return
      const { initialMs } = journal.timeControl
      state.started = true
      state.whiteHalf = event.whiteHalf
      state.remaining = assignInitial(event.whiteHalf, initialMs.white, initialMs.black)
      state.running = event.whiteHalf
      state.elapsedThisMove = 0
      return
    }
    case 'tap': {
      // R9 : seul le joueur dont le temps s'écoule peut rendre la main.
      if (!state.started || state.running !== event.half) return
      const { mode, incrementMs } = journal.timeControl
      state.remaining[event.half] += gainFor(mode, incrementMs, state.elapsedThisMove)
      state.elapsedThisMove = 0
      state.lastTapAt = event.at
      state.lastTapHalf = event.half
      state.running = otherHalf(event.half)
      return
    }
    case 'pause': {
      if (!state.started || state.running === null) return
      state.pausedFrom = state.running
      state.running = null
      return
    }
    case 'resume': {
      if (!state.started || state.pausedFrom === null) return
      state.running = state.pausedFrom
      state.pausedFrom = null
      return
    }
  }
}

function phaseOf(state: State): Phase {
  if (state.flagged !== null) return 'flagged'
  if (!state.started) return 'idle'
  return state.running === null ? 'paused' : 'running'
}

/**
 * R20 : tout ce qui s'affiche est dérivé du journal par cette fonction, et rien
 * d'autre n'est écrit en parallèle. Pure : mêmes entrées, même sortie, aucun
 * accès à l'horloge ni au stockage.
 */
export function fold(journal: Journal, now: number): View {
  const state = initial(journal)

  for (const event of journal.events) {
    advance(state, event.at)
    // R17 : la chute arrête tout ; les événements postérieurs ne s'appliquent plus.
    if (state.flagged !== null) break
    apply(state, event, journal)
  }

  if (state.flagged === null) advance(state, now)

  return {
    phase: phaseOf(state),
    remaining: { top: state.remaining.top, bottom: state.remaining.bottom },
    running: state.running,
    flagged: state.flagged,
    whiteHalf: state.started ? state.whiteHalf : null,
    lastTapAt: state.lastTapAt,
    lastTapHalf: state.lastTapHalf,
    elapsedThisMove: state.elapsedThisMove,
    mode: journal.timeControl.mode,
    incrementMs: journal.timeControl.incrementMs,
  }
}

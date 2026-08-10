import { ALERT_LEVELS, otherHalf } from './types'
import type { AlertLevelId, ClockEvent, Half, IncrementMode, Journal, Phase, View } from './types'

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
  /** Temps initial de chaque moitié : c'est lui qui arme ou désarme un palier. */
  initialFor: Record<Half, number>
  /** Le plus bas jamais atteint par chaque moitié — la mémoire du latch (R34). */
  lowest: Record<Half, number>
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
  const times = assignInitial(DEFAULT_WHITE_HALF, initialMs.white, initialMs.black)
  return {
    started: false,
    whiteHalf: DEFAULT_WHITE_HALF,
    remaining: { ...times },
    initialFor: { ...times },
    lowest: { ...times },
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
  // KTD2 : une horloge murale peut sauter en arrière (NTP, réglage manuel). On
  // fige, on ne rend jamais de temps.
  const dt = Math.max(0, to - state.cursor)
  const running = state.running

  if (running !== null && dt > 0) {
    const consumed = Math.min(dt, state.remaining[running])
    state.remaining[running] -= consumed
    // Le seul endroit où le temps baisse est donc le seul où un palier peut se
    // franchir : la mémoire du latch se tient ici, et nulle part ailleurs.
    state.lowest[running] = Math.min(state.lowest[running], state.remaining[running])
    // KTD5 : le temps du coup en cours s'accumule ici, donc il n'avance jamais
    // pendant une pause — c'est ce qui protège le gain Bronstein.
    state.elapsedThisMove += consumed

    if (state.remaining[running] === 0) {
      state.flagged = running
      state.running = null
      state.pausedFrom = null
    }
  }

  // Le curseur est une ligne de plus haute eau, jamais une simple affectation :
  // le poser en arrière ferait mesurer l'intervalle SUIVANT depuis une position
  // fausse, et surfacturerait le joueur au trait bien après le saut d'horloge.
  state.cursor = Math.max(state.cursor, to)
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
      const times = assignInitial(event.whiteHalf, initialMs.white, initialMs.black)
      state.started = true
      state.whiteHalf = event.whiteHalf
      state.remaining = { ...times }
      // R8 : l'orientation n'est connue qu'ici. Les deux temps initiaux changent
      // donc de moitié au premier tap, et avec eux ce qui arme chaque palier.
      state.initialFor = { ...times }
      state.lowest = { ...times }
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

/**
 * R34 : le palier atteint est le plus urgent dont le seuil a été franchi, lu sur
 * le temps le plus bas jamais atteint. Un palier ne se relâche donc jamais —
 * remonter au-dessus du seuil par l'incrément Fischer ne remet pas le cadran au
 * calme, ce qui serait mentir sur la nature de la fin de partie qui s'annonce.
 *
 * Un palier au moins aussi haut que le temps initial de ce joueur ne s'arme
 * jamais : Bullet 1+0 part à exactement soixante secondes, et le rappel « une
 * minute » se déclencherait au premier tic. Le test est par moitié parce que R32
 * autorise deux temps initiaux distincts.
 */
function alertReached(lowestMs: number, initialMs: number): AlertLevelId | null {
  let reached: AlertLevelId | null = null
  for (const level of ALERT_LEVELS) {
    if (level.belowMs < initialMs && lowestMs < level.belowMs) reached = level.id
  }
  return reached
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
 *
 * `now` est l'instant courant, attendu au niveau ou après le dernier événement —
 * ce que la couche commande garantit, puisqu'elle n'écrit qu'au présent. Ce
 * n'est pas une machine à remonter le temps : tous les événements du journal
 * sont appliqués, puis le temps est avancé jusqu'à `now`. Pour observer un état
 * intermédiaire, on tronque le journal, on ne recule pas `now`.
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
    alert: {
      top: alertReached(state.lowest.top, state.initialFor.top),
      bottom: alertReached(state.lowest.bottom, state.initialFor.bottom),
    },
    mode: journal.timeControl.mode,
    incrementMs: journal.timeControl.incrementMs,
  }
}

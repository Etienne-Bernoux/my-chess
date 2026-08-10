import type { IncrementMode, TimeControl } from '../domain/types'

/**
 * Identifiant réservé à la cadence saisie à la main. Il ne vit jamais dans
 * `time-controls.json`, et il ne doit jamais traverser `presetById` : le repli
 * de R30 y convertirait silencieusement la cadence saisie en premier preset.
 */
export const CUSTOM_ID = 'custom'

export const MIN_MINUTES = 1
export const MAX_MINUTES = 180
export const MAX_INCREMENT_SECONDS = 180

const MS_PER_MINUTE = 60_000
const MS_PER_SECOND = 1_000

const MODES: readonly IncrementMode[] = ['fischer', 'bronstein']

export const isIncrementMode = (value: unknown): value is IncrementMode =>
  MODES.includes(value as IncrementMode)

/**
 * La saisie brute de l'écran d'accueil, avant toute validation. Les minutes par
 * couleur existent même quand le handicap est décoché : les décocher ne doit pas
 * effacer ce qu'on venait de régler, au cas où l'on se ravise.
 */
export type CustomDraft = {
  readonly minutes: number
  readonly whiteMinutes: number
  readonly blackMinutes: number
  readonly incrementSeconds: number
  readonly mode: IncrementMode
  /** R4 exposé : deux temps initiaux distincts au lieu d'un seul. */
  readonly handicap: boolean
}

export const DEFAULT_DRAFT: CustomDraft = {
  minutes: 5,
  whiteMinutes: 5,
  blackMinutes: 5,
  incrementSeconds: 3,
  mode: 'fischer',
  handicap: false,
}

export type CustomResult =
  | { readonly ok: true; readonly timeControl: TimeControl }
  | { readonly ok: false; readonly reason: string }

/**
 * Même posture que `parseTimeControl` sur le fichier de presets : une saisie
 * invalide est refusée avec sa raison, jamais réparée en silence. Une cadence
 * corrigée dans le dos partirait sur la mauvaise partie de club.
 */
function minutesError(label: string, value: number): string | null {
  if (!Number.isInteger(value)) return `${label} : un nombre entier de minutes est attendu.`
  if (value < MIN_MINUTES || value > MAX_MINUTES) {
    return `${label} : entre ${MIN_MINUTES} et ${MAX_MINUTES} minutes.`
  }
  return null
}

function incrementError(value: number): string | null {
  if (!Number.isInteger(value)) return 'Incrément : un nombre entier de secondes est attendu.'
  if (value < 0 || value > MAX_INCREMENT_SECONDS) {
    return `Incrément : entre 0 et ${MAX_INCREMENT_SECONDS} secondes.`
  }
  return null
}

/**
 * Le label suit la forme des presets — `5+3`, suffixé du mode quand il n'est pas
 * Fischer. Le handicap ne se nomme que lorsqu'il change réellement quelque chose :
 * un handicap coché mais réglé à égalité produit le même libellé qu'une cadence
 * symétrique, parce que c'en est une.
 */
function describe(minutes: number, other: number, incrementSeconds: number, mode: IncrementMode): string {
  const asymmetry = other === minutes ? '' : ` · Noirs ${other}`
  const suffix = mode === 'bronstein' ? ' Bronstein' : ''
  return `${minutes}+${incrementSeconds}${asymmetry}${suffix}`
}

export function buildCustom(draft: CustomDraft): CustomResult {
  if (!isIncrementMode(draft.mode)) return { ok: false, reason: 'Mode de cadence inconnu.' }

  const whiteMinutes = draft.handicap ? draft.whiteMinutes : draft.minutes
  const blackMinutes = draft.handicap ? draft.blackMinutes : draft.minutes

  const reason = draft.handicap
    ? (minutesError('Blancs', whiteMinutes) ?? minutesError('Noirs', blackMinutes))
    : minutesError('Temps', whiteMinutes)
  const invalid = reason ?? incrementError(draft.incrementSeconds)
  if (invalid !== null) return { ok: false, reason: invalid }

  return {
    ok: true,
    timeControl: {
      id: CUSTOM_ID,
      label: describe(whiteMinutes, blackMinutes, draft.incrementSeconds, draft.mode),
      mode: draft.mode,
      // R23 : des entiers de millisecondes, obtenus par multiplication d'entiers.
      initialMs: { white: whiteMinutes * MS_PER_MINUTE, black: blackMinutes * MS_PER_MINUTE },
      incrementMs: draft.incrementSeconds * MS_PER_SECOND,
    },
  }
}

/**
 * Réamorce la saisie depuis une cadence déjà en vigueur — celle qu'on vient de
 * jouer ou celle mémorisée au lancement précédent. Une cadence dont les temps ne
 * tombent pas sur des minutes entières (elle ne peut venir que du fichier de
 * presets) est arrondie à la minute inférieure sans descendre sous le minimum :
 * le brouillon n'est qu'un point de départ modifiable, jamais ce qui s'applique.
 */
export function draftFromTimeControl(timeControl: TimeControl): CustomDraft {
  const toMinutes = (ms: number): number =>
    Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.floor(ms / MS_PER_MINUTE)))

  const white = toMinutes(timeControl.initialMs.white)
  const black = toMinutes(timeControl.initialMs.black)

  return {
    minutes: white,
    whiteMinutes: white,
    blackMinutes: black,
    incrementSeconds: Math.min(
      MAX_INCREMENT_SECONDS,
      Math.max(0, Math.floor(timeControl.incrementMs / MS_PER_SECOND)),
    ),
    mode: timeControl.mode,
    handicap: white !== black,
  }
}

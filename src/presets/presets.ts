import raw from './time-controls.json'
import type { IncrementMode, TimeControl } from '../domain/types'

const MODES: readonly IncrementMode[] = ['fischer', 'bronstein']

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/**
 * R29 : les cadences sont une donnée source versionnée, éditée à la main dans
 * l'IDE — pas une saisie utilisateur. Un fichier invalide est donc une erreur de
 * développement : on échoue bruyamment plutôt que de réparer en silence.
 */
export function parseTimeControl(value: unknown): TimeControl {
  if (typeof value !== 'object' || value === null) {
    throw new Error('cadence: objet attendu')
  }
  const c = value as Record<string, unknown>

  if (typeof c['id'] !== 'string' || c['id'].length === 0) {
    throw new Error('cadence: `id` doit être une chaîne non vide')
  }
  if (typeof c['label'] !== 'string' || c['label'].length === 0) {
    throw new Error(`cadence ${c['id']}: \`label\` doit être une chaîne non vide`)
  }
  if (!MODES.includes(c['mode'] as IncrementMode)) {
    throw new Error(`cadence ${c['id']}: \`mode\` doit valoir ${MODES.join(' ou ')}`)
  }
  if (!isNonNegativeInt(c['incrementMs'])) {
    throw new Error(`cadence ${c['id']}: \`incrementMs\` doit être un entier >= 0`)
  }

  const initial = c['initialMs']
  if (typeof initial !== 'object' || initial === null) {
    throw new Error(`cadence ${c['id']}: \`initialMs\` doit porter white et black`)
  }
  const { white, black } = initial as Record<string, unknown>
  if (!isPositiveInt(white) || !isPositiveInt(black)) {
    throw new Error(`cadence ${c['id']}: \`initialMs.white/black\` doivent être des entiers > 0`)
  }

  return {
    id: c['id'],
    label: c['label'],
    mode: c['mode'] as IncrementMode,
    initialMs: { white, black },
    incrementMs: c['incrementMs'],
  }
}

function loadPresets(): readonly TimeControl[] {
  const source = raw as { version?: unknown; presets?: unknown }
  if (source.version !== 1) {
    throw new Error(`time-controls.json: version ${String(source.version)} non supportée`)
  }
  if (!Array.isArray(source.presets) || source.presets.length === 0) {
    throw new Error('time-controls.json: `presets` doit être un tableau non vide')
  }

  const parsed = source.presets.map(parseTimeControl)
  const ids = new Set(parsed.map((p) => p.id))
  if (ids.size !== parsed.length) {
    throw new Error('time-controls.json: identifiants de cadence dupliqués')
  }
  return parsed
}

export const PRESETS: readonly TimeControl[] = loadPresets()

export const DEFAULT_PRESET: TimeControl = PRESETS[0]!

/** R30 : un identifiant inconnu retombe sur le premier preset plutôt que d'échouer. */
export const presetById = (id: string | null | undefined): TimeControl =>
  PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET

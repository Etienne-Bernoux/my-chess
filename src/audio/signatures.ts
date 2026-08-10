import raw from './sounds.json'
import { ALERT_LEVELS } from '../domain/types'
import type { AlertLevelId } from '../domain/types'

/** R13 : un signal par palier de rappel (R33), plus la chute du drapeau. */
export type Cue = AlertLevelId | 'flag'

export const CUES: readonly Cue[] = [...ALERT_LEVELS.map((level) => level.id), 'flag']

export type ToneSpec = {
  /** Décalage du début de ce ton dans la signature, en secondes. */
  readonly at: number
  readonly durationS: number
  readonly fromHz: number
  readonly toHz: number
  readonly type: OscillatorType
  readonly peak: number
}

const OSCILLATOR_TYPES: readonly OscillatorType[] = ['sine', 'square', 'sawtooth', 'triangle']

const isFiniteAtLeast = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min

/**
 * Les rampes exponentielles de la Web Audio refusent zéro : une fréquence ou un
 * pic nul lèverait à la première lecture, en pleine partie, là où personne ne
 * peut rien y faire. On le refuse au chargement, pas à la lecture.
 */
const isPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

function parseTone(cue: string, index: number, value: unknown): ToneSpec {
  const where = `sounds.json ${cue}[${index}]`
  if (typeof value !== 'object' || value === null) throw new Error(`${where} : objet attendu`)
  const t = value as Record<string, unknown>

  if (!isFiniteAtLeast(t['at'], 0)) throw new Error(`${where} : \`at\` doit être un nombre >= 0`)
  if (!isPositive(t['durationS'])) throw new Error(`${where} : \`durationS\` doit être > 0`)
  if (!isPositive(t['fromHz']) || !isPositive(t['toHz'])) {
    throw new Error(`${where} : \`fromHz\` et \`toHz\` doivent être > 0`)
  }
  if (!OSCILLATOR_TYPES.includes(t['type'] as OscillatorType)) {
    throw new Error(`${where} : \`type\` doit valoir ${OSCILLATOR_TYPES.join(', ')}`)
  }
  if (!isPositive(t['peak']) || t['peak'] > 1) {
    throw new Error(`${where} : \`peak\` doit être dans ]0, 1]`)
  }

  return {
    at: t['at'],
    durationS: t['durationS'],
    fromHz: t['fromHz'],
    toHz: t['toHz'],
    type: t['type'] as OscillatorType,
    peak: t['peak'],
  }
}

/**
 * Même doctrine que les cadences (R29) : le fichier est une donnée source
 * versionnée, éditée à la main dans l'IDE, jamais une saisie utilisateur. Un
 * fichier invalide est donc une erreur de développement — on échoue bruyamment.
 *
 * Une clé inconnue est refusée plutôt qu'ignorée : une signature dont le nom est
 * mal orthographié se réglerait en silence sur rien, et le palier resterait muet
 * sans que rien ne le dise.
 */
export function parseSignatures(value: unknown): Readonly<Record<Cue, readonly ToneSpec[]>> {
  if (typeof value !== 'object' || value === null) throw new Error('sounds.json : objet attendu')
  const source = value as { version?: unknown; signatures?: unknown }
  if (source.version !== 1) {
    throw new Error(`sounds.json : version ${String(source.version)} non supportée`)
  }
  if (typeof source.signatures !== 'object' || source.signatures === null) {
    throw new Error('sounds.json : `signatures` doit être un objet')
  }
  const signatures = source.signatures as Record<string, unknown>

  for (const key of Object.keys(signatures)) {
    if (!CUES.includes(key as Cue)) {
      throw new Error(`sounds.json : signature inconnue \`${key}\` (attendu : ${CUES.join(', ')})`)
    }
  }

  const parsed = {} as Record<Cue, readonly ToneSpec[]>
  for (const cue of CUES) {
    const tones = signatures[cue]
    if (!Array.isArray(tones) || tones.length === 0) {
      throw new Error(`sounds.json : \`${cue}\` doit être un tableau de tons non vide`)
    }
    parsed[cue] = tones.map((tone, index) => parseTone(cue, index, tone))
  }
  return parsed
}

export const SIGNATURES: Readonly<Record<Cue, readonly ToneSpec[]>> = parseSignatures(raw)

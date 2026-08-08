import { parseTimeControl } from '../presets/presets'
import { JOURNAL_VERSION } from '../domain/types'
import type { ClockEvent, Half, Journal } from '../domain/types'

/**
 * R27 : la lecture d'une sauvegarde est pure et séparée de l'accès au stockage.
 * Elle accepte de l'`unknown` et non une chaîne, parce que le stockage n'est pas
 * la seule source — un journal exporté collé dans un test entre par la même
 * porte (R28).
 */
export type ParseResult = { readonly ok: true; readonly journal: Journal } | { readonly ok: false; readonly reason: string }

const fail = (reason: string): ParseResult => ({ ok: false, reason })

const HALVES: readonly Half[] = ['top', 'bottom']

const isHalf = (value: unknown): value is Half => HALVES.includes(value as Half)

const isIntegerTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value)

/**
 * Un type d'événement inconnu fait échouer tout le journal plutôt que d'être
 * écarté en silence. Sur une pendule, ignorer un événement change les temps sans
 * le dire — refuser la reprise est le comportement honnête.
 */
function parseEvent(value: unknown, index: number): ClockEvent {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`événement ${index} : objet attendu`)
  }
  const e = value as Record<string, unknown>
  if (!isIntegerTimestamp(e['at'])) {
    throw new Error(`événement ${index} : \`at\` doit être un entier`)
  }
  const at = e['at']

  switch (e['type']) {
    case 'start':
      if (!isHalf(e['whiteHalf'])) {
        throw new Error(`événement ${index} : \`whiteHalf\` invalide`)
      }
      return { type: 'start', at, whiteHalf: e['whiteHalf'] }
    case 'tap':
      if (!isHalf(e['half'])) {
        throw new Error(`événement ${index} : \`half\` invalide`)
      }
      return { type: 'tap', at, half: e['half'] }
    case 'pause':
      return { type: 'pause', at }
    case 'resume':
      return { type: 'resume', at }
    default:
      throw new Error(`événement ${index} : type inconnu \`${String(e['type'])}\``)
  }
}

export const serialize = (journal: Journal): string => JSON.stringify(journal)

export function parseJournal(raw: unknown): ParseResult {
  if (raw === null || raw === undefined) return fail('sauvegarde absente')

  let source: unknown = raw
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) return fail('sauvegarde vide')
    try {
      source = JSON.parse(raw)
    } catch {
      // Couvre notamment le cas d'une écriture interrompue : JSON tronqué.
      return fail('sauvegarde illisible : JSON invalide ou tronqué')
    }
  }

  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return fail('sauvegarde illisible : objet attendu')
  }
  const j = source as Record<string, unknown>

  if (j['version'] !== JOURNAL_VERSION) {
    return fail(`version de schéma non supportée : ${String(j['version'])}`)
  }
  if (!Array.isArray(j['events'])) {
    return fail('sauvegarde illisible : `events` doit être un tableau')
  }

  try {
    const timeControl = parseTimeControl(j['timeControl'])
    const events = j['events'].map(parseEvent)
    return { ok: true, journal: { version: JOURNAL_VERSION, timeControl, events } }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'sauvegarde illisible')
  }
}

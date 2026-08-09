import { fold } from '../domain/fold'
import { parseJournal, serialize } from './codec'
import { parseTimeControl, presetById } from '../presets/presets'
import type { ParseResult } from './codec'
import type { Journal, TimeControl } from '../domain/types'

/**
 * Adaptateur mince et injectable : c'est le seul endroit du projet qui touche au
 * stockage du navigateur (R27). Les tests n'ont donc jamais besoin de jsdom.
 */
export interface KeyValueStore {
  read(key: string): string | null
  write(key: string, value: string): void
  remove(key: string): void
}

const JOURNAL_KEY = 'mychess.journal'
const LAST_TIME_CONTROL_KEY = 'mychess.lastTimeControl'
/** Schéma précédent : seule la référence à un preset était mémorisée. */
const LEGACY_LAST_PRESET_KEY = 'mychess.lastPreset'
const SILENT_KEY = 'mychess.silent'

export function memoryStore(seed: Readonly<Record<string, string>> = {}): KeyValueStore {
  const data = new Map(Object.entries(seed))
  return {
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
    remove: (key) => void data.delete(key),
  }
}

/** Dégrade en mémoire quand le stockage est indisponible (mode privé, quota). */
export function browserStore(): KeyValueStore {
  try {
    const probe = '__mychess_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
  } catch {
    return memoryStore()
  }
  return {
    read: (key) => localStorage.getItem(key),
    write: (key, value) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Un quota dépassé ne doit jamais interrompre une partie en cours.
      }
    },
    remove: (key) => localStorage.removeItem(key),
  }
}

/** R25 : appelé après chaque événement appendé, pas seulement en fin de partie. */
export const saveJournal = (store: KeyValueStore, journal: Journal): void =>
  store.write(JOURNAL_KEY, serialize(journal))

export const loadJournal = (store: KeyValueStore): ParseResult =>
  parseJournal(store.read(JOURNAL_KEY))

export const clearJournal = (store: KeyValueStore): void => store.remove(JOURNAL_KEY)

/**
 * R26 et KTD6 : « close » est dérivé, jamais marqué. Une partie non commencée
 * n'a rien à reprendre ; une partie dont le drapeau est tombé est terminée.
 */
export const isResumable = (journal: Journal, now: number): boolean => {
  const view = fold(journal, now)
  return view.phase !== 'idle' && view.phase !== 'flagged'
}

/**
 * R30 : la dernière cadence utilisée, proposée par défaut au lancement suivant.
 * C'est la cadence entière qui est mémorisée, et non plus une référence à un
 * preset : une cadence saisie à la main n'existe dans aucune liste, et devoir la
 * ressaisir à chaque partie viderait R30 de son sens le soir où l'on joue à
 * handicap.
 */
export function saveLastTimeControl(store: KeyValueStore, timeControl: TimeControl): void {
  store.write(LAST_TIME_CONTROL_KEY, JSON.stringify(timeControl))
  // La clé de l'ancien schéma ne sert qu'à la migration : la laisser derrière
  // ferait ressurgir un preset périmé si la nouvelle devenait illisible.
  store.remove(LEGACY_LAST_PRESET_KEY)
}

function readTimeControl(raw: string | null): TimeControl | null {
  if (raw === null) return null
  try {
    return parseTimeControl(JSON.parse(raw))
  } catch {
    // Une préférence illisible n'est qu'une préférence perdue : l'appelant
    // retombe sur le premier preset. Rien d'irremplaçable ne vit ici (H1).
    return null
  }
}

export function loadLastTimeControl(store: KeyValueStore): TimeControl | null {
  const stored = readTimeControl(store.read(LAST_TIME_CONTROL_KEY))
  if (stored !== null) return stored

  // Repli sur le schéma précédent : ignorer cette clé rejetterait sur le premier
  // preset le téléphone qui a déjà servi, ce qui est exactement ce que R30 évite.
  const legacyId = store.read(LEGACY_LAST_PRESET_KEY)
  return legacyId === null ? null : presetById(legacyId)
}

/** R15 : le mode silencieux survit à la fermeture de l'application. */
export const saveSilent = (store: KeyValueStore, silent: boolean): void =>
  store.write(SILENT_KEY, silent ? '1' : '0')

export const loadSilent = (store: KeyValueStore): boolean => store.read(SILENT_KEY) === '1'

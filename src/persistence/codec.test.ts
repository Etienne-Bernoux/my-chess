// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseJournal, serialize } from './codec'
import { newJournal, pause, start, tap } from '../domain/commands'
import { fold } from '../domain/fold'
import {
  browserStore,
  clearJournal,
  isResumable,
  loadJournal,
  loadLastPresetId,
  loadSilent,
  memoryStore,
  saveJournal,
  saveLastPresetId,
  saveSilent,
} from './store'
import type { Half, Journal, TimeControl } from '../domain/types'

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

afterEach(() => {
  vi.unstubAllGlobals()
})

const midGame = (control = tc()): Journal => {
  const s = start(newJournal(control), START_AT, WHITE)!
  const a = tap(s, START_AT + 5_000, WHITE)!
  return tap(a, START_AT + 8_000, BLACK)!
}

describe('codec — aller-retour', () => {
  it('parse(serialize(j)) rend un journal profondément égal', () => {
    const j = midGame()
    const result = parseJournal(serialize(j))
    expect(result.ok).toBe(true)
    expect(result.ok && result.journal).toEqual(j)
  })

  it('accepte aussi bien une chaîne qu’un objet déjà désérialisé', () => {
    const j = midGame()
    const fromObject = parseJournal(JSON.parse(serialize(j)))
    expect(fromObject.ok && fromObject.journal).toEqual(j)
  })
})

describe('codec — hydratation défensive (R27)', () => {
  const rejected: Record<string, unknown> = {
    'sauvegarde absente': null,
    'sauvegarde indéfinie': undefined,
    'chaîne vide': '   ',
    'chaîne arbitraire': 'ceci n’est pas du JSON',
    'tableau au lieu d’un objet': '[1, 2, 3]',
    'version antérieure': JSON.stringify({ ...midGame(), version: 0 }),
    'events absent': JSON.stringify({ version: 1, timeControl: tc() }),
    'cadence absente': JSON.stringify({ version: 1, timeControl: null, events: [] }),
  }

  for (const [name, raw] of Object.entries(rejected)) {
    it(`${name} : rejeté sans jeter`, () => {
      const result = parseJournal(raw)
      expect(result.ok).toBe(false)
      expect(result.ok === false && result.reason.length).toBeGreaterThan(0)
    })
  }

  it('la version non supportée est nommée dans la raison', () => {
    const result = parseJournal(JSON.stringify({ ...midGame(), version: 0 }))
    expect(result.ok === false && result.reason).toMatch(/0/)
  })

  it('JSON tronqué en plein tableau d’événements : rejeté', () => {
    const raw = serialize(midGame())
    expect(parseJournal(raw.slice(0, Math.floor(raw.length * 0.7))).ok).toBe(false)
  })

  it('journal valide mais amputé de ses derniers événements : accepté et cohérent', () => {
    const full = midGame()
    const amputated: Journal = { ...full, events: full.events.slice(0, 2) }
    const result = parseJournal(serialize(amputated))

    expect(result.ok).toBe(true)
    expect(result.ok && fold(result.journal, START_AT + 8_000).running).toBe(BLACK)
  })

  it('type d’événement inconnu : rejeté plutôt qu’écarté en silence', () => {
    const j = midGame()
    const withByoyomi = { ...j, events: [...j.events, { type: 'byoyomi', at: 99_000 }] }
    const result = parseJournal(JSON.stringify(withByoyomi))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/byoyomi/)
  })

  it('horodatage fractionnaire ou absent : rejeté (R23)', () => {
    const j = midGame()
    const broken = { ...j, events: [{ type: 'start', at: 1000.5, whiteHalf: 'bottom' }] }
    expect(parseJournal(JSON.stringify(broken)).ok).toBe(false)
  })

  it('moitié invalide dans un tap : rejeté', () => {
    const broken = {
      version: 1,
      timeControl: tc(),
      events: [{ type: 'tap', at: 1000, half: 'left' }],
    }
    expect(parseJournal(JSON.stringify(broken)).ok).toBe(false)
  })

  it('cadence corrompue : rejeté', () => {
    for (const initialMs of [{ white: -1, black: 1000 }, { white: 1000.5, black: 1000 }, null]) {
      const broken = { version: 1, timeControl: { ...tc(), initialMs }, events: [] }
      expect(parseJournal(JSON.stringify(broken)).ok).toBe(false)
    }
  })
})

describe('store — reprise (R25, R26)', () => {
  it('reprise après fermeture : le temps de l’absence a bien été consommé', () => {
    const store = memoryStore()
    const j = midGame()
    saveJournal(store, j)

    const reloaded = loadJournal(store)
    expect(reloaded.ok).toBe(true)
    if (!reloaded.ok) return

    const auRetour = fold(reloaded.journal, START_AT + 8_000 + 45 * 60_000)
    // Les Blancs tournaient : 180 000 − 5 000 + 2 000 = 177 000, épuisés en 45 min.
    expect(auRetour.flagged).toBe(WHITE)
    expect(auRetour.remaining[BLACK]).toBe(180_000 - 3_000 + 2_000)
  })

  it('une partie en cours est reprenable, une partie non commencée ne l’est pas', () => {
    expect(isResumable(midGame(), START_AT + 9_000)).toBe(true)
    expect(isResumable(newJournal(tc()), START_AT)).toBe(false)
  })

  it('une partie en pause reste reprenable', () => {
    const paused = pause(midGame(), START_AT + 9_000)!
    expect(isResumable(paused, START_AT + 600_000)).toBe(true)
  })

  it('KTD6 : une partie dont le drapeau est tombé n’est pas proposée', () => {
    const j = start(newJournal(tc({ initialMs: { white: 5_000, black: 180_000 } })), START_AT, WHITE)!
    expect(isResumable(j, START_AT + 6_000)).toBe(false)
  })

  it('une sauvegarde effacée n’est plus lisible', () => {
    const store = memoryStore()
    saveJournal(store, midGame())
    clearJournal(store)
    expect(loadJournal(store).ok).toBe(false)
  })
})

describe('browserStore — dégradation', () => {
  it('sans localStorage utilisable, dégrade en mémoire au lieu de jeter', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('mode privé')
      },
      getItem: () => null,
      removeItem: () => {},
    })

    const store = browserStore()
    expect(() => store.write('k', 'v')).not.toThrow()
    expect(store.read('k')).toBe('v')
  })

  it('un quota dépassé n’interrompt jamais une partie en cours', () => {
    const data = new Map<string, string>()
    let probed = false
    vi.stubGlobal('localStorage', {
      setItem: (key: string) => {
        // La sonde d'ouverture passe ; les écritures réelles échouent ensuite.
        if (!probed) {
          probed = true
          return
        }
        if (key === '__mychess_probe__') return
        throw new Error('QuotaExceededError')
      },
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => void data.delete(key),
    })

    const store = browserStore()
    expect(() => saveJournal(store, midGame())).not.toThrow()
  })

  it('sans objet localStorage du tout, browserStore reste utilisable', () => {
    vi.stubGlobal('localStorage', undefined)
    const store = browserStore()
    expect(() => store.write('k', 'v')).not.toThrow()
    expect(store.read('k')).toBe('v')
  })
})

describe('store — préférences', () => {
  it('R30 : la dernière cadence est mémorisée', () => {
    const store = memoryStore()
    expect(loadLastPresetId(store)).toBeNull()
    saveLastPresetId(store, 'blitz-5-0-fischer')
    expect(loadLastPresetId(store)).toBe('blitz-5-0-fischer')
  })

  it('R15 : le mode silencieux survit à la fermeture, et vaut faux par défaut', () => {
    const store = memoryStore()
    expect(loadSilent(store)).toBe(false)
    saveSilent(store, true)
    expect(loadSilent(store)).toBe(true)
    saveSilent(store, false)
    expect(loadSilent(store)).toBe(false)
  })
})

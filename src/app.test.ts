// @vitest-environment jsdom
import HTML from '../index.html?raw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { TestClock } from './domain/clock'
import { loadJournal, memoryStore } from './persistence/store'
import type { App } from './app'
import type { KeyValueStore } from './persistence/store'
import type { ClockEvent, Journal } from './domain/types'

/**
 * Le domaine est prouvé par ailleurs ; ce fichier vérifie qu'il est branché sur
 * les bons éléments et que les gestes produisent les bons événements. C'est le
 * seul endroit où un identifiant erroné casserait tout en silence.
 */

const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>'))
const START_AT = 1_000

let clock: TestClock
let store: KeyValueStore
let app: App

const mount = (): App => {
  document.body.innerHTML = BODY
  return createApp({ clock, store, root: document })
}

const press = (id: string): void => {
  document.querySelector(`#${id}`)!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  // Piège connu : lire le DOM dans le même tour de boucle que l'action lit
  // l'ancien rendu. On redessine explicitement avant d'asserter.
  app.draw()
}

const click = (id: string): void => {
  document.querySelector<HTMLElement>(`#${id}`)!.click()
  app.draw()
}

function journal(): Journal {
  const result = loadJournal(store)
  if (!result.ok) throw new Error(`journal illisible : ${result.reason}`)
  return result.journal
}

const types = (events: readonly ClockEvent[]): readonly string[] => events.map((e) => e.type)

const text = (selector: string): string =>
  document.querySelector<HTMLElement>(selector)?.textContent ?? ''

// `HTMLElement.hidden` vaut `boolean | string` depuis `hidden="until-found"`.
const hidden = (selector: string): boolean =>
  Boolean(document.querySelector<HTMLElement>(selector)!.hidden)

beforeEach(() => {
  clock = new TestClock(START_AT)
  store = memoryStore()
  app = mount()
})

afterEach(() => {
  app.dispose()
})

describe('démarrage (R8)', () => {
  it('le premier tap lance la pendule et fait de la moitié tapée celle des Blancs', () => {
    press('half-bottom')

    expect(types(journal().events)).toEqual(['start'])
    expect(journal().events[0]).toMatchObject({ type: 'start', at: START_AT, whiteHalf: 'bottom' })
    expect(document.querySelector('#half-bottom')!.classList.contains('is-running')).toBe(true)
  })

  it('démarrer par le haut produit l’orientation miroir', () => {
    press('half-top')
    expect(journal().events[0]).toMatchObject({ whiteHalf: 'top' })
    expect(document.querySelector('#half-top')!.classList.contains('is-running')).toBe(true)
  })
})

describe('taps en partie (R7, R9)', () => {
  it('le joueur au trait rend la main ; l’autre est sans effet', () => {
    press('half-bottom')

    clock.set(6_000)
    press('half-bottom') // R7 : le joueur au trait tape sa propre moitié
    expect(types(journal().events)).toEqual(['start', 'tap'])

    clock.set(8_000)
    press('half-bottom') // R9 : ce n'est plus son tour — aucun effet
    expect(types(journal().events)).toEqual(['start', 'tap'])

    clock.set(9_000)
    press('half-top')
    expect(types(journal().events)).toEqual(['start', 'tap', 'tap'])
  })

  it('R25 : le journal est persisté après chaque coup, pas en fin de partie', () => {
    press('half-bottom')
    expect(journal().events).toHaveLength(1)

    clock.set(6_000)
    press('half-bottom')
    expect(journal().events).toHaveLength(2)
  })

  it('R12 : le cédant voit sa moitié se figer immédiatement', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom')

    expect(document.querySelector('#half-bottom')!.classList.contains('is-confirming')).toBe(true)

    clock.set(6_500)
    app.draw()
    expect(document.querySelector('#half-bottom')!.classList.contains('is-confirming')).toBe(false)
    expect(document.querySelector('#half-top')!.classList.contains('is-running')).toBe(true)
  })

  it('R17 : le drapeau tombe pendant une longue réflexion et marque la bonne moitié', () => {
    press('half-bottom')
    clock.set(START_AT + 3 * 60_000 + 1)
    app.draw()

    expect(document.querySelector('#half-bottom')!.classList.contains('is-flagged')).toBe(true)
    expect(text('#clock-bottom')).toBe('0.0')
    expect(document.querySelector('#half-top')!.classList.contains('is-flagged')).toBe(false)
  })
})

describe('bande centrale (R10, R24)', () => {
  it('le bouton pause arrête le temps des deux côtés et ouvre l’écran', () => {
    press('half-bottom')
    clock.set(6_000)
    click('menu-button')

    expect(types(journal().events)).toEqual(['start', 'pause'])
    expect(hidden('#overlay')).toBe(false)

    const frozen = text('#clock-bottom')
    clock.set(120_000)
    app.draw()
    expect(text('#clock-bottom')).toBe(frozen)
  })

  it('R24 : l’undo retire le dernier tap et restitue le temps', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom')
    expect(journal().events).toHaveLength(2)

    click('undo-button')
    expect(types(journal().events)).toEqual(['start'])
    expect(document.querySelector('#half-bottom')!.classList.contains('is-running')).toBe(true)
  })

  it('l’undo est refusé quand le dernier événement n’est pas un tap', () => {
    press('half-bottom')
    expect(document.querySelector<HTMLButtonElement>('#undo-button')!.disabled).toBe(true)

    click('undo-button')
    expect(types(journal().events)).toEqual(['start'])
  })
})

describe('écran de pause (R11, R15)', () => {
  it('le reset demande bien deux gestes', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom')

    // Premier geste : ouvrir l'écran. La partie est toujours là.
    click('menu-button')
    expect(journal().events.length).toBeGreaterThan(0)

    // Second geste seulement : la partie repart de zéro.
    click('reset-button')
    expect(loadJournal(store).ok).toBe(false)
    expect(hidden('#overlay')).toBe(true)
  })

  it('R15 : l’interrupteur silencieux est persisté', () => {
    click('menu-button')
    const toggle = document.querySelector<HTMLInputElement>('#silent-toggle')!
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))

    expect(store.read('mychess.silent')).toBe('1')

    app.dispose()
    app = mount()
    // La case n'est synchronisée qu'à l'ouverture de l'écran : `render` sort tôt
    // quand l'overlay est fermé plutôt que de recalculer un panneau invisible.
    click('menu-button')
    expect(document.querySelector<HTMLInputElement>('#silent-toggle')!.checked).toBe(true)
  })

  it('les taps sur les moitiés sont neutralisés tant que l’écran est ouvert', () => {
    press('half-bottom')
    clock.set(6_000)
    click('menu-button')

    press('half-bottom')
    expect(types(journal().events)).toEqual(['start', 'pause'])
  })
})

describe('reprise à l’ouverture (R26)', () => {
  it('une partie non close est proposée, temps de l’absence compris', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom') // les Noirs prennent la main avec 3 min

    // Fermeture, puis réouverture une minute plus tard.
    app.dispose()
    clock.set(6_000 + 60_000)
    app = mount()

    expect(hidden('#overlay')).toBe(false)
    expect(text('#overlay-title')).toMatch(/en cours/i)
    expect(journal().events).toHaveLength(2)

    click('resume-button')
    expect(hidden('#overlay')).toBe(true)
    // La minute d'absence a bien été consommée : 3:00 − 1:00.
    expect(text('#clock-top')).toBe('2:00')
    expect(document.querySelector('#half-top')!.classList.contains('is-running')).toBe(true)
  })

  it('KTD6 : une partie dont le drapeau est tombé pendant l’absence n’est pas proposée', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom')

    app.dispose()
    clock.set(6_000 + 40 * 60_000) // bien au-delà des 3 min des Noirs
    app = mount()

    // La partie est terminée : rien n'est proposé et la pendule repart à neuf,
    // sur la dernière cadence utilisée.
    expect(hidden('#overlay')).toBe(true)
    expect(text('#clock-top')).toBe('3:00')
    expect(text('#clock-bottom')).toBe('3:00')
    expect(document.querySelector('#half-top')!.classList.contains('is-flagged')).toBe(false)
  })

  it('R30 : la dernière cadence utilisée est reproposée au lancement suivant', () => {
    click('menu-button')
    const select = document.querySelector<HTMLSelectElement>('#preset-select')!
    select.value = 'blitz-5-0-fischer'
    select.dispatchEvent(new Event('change', { bubbles: true }))

    app.dispose()
    app = mount()
    expect(text('#clock-bottom')).toBe('5:00')
  })

  it('une sauvegarde corrompue n’est pas proposée et ne casse pas le démarrage', () => {
    app.dispose()
    store.write('mychess.journal', '{"version":1,"events":[')
    app = mount()

    expect(text('#overlay-title')).not.toMatch(/en cours/i)
    expect(text('#overlay-note')).toMatch(/ignorée/i)

    // La pendule reste utilisable : fermer l'écran puis taper démarre une partie.
    click('close-button')
    press('half-bottom')
    expect(types(journal().events)).toEqual(['start'])
  })
})

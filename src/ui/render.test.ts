// @vitest-environment jsdom
import HTML from '../../index.html?raw'
import { beforeEach, describe, expect, it } from 'vitest'
import { CONFIRM_FLASH_MS, halfState, queryElements, render } from './render'
import { fold } from '../domain/fold'
import { newJournal, start, tap } from '../domain/commands'
import { PRESETS } from '../presets/presets'
import type { Elements, OverlayMode, UiModel } from './render'
import type { Half, Journal, TimeControl } from '../domain/types'

const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>'))

const START_AT = 1000
const WHITE: Half = 'bottom'
const BLACK: Half = 'top'

const tc = (over: Partial<TimeControl> = {}): TimeControl => ({
  id: PRESETS[0]!.id,
  label: PRESETS[0]!.label,
  mode: 'fischer',
  initialMs: { white: 180_000, black: 180_000 },
  incrementMs: 2_000,
  ...over,
})

const model = (journal: Journal, now: number, over: Partial<UiModel> = {}): UiModel => ({
  view: fold(journal, now),
  overlay: 'none' as OverlayMode,
  silent: false,
  canUndo: false,
  canExport: false,
  presets: PRESETS,
  selectedPresetId: PRESETS[0]!.id,
  note: '',
  ...over,
})

let el: Elements

beforeEach(() => {
  document.body.innerHTML = BODY
  el = queryElements()
})

describe('queryElements', () => {
  it('trouve tous les éléments attendus dans index.html', () => {
    expect(el.halves.top.id).toBe('half-top')
    expect(el.halves.bottom.id).toBe('half-bottom')
    expect(el.menuButton.id).toBe('menu-button')
  })

  it('échoue bruyamment si un élément manque', () => {
    document.body.innerHTML = '<div></div>'
    expect(() => queryElements()).toThrow(/absent/)
  })
})

describe('render — idempotence', () => {
  it('rendre deux fois la même vue laisse le DOM identique', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    const m = model(journal, START_AT + 5_000)

    render(el, m, START_AT + 5_000)
    const first = document.body.innerHTML
    render(el, m, START_AT + 5_000)

    expect(document.body.innerHTML).toBe(first)
  })

  it('l’écran de pause ouvert puis refermé laisse les moitiés intactes', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(journal, START_AT), START_AT)
    const halves = document.querySelector('#app')!.innerHTML

    render(el, model(journal, START_AT, { overlay: 'pause' }), START_AT)
    expect(el.overlay.hidden).toBe(false)

    render(el, model(journal, START_AT), START_AT)
    expect(el.overlay.hidden).toBe(true)
    // Le contenu masqué garde ses dernières valeurs : `render` sort tôt plutôt
    // que de recalculer un panneau invisible à chaque frame.
    expect(document.querySelector('#app')!.innerHTML).toBe(halves)
  })
})

describe('render — états des moitiés', () => {
  it('seule la moitié au trait est mise en avant', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(journal, START_AT + 1_000), START_AT + 1_000)

    expect(el.halves[WHITE].classList.contains('is-running')).toBe(true)
    expect(el.halves[BLACK].classList.contains('is-running')).toBe(false)
    expect(el.clocks[WHITE].textContent).toBe('2:59')
  })

  it('R12 : le cédant reçoit la confirmation sur sa propre moitié, puis elle retombe', () => {
    const journal = tap(start(newJournal(tc()), START_AT, WHITE)!, START_AT + 5_000, WHITE)!
    const at = START_AT + 5_000

    render(el, model(journal, at), at)
    expect(el.halves[WHITE].classList.contains('is-confirming')).toBe(true)
    expect(el.halves[BLACK].classList.contains('is-confirming')).toBe(false)

    const after = at + CONFIRM_FLASH_MS
    render(el, model(journal, after), after)
    expect(el.halves[WHITE].classList.contains('is-confirming')).toBe(false)
    expect(el.halves[BLACK].classList.contains('is-running')).toBe(true)
  })

  it('la confirmation ne survit pas à un undo : elle suit lastTapAt', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    const at = START_AT + 5_000
    render(el, model(journal, at), at)
    expect(el.halves[WHITE].classList.contains('is-confirming')).toBe(false)
  })

  it('sous dix secondes, la moitié au trait passe en urgence', () => {
    const journal = start(newJournal(tc({ initialMs: { white: 12_000, black: 180_000 } })), START_AT, WHITE)!
    const at = START_AT + 3_000
    render(el, model(journal, at), at)
    expect(el.halves[WHITE].classList.contains('is-urgent')).toBe(true)
    expect(el.clocks[WHITE].textContent).toBe('9.0')
  })

  it('R17 et R18 : la moitié au drapeau est marquée, et rien n’attribue de résultat', () => {
    const journal = start(newJournal(tc({ initialMs: { white: 5_000, black: 180_000 } })), START_AT, WHITE)!
    const at = START_AT + 9_000

    render(el, model(journal, at, { overlay: 'over' }), at)

    expect(el.halves[WHITE].classList.contains('is-flagged')).toBe(true)
    expect(el.halves[BLACK].classList.contains('is-flagged')).toBe(false)
    expect(el.clocks[WHITE].textContent).toBe('0.0')
    expect(document.body.textContent ?? '').not.toMatch(/vainqueur|gagn|perd|1-0|0-1/i)
  })
})

describe('render — écran de pause (R11)', () => {
  it('le reset n’est jamais rendu hors de l’écran de pause', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(journal, START_AT), START_AT)
    expect(el.overlay.hidden).toBe(true)

    render(el, model(journal, START_AT, { overlay: 'pause' }), START_AT)
    expect(el.overlay.hidden).toBe(false)
    expect(el.resetButton.hidden).toBe(false)
  })

  it('la cadence n’est modifiable qu’en dehors d’une partie en cours (R29)', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(journal, START_AT, { overlay: 'pause' }), START_AT)
    expect(el.presetSelect.disabled).toBe(true)

    render(el, model(newJournal(tc()), START_AT, { overlay: 'settings' }), START_AT)
    expect(el.presetSelect.disabled).toBe(false)
    expect(el.presetSelect.options.length).toBe(PRESETS.length)
  })

  it('R15 : l’interrupteur silencieux reflète le modèle', () => {
    const j = newJournal(tc())
    render(el, model(j, START_AT, { overlay: 'settings', silent: true }), START_AT)
    expect(el.silentToggle.checked).toBe(true)
    render(el, model(j, START_AT, { overlay: 'settings', silent: false }), START_AT)
    expect(el.silentToggle.checked).toBe(false)
  })
})

describe('halfState — fonction pure', () => {
  it('le drapeau prime sur toute autre mise en avant', () => {
    const journal = start(newJournal(tc({ initialMs: { white: 5_000, black: 180_000 } })), START_AT, WHITE)!
    const view = fold(journal, START_AT + 6_000)
    expect(halfState(view, WHITE, START_AT + 6_000)).toEqual(['is-flagged'])
  })

  it('une moitié à l’arrêt ne porte aucun état', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    expect(halfState(fold(journal, START_AT), BLACK, START_AT)).toEqual([])
  })
})

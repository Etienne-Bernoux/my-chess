// @vitest-environment jsdom
import HTML from '../../index.html?raw'
import { beforeEach, describe, expect, it } from 'vitest'
import { CONFIRM_FLASH_MS, halfState, queryElements, render } from './render'
import { fold } from '../domain/fold'
import { newJournal, start, tap } from '../domain/commands'
import { PRESETS } from '../presets/presets'
import { CUSTOM_ID, DEFAULT_DRAFT } from '../presets/custom'
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
  custom: DEFAULT_DRAFT,
  customError: null,
  resetArmed: false,
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

  it('sous dix secondes, la moitié au trait passe au palier le plus urgent', () => {
    const journal = start(newJournal(tc({ initialMs: { white: 12_000, black: 180_000 } })), START_AT, WHITE)!
    const at = START_AT + 3_000
    render(el, model(journal, at), at)
    expect(el.halves[WHITE].classList.contains('is-alert-urgent')).toBe(true)
    // R34 : partir de douze secondes désarme les deux paliers supérieurs, qui
    // seraient atteints avant même que le premier coup soit joué.
    expect(el.halves[WHITE].classList.contains('is-alert-minute')).toBe(false)
    expect(el.halves[WHITE].classList.contains('is-alert-half-minute')).toBe(false)
    expect(el.clocks[WHITE].textContent).toBe('9.0')
  })

  it('R36 : avant le premier tap, aucun camp n’est écrit', () => {
    const journal = newJournal(tc())
    render(el, model(journal, START_AT), START_AT)
    expect(el.sides[WHITE].hidden).toBe(true)
    expect(el.sides[BLACK].hidden).toBe(true)
  })

  it('R36 : le premier tap écrit les deux camps, et l’orientation le suit', () => {
    // R8 : les Noirs tapent la moitié de leur adversaire, qui devient celle des
    // Blancs. Inverser le tap doit inverser les deux libellés — sans quoi le
    // repère serait décoratif et mentirait une fois sur deux.
    const white = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(white, START_AT), START_AT)
    expect(el.sides[WHITE].hidden).toBe(false)
    expect(el.sides[WHITE].textContent).toBe('Blancs')
    expect(el.sides[BLACK].textContent).toBe('Noirs')

    document.body.innerHTML = BODY
    el = queryElements()

    const flipped = start(newJournal(tc()), START_AT, BLACK)!
    render(el, model(flipped, START_AT), START_AT)
    expect(el.sides[BLACK].textContent).toBe('Blancs')
    expect(el.sides[WHITE].textContent).toBe('Noirs')
  })

  it('R32, R36 : le camp dit à qui va lequel des deux temps du handicap', () => {
    // Sans le repère, régler cinq minutes pour les Blancs et trois pour les Noirs
    // puis voir les deux valeurs se croiser au premier tap se lit comme une
    // erreur de l'application. Le libellé est ce qui l'explique.
    const handicap = tc({ initialMs: { white: 300_000, black: 180_000 } })
    const journal = start(newJournal(handicap), START_AT, BLACK)!
    render(el, model(journal, START_AT), START_AT)

    expect(el.sides[BLACK].textContent).toBe('Blancs')
    expect(el.clocks[BLACK].textContent).toBe('5:00')
    expect(el.sides[WHITE].textContent).toBe('Noirs')
    expect(el.clocks[WHITE].textContent).toBe('3:00')
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

  it('la cadence reste choisissable partout où une nouvelle partie est proposée (R29)', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    // Un select grisé à côté d'un bouton « Nouvelle partie » rendrait le bouton
    // menteur : il proposerait une partie dont on ne peut pas régler la cadence.
    for (const overlay of ['home', 'pause', 'over'] as const) {
      render(el, model(journal, START_AT, { overlay }), START_AT)
      expect(el.presetSelect.disabled).toBe(false)
      expect(el.resetButton.hidden).toBe(false)
    }
    // Les presets, plus l'entrée manuelle qui ferme toujours la liste.
    expect(el.presetSelect.options.length).toBe(PRESETS.length + 1)
    expect(el.presetSelect.options[PRESETS.length]!.value).toBe(CUSTOM_ID)
  })

  it('les champs manuels ne sont montés que sous l’entrée manuelle', () => {
    const journal = newJournal(tc())

    render(el, model(journal, START_AT, { overlay: 'home' }), START_AT)
    expect(el.customFields.hidden).toBe(true)

    render(el, model(journal, START_AT, { overlay: 'home', selectedPresetId: CUSTOM_ID }), START_AT)
    expect(el.customFields.hidden).toBe(false)
    expect(el.customMinutes.value).toBe(String(DEFAULT_DRAFT.minutes))
    // Le handicap est décoché par défaut : le champ unique tient l'écran.
    expect(el.customTimeField.hidden).toBe(false)
    expect(el.customHandicapFields.hidden).toBe(true)
  })

  it('une saisie invalide barre l’ouverture d’une partie et prend le pas sur la note', () => {
    const model_ = model(newJournal(tc()), START_AT, {
      overlay: 'home',
      selectedPresetId: CUSTOM_ID,
      customError: 'Temps : un nombre entier de minutes est attendu.',
      note: 'Journal copié dans le presse-papiers.',
    })
    render(el, model_, START_AT)

    expect(el.resetButton.disabled).toBe(true)
    expect(el.overlayNote.textContent).toMatch(/entier/)
    expect(el.overlayNote.classList.contains('is-error')).toBe(true)
  })

  it('ne réécrit pas le champ que le doigt est en train de remplir', () => {
    const model_ = model(newJournal(tc()), START_AT, {
      overlay: 'home',
      selectedPresetId: CUSTOM_ID,
      custom: { ...DEFAULT_DRAFT, minutes: Number.NaN },
    })
    render(el, model_, START_AT)

    // Champ vidé pour être retapé : le repeupler à la frame suivante le rendrait
    // impossible à corriger.
    el.customMinutes.value = '1'
    el.customMinutes.focus()
    render(el, model_, START_AT)
    expect(el.customMinutes.value).toBe('1')

    // Hors focus, l'affichage se réaligne — et une valeur invalide s'affiche
    // vide plutôt qu'en « NaN ».
    el.customMinutes.blur()
    render(el, model_, START_AT)
    expect(el.customMinutes.value).toBe('')
  })

  it('l’accueil ne propose la reprise que si une partie est en cours', () => {
    render(el, model(newJournal(tc()), START_AT, { overlay: 'home' }), START_AT)
    expect(el.resumeButton.hidden).toBe(true)
    expect(el.resetButton.textContent).toBe('Commencer')
    expect(el.overlayTitle.textContent).toBe('myChess')

    const journal = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(journal, START_AT, { overlay: 'home' }), START_AT)
    expect(el.resumeButton.hidden).toBe(false)
    expect(el.resetButton.textContent).toBe('Nouvelle partie')
    expect(el.overlayTitle.textContent).toMatch(/en cours/i)
  })

  it('le bouton de la bande dit « Réglages » à l’arrêt et « Pause » en partie', () => {
    render(el, model(newJournal(tc()), START_AT), START_AT)
    expect(el.menuButton.textContent).toBe('Réglages')
    expect(el.menuButton.getAttribute('aria-label')).toBe('Réglages')

    const journal = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(journal, START_AT), START_AT)
    expect(el.menuButton.textContent).toBe('❚❚')
    expect(el.menuButton.getAttribute('aria-label')).toBe('Pause')

    // Drapeau tombé : il n'y a plus rien à mettre en pause.
    const flagged = start(newJournal(tc({ initialMs: { white: 5_000, black: 5_000 } })), START_AT, WHITE)!
    const at = START_AT + 6_000
    render(el, model(flagged, at), at)
    expect(el.menuButton.getAttribute('aria-label')).toBe('Réglages')
  })

  it('R11 : le reset armé s’annonce par son libellé et son remplissage', () => {
    const journal = start(newJournal(tc()), START_AT, WHITE)!
    render(el, model(journal, START_AT, { overlay: 'home', resetArmed: true }), START_AT)
    expect(el.resetButton.textContent).toMatch(/abandon/i)
    expect(el.resetButton.classList.contains('is-armed')).toBe(true)

    render(el, model(journal, START_AT, { overlay: 'home' }), START_AT)
    expect(el.resetButton.textContent).toBe('Nouvelle partie')
    expect(el.resetButton.classList.contains('is-armed')).toBe(false)
  })

  it('un drapeau tombé n’est jamais reprenable (R17)', () => {
    const journal = start(newJournal(tc({ initialMs: { white: 5_000, black: 5_000 } })), START_AT, WHITE)!
    const at = START_AT + 6_000
    render(el, model(journal, at, { overlay: 'over' }), at)
    expect(el.resumeButton.hidden).toBe(true)
    expect(el.resetButton.textContent).toBe('Commencer')
  })

  it('R15 : l’interrupteur silencieux reflète le modèle', () => {
    const j = newJournal(tc())
    render(el, model(j, START_AT, { overlay: 'home', silent: true }), START_AT)
    expect(el.silentToggle.checked).toBe(true)
    render(el, model(j, START_AT, { overlay: 'home', silent: false }), START_AT)
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

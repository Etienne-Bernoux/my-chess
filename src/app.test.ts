// @vitest-environment jsdom
import HTML from '../index.html?raw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { TestClock } from './domain/clock'
import { parseJournal } from './persistence/codec'
import { loadJournal, memoryStore } from './persistence/store'
import { RESET_ARM_MS } from './ui/render'
import { CUSTOM_ID } from './presets/custom'
import type { App } from './app'
import type { AudioSink, Cue } from './audio/cues'
import type { KeyValueStore } from './persistence/store'
import type { ClockEvent, Journal } from './domain/types'

/**
 * Le domaine est prouvé par ailleurs ; ce fichier vérifie qu'il est branché sur
 * les bons éléments et que les gestes produisent les bons événements. C'est le
 * seul endroit où un identifiant erroné casserait tout en silence.
 */

const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>'))
const START_AT = 1_000

/** Sink enregistreur : ce qui est audible n'est pas testable, le câblage l'est. */
type RecordingSink = AudioSink & { readonly played: Cue[]; armCount: number }

const recordingSink = (): RecordingSink => {
  const sink: RecordingSink = {
    played: [],
    armCount: 0,
    arm: () => {
      sink.armCount += 1
    },
    play: (cue) => {
      sink.played.push(cue)
    },
  }
  return sink
}

let clock: TestClock
let store: KeyValueStore
let audio: RecordingSink
let app: App

/** R37 : source d'aléa scriptée — le tirage se prouve, il ne s'observe pas. */
let randomValues: number[] = []
const scriptedRandom = (): number => randomValues.shift() ?? 0

const mount = (): App => {
  document.body.innerHTML = BODY
  return createApp({ clock, store, audio, random: scriptedRandom, root: document })
}

/**
 * L'application s'ouvre sur l'accueil : tant qu'il n'est pas fermé, aucun tap
 * n'atteint les moitiés. Les tests qui portent sur la pendule elle-même passent
 * donc par ici ; ceux qui portent sur l'accueil montent sans le fermer.
 */
const enterGame = (): void => {
  document.querySelector<HTMLElement>('#reset-button')!.click()
  app.draw()
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

const choose = (value: string): void => {
  const select = document.querySelector<HTMLSelectElement>('#preset-select')!
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
  app.draw()
}

const fill = (id: string, value: string): void => {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)!
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  app.draw()
}

const check = (id: string, on: boolean): void => {
  const input = document.querySelector<HTMLInputElement>(`#${id}`)!
  input.checked = on
  input.dispatchEvent(new Event('change', { bubbles: true }))
  app.draw()
}

const disabled = (selector: string): boolean =>
  document.querySelector<HTMLButtonElement>(selector)!.disabled

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
  audio = recordingSink()
  randomValues = []
  app = mount()
  enterGame()
})

afterEach(() => {
  app.dispose()
  vi.unstubAllGlobals()
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

  it('R18 : après la chute, l’écran explique sans attribuer de résultat', () => {
    press('half-bottom')
    clock.set(START_AT + 3 * 60_000 + 1)
    app.draw()

    click('menu-button')
    expect(text('#overlay-title')).toMatch(/drapeau/i)
    expect(document.body.textContent ?? '').not.toMatch(/vainqueur|gagn|perdu|1-0|0-1/i)
  })

  it('R24 : l’undo est refusé et grisé une fois le drapeau tombé', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom') // les Noirs prennent la main
    clock.set(6_000 + 3 * 60_000 + 1) // ils tombent
    app.draw()

    expect(document.querySelector<HTMLButtonElement>('#undo-button')!.disabled).toBe(true)
    click('undo-button')
    expect(types(journal().events)).toEqual(['start', 'tap'])
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

describe('export du journal (R28)', () => {
  const openWithGame = (): void => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom')
    click('menu-button')
  }

  it('sans presse-papiers, le journal est affiché pour être copié à la main', () => {
    vi.stubGlobal('navigator', {})
    openWithGame()
    click('export-button')

    const note = text('#overlay-note')
    expect(note).toContain('"type":"start"')
    // Le format d'export EST le format de stockage : il se reparse tel quel.
    expect(parseJournal(note).ok).toBe(true)
  })

  it('avec presse-papiers, le journal y est copié et la copie est confirmée', async () => {
    let copied = ''
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: (value: string) => {
          copied = value
          return Promise.resolve()
        },
      },
    })
    openWithGame()
    click('export-button')
    await Promise.resolve()
    app.draw()

    expect(parseJournal(copied).ok).toBe(true)
    expect(text('#overlay-note')).toMatch(/presse-papiers/i)
  })

  it('si la copie échoue, le journal reste récupérable à l’écran', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: () => Promise.reject(new Error('refusé')) },
    })
    openWithGame()
    click('export-button')
    await Promise.resolve()
    await Promise.resolve()
    app.draw()

    expect(parseJournal(text('#overlay-note')).ok).toBe(true)
  })

  it('rien à exporter avant le premier coup', () => {
    click('menu-button')
    expect(hidden('#export-button')).toBe(true)
  })
})

describe('retours sonores (R13, R14, R15)', () => {
  /** Cadence courte pour atteindre le seuil des dix secondes rapidement. */
  const shortGame = (): void => {
    click('menu-button')
    const select = document.querySelector<HTMLSelectElement>('#preset-select')!
    select.value = 'bullet-1-0-fischer' // 1 min, incrément nul
    select.dispatchEvent(new Event('change', { bubbles: true }))
    click('reset-button')
  }

  it('R14 : l’audio est armé au premier geste, et l’armement est idempotent', () => {
    expect(audio.armCount).toBe(0)
    press('half-bottom')
    expect(audio.armCount).toBe(1)

    clock.set(6_000)
    press('half-bottom')
    expect(audio.armCount).toBe(2) // ré-armer est sans effet côté Web Audio
    expect(audio.played).toEqual([])
  })

  it('R33, R34 : chaque palier puis la chute produisent un signal distinct, et le palier d’une minute reste désarmé en bullet', () => {
    // Bullet 1+0 part à une minute pile : R34 désarme le palier « une minute »,
    // qui se déclencherait au premier tic sans rien apprendre à personne.
    shortGame()
    press('half-bottom')

    clock.set(START_AT + 29_999) // 30 001 ms restantes : aucun palier franchi
    app.draw()
    expect(audio.played).toEqual([])

    clock.set(START_AT + 30_001)
    app.draw()
    expect(audio.played).toEqual(['half-minute'])

    clock.set(START_AT + 50_001)
    app.draw()
    expect(audio.played).toEqual(['half-minute', 'urgent'])

    clock.set(START_AT + 60_000)
    app.draw()
    expect(audio.played).toEqual(['half-minute', 'urgent', 'flag'])

    // Une fois le drapeau tombé, plus rien n'est émis frame après frame.
    clock.set(START_AT + 120_000)
    app.draw()
    app.draw()
    expect(audio.played).toEqual(['half-minute', 'urgent', 'flag'])
    expect(audio.played).not.toContain('minute')
  })

  it('R15 : le mode silencieux coupe tous les sons sans toucher au visuel', () => {
    click('menu-button')
    const toggle = document.querySelector<HTMLInputElement>('#silent-toggle')!
    toggle.checked = true
    toggle.dispatchEvent(new Event('change', { bubbles: true }))
    shortGame()

    press('half-bottom')
    clock.set(START_AT + 60_000)
    app.draw()

    expect(audio.played).toEqual([])
    expect(document.querySelector('#half-bottom')!.classList.contains('is-flagged')).toBe(true)
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

    // La partie est terminée : l'accueil ne propose pas de la reprendre et la
    // pendule repart à neuf, sur la dernière cadence utilisée.
    expect(hidden('#resume-button')).toBe(true)
    expect(text('#overlay-title')).not.toMatch(/en cours/i)
    enterGame()
    expect(text('#clock-top')).toBe('3:00')
    expect(text('#clock-bottom')).toBe('3:00')
    expect(document.querySelector('#half-top')!.classList.contains('is-flagged')).toBe(false)
  })

  it('R30 : la dernière cadence utilisée est reproposée au lancement suivant', () => {
    click('menu-button')
    const select = document.querySelector<HTMLSelectElement>('#preset-select')!
    select.value = 'blitz-5-0-fischer'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    click('reset-button')

    app.dispose()
    app = mount()
    enterGame()
    expect(text('#clock-bottom')).toBe('5:00')
  })

  it('R11 : abandonner une partie reprenable demande un second appui', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom')

    app.dispose()
    clock.set(6_000 + 60_000)
    app = mount()

    // Premier appui : le bouton s'arme, la partie est intacte.
    click('reset-button')
    expect(journal().events).toHaveLength(2)
    expect(hidden('#overlay')).toBe(false)
    expect(text('#reset-button')).toMatch(/abandon/i)

    // Second appui : la partie est bel et bien jetée.
    click('reset-button')
    expect(hidden('#overlay')).toBe(true)
    expect(loadJournal(store).ok).toBe(false)
  })

  it('R11 : le reset se désarme tout seul, sans minuteur à nettoyer', () => {
    press('half-bottom')
    app.dispose()
    app = mount()

    click('reset-button')
    expect(text('#reset-button')).toMatch(/abandon/i)

    // Passé la fenêtre, l'appui suivant ré-arme au lieu de détruire.
    clock.set(clock.now() + RESET_ARM_MS)
    click('reset-button')
    expect(journal().events).toHaveLength(1)
    expect(text('#reset-button')).toMatch(/abandon/i)
  })

  it('sans partie en cours, commencer ne demande qu’un seul appui', () => {
    click('menu-button')
    click('reset-button')
    expect(hidden('#overlay')).toBe(true)
  })

  it('choisir une cadence ne détruit pas la partie qu’on propose de reprendre', () => {
    press('half-bottom')
    clock.set(6_000)
    press('half-bottom')

    app.dispose()
    clock.set(6_000 + 60_000)
    app = mount()

    // La sélection n'est qu'un choix armé pour la partie suivante.
    const select = document.querySelector<HTMLSelectElement>('#preset-select')!
    select.value = 'blitz-5-0-fischer'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    app.draw()
    expect(journal().events).toHaveLength(2)

    click('resume-button')
    expect(hidden('#overlay')).toBe(true)
    expect(text('#clock-top')).toBe('2:00')
  })

  it('une sauvegarde corrompue n’est pas proposée et ne casse pas le démarrage', () => {
    app.dispose()
    store.write('mychess.journal', '{"version":1,"events":[')
    app = mount()

    expect(text('#overlay-title')).not.toMatch(/en cours/i)
    expect(text('#overlay-note')).toMatch(/ignorée/i)

    // La pendule reste utilisable : fermer l'écran puis taper démarre une partie.
    enterGame()
    press('half-bottom')
    expect(types(journal().events)).toEqual(['start'])
  })
})

describe('cadence manuelle et handicap (R4, R31, R32)', () => {
  const openSettings = (): void => {
    click('menu-button')
    choose(CUSTOM_ID)
  }

  it('les champs n’apparaissent que sous l’entrée manuelle du select', () => {
    click('menu-button')
    expect(hidden('#custom-fields')).toBe(true)

    choose(CUSTOM_ID)
    expect(hidden('#custom-fields')).toBe(false)

    choose('blitz-5-0-fischer')
    expect(hidden('#custom-fields')).toBe(true)
  })

  it('R31 : la cadence saisie s’applique à la partie ouverte, incrément compris', () => {
    openSettings()
    fill('custom-minutes', '7')
    fill('custom-increment', '4')
    click('reset-button')

    expect(text('#clock-bottom')).toBe('7:00')

    press('half-bottom')
    clock.set(START_AT + 10_000)
    press('half-bottom') // dix secondes consommées, quatre rendues
    expect(text('#clock-bottom')).toBe('6:54')
  })

  it('R32 : le handicap donne à chaque camp son temps, et l’orientation vient du seul premier tap (R8)', () => {
    openSettings()
    check('custom-handicap', true)
    fill('custom-white', '5')
    fill('custom-black', '3')
    click('reset-button')

    // R8 : les Noirs lancent en tapant la moitié adverse — le haut devient donc
    // celle des Blancs, et c'est ce tap seul qui attribue les deux temps.
    press('half-top')
    expect(text('#clock-top')).toBe('5:00')
    expect(text('#clock-bottom')).toBe('3:00')
  })

  it('R32 : lancer par l’autre moitié échange les deux temps', () => {
    openSettings()
    check('custom-handicap', true)
    fill('custom-white', '5')
    fill('custom-black', '3')
    click('reset-button')

    press('half-bottom')
    expect(text('#clock-bottom')).toBe('5:00')
    expect(text('#clock-top')).toBe('3:00')
  })

  it('cocher le handicap part du temps affiché', () => {
    openSettings()
    fill('custom-minutes', '12')
    check('custom-handicap', true)

    expect(document.querySelector<HTMLInputElement>('#custom-white')!.value).toBe('12')
    expect(document.querySelector<HTMLInputElement>('#custom-black')!.value).toBe('12')
    // Le champ unique s'efface : deux temps affichés ne diraient pas lequel vaut.
    expect(hidden('#custom-time-field')).toBe(true)
  })

  it('ne réécrit pas un handicap déjà réglé quand on décoche puis se ravise', () => {
    openSettings()
    check('custom-handicap', true)
    fill('custom-white', '5')
    fill('custom-black', '3')

    check('custom-handicap', false)
    check('custom-handicap', true)
    expect(document.querySelector<HTMLInputElement>('#custom-black')!.value).toBe('3')
  })

  it('cocher le handicap depuis des champs par camp vides recopie quand même le temps', () => {
    openSettings()
    fill('custom-white', '')
    fill('custom-black', '')
    fill('custom-minutes', '8')
    check('custom-handicap', true)

    // `NaN !== NaN` ferait passer deux champs vides pour un handicap déjà réglé,
    // et la cadence resterait invalide sans qu'on voie pourquoi.
    expect(disabled('#reset-button')).toBe(false)
    click('reset-button')
    press('half-bottom')
    expect(text('#clock-bottom')).toBe('8:00')
    expect(text('#clock-top')).toBe('8:00')
  })

  it('une saisie invalide n’ouvre pas de partie, et dit pourquoi', () => {
    openSettings()
    fill('custom-minutes', '') // champ vidé pour être retapé

    expect(disabled('#reset-button')).toBe(true)
    expect(text('#overlay-note')).toMatch(/entier/i)

    click('reset-button')
    expect(hidden('#overlay')).toBe(false) // rien ne s'est ouvert

    fill('custom-minutes', '4')
    expect(disabled('#reset-button')).toBe(false)
    click('reset-button')
    expect(hidden('#overlay')).toBe(true)
    expect(text('#clock-bottom')).toBe('4:00')
  })

  it('R30 : une cadence manuelle est reproposée au lancement suivant', () => {
    openSettings()
    check('custom-handicap', true)
    fill('custom-white', '9')
    fill('custom-black', '6')
    fill('custom-increment', '0')
    click('reset-button')

    app.dispose()
    app = mount()
    enterGame()

    // Elle n'existe dans aucune liste : seule la cadence entière, mémorisée,
    // peut la restituer.
    press('half-bottom')
    expect(text('#clock-bottom')).toBe('9:00')
    expect(text('#clock-top')).toBe('6:00')
  })

  it('la saisie repart de la cadence en vigueur, pas d’un état neutre', () => {
    click('menu-button')
    choose('rapide-15-10-fischer')
    click('reset-button')

    click('menu-button')
    choose(CUSTOM_ID)
    expect(document.querySelector<HTMLInputElement>('#custom-minutes')!.value).toBe('15')
    expect(document.querySelector<HTMLInputElement>('#custom-increment')!.value).toBe('10')
  })

  it('une préférence de cadence illisible retombe sur le premier preset', () => {
    app.dispose()
    store.write('mychess.lastTimeControl', '{"id":"custom"')
    app = mount()
    enterGame()

    expect(text('#clock-bottom')).toBe('3:00') // Blitz 3+2, premier preset
  })

  it('R30 : le schéma précédent, qui ne mémorisait qu’un identifiant, est repris', () => {
    app.dispose()
    // Le téléphone qui migre n'a que l'ancienne clé : le montage du test en a
    // déjà écrit une nouvelle, qui masquerait la migration qu'on veut prouver.
    store.remove('mychess.lastTimeControl')
    store.write('mychess.lastPreset', 'rapide-10-5-fischer')
    app = mount()
    enterGame()

    expect(text('#clock-bottom')).toBe('10:00')
  })
})

describe('tirage des couleurs (R37)', () => {
  /** La pendule n'a pas encore démarré : le menu rouvre donc l'accueil. */
  const openHome = (): void => click('menu-button')

  it('rien n’est tiré tant que personne n’a appuyé', () => {
    openHome()
    expect(hidden('#draw-field')).toBe(false)
    expect(hidden('#draw-result')).toBe(true)
  })

  it('les deux issues sortent, et le résultat se remplace', () => {
    openHome()

    randomValues = [0.2]
    click('draw-button')
    expect(text('#draw-result')).toBe('Blancs pour vous')
    expect(hidden('#draw-result')).toBe(false)

    randomValues = [0.8]
    click('draw-button')
    expect(text('#draw-result')).toBe('Noirs pour vous')
  })

  it('R8 : le tirage ne décide pas de l’orientation, le premier tap si', () => {
    openHome()
    randomValues = [0.9] // le tirage annonce « Noirs »
    click('draw-button')
    expect(text('#draw-result')).toBe('Noirs pour vous')

    click('reset-button')
    press('half-top')

    // Le tap seul attribue les camps : ce qui est sorti du tirage n'y entre pas.
    expect(journal().events[0]).toMatchObject({ type: 'start', whiteHalf: 'top' })
    expect(text('#side-top')).toBe('Blancs')
  })

  it('ouvrir une partie efface le tirage', () => {
    openHome()
    randomValues = [0.2]
    click('draw-button')
    expect(text('#draw-result')).toBe('Blancs pour vous')

    click('reset-button')
    openHome()

    // Sinon le résultat d'une partie déjà jouée se lirait comme celui de la
    // suivante, et personne ne verrait la différence.
    expect(hidden('#draw-result')).toBe(true)
  })

  it('R37 : facultatif, donc absent de tout écran qui n’est pas l’accueil', () => {
    press('half-bottom')
    click('menu-button') // la pendule tourne : c'est la pause qui s'ouvre

    expect(hidden('#draw-field')).toBe(true)
  })
})

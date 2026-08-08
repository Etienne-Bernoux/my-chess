import { newJournal, pause, resume, start, tap, undo } from './domain/commands'
import { fold } from './domain/fold'
import { serialize } from './persistence/codec'
import {
  clearJournal,
  isResumable,
  loadJournal,
  loadLastPresetId,
  loadSilent,
  saveJournal,
  saveLastPresetId,
  saveSilent,
} from './persistence/store'
import { DEFAULT_PRESET, PRESETS, presetById } from './presets/presets'
import { queryElements, render } from './ui/render'
import { createWebAudioCues, cueForTransition } from './audio/cues'
import { createWakeLock } from './platform/wakeLock'
import type { AudioSink } from './audio/cues'
import type { ScreenWakeLock } from './platform/wakeLock'
import type { OverlayMode } from './ui/render'
import type { Clock } from './domain/clock'
import type { KeyValueStore } from './persistence/store'
import type { Half, Journal, View } from './domain/types'

export type AppDeps = {
  readonly clock: Clock
  readonly store: KeyValueStore
  readonly root?: ParentNode
  readonly audio?: AudioSink
  readonly wakeLock?: ScreenWakeLock
}

export type App = {
  /** Force un rendu immédiat — utile pour lire le DOM après le re-render. */
  draw(): void
  dispose(): void
}

/**
 * Racine de composition. Horloge et stockage sont injectés (R22 étendue à toute
 * l'application) : c'est ce qui rend le câblage testable sans simuler ni le
 * temps ni le stockage du navigateur.
 */
export function createApp({
  clock,
  store,
  root = document,
  audio = createWebAudioCues(),
  wakeLock = createWakeLock(),
}: AppDeps): App {
  const el = queryElements(root)

  let journal: Journal = newJournal(presetById(loadLastPresetId(store)))
  let overlay: OverlayMode = 'none'
  let silent = loadSilent(store)
  let note = ''

  // R26 : à l'ouverture, si le journal de la dernière partie n'est pas clos, on
  // propose de la reprendre. La reprise restitue l'état exact — c'est le fold
  // qui s'en charge, il n'y a aucun chemin de rattrapage à écrire.
  const saved = loadJournal(store)
  if (saved.ok && isResumable(saved.journal, clock.now())) {
    journal = saved.journal
    overlay = 'resume'
  } else if (!saved.ok && saved.reason !== 'sauvegarde absente') {
    note = `Sauvegarde précédente ignorée — ${saved.reason}`
    overlay = 'settings'
    clearJournal(store)
  }

  /** R25 : le journal est persisté au fil de la partie, après chaque événement. */
  const commit = (next: Journal | null): boolean => {
    if (next === null) return false
    journal = next
    saveJournal(store, journal)
    return true
  }

  const canUndo = (): boolean => journal.events[journal.events.length - 1]?.type === 'tap'

  const selectedPresetId = (): string =>
    PRESETS.some((p) => p.id === journal.timeControl.id)
      ? journal.timeControl.id
      : DEFAULT_PRESET.id

  const startNewGame = (presetId: string): void => {
    journal = newJournal(presetById(presetId))
    clearJournal(store)
    saveLastPresetId(store, journal.timeControl.id)
    overlay = 'none'
    note = ''
  }

  // ---------- Zones de tap (R6, R7, R8, R9) ----------

  const onHalfPressed = (half: Half): void => {
    if (overlay !== 'none') return
    // R14 : l'audio est pré-armé au premier geste utilisateur — le tap de
    // démarrage suffit, et l'API l'exige.
    audio.arm()
    const now = clock.now()

    if (fold(journal, now).phase === 'idle') {
      // R8 : les Noirs tapent la moitié située du côté de leur adversaire ;
      // l'orientation des deux camps se déduit de ce seul tap, et aucun écran ne
      // demande qui est Blanc.
      if (commit(start(journal, now, half))) saveLastPresetId(store, journal.timeControl.id)
      return
    }

    // R9 : un tap sur la moitié du joueur qui n'est pas au trait rend `null` et
    // n'est donc jamais écrit au journal (KTD3).
    commit(tap(journal, now, half))
  }

  const preventDefault = (event: Event): void => event.preventDefault()

  for (const half of ['top', 'bottom'] as const) {
    el.halves[half].addEventListener('pointerdown', () => onHalfPressed(half))
    // Un appui long ne doit jamais ouvrir le menu contextuel du navigateur.
    el.halves[half].addEventListener('contextmenu', preventDefault)
  }

  // ---------- Bande centrale (R10, R24) ----------

  el.undoButton.addEventListener('click', () => {
    if (overlay === 'none') commit(undo(journal))
  })

  el.menuButton.addEventListener('click', () => {
    const now = clock.now()
    const phase = fold(journal, now).phase
    if (phase === 'running') {
      commit(pause(journal, now))
      overlay = 'pause'
    } else if (phase === 'paused') {
      overlay = 'pause'
    } else if (phase === 'flagged') {
      overlay = 'over'
    } else {
      overlay = 'settings'
    }
  })

  // ---------- Écran de pause (R11, R15, R28, R29, R30) ----------

  el.resumeButton.addEventListener('click', () => {
    // Une partie fermée alors qu'elle tournait n'a pas d'événement `pause` :
    // `resume` rend alors `null` et il n'y a qu'à refermer l'écran.
    commit(resume(journal, clock.now()))
    overlay = 'none'
    note = ''
  })

  el.closeButton.addEventListener('click', () => {
    overlay = 'none'
    note = ''
  })

  el.resetButton.addEventListener('click', () => startNewGame(el.presetSelect.value))

  el.presetSelect.addEventListener('change', () => {
    if (el.presetSelect.disabled) return
    startNewGame(el.presetSelect.value)
    overlay = 'settings'
  })

  el.silentToggle.addEventListener('change', () => {
    silent = el.silentToggle.checked
    saveSilent(store, silent)
  })

  el.exportButton.addEventListener('click', () => {
    // R28 : le format d'export est exactement le format de stockage — un journal
    // exporté se rejoue tel quel comme cas de test.
    const payload = serialize(journal)
    const clipboard: Clipboard | undefined = globalThis.navigator?.clipboard
    if (clipboard === undefined) {
      note = payload
      return
    }
    clipboard.writeText(payload).then(
      () => {
        note = 'Journal copié dans le presse-papiers.'
      },
      () => {
        note = payload
      },
    )
  })

  // ---------- Boucle de redessin (R21) ----------

  // Un timer ne sert qu'à redessiner : il ne détient aucun état de temps et ne
  // fait avancer aucun compteur. Le supprimer figerait l'affichage sans fausser
  // d'un millimètre l'état de la pendule.
  let previousView: View | null = null

  const draw = (): void => {
    const now = clock.now()
    const view = fold(journal, now)

    // R13 : les signaux naissent d'une transition entre deux vues, jamais d'une
    // horloge. R15 : le mode silencieux les coupe tous, sans toucher au visuel.
    const cue = cueForTransition(previousView, view)
    if (cue !== null && !silent) audio.play(cue)
    previousView = view

    // L'écran ne doit rester allumé que pendant qu'une pendule tourne : ni en
    // pause, ni après la chute du drapeau.
    wakeLock.setDesired(view.phase === 'running')

    render(
      el,
      {
        view,
        overlay,
        silent,
        canUndo: canUndo(),
        canExport: journal.events.length > 0,
        presets: PRESETS,
        selectedPresetId: selectedPresetId(),
        note,
      },
      now,
    )
  }

  let frame = 0

  const tick = (): void => {
    draw()
    frame = requestAnimationFrame(tick)
  }

  const startLoop = (): void => {
    if (frame === 0) frame = requestAnimationFrame(tick)
  }

  const stopLoop = (): void => {
    if (frame !== 0) cancelAnimationFrame(frame)
    frame = 0
  }

  // Suspendre le redessin en arrière-plan économise la batterie sans rien
  // changer à l'état : c'est exactement la propriété que le fold garantit.
  const onVisibilityChange = (): void => {
    if (document.hidden) stopLoop()
    else startLoop()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', stopLoop)

  draw()
  startLoop()

  return {
    draw,
    dispose(): void {
      stopLoop()
      wakeLock.dispose()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', stopLoop)
    },
  }
}

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
import { PRESETS, presetById } from './presets/presets'
import { RESET_ARM_MS, canResume, queryElements, render } from './ui/render'
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
  // L'application s'ouvre toujours sur l'accueil : la cadence est vue et
  // confirmée avant qu'une partie de club ne parte sur la mauvaise.
  let overlay: OverlayMode = 'home'
  let silent = loadSilent(store)
  let note = ''

  // R26 : à l'ouverture, si le journal de la dernière partie n'est pas clos, on
  // propose de la reprendre. La reprise restitue l'état exact — c'est le fold
  // qui s'en charge, il n'y a aucun chemin de rattrapage à écrire.
  const saved = loadJournal(store)
  if (saved.ok && isResumable(saved.journal, clock.now())) {
    journal = saved.journal
  } else if (!saved.ok && saved.reason !== 'sauvegarde absente') {
    note = `Sauvegarde précédente ignorée — ${saved.reason}`
    clearJournal(store)
  }

  // La cadence choisie dans la liste est distincte de celle de la partie
  // affichée : sur l'accueil d'une partie reprenable, il faut pouvoir en armer
  // une autre pour la partie suivante sans détruire celle qu'on propose de
  // reprendre. C'est le bouton qui applique, jamais la sélection.
  let selectedPresetId = presetById(journal.timeControl.id).id

  // R11 : instant du premier appui sur le reset. Comme le flash de R12, l'état
  // armé se dérive du temps écoulé plutôt que d'un `setTimeout` — un undo, une
  // reprise ou une fermeture ne laissent donc aucun minuteur orphelin.
  let resetArmedAt: number | null = null

  const isResetArmed = (now: number): boolean =>
    resetArmedAt !== null && now - resetArmedAt >= 0 && now - resetArmedAt < RESET_ARM_MS

  /** R25 : le journal est persisté au fil de la partie, après chaque événement. */
  const commit = (next: Journal | null): boolean => {
    if (next === null) return false
    journal = next
    saveJournal(store, journal)
    return true
  }

  // Interroge la commande elle-même plutôt que de redire ses conditions : le
  // bouton est grisé exactement quand l'undo serait refusé.
  const canUndo = (now: number): boolean => undo(journal, now) !== null

  // Ne lance jamais l'horloge : R8 veut que ce soit le premier tap des Noirs, sur
  // la moitié adverse, qui décide de l'orientation des deux camps.
  const startNewGame = (): void => {
    journal = newJournal(presetById(selectedPresetId))
    clearJournal(store)
    saveLastPresetId(store, journal.timeControl.id)
    overlay = 'none'
    resetArmedAt = null
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
    if (overlay === 'none') commit(undo(journal, clock.now()))
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
      overlay = 'home'
    }
  })

  // ---------- Écran de pause (R11, R15, R28, R29, R30) ----------

  el.resumeButton.addEventListener('click', () => {
    // Une partie fermée alors qu'elle tournait n'a pas d'événement `pause` :
    // `resume` rend alors `null` et il n'y a qu'à refermer l'écran.
    commit(resume(journal, clock.now()))
    overlay = 'none'
    resetArmedAt = null
    note = ''
  })

  el.resetButton.addEventListener('click', () => {
    const now = clock.now()
    // R11 : l'accueil est le seul écran qui s'ouvre de lui-même, donc le seul où
    // un unique appui pourrait jeter une partie non close sans qu'on l'ait voulu.
    // Ailleurs, avoir ouvert l'écran est déjà le premier geste.
    const needsArming = overlay === 'home' && canResume(fold(journal, now))
    if (!needsArming || isResetArmed(now)) {
      startNewGame()
      return
    }
    resetArmedAt = now
  })

  el.presetSelect.addEventListener('change', () => {
    selectedPresetId = presetById(el.presetSelect.value).id
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
        canUndo: canUndo(now),
        canExport: journal.events.length > 0,
        presets: PRESETS,
        selectedPresetId,
        resetArmed: isResetArmed(now),
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

  // `pageshow` est indispensable en regard de `pagehide` : une restauration
  // depuis le bfcache ne passe pas forcément par `visibilitychange`, et la
  // boucle resterait alors arrêtée. L'écran garderait la dernière frame rendue
  // pendant que l'état, lui, continue de courir — la pendule mentirait.
  const onPageShow = (): void => startLoop()

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', stopLoop)
  window.addEventListener('pageshow', onPageShow)

  draw()
  startLoop()

  return {
    draw,
    dispose(): void {
      stopLoop()
      wakeLock.dispose()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', stopLoop)
      window.removeEventListener('pageshow', onPageShow)
    },
  }
}

import { TENTHS_BELOW_MS, URGENT_BELOW_MS, formatRemaining } from './format'
import type { Half, TimeControl, View } from '../domain/types'

/**
 * R12 : durée de la confirmation visuelle donnée au cédant. Assez longue pour
 * être captée en vision périphérique alors que la main repart vers les pièces,
 * assez courte pour ne pas masquer l'état de repos du cadran.
 */
export const CONFIRM_FLASH_MS = 220

export type OverlayMode = 'none' | 'settings' | 'pause' | 'resume' | 'over'

export type UiModel = {
  readonly view: View
  readonly overlay: OverlayMode
  readonly silent: boolean
  readonly canUndo: boolean
  readonly canExport: boolean
  readonly presets: readonly TimeControl[]
  readonly selectedPresetId: string
  readonly note: string
}

export type Elements = {
  readonly halves: Readonly<Record<Half, HTMLElement>>
  readonly clocks: Readonly<Record<Half, HTMLElement>>
  readonly undoButton: HTMLButtonElement
  readonly menuButton: HTMLButtonElement
  readonly overlay: HTMLElement
  readonly overlayTitle: HTMLElement
  readonly overlayHint: HTMLElement
  readonly overlayNote: HTMLElement
  readonly presetField: HTMLElement
  readonly presetSelect: HTMLSelectElement
  readonly silentToggle: HTMLInputElement
  readonly resumeButton: HTMLButtonElement
  readonly closeButton: HTMLButtonElement
  readonly exportButton: HTMLButtonElement
  readonly resetButton: HTMLButtonElement
}

function required<T extends HTMLElement>(root: ParentNode, id: string): T {
  const element = root.querySelector<T>(`#${id}`)
  if (element === null) throw new Error(`élément #${id} absent du document`)
  return element
}

export function queryElements(root: ParentNode = document): Elements {
  return {
    halves: {
      top: required(root, 'half-top'),
      bottom: required(root, 'half-bottom'),
    },
    clocks: {
      top: required(root, 'clock-top'),
      bottom: required(root, 'clock-bottom'),
    },
    undoButton: required<HTMLButtonElement>(root, 'undo-button'),
    menuButton: required<HTMLButtonElement>(root, 'menu-button'),
    overlay: required(root, 'overlay'),
    overlayTitle: required(root, 'overlay-title'),
    overlayHint: required(root, 'overlay-hint'),
    overlayNote: required(root, 'overlay-note'),
    presetField: required(root, 'preset-field'),
    presetSelect: required<HTMLSelectElement>(root, 'preset-select'),
    silentToggle: required<HTMLInputElement>(root, 'silent-toggle'),
    resumeButton: required<HTMLButtonElement>(root, 'resume-button'),
    closeButton: required<HTMLButtonElement>(root, 'close-button'),
    exportButton: required<HTMLButtonElement>(root, 'export-button'),
    resetButton: required<HTMLButtonElement>(root, 'reset-button'),
  }
}

/**
 * R12 : dérivé de `now - lastTapAt`, jamais d'un `setTimeout` (KTD7). Un undo,
 * une pause ou une reprise ne laissent donc aucun minuteur orphelin à annuler.
 */
export const isConfirming = (view: View, half: Half, now: number): boolean =>
  view.lastTapHalf === half &&
  view.lastTapAt !== null &&
  now - view.lastTapAt >= 0 &&
  now - view.lastTapAt < CONFIRM_FLASH_MS

export function halfState(view: View, half: Half, now: number): readonly string[] {
  if (view.flagged === half) return ['is-flagged']
  if (isConfirming(view, half, now)) return ['is-confirming']
  if (view.running !== half) return []
  return view.remaining[half] < URGENT_BELOW_MS ? ['is-running', 'is-urgent'] : ['is-running']
}

const OVERLAY_TEXT: Record<Exclude<OverlayMode, 'none'>, { title: string; hint: string }> = {
  settings: {
    title: 'myChess',
    hint: 'Les Noirs lancent la pendule en tapant la moitié située du côté de leur adversaire.',
  },
  pause: {
    title: 'Pause',
    hint: 'Le temps est arrêté des deux côtés.',
  },
  resume: {
    title: 'Partie en cours',
    hint: 'Une partie n’était pas terminée. La reprendre restitue l’état exact, temps écoulé pendant l’absence compris.',
  },
  over: {
    // R18 : on explique pourquoi rien n'est attribué, sans rien attribuer.
    title: 'Drapeau tombé',
    hint: 'La pendule le constate et s’arrête là. Elle ne voit pas l’échiquier : selon l’article 6.9 des règles FIDE, la partie peut être nulle malgré la chute.',
  },
}

function syncPresets(select: HTMLSelectElement, presets: readonly TimeControl[]): void {
  if (select.options.length === presets.length) return
  select.replaceChildren(
    ...presets.map((preset) => new Option(preset.label, preset.id)),
  )
}

const toggleClass = (element: HTMLElement, name: string, on: boolean): void => {
  if (element.classList.contains(name) !== on) element.classList.toggle(name, on)
}

/**
 * Idempotent par construction : ne crée aucun nœud, ne met à jour que du texte,
 * des classes et des attributs. Appelé à chaque frame par la boucle de redessin,
 * il ne détient aucun état de temps (R21).
 */
export function render(el: Elements, model: UiModel, now: number): void {
  const { view } = model

  for (const half of ['top', 'bottom'] as const) {
    const states = halfState(view, half, now)
    for (const name of ['is-running', 'is-urgent', 'is-flagged', 'is-confirming']) {
      toggleClass(el.halves[half], name, states.includes(name))
    }

    const text = formatRemaining(view.remaining[half])
    if (el.clocks[half].textContent !== text) el.clocks[half].textContent = text
    // Le dixième change dix fois par seconde : l'annoncer en continu rendrait
    // un lecteur d'écran inutilisable.
    el.clocks[half].setAttribute(
      'aria-live',
      view.remaining[half] < TENTHS_BELOW_MS ? 'off' : 'polite',
    )
  }

  el.undoButton.disabled = !model.canUndo
  el.menuButton.disabled = model.overlay !== 'none'

  const open = model.overlay !== 'none'
  el.overlay.hidden = !open
  if (!open) return

  const text = OVERLAY_TEXT[model.overlay]
  el.overlayTitle.textContent = text.title
  el.overlayHint.textContent = text.hint
  el.overlayNote.textContent = model.note

  const cadenceEditable = model.overlay === 'settings' || model.overlay === 'over'
  el.presetField.hidden = false
  el.presetSelect.disabled = !cadenceEditable
  syncPresets(el.presetSelect, model.presets)
  if (el.presetSelect.value !== model.selectedPresetId) {
    el.presetSelect.value = model.selectedPresetId
  }

  el.silentToggle.checked = model.silent

  el.resumeButton.hidden = model.overlay !== 'pause' && model.overlay !== 'resume'
  el.resumeButton.textContent =
    model.overlay === 'resume' ? 'Reprendre la partie' : 'Reprendre'
  el.closeButton.hidden = model.overlay !== 'settings'
  el.exportButton.hidden = !model.canExport
  // R11 : le reset ne vit que sur cet écran, donc jamais atteignable en un geste.
  el.resetButton.hidden = model.overlay === 'settings'
  el.resetButton.textContent = 'Nouvelle partie'
}

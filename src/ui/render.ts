import { TENTHS_BELOW_MS, formatRemaining } from './format'
import { URGENT_BELOW_MS } from '../domain/types'
import { CUSTOM_ID } from '../presets/custom'
import type { CustomDraft } from '../presets/custom'
import type { Half, TimeControl, View } from '../domain/types'

/**
 * R12 : durée de la confirmation visuelle donnée au cédant. Assez longue pour
 * être captée en vision périphérique alors que la main repart vers les pièces,
 * assez courte pour ne pas masquer l'état de repos du cadran.
 */
export const CONFIRM_FLASH_MS = 220

/**
 * `home` est l'écran d'accueil : il s'ouvre au lancement, propose la cadence et
 * — quand une partie n'est pas close — sa reprise. C'est le même écran dans les
 * deux cas ; seuls le texte et la présence du bouton de reprise changent, et ils
 * se déduisent de la phase. Deux modes distincts obligeraient à les tenir en
 * accord à la main.
 */
export type OverlayMode = 'none' | 'home' | 'pause' | 'over'

export type UiModel = {
  readonly view: View
  readonly overlay: OverlayMode
  readonly silent: boolean
  readonly canUndo: boolean
  readonly canExport: boolean
  readonly presets: readonly TimeControl[]
  readonly selectedPresetId: string
  /** La saisie manuelle en cours ; n'est affichée que sous l'entrée `custom`. */
  readonly custom: CustomDraft
  /** Ce qui empêche la saisie manuelle de produire une cadence, s'il y a lieu. */
  readonly customError: string | null
  /** R11 : le reset a été armé, le prochain appui abandonne réellement la partie. */
  readonly resetArmed: boolean
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
  readonly customFields: HTMLElement
  readonly customTimeField: HTMLElement
  readonly customMinutes: HTMLInputElement
  readonly customHandicap: HTMLInputElement
  readonly customHandicapFields: HTMLElement
  readonly customWhite: HTMLInputElement
  readonly customBlack: HTMLInputElement
  readonly customIncrement: HTMLInputElement
  readonly customModes: Readonly<Record<'fischer' | 'bronstein', HTMLInputElement>>
  readonly silentToggle: HTMLInputElement
  readonly resumeButton: HTMLButtonElement
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
    customFields: required(root, 'custom-fields'),
    customTimeField: required(root, 'custom-time-field'),
    customMinutes: required<HTMLInputElement>(root, 'custom-minutes'),
    customHandicap: required<HTMLInputElement>(root, 'custom-handicap'),
    customHandicapFields: required(root, 'custom-handicap-fields'),
    customWhite: required<HTMLInputElement>(root, 'custom-white'),
    customBlack: required<HTMLInputElement>(root, 'custom-black'),
    customIncrement: required<HTMLInputElement>(root, 'custom-increment'),
    customModes: {
      fischer: required<HTMLInputElement>(root, 'custom-mode-fischer'),
      bronstein: required<HTMLInputElement>(root, 'custom-mode-bronstein'),
    },
    silentToggle: required<HTMLInputElement>(root, 'silent-toggle'),
    resumeButton: required<HTMLButtonElement>(root, 'resume-button'),
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

/**
 * Une partie est reprenable tant qu'elle a commencé sans être close. C'est la
 * seule chose qui distingue les deux visages de l'écran d'accueil, et elle se
 * lit dans la vue — aucun drapeau parallèle à tenir à jour.
 */
export const canResume = (view: View): boolean =>
  view.phase === 'running' || view.phase === 'paused'

/**
 * R11 : fenêtre pendant laquelle le reset reste armé. Assez longue pour lire le
 * nouveau libellé et appuyer sans se presser, assez courte pour qu'un écran
 * laissé ouvert ne garde pas un bouton destructeur amorcé.
 */
export const RESET_ARM_MS = 4_000

const HOME_FRESH = {
  title: 'myChess',
  hint: 'Choisissez la cadence. Les Noirs lancent ensuite la pendule en tapant la moitié située du côté de leur adversaire.',
}

const HOME_RESUMABLE = {
  title: 'Partie en cours',
  hint: 'Une partie n’était pas terminée. La reprendre restitue l’état exact, temps écoulé pendant l’absence compris ; en commencer une nouvelle l’abandonne.',
}

const overlayText = (
  overlay: Exclude<OverlayMode, 'none'>,
  resumable: boolean,
): { title: string; hint: string } => {
  if (overlay === 'home') return resumable ? HOME_RESUMABLE : HOME_FRESH
  if (overlay === 'pause') return { title: 'Pause', hint: 'Le temps est arrêté des deux côtés.' }
  // R18 : on explique pourquoi rien n'est attribué, sans rien attribuer.
  return {
    title: 'Drapeau tombé',
    hint: 'La pendule le constate et s’arrête là. Elle ne voit pas l’échiquier : selon l’article 6.9 des règles FIDE, la partie peut être nulle malgré la chute.',
  }
}

/**
 * L'entrée manuelle ferme toujours la liste : elle n'est pas une cadence parmi
 * les autres mais la porte de sortie du catalogue, et la chercher au milieu des
 * presets coûterait un aller-retour de lecture avant chaque partie.
 */
export const CUSTOM_OPTION_LABEL = 'Personnalisée…'

function syncPresets(select: HTMLSelectElement, presets: readonly TimeControl[]): void {
  if (select.options.length === presets.length + 1) return
  select.replaceChildren(
    ...presets.map((preset) => new Option(preset.label, preset.id)),
    new Option(CUSTOM_OPTION_LABEL, CUSTOM_ID),
  )
}

/**
 * Ne réécrit jamais un champ que le doigt est en train de remplir. Effacer pour
 * retaper laisse le champ transitoirement vide — donc invalide — et le repeupler
 * à la frame suivante le rendrait impossible à corriger. Le rendu reste
 * idempotent : il est fonction de l'état *et* du champ qui a le focus.
 */
function setNumberField(input: HTMLInputElement, value: number): void {
  if (input.ownerDocument.activeElement === input) return
  const text = Number.isFinite(value) ? String(value) : ''
  if (input.value !== text) input.value = text
}

function renderCustomFields(el: Elements, model: UiModel): void {
  const open = model.selectedPresetId === CUSTOM_ID
  el.customFields.hidden = !open
  if (!open) return

  const draft = model.custom

  // Le champ unique et la paire par couleur ne coexistent jamais : deux temps
  // affichés en même temps ne diraient pas lequel s'applique.
  el.customHandicap.checked = draft.handicap
  el.customTimeField.hidden = draft.handicap
  el.customHandicapFields.hidden = !draft.handicap

  setNumberField(el.customMinutes, draft.minutes)
  setNumberField(el.customWhite, draft.whiteMinutes)
  setNumberField(el.customBlack, draft.blackMinutes)
  setNumberField(el.customIncrement, draft.incrementSeconds)

  el.customModes.fischer.checked = draft.mode === 'fischer'
  el.customModes.bronstein.checked = draft.mode === 'bronstein'
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

  // Le même bouton ouvre la pause pendant la partie et les réglages avant : le
  // glyphe ❚❚ annoncerait une pause là où il n'y a rien à arrêter. Un mot lève
  // l'ambiguïté ; ❚❚ ne revient qu'une fois la pendule lancée, où il est lu sans
  // hésitation et doit rester discret.
  const running = view.phase === 'running'
  const menuLabel = running ? 'Pause' : 'Réglages'
  if (el.menuButton.textContent !== (running ? '❚❚' : menuLabel)) {
    el.menuButton.textContent = running ? '❚❚' : menuLabel
  }
  if (el.menuButton.getAttribute('aria-label') !== menuLabel) {
    el.menuButton.setAttribute('aria-label', menuLabel)
  }
  toggleClass(el.menuButton, 'band-button--wide', running)

  const open = model.overlay !== 'none'
  el.overlay.hidden = !open
  if (!open) return

  const resumable = canResume(view)
  const text = overlayText(model.overlay, resumable)
  el.overlayTitle.textContent = text.title
  el.overlayHint.textContent = text.hint

  // Ce qui empêche d'ouvrir une partie passe devant tout le reste : la note
  // ordinaire (journal copié, sauvegarde ignorée) n'attend pas de geste.
  el.overlayNote.textContent = model.customError ?? model.note
  toggleClass(el.overlayNote, 'is-error', model.customError !== null)

  // La cadence reste choisissable en toutes circonstances : la sélection n'est
  // qu'un choix armé, c'est « Nouvelle partie » qui l'applique. Un select grisé
  // rendait le bouton menteur — il proposait une nouvelle partie sans laisser en
  // régler la cadence.
  el.presetField.hidden = false
  syncPresets(el.presetSelect, model.presets)
  if (el.presetSelect.value !== model.selectedPresetId) {
    el.presetSelect.value = model.selectedPresetId
  }
  renderCustomFields(el, model)

  el.silentToggle.checked = model.silent

  // Rien à reprendre sur un drapeau tombé (R17) ni sur une pendule jamais lancée.
  el.resumeButton.hidden = !resumable
  el.resumeButton.textContent = model.overlay === 'home' ? 'Reprendre la partie' : 'Reprendre'
  el.exportButton.hidden = !model.canExport

  // R11 : le reset ne vit que sur cet écran, et abandonner une partie non close y
  // demande un second appui — l'accueil s'ouvrant seul au lancement, un unique
  // geste suffirait sinon à jeter la partie en cours.
  el.resetButton.hidden = false
  // Une saisie qui ne produit pas de cadence ne doit pas pouvoir ouvrir une
  // partie : on refuse et on dit pourquoi, plutôt que de corriger dans le dos.
  el.resetButton.disabled = model.customError !== null
  el.resetButton.textContent = model.resetArmed
    ? 'Confirmer l’abandon'
    : resumable
      ? 'Nouvelle partie'
      : 'Commencer'
  toggleClass(el.resetButton, 'is-armed', model.resetArmed)
}

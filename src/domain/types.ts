/**
 * La pendule ne connaît pas les échecs : elle connaît deux moitiés physiques de
 * l'écran. Le rattachement Blancs/Noirs se déduit du seul événement `start`
 * (R8) et ne sert qu'à choisir le temps initial de chaque joueur (R4).
 */
export type Half = 'top' | 'bottom'

export type IncrementMode = 'fischer' | 'bronstein'

export type AlertLevelId = 'minute' | 'half-minute' | 'urgent'

export type AlertLevel = {
  readonly id: AlertLevelId
  readonly belowMs: number
}

/**
 * R33 : les paliers de rappel, du moins urgent au plus urgent. Ils vivent dans
 * le domaine parce que deux couches indépendantes en dépendent — la signature
 * sonore (R13) et la bascule visuelle — et qu'elles doivent franchir le même
 * seuil au même instant.
 *
 * C'est un catalogue et non une suite de conditions : un palier est une donnée,
 * jamais une branche de plus dans le rendu et une autre dans l'audio.
 */
export const ALERT_LEVELS: readonly AlertLevel[] = [
  { id: 'minute', belowMs: 60_000 },
  { id: 'half-minute', belowMs: 30_000 },
  { id: 'urgent', belowMs: 10_000 },
]

/**
 * Durée minimale réellement consommée pour qu'un tap compte comme la fin d'un
 * coup. Le téléphone est posé à plat : une paume qui roule d'une moitié à
 * l'autre produit deux `pointerdown` valides à quelques dizaines de
 * millisecondes d'écart, et le second offrirait à l'adversaire l'incrément d'un
 * coup qu'il n'a pas joué.
 *
 * Ce n'est pas la taxe du double-tap que R24 écarte : elle coûte un tempo à
 * *chaque* coup, alors qu'aucun coup humain — pièce déplacée puis pendule
 * frappée — ne tient sous ce seuil, même en bullet. Valeur à confirmer au doigt.
 */
export const TAP_GUARD_MS = 120

export const otherHalf = (half: Half): Half => (half === 'top' ? 'bottom' : 'top')

/**
 * R4 : le temps initial est stocké par joueur, pas globalement, même si aucune
 * interface ne permet de les régler séparément en v1. Un handicap se réduit
 * alors à exposer un champ, jamais à migrer un schéma.
 */
export type InitialTimes = {
  readonly white: number
  readonly black: number
}

export type TimeControl = {
  readonly id: string
  readonly label: string
  readonly mode: IncrementMode
  readonly initialMs: InitialTimes
  readonly incrementMs: number
}

/**
 * R19 : l'état d'une partie est ce journal, et rien d'autre. Pas d'événement de
 * fin : la chute du drapeau est dérivée par le fold, jamais écrite (KTD6).
 * Tous les horodatages sont des entiers de millisecondes epoch (R23).
 */
export type ClockEvent =
  | { readonly type: 'start'; readonly at: number; readonly whiteHalf: Half }
  | { readonly type: 'tap'; readonly at: number; readonly half: Half }
  | { readonly type: 'pause'; readonly at: number }
  | { readonly type: 'resume'; readonly at: number }

export type Journal = {
  readonly version: 1
  readonly timeControl: TimeControl
  readonly events: readonly ClockEvent[]
}

export type Phase = 'idle' | 'running' | 'paused' | 'flagged'

/**
 * Tout ce qui s'affiche (R20), dérivé du journal par `fold`. Aucun champ de
 * résultat de partie : la pendule constate, elle n'arbitre pas (R18).
 */
export type View = {
  readonly phase: Phase
  readonly remaining: Readonly<Record<Half, number>>
  readonly running: Half | null
  readonly flagged: Half | null
  readonly whiteHalf: Half | null
  /** Le cédant du dernier coup et l'instant où il a rendu la main — R12. */
  readonly lastTapAt: number | null
  readonly lastTapHalf: Half | null
  readonly elapsedThisMove: number
  /**
   * R34 : le palier de rappel atteint par chaque moitié, ou `null`. Il se lit
   * sur le temps le plus bas jamais atteint et non sur le temps courant — un
   * palier franchi ne se relâche jamais, même quand l'incrément fait remonter
   * au-dessus du seuil.
   */
  readonly alert: Readonly<Record<Half, AlertLevelId | null>>
  readonly mode: IncrementMode
  readonly incrementMs: number
}

export const JOURNAL_VERSION = 1 as const

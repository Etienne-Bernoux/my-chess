/**
 * Hors R1–R30 (KTD8, décidé en session) : sans verrou, l'écran s'éteint pendant
 * une réflexion longue et le critère de fin de SPECS — une partie réelle jouée
 * du début à la fin — n'est pas atteignable. Isolé dans son propre module pour
 * rester retirable en une suppression d'import.
 */

/**
 * Sous-ensemble de `WakeLockSentinel` réellement utilisé — donc simulable.
 * `released` en fait partie : le navigateur relâche le verrou de son propre chef
 * (batterie faible, écran éteint au bouton, politique constructeur), et sans ce
 * drapeau on garderait indéfiniment un verrou mort en croyant le tenir.
 */
export interface WakeLockHandle {
  readonly released: boolean
  release(): Promise<void>
}

export type WakeLockRequester = () => Promise<WakeLockHandle>

export interface ScreenWakeLock {
  /** Idempotent : appelé à chaque frame avec l'état voulu. */
  setDesired(on: boolean): void
  dispose(): void
}

export function resolveRequester(): WakeLockRequester | null {
  const wakeLock = globalThis.navigator?.wakeLock
  if (wakeLock === undefined) return null
  return () => wakeLock.request('screen')
}

export function createWakeLock(
  requester: WakeLockRequester | null = resolveRequester(),
): ScreenWakeLock {
  let desired = false
  let handle: WakeLockHandle | null = null
  let pending = false
  // Une demande refusée n'est pas retentée à chaque frame : on attend un
  // changement d'état réel, sinon un appareil en batterie faible passerait la
  // partie à redemander un verrou qu'il ne donnera pas.
  let refused = false

  const sync = (): void => {
    if (requester === null) return

    // Un verrou relâché par le navigateur est un verrou perdu, pas un verrou tenu.
    if (handle?.released === true) handle = null

    if (desired && handle === null && !pending && !refused && !document.hidden) {
      pending = true
      requester().then(
        (acquired) => {
          pending = false
          // La partie a pu se mettre en pause pendant la promesse.
          if (desired) handle = acquired
          else void acquired.release()
        },
        () => {
          // Verrou refusé (batterie faible, permission) : c'est un confort, pas
          // un prérequis. On n'insiste pas et la pendule reste juste.
          pending = false
          refused = true
        },
      )
      return
    }

    if (!desired && handle !== null) {
      const released = handle
      handle = null
      void released.release().catch(() => {})
    }
  }

  // Le navigateur relâche lui-même le verrou quand l'onglet passe en
  // arrière-plan : on oublie le nôtre et on le redemande au retour.
  const onVisibilityChange = (): void => {
    if (document.hidden) handle = null
    sync()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  return {
    setDesired(on: boolean): void {
      if (on !== desired) {
        desired = on
        refused = false
      }
      // Appelé sans court-circuit même à état inchangé : c'est ce qui permet de
      // récupérer un verrou que le navigateur a relâché sous nous en pleine partie.
      sync()
    },

    dispose(): void {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      desired = false
      sync()
    },
  }
}

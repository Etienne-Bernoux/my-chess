/**
 * Au-dessus du seuil, `m:ss` ; en dessous, les dixièmes. Le dixième n'apparaît
 * que là où il sert : plus tôt il distrait, plus tard on ne le voit pas arriver.
 */
export const TENTHS_BELOW_MS = 20_000

/** Seuil des dix dernières secondes — signature sonore et bascule visuelle (R13). */
export const URGENT_BELOW_MS = 10_000

export function formatRemaining(ms: number): string {
  // Le fold garantit des entiers positifs (R23) ; ce garde-fou protège de
  // l'affichage d'un `NaN` si un appelant se trompe, pas d'un bug du domaine.
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0

  if (safe >= TENTHS_BELOW_MS) {
    const totalSeconds = Math.floor(safe / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }

  const tenths = Math.floor(safe / 100)
  return `${Math.floor(tenths / 10)}.${tenths % 10}`
}

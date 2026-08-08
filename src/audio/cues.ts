import { URGENT_BELOW_MS } from '../ui/format'
import type { View } from '../domain/types'

/** R13 : deux signatures sonores distinctes, pas deux variantes du même bip. */
export type Cue = 'urgent' | 'flag'

export interface AudioSink {
  /** R14 : l'API exige un geste utilisateur pour démarrer l'audio. */
  arm(): void
  play(cue: Cue): void
}

/**
 * KTD7 : la transition entre la vue précédente et la vue courante est le seul
 * déclencheur. Aucun `setTimeout` audio à armer, donc rien à annuler sur un
 * undo, une pause ou une reprise — la cohérence est gratuite.
 *
 * Le franchissement du seuil compte même s'il a eu lieu « dans le passé »,
 * pendant que l'application était en arrière-plan : la comparaison porte sur
 * deux vues, pas sur l'écoulement réel du temps.
 */
export function cueForTransition(previous: View | null, current: View): Cue | null {
  if (previous === null) return null

  // La chute prime : passer de trente secondes au drapeau en une seule
  // transition ne doit pas produire aussi le signal des dix secondes.
  if (previous.flagged === null && current.flagged !== null) return 'flag'

  const running = current.running
  if (running === null) return null

  const before = previous.remaining[running]
  const after = current.remaining[running]
  return before >= URGENT_BELOW_MS && after < URGENT_BELOW_MS ? 'urgent' : null
}

/** Sink neutre : mode silencieux (R15), environnement sans Web Audio, tests. */
export const silentSink: AudioSink = {
  arm: () => {},
  play: () => {},
}

type ToneSpec = {
  readonly at: number
  readonly durationS: number
  readonly fromHz: number
  readonly toHz: number
  readonly type: OscillatorType
  readonly peak: number
}

// Deux timbres franchement différents : un doublet bref et haut pour l'entrée
// dans les dix dernières secondes, un son grave et descendant pour la chute.
const SIGNATURES: Record<Cue, readonly ToneSpec[]> = {
  urgent: [
    { at: 0, durationS: 0.07, fromHz: 1_320, toHz: 1_320, type: 'square', peak: 0.22 },
    { at: 0.13, durationS: 0.07, fromHz: 1_320, toHz: 1_320, type: 'square', peak: 0.22 },
  ],
  flag: [{ at: 0, durationS: 0.55, fromHz: 420, toHz: 130, type: 'triangle', peak: 0.32 }],
}

export function createWebAudioCues(
  createContext: () => AudioContext = () => new AudioContext(),
): AudioSink {
  let context: AudioContext | null = null

  const ensure = (): AudioContext | null => {
    if (context === null) {
      try {
        context = createContext()
      } catch {
        // Pas de Web Audio disponible : la pendule reste parfaitement utilisable.
        return null
      }
    }
    if (context.state === 'suspended') void context.resume()
    return context
  }

  return {
    arm(): void {
      ensure()
    },

    play(cue: Cue): void {
      // Jamais de son avant le premier geste utilisateur : hors d'un geste, la
      // Web Audio ne démarrerait pas de toute façon (R14).
      if (context === null) return
      const ctx = ensure()
      if (ctx === null) return

      const now = ctx.currentTime
      for (const spec of SIGNATURES[cue]) {
        const start = now + spec.at
        const end = start + spec.durationS

        const oscillator = ctx.createOscillator()
        oscillator.type = spec.type
        oscillator.frequency.setValueAtTime(spec.fromHz, start)
        if (spec.toHz !== spec.fromHz) {
          oscillator.frequency.exponentialRampToValueAtTime(spec.toHz, end)
        }

        // Enveloppe : sans elle, couper l'oscillateur net produit un clic.
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(spec.peak, start + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, end)

        oscillator.connect(gain).connect(ctx.destination)
        oscillator.start(start)
        oscillator.stop(end + 0.02)
      }
    },
  }
}

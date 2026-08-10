import { SIGNATURES } from './signatures'
import { ALERT_LEVELS } from '../domain/types'
import type { Cue } from './signatures'
import type { AlertLevelId, Half, View } from '../domain/types'

export type { Cue } from './signatures'

export interface AudioSink {
  /** R14 : l'API exige un geste utilisateur pour démarrer l'audio. */
  arm(): void
  play(cue: Cue): void
}

const HALVES: readonly Half[] = ['top', 'bottom']

/**
 * KTD7 : la transition entre la vue précédente et la vue courante est le seul
 * déclencheur. Aucun `setTimeout` audio à armer, donc rien à annuler sur un
 * undo, une pause ou une reprise — la cohérence est gratuite.
 *
 * Le franchissement compte même s'il a eu lieu « dans le passé », pendant que
 * l'application était en arrière-plan : la comparaison porte sur deux vues, pas
 * sur l'écoulement réel du temps.
 *
 * Les DEUX moitiés sont examinées, pas seulement celle qui tourne : quand le
 * franchissement tombe dans la même frame que le tap, la moitié concernée vient
 * de s'arrêter.
 */
export function cueForTransition(previous: View | null, current: View): Cue | null {
  if (previous === null) return null

  // La chute prime : passer de trente secondes au drapeau en une seule
  // transition ne doit pas produire aussi le signal des dix secondes.
  if (previous.flagged === null && current.flagged !== null) return 'flag'

  const crossed = HALVES.map((half) => changedTo(previous, current, half))

  // Le plus urgent parle, et lui seul. Un retour d'arrière-plan de vingt minutes
  // franchit les trois paliers d'un coup : trois bips empilés diraient moins que
  // le seul qui compte. R34 rend l'ordre suffisant — un palier ne se relâchant
  // jamais, il n'est franchi qu'une fois par partie.
  let cue: AlertLevelId | null = null
  for (const level of ALERT_LEVELS) {
    if (crossed.includes(level.id)) cue = level.id
  }
  return cue
}

const changedTo = (previous: View, current: View, half: Half): AlertLevelId | null => {
  const reached = current.alert[half]
  return reached !== null && reached !== previous.alert[half] ? reached : null
}

/** Sink neutre : mode silencieux (R15), environnement sans Web Audio, tests. */
export const silentSink: AudioSink = {
  arm: () => {},
  play: () => {},
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

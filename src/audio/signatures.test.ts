import { describe, expect, it } from 'vitest'
import { CUES, SIGNATURES, parseSignatures } from './signatures'

const tone = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  at: 0,
  durationS: 0.08,
  fromHz: 880,
  toHz: 880,
  type: 'sine',
  peak: 0.2,
  ...over,
})

const withSignatures = (over: Record<string, unknown> = {}): unknown => ({
  version: 1,
  signatures: Object.fromEntries(CUES.map((cue) => [cue, [tone()]])),
  ...over,
})

const allBut = (missing: string): Record<string, unknown> =>
  Object.fromEntries(CUES.filter((cue) => cue !== missing).map((cue) => [cue, [tone()]]))

describe('sounds.json — le fichier livré', () => {
  it('couvre exactement les signaux attendus, paliers compris', () => {
    expect(Object.keys(SIGNATURES).sort()).toEqual([...CUES].sort())
    for (const cue of CUES) expect(SIGNATURES[cue].length).toBeGreaterThan(0)
  })

  it('monte en tonalité d’un palier au suivant', () => {
    // R33 : ce qui distingue les paliers à l'oreille est la hauteur, pas un
    // timbre à mémoriser. La règle vaut pour la donnée, pas seulement le code.
    const pitch = (cue: 'minute' | 'half-minute' | 'urgent'): number => SIGNATURES[cue][0]!.fromHz
    expect(pitch('minute')).toBeLessThan(pitch('half-minute'))
    expect(pitch('half-minute')).toBeLessThan(pitch('urgent'))
  })

  it('garde la chute franchement plus grave que le dernier palier', () => {
    expect(SIGNATURES['flag'][0]!.fromHz).toBeLessThan(SIGNATURES['urgent'][0]!.fromHz)
  })
})

describe('parseSignatures — un fichier invalide est une erreur de développement (R29, R35)', () => {
  it('accepte le fichier bien formé', () => {
    expect(() => parseSignatures(withSignatures())).not.toThrow()
  })

  it('refuse une version non supportée', () => {
    expect(() => parseSignatures(withSignatures({ version: 2 }))).toThrow(/version/)
  })

  it('refuse un palier sans signature', () => {
    expect(() => parseSignatures(withSignatures({ signatures: allBut('half-minute') }))).toThrow(
      /half-minute/,
    )
  })

  it('refuse une signature vide', () => {
    const signatures = { ...allBut('urgent'), urgent: [] }
    expect(() => parseSignatures(withSignatures({ signatures }))).toThrow(/urgent/)
  })

  it('refuse une clé inconnue plutôt que de l’ignorer', () => {
    // Une signature mal orthographiée se réglerait sinon sur rien, et le palier
    // resterait muet sans que rien ne le dise.
    const signatures = { ...allBut(''), 'half-minutes': [tone()] }
    expect(() => parseSignatures(withSignatures({ signatures }))).toThrow(/half-minutes/)
  })

  it('refuse les valeurs que les rampes de la Web Audio rejetteraient à la lecture', () => {
    for (const broken of [{ fromHz: 0 }, { toHz: 0 }, { peak: 0 }, { peak: 1.5 }, { durationS: 0 }]) {
      const signatures = { ...allBut('minute'), minute: [tone(broken)] }
      expect(() => parseSignatures(withSignatures({ signatures }))).toThrow(/minute\[0\]/)
    }
  })

  it('refuse un type d’oscillateur inconnu', () => {
    const signatures = { ...allBut('flag'), flag: [tone({ type: 'bruit' })] }
    expect(() => parseSignatures(withSignatures({ signatures }))).toThrow(/type/)
  })
})

import { describe, expect, it } from 'vitest'
import bronsteinGame from './__fixtures__/bronstein-3-2-complete.json'
import pausedGame from './__fixtures__/fischer-5-0-paused.json'
import { parseJournal, serialize } from './codec'
import { fold } from '../domain/fold'

/**
 * R28 : un journal exporté se rejoue tel quel comme cas de test. Un bug de
 * pendule survient au club, loin du poste de développement, et n'est jamais
 * reproductible de mémoire — c'est le seul moyen d'en faire une régression
 * vérifiable. Ce fichier est la démonstration que le mécanisme fonctionne.
 */
describe('rejeu d’un journal exporté (R28)', () => {
  const parsed = parseJournal(bronsteinGame)

  it('le journal exporté est lisible tel quel', () => {
    expect(parsed.ok).toBe(true)
  })

  it('rejoué, il rend les temps attendus', () => {
    if (!parsed.ok) throw new Error('fixture illisible')
    const v = fold(parsed.journal, 59_500)

    // Blancs : 24 500 consommés, gains Bronstein 2000+2000+500+2000+2000 = 8 500.
    expect(v.remaining.bottom).toBe(180_000 - 24_500 + 8_500)
    // Noirs : 34 000 consommés, gains 2000+1000+2000+2000+2000 = 9 000.
    expect(v.remaining.top).toBe(180_000 - 34_000 + 9_000)
    expect(v.running).toBe('bottom')
    expect(v.flagged).toBeNull()
  })

  it('le format d’export est exactement le format de stockage', () => {
    if (!parsed.ok) throw new Error('fixture illisible')
    const roundTripped = parseJournal(serialize(parsed.journal))
    expect(roundTripped.ok && roundTripped.journal).toEqual(parsed.journal)
  })

  it('le rejeu est déterministe à des instants arbitraires', () => {
    if (!parsed.ok) throw new Error('fixture illisible')
    for (const at of [1_000, 20_000, 59_500, 120_000]) {
      expect(fold(parsed.journal, at)).toEqual(fold(parsed.journal, at))
    }
  })
})

/**
 * Second journal, délibérément différent du premier : mort subite (incrément
 * nul), pause de soixante secondes à cheval sur un coup, et Blancs en HAUT.
 * Une fixture qui rejouerait la partie déjà couverte ailleurs ne prouverait que
 * son propre chargement.
 */
describe('rejeu d’un second journal, indépendant du premier', () => {
  const parsed = parseJournal(pausedGame)

  it('se relit tel quel', () => {
    expect(parsed.ok).toBe(true)
  })

  it('l’orientation inversée est restituée : les Blancs sont en haut', () => {
    if (!parsed.ok) throw new Error('fixture illisible')
    expect(fold(parsed.journal, 105_000).whiteHalf).toBe('top')
  })

  it('la pause n’est facturée à personne, et l’incrément nul ne rend rien', () => {
    if (!parsed.ok) throw new Error('fixture illisible')
    const v = fold(parsed.journal, 105_000)

    // Blancs (haut) : 12 000 + 5 000 + (2 000 avant la pause + 4 000 après).
    expect(v.remaining.top).toBe(300_000 - 23_000)
    // Noirs (bas) : 8 000 + 3 000 + 10 000.
    expect(v.remaining.bottom).toBe(300_000 - 21_000)
    expect(v.running).toBe('top')
  })

  it('pendant la pause, le temps est gelé quel que soit l’instant observé', () => {
    if (!parsed.ok) throw new Error('fixture illisible')
    // Pour observer un état intermédiaire on tronque le journal — reculer `now`
    // ne remonte pas le temps, le fold applique tous les événements qu'il a.
    const jusquALaPause = {
      ...parsed.journal,
      events: parsed.journal.events.slice(0, 6),
    }

    const debut = fold(jusquALaPause, 31_000)
    const bienPlusTard = fold(jusquALaPause, 600_000)

    expect(debut.phase).toBe('paused')
    expect(bienPlusTard.phase).toBe('paused')
    expect(bienPlusTard.remaining.top).toBe(debut.remaining.top)
    expect(bienPlusTard.remaining.bottom).toBe(debut.remaining.bottom)
  })
})

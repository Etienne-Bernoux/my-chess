/**
 * R22 : la source de temps est injectée et jamais lue en dur. C'est ce qui rend
 * testable une partie de trois heures en quelques millisecondes.
 */
export interface Clock {
  now(): number
}

/**
 * KTD2 : temps mural et non `performance.now()`, qui repart de zéro à chaque
 * chargement de page et ne peut donc pas mesurer une absence (R26). Le plancher
 * entier est appliqué ici, à la frontière, une seule fois — en aval R23 est
 * acquise sans avoir à être revérifiée.
 */
export const systemClock: Clock = {
  now: () => Math.floor(Date.now()),
}

/** Horloge de test : n'avance que quand on le lui demande. */
export class TestClock implements Clock {
  #now: number

  constructor(start = 0) {
    this.#now = Math.floor(start)
  }

  now(): number {
    return this.#now
  }

  set(at: number): void {
    this.#now = Math.floor(at)
  }

  advance(byMs: number): number {
    this.#now += Math.floor(byMs)
    return this.#now
  }
}

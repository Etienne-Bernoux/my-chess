/**
 * R37 : le tirage des couleurs. Il ne touche à rien de la pendule — pas
 * d'événement au journal, pas de temps, aucune influence sur l'orientation, qui
 * reste déduite du seul premier tap (R8). C'est un pion caché dans le poing, en
 * numérique, et rien d'autre.
 */
export type DrawnSide = 'white' | 'black'

/**
 * La source d'aléa est injectée, comme l'est l'horloge (R22) et pour la même
 * raison : un tirage non injecté ne se teste pas, on ne peut que le regarder
 * tomber du bon côté quelques fois et espérer.
 */
export type Random = () => number

export const drawSide = (random: Random): DrawnSide => (random() < 0.5 ? 'white' : 'black')

---
title: "Un delta plafonné ne protège rien si le curseur qui l'accompagne, lui, recule"
module: domain/fold
date: 2026-08-08
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "Un joueur est surfacturé de plusieurs secondes après un recalage d'horloge, alors que le garde anti-recul semble en place"
  - "L'erreur n'apparaît pas au moment du saut d'horloge mais au pas suivant"
  - "Le journal étant append-only, l'écart est définitif : aucun rejeu ne le corrige"
root_cause: logic_error
resolution_type: code_fix
tags:
  - horloge
  - temps
  - event-sourcing
  - fold
---

# Un delta plafonné ne protège rien si le curseur qui l'accompagne, lui, recule

## Problème

`fold()` avance le temps par pas : à chaque événement et à chaque frame, il consomme `to - cursor` sur la pendule qui tourne, puis déplace le curseur. Le garde contre les sauts d'horloge murale (NTP, réglage manuel) plafonnait le **delta** :

```ts
const dt = Math.max(0, to - state.cursor)   // protégé
// ...
state.cursor = to                            // PAS protégé
```

Le raisonnement semblait complet : un `to` inférieur au curseur donne `dt = 0`, donc aucun temps n'est consommé, donc rien de faux ne se produit. C'est vrai — **pour ce pas-là seulement**.

## Symptômes

Le pas courant est correct, et c'est ce qui rend le défaut difficile à voir. L'erreur naît au pas **suivant** : le curseur s'est posé dans le passé, donc l'intervalle d'après est mesuré depuis une position fausse et facture au joueur au trait du temps qu'il n'a pas consommé. Sur une pendule d'échecs, cela ne produit pas un affichage légèrement décalé — cela fait tomber un drapeau trop tôt.

Comme le journal est append-only et que le fold est déterministe, l'écart n'est pas transitoire : il est reproduit à l'identique à chaque rejeu.

## Ce qui n'a pas marché

Plafonner `dt` seul, en croyant que « ne rien consommer » suffisait. Le garde était même commenté avec sa raison — « on fige, on ne rend jamais de temps » — ce qui a rendu la lacune d'autant plus invisible : le commentaire décrivait fidèlement ce que la ligne faisait, et personne ne relit une ligne qui s'explique elle-même.

Ce défaut a survécu à l'écriture initiale, aux tests écrits *avant* le code, et à une première passe de relecture. Il a été trouvé par une relecture dédiée à l'exactitude, qui a tracé deux pas consécutifs au lieu d'un.

## Solution

Le curseur est une **ligne de plus haute eau**, jamais une simple affectation :

```ts
state.cursor = Math.max(state.cursor, to)
```

Et symétriquement, à l'écriture : la couche commande n'écrit jamais un horodatage antérieur au précédent, ce qui garantit qu'un journal reste rejouable.

```ts
const previous = journal.events[journal.events.length - 1]
const at = Math.max(Math.floor(event.at), previous?.at ?? Number.NEGATIVE_INFINITY)
```

## Pourquoi ça marche

Un accumulateur incrémental a **deux** états, pas un : la quantité consommée et la position depuis laquelle on mesure. Plafonner la première sans plafonner la seconde déplace simplement l'erreur d'un pas dans le futur, là où elle est beaucoup plus dure à relier à sa cause.

La formulation générale : *toute borne posée sur un delta calculé depuis une référence mobile doit aussi être posée sur la référence.* Sinon on n'a pas supprimé l'erreur, on l'a décalée.

## Prévention

**Le test qui attrape ça teste deux pas, pas un.** Un test qui n'observe que l'instant du saut passe avec le code buggé. Il faut comparer un journal contenant un horodatage qui recule à un journal équivalent sans recul, et asserter l'égalité **après** l'événement suivant :

```ts
const at = START_AT + 14_000   // un pas APRÈS le recul
expect(fold(recule, at).remaining[WHITE]).toBe(fold(droit, at).remaining[WHITE])
```

**Vérifier le correctif par retrait.** Remettre l'ancienne ligne et confirmer que le test échoue. Sans cette étape, on ne sait pas si le test prouve quelque chose — il passait déjà avant le correctif dans sa première rédaction.

**Réflexe de relecture** : partout où l'on écrit `x = Math.max(0, b - a)` suivi de `a = b`, se demander ce que devient `a` quand `b < a`. C'est le même piège pour un rate limiter, un timeout de session, ou toute boucle de jeu qui accumule un temps écoulé.

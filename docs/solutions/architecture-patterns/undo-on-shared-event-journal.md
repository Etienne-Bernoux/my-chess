---
title: "Sur un journal partagé, annuler son propre événement change l'état de l'autre partie"
module: domain/commands
date: 2026-08-08
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Un undo retire un événement d'un journal append-only dont l'état est dérivé par une fonction pure"
  - "Le journal décrit plusieurs parties prenantes, pas seulement l'auteur de l'événement"
  - "L'état dérivé comporte un état terminal (échéance, épuisement, expiration)"
root_cause: logic_error
resolution_type: code_fix
tags:
  - event-sourcing
  - undo
  - journal
  - fold
---

# Sur un journal partagé, annuler son propre événement change l'état de l'autre partie

## Contexte

Un journal d'événements append-only avec un fold pur donne un undo d'une simplicité séduisante : on retire le dernier événement, on rejoue, et l'état exact d'avant est restitué. Aucun état sauvegardé à défaire, aucune transaction inverse à écrire. C'est correct, et c'est précisément ce qui endort la vigilance.

Le raisonnement qui a été écrit — noir sur blanc, dans le plan d'implémentation — était : « autoriser l'undo après l'état terminal est légitime, on a pu agir trop tard ; l'état terminal se reformera au rejeu de toute façon. »

Les deux moitiés de cette phrase sont fausses.

## Le piège

**Le rejeu ne restitue pas « l'état d'avant ». Il re-dérive tout l'état, pour tout le monde.**

Sur une pendule d'échecs : Blanc rend la main à T, Noir réfléchit quarante secondes et son drapeau tombe. Annuler le tap de Blanc retire l'événement qui avait transféré le trait — donc au rejeu, **Blanc était au trait depuis le début** et se voit facturer les quarante secondes de réflexion de Noir. Le drapeau ne « retombe » pas : il tombe sur l'autre joueur.

Un geste, irréversible (il n'y a pas de redo sur un journal tronqué), qui change le perdant.

Et la justification « on a tapé trop tard » ne tenait pas non plus : un tap postérieur à l'état terminal est **déjà** refusé par la couche commande, donc il n'y a jamais rien à annuler dans ce cas. Le seul cas où l'undo post-terminal agit réellement est celui qui réécrit l'histoire au détriment de l'autre partie.

## Guidance

**Un undo n'est sûr que tant que l'événement retiré n'a d'effet dérivé que sur son auteur.** Dès que le fold attribue à d'autres parties un état qui dépend de cet événement — un tour de parole, un verrou, une facturation, une échéance —, le retirer les affecte aussi.

Deux questions à poser avant d'exposer un undo sur un journal partagé :

1. **Qui l'événement retiré affecte-t-il dans le fold, au-delà de son auteur ?** S'il transfère quoi que ce soit (le trait, un droit, un compteur), l'undo est un transfert inverse, pas une annulation.
2. **L'état dérivé comporte-t-il un état terminal ?** Un état terminal est absorbant : une fois franchi, il fige le reste du journal. Rejouer sans l'événement peut le faire franchir par quelqu'un d'autre, à un autre instant.

La règle appliquée ici : **l'undo est refusé une fois l'état terminal atteint.** Après la chute, la pendule ne réécrit plus rien — les joueurs tranchent entre eux, ce qui est de toute façon ce que prévoit le règlement.

## Pourquoi ça compte

La pureté du fold rend l'undo trivial à *implémenter* et masque exactement ce qui le rend délicat à *spécifier*. Il n'y a pas de code de compensation à écrire, donc rien n'oblige à se demander qui la compensation affecte. Le raisonnement erroné a survécu à la rédaction du plan, à l'implémentation, et à un test qui affirmait explicitement le bon comportement — parce que ce test n'exerçait que le cas bénin, où l'annulation ne transférait rien.

## Quand l'appliquer

Tout système événementiel où le journal décrit plusieurs parties prenantes : pendules, files d'attente partagées, réservations, allocations de ressources, transferts de verrou. La question n'est pas « puis-je rejouer sans cet événement ? » — la réponse est toujours oui — mais « **qui d'autre le rejeu recalcule-t-il ?** »

## Exemple

Le test qui verrouille le comportement montre explicitement ce que le refus empêche, plutôt que d'affirmer seulement que l'undo rend `null` :

```ts
// Blancs 3 s, Noirs 4 s, mort subite. Blanc tape après 1 s, Noir tombe à 6 000.
expect(fold(played, START_AT + 5_000).flagged).toBe(BLACK)
expect(undoAt(played, START_AT + 5_000)).toBeNull()

// Ce que le refus empêche : sans le tap, Blanc serait au trait depuis le
// début et paierait la réflexion de Noir — c'est LUI qui tomberait.
const sansLeTap = { ...played, events: played.events.slice(0, -1) }
expect(fold(sansLeTap, START_AT + 5_000).flagged).toBe(WHITE)
```

La seconde assertion est la seule qui documente le danger. Un test qui se contente du `toBeNull()` passerait encore si quelqu'un rétablissait l'undo pour une autre raison, en croyant ne lever qu'une précaution excessive.

---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
origin: SPECS.md
date: 2026-08-09
type: feat
depth: light
---

# feat: Cadence manuelle et temps asymétriques

## Goal Capsule

Permettre de régler une cadence depuis l'application — temps, incrément, mode — sans passer par le fichier de presets, et donner à chaque camp un temps initial distinct. Les deux fonctions étaient classées **v2** par SPECS (« Reporté sans date : interface de réglage des temps asymétriques, éditeur visuel de cadences ») ; ce plan les lève, en levant aussi la clause de R29 « pas d'éditeur visuel en v1 ».

**Objection consignée, tranchée par Etienne :** le seul critère de fin de v1 est la partie jouée au club, et SPECS classait ces deux fonctions en v2 précisément pour qu'elles soient dessinées *par* ce retour d'usage. Les construire avant, c'est juger à l'aveugle des libellés et des gestes que la partie de club aurait cadrés gratuitement. Décision d'Etienne : on y va maintenant.

---

## Problem Frame

Le socle est déjà en place et c'est ce qui rend le lot petit :

- **R4 a préparé l'asymétrie** — `TimeControl.initialMs` est un `{ white, black }` depuis le premier jour, et `fold` mappe déjà les couleurs vers les moitiés via `whiteHalf`. Aucune migration de schéma, aucun changement dans `fold` ni dans `commands`.
- **Le journal porte la cadence complète**, pas une référence à un preset. Une partie en cadence manuelle se persiste, se reprend et s'exporte sans une ligne de plus (R25–R28).
- **`parseTimeControl` est déjà un validateur générique et strict**, utilisé par `codec` pour hydrater un journal. Il est réutilisable tel quel pour la nouvelle donnée persistée.

Deux points ne sont *pas* couverts par l'existant, et c'est là que se concentre le travail :

1. **R30 mémorise un identifiant de preset**, pas une cadence. `saveLastPresetId` / `presetById` ne savent rien exprimer qui ne soit pas dans le fichier JSON. Une cadence manuelle n'a pas d'identifiant à retrouver — il faut mémoriser la cadence elle-même.
2. **`presetById` retombe silencieusement sur le premier preset** pour un identifiant inconnu (le repli de R30). Un identifiant réservé à la saisie manuelle traversant cette fonction serait donc converti en « Blitz 3+2 » sans rien dire. La sélection armée doit cesser d'être un identifiant pour devenir une cadence.

---

## Décisions

| # | Décision | Raison |
|---|---|---|
| D1 | La saisie manuelle est une **entrée « Personnalisée… » du select existant**, qui révèle les champs sous lui. | L'accueil reste strictement identique tant qu'on ne la choisit pas : zéro geste ajouté au cas courant, qui est de repartir sur la cadence de la dernière fois. |
| D2 | Le handicap est **derrière un interrupteur**, et seulement en cadence manuelle. | Le handicap est rare : lui faire payer deux champs au lieu d'un à chaque partie est un mauvais échange. Un preset asymétrique dans un fichier versionné générique n'aurait pas de sens. |
| D3 | Cocher Handicap **remplace** le champ unique par les deux champs Blancs / Noirs, initialisés à sa valeur. | Laisser les trois à l'écran donnerait deux sources de vérité contradictoires — laquelle s'applique ? Écart assumé avec le croquis de cadrage, qui les montrait côte à côte. |
| D4 | La mémorisation de R30 stocke **la cadence complète sérialisée**, hydratée par `parseTimeControl`, avec repli sur l'ancienne clé d'identifiant. | Sans ça, régler un 5+3 asymétrique pour une soirée oblige à le ressaisir à chaque partie, et R30 existe pour éviter exactement ça. Le repli évite de perdre la préférence en place sur le téléphone. |
| D5 | L'état armé de l'accueil devient **une `TimeControl`**, plus un identifiant. | Voir Problem Frame ②. Une cadence manuelle n'est pas retrouvable par identifiant, et le repli silencieux de `presetById` la transformerait en preset. |
| D6 | La saisie est en **minutes entières** et **secondes entières** d'incrément. | C'est l'unité dans laquelle les cadences réelles s'énoncent, et R23 veut des entiers. Conséquence assumée : une cadence sous la minute n'est pas exprimable à la main (le preset Bullet 1+0 reste dans la liste). |
| D7 | Une saisie invalide **désactive le bouton** et dit pourquoi ; elle n'est jamais réparée en silence. | Même posture que `parseTimeControl` sur le fichier de presets : échouer bruyamment plutôt que corriger dans le dos. |

---

## Unités

**U1 — Construction d'une cadence manuelle** (`src/presets/custom.ts`)
Une saisie brute (minutes, incrément, mode, handicap, minutes par couleur) vers `TimeControl | erreur`. Bornes et entiers, label dérivé de la saisie, identifiant réservé. Aucune dépendance au DOM.

**U2 — Mémorisation de la cadence** (`src/persistence/store.ts`)
`saveLastTimeControl` / `loadLastTimeControl` en lieu et place du couple identifiant. Hydratation par `parseTimeControl` dans un `try`, repli sur `mychess.lastPreset` quand la nouvelle clé est absente, repli final sur le premier preset.

**U3 — Champs de l'accueil** (`index.html`, `src/ui/render.ts`)
Entrée « Personnalisée… » toujours en fin de liste, groupe de champs révélé par elle, interrupteur Handicap qui échange le champ unique contre les deux champs par couleur. Le rendu reste idempotent et ne crée aucun nœud.

**U4 — Câblage** (`src/app.ts`)
`selectedPresetId: string` devient une cadence armée plus un brouillon de saisie. Le bouton d'ouverture de partie consomme la cadence armée ; il est désactivé tant que le brouillon ne produit pas de cadence valide.

**U5 — SPECS**
Deux exigences ajoutées, deux lignes retirées du hors-périmètre reporté, clause « pas d'éditeur visuel en v1 » de R29 levée.

---

## Vérifier

**En Vitest** — toute la validation et toute la persistance : bornes et rejets, label dérivé, round-trip de la cadence mémorisée, repli sur l'ancienne clé, valeur corrompue.

**Le test qui porte la valeur de la fonction** : une cadence asymétrique s'applique **par couleur**, et l'orientation des camps vient du seul premier tap (R8). Blancs 5 min / Noirs 3 min, tap de démarrage sur la moitié haute ⇒ la moitié haute part de 5 min et la basse de 3. Le même journal démarré sur l'autre moitié inverse les deux. C'est la seule assertion qui distingue « on a stocké deux nombres » de « le handicap fonctionne ».

**À la main sur le téléphone**, comme tout le reste de l'ergonomie : la révélation des champs ne pousse pas le bouton hors de l'écran, le clavier numérique ne masque pas le champ en cours, l'accueil ne coûte toujours pas un geste de trop quand on ne touche pas à la cadence.

---

## Ce que ce plan ne fait pas

- Pas d'édition ni d'enregistrement de presets nommés : la cadence manuelle est mémorisée comme *dernière utilisée*, pas ajoutée à la liste.
- Pas de cadence sous la minute à la saisie (D6).
- Pas de réglage asymétrique sur un preset (D2).

---
date: 2026-08-09
projet: myChess
portee: pendule v1 detaillee, repertoire en orientations
---

# myChess — spécification

Ce document dit **quoi** construire et **pourquoi**, pas comment le coder. Les pistes explorées et écartées, avec leurs raisons, sont dans [`docs/ideation/2026-08-08-mychess-ideation.md`](./docs/ideation/2026-08-08-mychess-ideation.md). Les contraintes techniques permanentes du projet sont dans [`CLAUDE.md`](./CLAUDE.md).

**Périmètre de ce document.** La pendule est spécifiée en exigences implémentables. Le répertoire d'ouvertures n'a que ses décisions d'architecture déjà solides et la liste de ce qui reste à trancher — le spécifier finement aujourd'hui serait deviner, et cette spec serait périmée avant d'être utilisée : construire la pendule va apprendre des choses sur la persistance, la vérification et l'ergonomie tactile qui changeront ce qu'on veut du trainer.

---

## Cadre

Application pour **un seul utilisateur**, installée sur son téléphone Android. Pas de compte, pas de synchronisation, pas de second utilisateur à ménager. Cette contrainte est une liberté : l'application peut être plus exigeante et plus honnête sur ce qu'elle ne sait pas qu'un produit destiné à un marché.

PWA hors ligne par défaut, installée via « Ajouter à l'écran d'accueil » sur Chrome Android. Vite + TypeScript, Vitest, pnpm ; Svelte si la réactivité de l'UI le justifie. Ni natif Kotlin ni Capacitor — les deux exigeraient la toolchain Android pour produire un APK, et rien dans ces deux fonctions ne le réclame.

**Ordre de livraison :** la pendule d'abord. Elle est autonome, ne contient aucune logique échiquéenne, et est utilisable dès sa première version.

---

## Pendule — exigences

### Cadences

R1. Deux modes de cadence, et deux seulement : **Fischer** (temps initial + incrément fixe ajouté à chaque coup joué) et **Bronstein** (le décompte part immédiatement, puis restitue le temps réellement consommé, plafonné au délai).

R2. Un incrément de zéro est un réglage valide et couvre la mort subite. Il n'existe pas de mode « sudden death » distinct.

R3. Les deux modes partagent une formule unique. Le gain rendu en fin de coup est `increment` en Fischer, et `min(increment, elapsed)` en Bronstein. Aucun mode ne doit être implémenté comme un cas particulier greffé sur l'autre.

R4. Le temps initial est stocké **par joueur**, pas globalement. C'est ce qui a permis d'exposer le handicap (R32) sans migrer un schéma.

### Disposition et interaction

R5. Le téléphone est **posé à plat** entre les deux joueurs. L'écran est coupé en deux moitiés horizontales ; la moitié de l'adversaire est **pivotée à 180°**.

R6. Chaque moitié est **entièrement** une zone de tap. Aucun contrôle secondaire n'y est placé : à plat, on tape sans regarder, et la cible doit être la surface maximale.

R7. **Pendant la partie, chaque joueur tape sa propre moitié** après avoir joué, ce qui lance le temps de l'adversaire.

R8. **Le démarrage est l'exception :** les Noirs lancent la pendule en tapant la moitié située du côté de leur adversaire, comme sur une pendule physique. L'orientation des deux camps se déduit de ce premier tap — aucun écran ne demande qui est Blanc.

R36. Une fois le premier tap passé, **chaque moitié porte le nom de son camp** — Blancs ou Noirs. R8 n'est pas amendé : l'orientation se déduit toujours de ce seul tap, et l'application se contente d'écrire ce qu'il a décidé. Avant le tap, rien n'est affiché — il n'y a rien à dire, et surtout rien à deviner.

  C'est ce qui rend l'échange des deux temps lisible en handicap (R32). Sans repère, régler cinq minutes pour les Blancs et trois pour les Noirs puis voir les deux valeurs se croiser au premier tap se lit comme une erreur de l'application. C'était une question laissée à l'usage ; elle se règle par un mot, sans écran ni geste supplémentaire.

  Le repère est posé **hors du flux** : il ne décale pas le cadran et n'ajoute pas de hauteur, sans quoi la grille déborderait sur un écran court. Il suit la rotation de sa moitié (R5), donc se lit à l'endroit depuis la place de son joueur, et ne vole aucun tap (R6).

R9. Un tap sur la moitié du joueur qui n'est pas au trait n'a **aucun effet**. Seul le joueur dont le temps s'écoule peut rendre la main.

R9b. Un tap est également sans effet si le joueur au trait n'a **pas encore consommé un minimum de temps** sur son coup. Le téléphone est posé à plat : une paume qui roule d'une moitié à l'autre produit deux contacts valides, et le second offrirait à l'adversaire l'incrément d'un coup qu'il n'a pas joué.

  Ce n'est pas le double-tap obligatoire écarté en R24 — celui-ci taxe *chaque* coup, alors qu'aucun coup humain, pièce déplacée puis pendule frappée, ne tient sous ce seuil. Le garde porte sur le temps **réellement consommé** et non sur le délai écoulé, pour qu'une reprise après pause ne soit jamais bloquée.

R10. Une **bande centrale étroite**, hors des deux zones de tap, porte la pause.

R11. Le reset n'est **jamais atteignable depuis la pendule elle-même**. Il ne vit que sur un écran en superposition — accueil, pause, ou drapeau tombé.

R11b. L'application s'ouvre **systématiquement sur un écran d'accueil**. La cadence y est présélectionnée (cf. R30) et modifiable, et une partie non close y est proposée à la reprise (cf. R26). Le bouton qui ouvre une partie **ne lance pas l'horloge** : c'est le tap de R8 qui décide de l'orientation des camps, et lui seul.

  Choisir une cadence n'est qu'un choix armé, jamais une action : c'est le bouton qui l'applique. Sans cela, régler la cadence détruirait la partie qu'on propose de reprendre, et il faudrait interdire l'un pour permettre l'autre.

  L'accueil étant le seul écran qui s'ouvre **sans qu'on l'ait demandé**, y abandonner une partie non close exige un **second appui** : le bouton s'arme d'abord et l'annonce. Ailleurs, avoir ouvert l'écran est déjà le premier geste.

R37. Un **tirage au sort des couleurs** est proposé sur l'écran d'accueil, et **facultatif** : c'est un bouton qu'on ignore, jamais une étape avant de jouer. Il ne vit que sur l'accueil — sur la pause ou un drapeau tombé, il ne serait qu'un contrôle de plus entre le joueur et celui qu'il cherche.

  Il ne touche à **rien** : ni le journal, ni la cadence, ni l'orientation, qui reste déduite du seul premier tap (R8). Un tirage qui désignerait une moitié de l'écran entrerait en contradiction avec ce tap sans que rien ne le signale ; celui-ci ne fait que sortir un mot, comme un pion caché dans un poing. Le résultat n'est **pas persisté** : le retrouver au lancement suivant ferait croire à un tirage qu'on n'a pas fait.

  La source d'aléa est **injectée**, comme la source de temps (R22) et pour la même raison : un tirage lu en dur ne se prouve pas, on ne peut que le regarder tomber du bon côté quelques fois et espérer.

R38. **En pause, la cadence se lit mais ne se règle plus.** Un champ éditable y laisse croire qu'on modifie la partie **en cours**, ce qui est faux : seule « Nouvelle partie » l'appliquerait, en jetant celle qu'on vient de mettre en pause.

  Les contrôles sont **grisés, jamais masqués** : le bouton doit continuer d'annoncer avec quelle cadence il partirait. C'est ce qui rend l'ancienne objection caduque — elle visait un select grisé qui aurait rendu le bouton menteur, alors que c'est l'inverse : masquer mentirait, griser informe. Le prix assumé : changer de cadence en cours de session coûte deux gestes de plus, une nouvelle partie puis les réglages.

  Le **mode silencieux n'est pas concerné** : se taire au milieu d'une partie est un besoin légitime, et ce n'est pas un réglage de cadence.

### Retours

R12. Au moment du tap, la confirmation prioritaire va **au joueur qui vient de jouer**, et elle est **visuelle** sur sa propre moitié — son cadran se fige de façon perceptible en vision périphérique. Il n'y a qu'un vibreur dans le téléphone et les deux joueurs le sentent : l'haptique ne peut pas être adressée à un seul camp.

  Ce qui est traité ici est le **faux négatif** — le tap qui n'a pas pris, alors que la main est déjà repartie vers les pièces. Tout le prior art traite le faux positif (le tap accidentel) et laisse celui-ci de côté.

R13. Des signatures **sonores distinctes** marquent les transitions d'état : chaque palier de rappel (R33) et la chute du drapeau. Les paliers se distinguent par une **tonalité qui monte** d'un palier au suivant, jamais par des timbres sans rapport : reconnaître quatre sons à l'oreille en pleine partie serait un apprentissage qu'une pendule n'a pas à exiger, alors qu'une hauteur qui monte se comprend sans avoir jamais été expliquée.

R33. Le temps restant est rappelé à **trois paliers** — une minute, trente secondes, dix secondes — sur **deux canaux à la fois**, une couleur de fond et un signal sonore. Le visuel est le porteur principal : R15 coupe tous les sons, et le mode silencieux est l'état normal en club. Dix secondes seules prévenaient trop tard pour changer quoi que ce soit à sa façon de jouer.

  Les paliers sont un **catalogue**, pas une suite de conditions. Un palier est une donnée — un seuil et un nom — et le rendu comme l'audio le consomment ; en ajouter un ne doit pas ajouter une branche ici et une autre là.

R34. Un palier atteint **ne se relâche jamais** avant la fin de la partie. En Fischer, l'incrément fait régulièrement repasser au-dessus d'un seuil qu'on vient de franchir : le cadran ne redevient pas calme pour autant, et le son ne rejoue pas. Conséquence assumée : un cadran peut afficher plus d'une minute sur le fond d'un palier plus bas. Il dit alors la vérité sur la fin de partie qui s'annonce, pas sur l'instant.

  Un palier **ne s'arme pas** s'il est supérieur ou égal au temps initial **de ce joueur**. Une cadence d'une minute franchirait le palier « une minute » au premier tic sans rien apprendre à personne. Le test est par joueur, jamais global : R32 autorise deux temps initiaux distincts.

  Le palier atteint est **dérivé du journal** (R19, R20) comme tout le reste, et n'est écrit nulle part. C'est ce qui fait qu'un undo le réarme et qu'une reprise après fermeture le retrouve, sans code dédié ni migration du format de sauvegarde.

R35. Les signatures sonores vivent dans un **fichier JSON versionné**, éditable à la main — hauteur, durée, timbre, enveloppe de chaque ton. Même doctrine que R29 pour les cadences : c'est une donnée source, pas un écran de réglages. Un bip se juge à l'oreille, dans la salle où l'on joue, et l'ajuster ne doit pas coûter un menu de plus sur l'écran d'accueil ni une préférence de plus à persister.

R14. L'audio est **pré-armé au premier geste utilisateur** (le tap de démarrage suffit — l'API l'exige).

R15. Un interrupteur de **mode silencieux** coupe tous les sons. Un bip dans une salle de club est antisocial.

R16. La spécification **n'exige pas** que le signal sonore parte quand l'application n'est pas au premier plan. Chrome gèle une page cachée après quelques minutes et la Web Audio ne peut pas y démarrer un son. C'est une limite acceptée, pas un défaut à corriger.

### Chute du drapeau

R17. À l'épuisement du temps, la pendule **arrête le décompte et marque sans ambiguïté la moitié concernée**.

R18. Elle **n'écrit aucun résultat de partie**. Pas de vainqueur affiché.

  Raison : FIDE, Laws of Chess art. 6.9 — la partie est nulle si l'adversaire ne peut mater par aucune suite de coups légaux, drapeau tombé ou non. La pendule ne voit pas l'échiquier et ne peut donc pas savoir. En blitz, l'Appendice B va plus loin : la chute compte quand elle est **réclamée** par un joueur, pas quand un appareil la constate.

### Modèle interne

R19. L'état d'une partie est un **journal d'événements horodatés, append-only** : démarrage, tap, pause, reprise. Rien d'autre n'est stocké comme source de vérité.

R20. Tout ce qui s'affiche — temps restants, joueur au trait, drapeau tombé — est **dérivé du journal par une fonction pure**. Aucun état dérivé n'est écrit quelque part en parallèle.

R21. Aucun `setInterval` ne fait avancer le temps. Un timer ne sert qu'à **redessiner**.

  Raison : Chrome throttle les timers d'arrière-plan à environ une fois par minute après cinq minutes. Un compteur qui décrémente dérive — et sur une pendule, cette dérive ne produit pas un affichage légèrement faux, elle fait tomber un drapeau à tort. Un fold sur journal est idempotent : le rejouer après vingt minutes d'arrière-plan donne le même résultat qu'en direct, ce qui supprime le besoin d'un chemin de rattrapage séparé.

R22. La **source de temps est injectée** (une interface `Clock` passée en paramètre) et jamais lue en dur.

R23. Toute durée manipulée est un **entier**. Une durée fractionnaire accumulée corrompt l'horloge à la longue.

R24. Un **undo du dernier tap** est disponible : retirer le dernier événement du journal et rejouer restitue le temps exact.

  C'est la vraie réponse au tap accidentel, et elle ne coûte aucun tempo — contrairement au double-tap obligatoire employé ailleurs, qui taxe chaque coup en blitz et aggrave le faux négatif de R12.

### Persistance et reprise

R25. Le journal de la partie en cours est **persisté au fil de la partie**, pas seulement à la fin.

R26. À l'ouverture, si le journal de la dernière partie n'est pas clos, l'application **propose de la reprendre**. La reprise restitue l'état exact, y compris le temps écoulé pendant l'absence.

R27. La logique de lecture d'une sauvegarde est **pure et séparée** de l'accès au stockage, et hydrate défensivement : sauvegarde absente, tronquée, ou issue d'une version antérieure du schéma.

R28. Le journal d'une partie est **exportable**. Un journal exporté se rejoue tel quel comme cas de test.

  Un bug de pendule survient au club, loin du poste de développement, et n'est jamais reproductible de mémoire. C'est le seul moyen d'en faire une régression vérifiable.

### Presets

R29. Un petit jeu de cadences est fourni dans un **fichier JSON versionné**, éditable à la main.

R30. La dernière cadence utilisée est mémorisée et proposée par défaut au lancement suivant. C'est la **cadence entière** qui est mémorisée, et non une référence à un preset : une cadence saisie à la main (R31) n'existe dans aucune liste, et ne pas la retenir obligerait à la ressaisir avant chaque partie.

R31. Une cadence peut être **saisie dans l'application** — temps, incrément, mode — sans passer par le fichier de presets. Elle vit derrière une entrée dédiée de la liste des cadences, qui ferme celle-ci : l'écran d'accueil reste identique tant qu'on ne la choisit pas.

  La saisie est en minutes et secondes entières. Conséquence assumée : une cadence sous la minute ne s'exprime pas à la main, et reste l'affaire du fichier de presets.

  Une saisie qui ne produit pas de cadence valide **n'ouvre pas de partie** : le bouton est refusé et la raison affichée. Rien n'est réparé en silence — une cadence corrigée dans le dos partirait sur la mauvaise partie de club.

R32. Les deux camps peuvent recevoir des **temps initiaux distincts** (handicap). Le réglage est derrière un interrupteur, et seulement en cadence manuelle : le handicap est rare, et lui faire payer un champ de plus à chaque partie serait un mauvais échange. Un preset asymétrique n'aurait pas de sens dans un fichier versionné générique.

  Les temps se règlent **par couleur**, jamais par moitié d'écran : l'orientation des deux camps n'est connue qu'au premier tap (R8), et c'est lui qui attribue les deux temps. Sur l'écran d'accueil, les deux valeurs sont donc affichées dans une orientation qui n'est pas encore décidée.

---

## Hors périmètre

**Définitivement écartés**, pas reportés :

- **Multi-période** (type 40 coups en 90 min puis 30 min). Ce n'est pas un besoin réel. Cette exclusion emporte aussi la machine à états de périodes et le **compteur de coups**, dont la seule raison d'être était de déclencher les transitions.
- **Délai américain.** Il produit exactement le même temps restant que Bronstein à chaque fin de coup et ne diffère que par l'affichage pendant le coup. Deux implémentations pour un résultat identique, c'est de la surface de bug pour rien.
- **Byo-yomi.**

**Reporté sans date :** enregistrement de cadences nommées depuis l'application (une cadence saisie est mémorisée comme *dernière utilisée*, cf. R30, pas ajoutée à la liste), tout ce qui touche au répertoire.

---

## Répertoire d'ouvertures — orientations

Rien ici n'est une exigence implémentable. Ce sont les décisions déjà solides, à ne pas re-débattre, et les questions qui restent ouvertes.

### Décisions acquises

D1. **La clé d'une position est un EPD, pas un FEN** : les quatre premiers champs seulement — placement des pièces, trait, droits de roque, case en passant.

  C'est le point qui décide si l'idée fonctionne. Le FEN complet contient le compteur de demi-coups et le numéro de coup, qui **diffèrent entre deux transpositions vers la même position**. L'utiliser comme clé fait échouer la convergence en silence et reconstruit exactement l'arbre de lignes qu'on cherchait à éviter.

D2. La structure est un **graphe orienté acyclique**, pas un arbre : les coups sont des arêtes entre positions, et les transpositions convergent naturellement.

D3. Quand deux lignes atteignent la même position et y prescrivent des coups différents, l'application **remonte le conflit** avec les deux chemins d'arrivée. Elle ne tranche pas silencieusement. C'est le seul moment où l'outil peut détecter que le répertoire se contredit lui-même.

D4. **Le répertoire est une donnée source versionnée dans le repo**, éditée à la main dans l'éditeur de code — pas saisie dans l'application. C'est une application personnelle avec un seul contributeur : l'IDE est une meilleure interface d'édition que tout ce qu'on construirait sur un écran de téléphone.

  Trois conséquences qui simplifient franchement le projet :

  - **Le dispositif de durabilité tombe.** Le répertoire est sauvegardé sur GitHub, versionné et diffable par construction. Plus rien d'irremplaçable ne vit dans le stockage du navigateur, à l'exception de la progression de révision — qui est reconstituable et ne justifie pas `navigator.storage.persist()` ni un export/import dédié.
  - **La raison écrite obligatoire devient une contrainte de typage** plutôt qu'une interface qui force un champ : elle est requise dans le type du format source, et un coup sans justification ne compile pas.
  - **Les conflits de transposition deviennent une erreur de build.** Deux lignes qui prescrivent des coups différents dans la même position se détectent au chargement ou dans un test — pas d'écran de résolution à construire.

  Le prix assumé : on ne peut pas ajouter une ligne depuis le téléphone, en club, juste après avoir vu une position intéressante. Cette limite est acceptée.

D5. **Le format source est du TypeScript dont le contenu échiquéen reste de la notation algébrique.** Chaque entrée porte la ligne d'accès en SAN sous forme de chaîne, le coup prescrit, et une justification — champ requis par le type.

```ts
type RepertoireEntry = {
  line: string   // "1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6"
  move: string   // "6.Be3"
  why: string    // requis : un coup sans raison ne compile pas
}
```

  Ni PGN pur, ni structure d'objets imbriqués, et c'est délibéré. Le PGN ne porte aucune contrainte — ses commentaires sont optionnels par nature, donc la justification obligatoire de D6 disparaîtrait — et il est structurellement un arbre de variations imbriquées, soit l'anti-pattern exact que la clé EPD de D1 existe pour éviter. À l'inverse, un répertoire écrit en objets imbriqués cesse d'être lisible comme une ligne d'échecs.

  **L'EPD n'est jamais saisi à la main :** il se calcule au chargement en rejouant les coups de `line`. Le graphe de D2 et les contradictions de D3 sont donc *dérivés*, pas déclarés — deux entrées dont la ligne aboutit au même EPD avec des `move` différents sont détectées par un test.

  Prix assumé : ce n'est pas du PGN standard, donc pas importable tel quel dans Lichess. Générer un export PGN depuis cette structure est trivial ; faire porter une contrainte obligatoire par du PGN ne l'est pas.

D6. Deux directions d'entraînement valent mieux que la répétition espacée classique, et sont ce qui distingue cet outil d'un Chessable : **exiger une raison écrite** pour tout coup du répertoire (cf. D5 — portée par le typage), et **entraîner la détection de la sortie de livre** plutôt que la récitation — l'application joue une partie et dévie à un moment imprévisible, c'est au joueur de remarquer qu'il n'est plus en terrain connu. Ces deux directions ne sont possibles que parce qu'il n'y a qu'un utilisateur : un champ obligatoire rédigé à la main détruirait la conversion d'un produit de masse.

### Questions ouvertes

| # | Question | Pourquoi elle bloque |
|---|---|---|
| Q1 | La clé est-elle l'EPD seul, ou le couple `(EPD, couleur du répertoire)` ? | Une même position peut appartenir au répertoire blanc et au noir avec des intentions différentes. À trancher avant la première structure de données. |
| Q2 | Quels modes d'entraînement en v1, et faut-il de la répétition espacée d'emblée ? | La répétition espacée est peut-être prématurée avant que le répertoire ait une taille réelle. |
| Q3 | Que fait hors ligne tout ce qui dépend de l'API Lichess Opening Explorer ? | Les dumps pèsent 2,9 Go (masters) à 22 Go : inembarquables. Soit ces fonctions exigent le réseau et dégradent proprement, soit on embarque un jeu ECO curé. **Bloquant pour D6** : dévier du répertoire suppose une source de coups adverses. |
| Q4 | Quelle bibliothèque d'échiquier, et en faut-il une ? | Le répertoire étant édité dans l'IDE (D4), aucun échiquier interactif n'est nécessaire pour la **saisie**. Il en faut un pour l'**affichage** pendant le drill, et le besoin est bien plus modeste : `cm-chessboard` (maintenu, sans dépendance, SVG) suffirait, voire un rendu statique. |

L'amorçage du répertoire depuis l'historique de ses propres parties a été examiné et **écarté comme source de vérité** : un répertoire dérivé de ses parties enregistre ce qu'on **a** joué, mauvaises habitudes comprises, alors qu'un répertoire est ce qu'on **devrait** jouer. Le garde-fou envisagé ne se déclenche jamais sur une erreur jouée systématiquement. La piste garde une valeur d'**audit** — comparer ses parties au répertoire pour voir où il a lâché — mais plus de valeur de sourcing depuis D4.

---

## Hypothèses

H1. **Le journal de la partie en cours reste la seule donnée du navigateur qui compte** (R25 à R27). Il est jetable une fois la partie finie, donc aucune mesure de durabilité renforcée ne le concerne. Si un jour la progression de révision du répertoire devient précieuse, la question de la durabilité se reposera — pour elle seule, et pas pour le répertoire lui-même (cf. D4).

H2. **Le drill du répertoire suppose une source de coups adverses** hors répertoire pour pouvoir dévier de façon imprévisible (D6). Tant que Q3 n'est pas tranchée, on ne sait pas si cette source est le réseau, un jeu ECO embarqué ou un moteur — et donc si le mode fonctionne hors ligne.

**Contexte de jeu confirmé :** parties amicales et de club, pas de tournoi homologué. C'est ce qui justifie l'exclusion du multi-période, et ce n'est plus une hypothèse.

---

## Vérifier

Le partage est délibéré, et il découle de ce qui est réellement vérifiable.

**Testé pour de vrai, en Vitest, avec une horloge injectée.** Toute la logique de temps. C'est le seul domaine purement déterministe du projet, et celui qu'on ne peut pas vérifier à la main : personne ne reproduit un throttling de trente minutes, un tap trois millisecondes avant l'échéance, ou une reprise depuis un journal tronqué. Les scénarios à couvrir : Fischer et Bronstein sur une partie complète, incrément nul, undo puis rejeu, mise en arrière-plan longue, reprise après fermeture de l'application, journal corrompu.

**Vérifié à la main sur le téléphone.** Toute l'ergonomie. Un audit mobile nomme les éléments cassés — il ne rend pas un booléen, et `scrollWidth <= innerWidth` ne prouve rien puisque `overflow-x: hidden` le masque. À contrôler explicitement : les deux moitiés sont atteignables et pivotées correctement, la bande centrale ne vole aucun tap, la confirmation visuelle de R12 est perceptible sans fixer l'écran, l'écran d'accueil ne coûte pas un geste de trop avant chaque partie, et l'abandon d'une partie en cours demande bien un second appui qui se voit (R11b).

Pour la saisie manuelle (R31, R32) : la révélation des champs ne pousse pas le bouton hors de l'écran, le clavier numérique ne masque pas le champ en cours de remplissage, et l'échange des deux temps au premier tap — inévitable puisque l'orientation n'est décidée qu'à cet instant — ne fait pas croire à une erreur, ce à quoi le repère de camp (R36) doit suffire. À contrôler pour lui : il se lit sans effort dans tous les états de la moitié, flash de confirmation et drapeau tombé compris, et ne concurrence jamais les chiffres.

Pour les paliers (R33, R34) : les trois fonds se distinguent l'un de l'autre à un mètre et sans les avoir appris, aucun ne se confond avec le carmin de la chute (R17), et la tonalité de chaque palier s'entend par-dessus le bruit d'une salle de club. Les trois seuils et les trois couleurs sont des valeurs jugées au doigt et à l'oreille : elles se confirment en jouant, pas en les relisant.

**Les deux chemins**, chaque fois qu'ils existent : partie jouée en direct **et** reprise après interruption.

Un vrai rechargement se prouve en redémarrant le serveur de développement, pas avec un `location.reload()` piloté à distance.

---

## Découpage

**v1 — pendule utilisable en club.** R1 à R38. Le critère de fin n'est pas « les tests passent » mais : une partie réelle jouée du début à la fin sur le téléphone, contre un adversaire humain, sans qu'on ait envie de reprendre une autre pendule.

**v2 — durcissement.** Ce que la v1 aura révélé en usage. Candidats connus, non engagés : cadences nommées enregistrables, granularité de saisie sous la minute si R31 se révèle trop grossière à l'usage.

**v3 — répertoire.** Ouvre par la réponse à Q1 (la clé) et Q3 (le comportement hors ligne), qui décident de tout le reste.

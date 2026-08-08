# CLAUDE.md — myChess

> Les universels (langue, sécurité git, qualité de code) sont dans le global `~/.claude/CLAUDE.md` ; la posture pédagogue, le ping-pong de cadrage et la règle « j'écris le use case en premier » sont dans le `CLAUDE.md` de l'espace perso parent. **Ici, uniquement le spécifique à myChess.**

## Ce qu'est ce projet

PWA d'échecs pour un seul utilisateur, installée sur un téléphone Android via « Ajouter à l'écran d'accueil ». Deux fonctions : une **pendule** posée à plat entre deux joueurs (livrée en premier), un **répertoire d'ouvertures** (ensuite). Voir [`SPECS.md`](./SPECS.md) pour le périmètre et [`docs/ideation/`](./docs/ideation/) pour les pistes écartées et leurs raisons.

Pas de natif, pas de Capacitor : aucune toolchain Android sur le poste, et rien dans ces deux fonctions ne l'exige.

## Contraintes techniques dures

Non négociables. Chacune vient d'un incident vécu ou d'une vérification adversariale ; les rouvrir demande une raison, pas une préférence.

- **Le temps ne se décrémente jamais.** Aucun `setInterval` ne fait avancer l'horloge — il ne fait que redessiner. L'état de la pendule est un journal d'événements horodatés append-only, et tout l'affichage en est dérivé par une fonction pure. Chrome throttle les timers d'arrière-plan à ~1×/min après 5 minutes : un compteur qui décrémente dérive, et sur une pendule cette dérive fait tomber un drapeau à tort.
- **La source de temps est injectée, jamais lue en dur.** Le moteur reçoit une interface `Clock` en paramètre et n'appelle pas `Date.now()` directement. C'est ce qui rend testable une partie multi-période de trois heures en quelques millisecondes, et ce qui évite de booster une constante puis d'oublier de la remettre avant le commit.
- **Toute durée entière.** Une durée fractionnaire accumulée corrompt l'horloge à la longue.
- **La clé du répertoire est un EPD, pas un FEN.** Les quatre premiers champs seulement : placement, trait, roques, en passant. Le FEN complet contient le compteur de demi-coups et le numéro de coup, qui *diffèrent entre deux transpositions vers la même position* — l'inclure fait échouer la convergence en silence et reconstruit l'arbre de lignes qu'on voulait éviter.
- **Le répertoire est la seule donnée irremplaçable du projet.** Demander `navigator.storage.persist()`, offrir un export/import complet, et coupler explicitement version d'application et version de schéma. Une éviction de stockage ou un service worker périmé sur une migration donne une perte silencieuse.

## Pièges connus qui s'appliquent ici

- **Svelte, dépendances cachées** — une fonction qui lit une variable réactive dans son corps rend cette dépendance invisible à l'analyse statique de `$:`, et le dérivé ne recalcule jamais. Passer les valeurs réactives en arguments. A frappé trois fois en une session sur croisade.
- **Blowout de grille CSS** — `minmax(0, 1fr)` empêche le débordement mais autorise l'écrasement à côté d'une piste `auto` : utiliser `minmax(min-content, 1fr)`. Et tester sur les **deux** axes, pas seulement la largeur.
- **Cascade CSS** — media queries en fin de feuille, sinon elles perdent à spécificité égale.
- **Nettoyage des timers** — tous les identifiants de `setInterval` / `setTimeout` libérés au démontage du composant, sinon accumulation en HMR.

## Vérifier

Pas de suite de tests généralisée. Le partage est délibéré :

- **La logique de temps est testée pour de vrai**, en Vitest, avec une horloge injectée. C'est le seul domaine purement déterministe du projet, et c'est celui qu'on ne peut pas vérifier à la main : personne ne reproduit un throttling de trente minutes ni un tap à trois millisecondes du drapeau.
- **L'ergonomie se vérifie sur le téléphone**, pas dans un test. Un audit mobile nomme les éléments cassés — il ne rend pas un booléen. `scrollWidth <= innerWidth` est masqué par `overflow-x: hidden` et ne prouve rien.
- Exercer **les deux chemins** quand ils existent : partie en direct *et* reprise après mise en arrière-plan.
- Un vrai rechargement = redémarrer le serveur de dev, pas un `location.reload()` piloté à distance.
- Lire le DOM **après** le re-render, pas dans le même tour de boucle que l'action.

## Vocabulaire

- **EPD** — les quatre premiers champs d'un FEN. La clé d'une position dans le répertoire.
- **Journal** — la suite append-only d'événements horodatés d'une partie. Source de vérité de la pendule.
- **Fold** — la fonction pure qui dérive l'état affiché depuis le journal.
- **Hors livre** — position atteinte qui n'est pas dans le répertoire.
- **Cédant** — le joueur qui vient de jouer et rend la main.

## Cerveau

Cet arbre interroge **`kb-perso`**, jamais `kb-pro`. Lecture seule.

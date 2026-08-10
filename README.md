# myChess

Deux outils d'échecs pour mon usage, dans une seule application installée sur mon téléphone : une **pendule** posée à plat entre les joueurs, et un **répertoire d'ouvertures** qu'on travaille pour de vrai.

> **Statut : pendule v1 implémentée** (exigences R1 à R32 de [`SPECS.md`](./SPECS.md)), en attente de sa validation sur le téléphone. Le répertoire d'ouvertures n'est pas commencé. Les pistes explorées et écartées sont tracées dans [`docs/ideation/`](./docs/ideation/).

## Pourquoi

Les deux fonctions existent ailleurs, séparément et mal ensemble. Les pendules du commerce sont correctes mais génériques ; les entraîneurs de répertoire (Chessable, Chessbook) sont conçus pour un marché, donc obligés de cacher leur complexité et de flatter la progression. Un outil pour une seule personne n'a aucune de ces contraintes : il peut être plus exigeant, plus honnête sur ce qui n'est pas su, et spécialisé sur ce que je joue réellement.

## Les deux fonctions

### Pendule

Téléphone posé **à plat sur la table**, entre les deux joueurs. L'écran est coupé en deux moitiés, celle de l'adversaire pivotée à 180°. Les Noirs démarrent en tapant la moitié située du côté de leur adversaire, comme sur une vraie pendule.

L'application s'ouvre sur un **écran d'accueil** : la cadence y est présélectionnée et confirmée avant qu'une partie ne parte sur la mauvaise, et une partie qu'on avait laissée en plan y est proposée à la reprise, temps écoulé pendant l'absence compris.

Deux modes de cadence, et deux seulement : **Fischer** (temps initial + incrément, incrément nul compris — donc 5+0, 3+2, 5+3, 15+10) et **Bronstein**. Pas de multi-période, pas de délai américain, pas de byo-yomi : voir [`SPECS.md`](./SPECS.md) pour ce qui a été écarté et pourquoi.

Au-delà des cadences fournies, une entrée **« Personnalisée… »** ouvre la saisie d'un temps, d'un incrément et d'un mode, et — derrière un interrupteur — d'un **temps distinct par camp** pour jouer à handicap. Les temps se règlent par couleur : c'est le premier tap qui décide de l'orientation des deux camps, et donc de qui reçoit lequel.

À la chute du drapeau, la pendule **constate sans arbitrer** — elle marque le camp concerné et n'écrit aucun résultat. Une pendule ne voit pas l'échiquier, donc elle ne peut pas savoir si le mat était encore possible.

C'est le premier livrable : autonome, aucune logique échiquéenne, utilisable dès la première version.

### Répertoire d'ouvertures

Un endroit pour construire son répertoire, vérifier qu'on l'a réellement joué, et travailler ce qui ne tient pas. Nettement plus gros que la pendule et volontairement livré après.

## Stack

PWA installable, hors ligne par défaut. Vite + TypeScript, Vitest pour la logique pure, pnpm.

**Pas de natif, pas de Capacitor.** Les deux exigent la toolchain Android (JDK, Android Studio, SDK) pour produire un APK. Rien dans ces deux fonctions ne le justifie : le Screen Wake Lock, l'audio, la vibration et le stockage local sont tous disponibles à une PWA sur Chrome Android. Si une limite réelle apparaît un jour, le même code s'enveloppe dans Capacitor sans réécriture — mais on ne paie pas ce prix avant d'en avoir la preuve.

## Installation sur le téléphone

Ouvrir l'URL dans Chrome sur Android, puis menu → « Ajouter à l'écran d'accueil ». L'application s'installe avec son icône et s'ouvre en plein écran, sans passer par un store.

## Développement

```sh
pnpm install
pnpm dev         # serveur de développement
pnpm test        # toute la logique de temps, horloge injectée
pnpm typecheck   # TypeScript strict
pnpm build       # bundle de production + service worker + manifest
pnpm preview     # sert le build — le seul moyen de tester la PWA installée
```

Le service worker est **désactivé en développement** : un cache périmé sur une pendule fait perdre du temps de diagnostic pour rien. Pour vérifier l'installation et le hors-ligne, passer par `pnpm build && pnpm preview`.

Pour tester depuis le téléphone sur le réseau local : `pnpm preview --host`.

Les icônes sont générées une fois par `node scripts/generate-icons.mjs` et versionnées ; le script ne tourne pas au build.

### Où est quoi

| Chemin | Rôle |
|---|---|
| `src/domain/fold.ts` | **Le cœur.** Dérive tout l'affichage du journal, en pur. Aucun temps n'y est décrémenté ailleurs |
| `src/domain/commands.ts` | La seule couche autorisée à faire grandir le journal, append-only |
| `src/domain/clock.ts` | L'interface `Clock` injectée, et le seul `Date.now()` du projet |
| `src/persistence/` | Codec pur, adaptateur de stockage, journaux exportés rejouables en test |
| `src/ui/` | Disposition, rendu idempotent, formatage |
| `src/app.ts` | Racine de composition : horloge, stockage, audio et wake lock y sont injectés |

## Documentation

| Fichier | Contenu |
|---|---|
| [`SPECS.md`](./SPECS.md) | La spécification : périmètre, cadences, ergonomie, modèle de données, découpage des versions |
| [`CLAUDE.md`](./CLAUDE.md) | Conventions du projet et contraintes techniques dures, pour moi comme pour Claude |
| [`docs/ideation/`](./docs/ideation/) | Pistes explorées, retenues et écartées, avec leurs raisons |
| [`docs/solutions/`](./docs/solutions/) | Pièges rencontrés pour de vrai, et ce qu'il fallait comprendre pour s'en sortir |

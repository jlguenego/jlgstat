# Évolution 01 : analyser un dépôt Git distant à partir de son URL

Demande initiale : [01-url.md](01-url.md).

**Statut : implémentée.** La référence est désormais la spécification détaillée, §3.4 (décisions 35 à 42). Pendant l'implémentation, trois points ont été précisés par rapport à ce document :

- la récupération utilise `git init` + `fetch` au lieu de `git clone` (voir « Récupération minimale ») ;
- les fichiers sont extraits tels que stockés dans le dépôt ;
- `--ref` exige un SHA complet pour un commit.

## Besoin reformulé

L'argument positionnel de `jlgstat` peut être soit un chemin local (comportement actuel), soit l'URL d'un dépôt Git :

```bash
npx jlgstat https://github.com/owner/repo
npx jlgstat https://github.com/owner/repo/tree/dev/src      # URL copiée du navigateur
npx jlgstat git@github.com:owner/repo.git --ref v2.1.0
npx jlgstat https://github.com/owner/repo --keep-clone
npx jlgstat --clear-cache
```

Avec une URL, `jlgstat` :

1. récupère avec la commande `git` le **minimum nécessaire** : la dernière version de la branche par défaut du dépôt (le `HEAD` distant), ou celle de `--ref`, sans l'historique ;
2. produit exactement le même rapport que pour un répertoire local, avec toutes les options existantes (`--json`, `--output`, `--compare`, `--include`, `--exclude`, `--all`…) ;
3. supprime le clone à la fin, que l'analyse réussisse, échoue ou soit interrompue, sauf avec `--keep-clone`.

## Décisions

### Dépendance à Git et principe « sans réseau »

- `jlgstat` **délègue la récupération à la commande `git`** installée sur la machine. Il en hérite les mécanismes d'authentification (credential helper, clés SSH, configuration du proxy). Il n'embarque aucune dépendance npm supplémentaire.
- Si `git` n'est pas dans le PATH, on affiche un message clair et on sort avec le code `1`. Cela ne concerne que le mode URL : l'analyse d'un répertoire local ne demande jamais `git`.
- Le principe « sans appel réseau » devient : **aucun appel réseau, sauf quand l'utilisateur fournit explicitement une URL**, et dans ce cas uniquement à travers `git`.

### URLs acceptées

On reconnaît comme URL (et non comme chemin) un argument qui :

- commence par `https://`, `http://`, `ssh://`, `git://` ou `file://` ;
- ou a la forme SCP `user@host:chemin` (ex. `git@github.com:owner/repo.git`).

Les URLs copiées depuis le navigateur sont décomposées en *dépôt + ref + sous-dossier* :

| Forge     | Forme navigateur                         |
|-----------|------------------------------------------|
| GitHub    | `…/owner/repo/tree/<ref>/<chemin>`       |
| GitLab    | `…/group/repo/-/tree/<ref>/<chemin>`     |
| Bitbucket | `…/owner/repo/src/<ref>/<chemin>`        |

- Un nom de ref peut contenir des `/` (`feature/x`). On lève l'ambiguïté avec `git ls-remote` : on choisit la plus longue ref existante qui préfixe le reste du chemin.
- Le **sous-dossier** est analysé seul, comme `jlgstat <sous-dossier>` en local. Le clone utilise alors un sparse checkout pour ne télécharger que ce sous-dossier.
- Une URL `…/blob/…` (un fichier) est refusée avec une erreur d'usage.
- Un suffixe `.git`, une barre oblique finale, une query string ou un fragment sont ignorés.

### Option `--ref <branche|tag|commit>`

- Elle analyse la branche, le tag ou le commit indiqué au lieu de la branche par défaut.
- Si l'URL contient déjà une ref, **`--ref` l'emporte**. Un avertissement sur stderr est affiché si les deux valeurs diffèrent.
- Un SHA de commit **complet** est récupéré par `git fetch --depth 1 origin <sha>`, si le serveur l'autorise. Un SHA abrégé est refusé, car `git fetch` ne l'accepte pas.
- `--ref` sans URL est une erreur d'usage.

### Récupération minimale

- On n'utilise pas `git clone`. Chaque copie `<entry>/` contient un dépôt `<entry>/git/` (créé par `git init`, avec `core.worktree` pointant vers `tree/`) et un arbre de travail `<entry>/tree/` **sans dossier `.git`**. Les métadonnées Git ne sont donc jamais analysées, même avec `--all`.
- Séquence suivie :
  1. `git ls-remote --symref` résout la branche par défaut, la ref demandée et le découpage des URLs navigateur ;
  2. `git fetch --depth 1 --no-tags origin <ref|sha>` récupère le commit ;
  3. `git checkout --force --detach <commit>` l'extrait.
  Une entrée réutilisée suit la même séquence, suivie d'un `git clean`.
- Avec un sous-dossier, le fetch est partiel (`--filter=blob:none`, avec la configuration de promisor) et l'extraction utilise un sparse checkout. Si le serveur refuse le filtre, on récupère le commit en entier.
- Les fichiers sont extraits **tels que stockés**. `git/info/attributes` contient `* -text -filter -ident`, ce qui empêche toute conversion de fin de ligne et tout filtre (LFS compris), quelle que soit la configuration Git de la machine.
- Aucun hook n'est exécuté (`core.hooksPath` neutralisé) et le transport `ext::` est interdit.
- La sortie standard de `git` ne doit jamais polluer stdout (qui peut contenir le JSON). Ses messages vont sur stderr.
- Si stdin n'est pas un TTY, on positionne `GIT_TERMINAL_PROMPT=0` pour ne pas bloquer en attendant un mot de passe.

### Cache et `--keep-clone`

- **Emplacement du cache** : `%LOCALAPPDATA%\jlgstat` (Windows), `~/Library/Caches/jlgstat` (macOS), `$XDG_CACHE_HOME/jlgstat` ou sinon `~/.cache/jlgstat` (Linux). La variable `JLGSTAT_CACHE_DIR` permet de le changer. Les clones gardés vont dans `repos/`, les clones temporaires dans `tmp/`.
- **Clé d'une entrée** : l'URL normalisée (hôte + chemin, sans identifiants, la même en HTTPS et en SSH), la ref demandée et le sous-dossier.
- **Sans `--keep-clone`** : on clone dans `<cache>/tmp/`, puis on le supprime à la fin.
- **Avec `--keep-clone`** : le clone est créé (ou réutilisé) dans le cache et conservé. Son chemin est affiché sur stderr.
- **Entrée déjà présente dans le cache** : elle est **réutilisée et mise à jour** par un fetch superficiel (`--depth 1`) suivi d'un reset sur la ref, avec ou sans `--keep-clone`. Sans `--keep-clone`, l'entrée est supprimée à la fin du run. Le cache n'est donc persistant que tant que l'utilisateur le demande.
- La suppression est garantie en cas d'erreur. Sur SIGINT/SIGTERM, elle est tentée ; si le système la refuse, le reste est éliminé par `--clear-cache`, qui le reconnaît grâce au marqueur écrit dès la création de la copie.

### Option `--clear-cache`

- `jlgstat --clear-cache` vide tout le cache `jlgstat`, affiche le nombre d'entrées et la place libérée, puis quitte sans faire d'analyse.
- `jlgstat <url> --clear-cache` ne supprime que les entrées de ce dépôt.
- Si on la combine avec un chemin local, c'est une erreur d'usage.

### Rapport JSON

- `root` contient l'URL **nettoyée** (sans `user:token@`), suivie du sous-dossier s'il y en a un. Le chemin du clone n'apparaît jamais dans le rapport.
- Nouveau champ `source`, présent seulement en mode URL : `{ "url": string, "ref": string, "commit": string, "path": string | null }`. `ref` est le nom effectivement résolu (par exemple `main`), et `commit` le SHA complet.
- C'est un ajout de champ, donc `SCHEMA_VERSION` passe à la version mineure suivante. Il faut mettre à jour `report/model.ts`, `schema/jlgstat.schema.json` et `schema/example.json`.
- Le rendu terminal affiche aussi l'URL, la ref et le commit court dans l'en-tête.

### Erreurs et codes de sortie

- Code `1` dans les cas suivants : `git` absent, dépôt introuvable, accès refusé, réseau indisponible, ref inexistante, sous-dossier inexistant. Le message reprend la cause renvoyée par `git`, sans identifiants.
- Le code `2` (rapport partiel) garde la même signification qu'aujourd'hui.

### Invariants

- **Lecture seule** : on n'écrit que dans le dossier temporaire ou dans le cache. C'est une exception explicite, à documenter.
- Le dossier `.git` du clone est exclu de l'analyse. Il faut vérifier qu'il fait partie des exclusions par défaut, y compris avec `--all`.
- La sortie reste déterministe pour un commit donné.

## Hors périmètre

- Les sous-modules : ils ne sont pas récupérés.
- Git LFS : on compte les fichiers pointeurs, pas le contenu réel. C'est à signaler dans la documentation.
- Plusieurs URLs dans une même commande.
- Un client Git embarqué ou un téléchargement d'archive par une API de forge.
- Le verrouillage du cache contre deux runs simultanés sur la même entrée.

## Tests

- Aucun appel réseau dans la suite de tests.
- On crée un petit dépôt Git local à l'exécution avec `makeTree()` + `git init`/`commit` (plusieurs branches, un tag, un sous-dossier), puis on le clone par une URL `file://`.
- Cas couverts :
  - branche par défaut ;
  - `--ref` (branche, tag) ;
  - priorité de `--ref` sur l'URL ;
  - sous-dossier ;
  - `--keep-clone` puis réutilisation et mise à jour ;
  - suppression sans `--keep-clone` ;
  - `--clear-cache` global et ciblé ;
  - ref inexistante (code 1) ;
  - `git` absent, en simulant un PATH vide (code 1) ;
  - nettoyage des identifiants dans `root` et `source.url` ;
  - validation du JSON contre le schéma.
- Tests unitaires de l'analyse des URLs navigateur (GitHub, GitLab, Bitbucket, SCP, refs avec `/`).
- Les tests qui demandent `git` sont ignorés si `git` est absent.

## Documentation à mettre à jour

- `specification-detaillee/01-vision-perimetre.md` : le principe réseau.
- La section CLI de la spec : l'argument URL, `--ref`, `--keep-clone`, `--clear-cache`, `JLGSTAT_CACHE_DIR`.
- La section format JSON : `root` et `source`.
- `09-decisions.md` : les décisions ci-dessus.
- `README.md` et l'aide de `--help`, en anglais.

# jlgstat — Spécification détaillée : interface en ligne de commande

[← Sommaire](README.md)

## 3. Interface en ligne de commande

```text
jlgstat [path] [options]

path                  Répertoire ou URL de dépôt Git à analyser (défaut : .)
--json                Rapport JSON sur stdout, sans texte décoratif
--depth <n>           Profondeur maximale d'agrégation affichée des répertoires (défaut : 2)
--largest <n>         Nombre de fichiers du classement (défaut : 10)
--all                 Inclut les fichiers normalement exclus/ignorés, sous réserve de sécurité
--include <glob>      Filtre d'inclusion ; option répétable
--exclude <glob>      Exclusion supplémentaire ; option répétable
--compare <file>      Compare l'analyse courante à un snapshot JSON antérieur
--output <file>       Écrit le rapport au chemin indiqué
--ref <ref>           Branche, tag ou SHA complet à analyser (URL seulement)
--keep-clone          Conserve le dépôt récupéré dans le cache de jlgstat
--clear-cache         Supprime les dépôts conservés (tous, ou ceux de l'URL donnée), puis quitte
--quiet               Supprime l'indicateur de progression et la confirmation sur stderr
--no-color            Désactive les couleurs
--help                Affiche l'aide
--version             Affiche la version
```

Exemples :

```bash
npx jlgstat
npx jlgstat .
npx jlgstat ./packages/frontend
npx jlgstat . --depth 3
npx jlgstat . --largest 20
npx jlgstat . --json > before.json
npx jlgstat . --output before.json
npx jlgstat . --compare before.json
npx jlgstat . --all
npx jlgstat https://github.com/owner/repo
npx jlgstat https://github.com/owner/repo/tree/dev/src --json
npx jlgstat git@github.com:owner/repo.git --ref v2.0.0 --keep-clone
npx jlgstat --clear-cache
```

**Conventions :**

- `--depth` limite l'agrégation *affichée* et non le scan ; les totaux restent ceux de l'ensemble du périmètre. `--largest 0` masque le classement.
- Les options invalides produisent une erreur explicite et un code de sortie `1`.
- `path` doit désigner un **répertoire** ou une **URL de dépôt** (§3.4). Un fichier, un chemin inexistant ou plusieurs chemins produisent une erreur explicite (code `1`). Pour cibler des fichiers précis, utiliser `--include`.
- `--ref` et `--keep-clone` exigent une URL ; `--clear-cache` n'accepte qu'une URL ou rien, et ne se combine pas avec `--ref` ni `--keep-clone` (code `1` sinon).

### 3.1 Syntaxe des filtres

`--include` et `--exclude` utilisent **la syntaxe `.gitignore`**, avec le même moteur que pour les fichiers `.gitignore` :

- motifs relatifs au répertoire analysé, séparateur `/` sur tous les OS ;
- `*.ts` correspond à toute profondeur, `/scripts` uniquement à la racine, `fixtures/` à tout répertoire de ce nom, `src/**` à tout ce qui est sous `src/` ;
- insensibles à la casse sous Windows et macOS, sensibles sous Linux ;
- interprétation indépendante du shell : citer les motifs (`"*.ts"`) est recommandé dans la documentation.

### 3.2 Ordre d'application des filtres

1. Base : tout l'arbre sous la racine.
2. Exclusions par défaut (§4.1) et règles `.gitignore`. **`--all` saute cette étape.**
3. `--include` : si au moins un motif est fourni, seuls les fichiers qui correspondent sont conservés. `--include` ne réintègre jamais un fichier écarté à l'étape 2.
4. `--exclude` : retire les fichiers correspondants. **`--exclude` l'emporte toujours.**

Les protections de sécurité (liens symboliques de répertoires, fichiers spéciaux, erreurs d'accès) s'appliquent à toutes les étapes et ne sont jamais levées, y compris avec `--all`.

### 3.3 `--output`

- Le format est déduit de l'extension : `.json` → JSON ; toute autre extension → rapport texte sans couleurs. `--json` force le JSON quelle que soit l'extension.
- Un fichier existant est **écrasé**, comme avec une redirection `>`. L'écriture passe par un fichier temporaire dans le même répertoire puis un renommage atomique : jamais de fichier à moitié écrit.
- Avec `--output`, stdout reste vide ; une ligne de confirmation est écrite sur stderr (supprimée par `--quiet`).

### 3.4 Analyse d'un dépôt distant

L'argument `path` peut être l'URL d'un dépôt Git. `jlgstat` récupère alors le minimum nécessaire avec la commande `git` installée sur la machine, analyse le résultat exactement comme un répertoire local (mêmes options : `--json`, `--output`, `--compare`, `--include`, `--exclude`, `--all`…), puis supprime la copie.

**Sous-modules.** Jamais récupérés, quelle que soit la configuration Git de la machine (`submodule.recurse`).

**Dépendance à `git`.** `jlgstat` délègue la récupération à `git` et en hérite les mécanismes d'authentification (credential helper, clés SSH, proxy). Aucun client Git n'est embarqué. Si `git` est absent du PATH : message explicite et code `1`. L'analyse d'un répertoire local n'utilise jamais `git`.

**URLs reconnues.** Un argument est une URL s'il commence par `https://`, `http://`, `ssh://`, `git://` ou `file://`, ou s'il a la forme SCP `user@host:chemin`. Un répertoire local existant portant ce nom reste prioritaire. Le suffixe `.git`, la barre oblique finale, la query string et le fragment sont ignorés pour l'identité du dépôt ; un port non standard en fait partie.

**URLs copiées du navigateur.** Elles sont décomposées en *dépôt + ref + sous-dossier* :

| Forge | Forme |
|---|---|
| GitHub (et toute forge au même format) | `…/owner/repo/tree/<ref>/<chemin>` |
| GitLab | `…/group/repo/-/tree/<ref>/<chemin>` |
| Bitbucket | `…/owner/repo/src/<ref>/<chemin>` |

Un nom de ref pouvant contenir des `/`, le découpage retient la plus longue branche ou le plus long tag du dépôt (`git ls-remote`) qui préfixe le reste de l'URL ; la suite est le sous-dossier, analysé seul. Une URL `…/blob/…` (un fichier) est refusée.

**`--ref <ref>`.** Analyse une branche, un tag ou un commit (SHA **complet**) au lieu de la branche par défaut (le `HEAD` du dépôt distant). Si l'URL contient déjà une ref, `--ref` l'emporte et un avertissement est écrit sur stderr lorsque les deux diffèrent. Une ref inexistante produit le code `1`.

**Récupération minimale.** Sans historique : `git init`, puis `git fetch --depth 1 --no-tags origin <ref>`, puis `git checkout` du commit. Avec un sous-dossier, le fetch est partiel (`--filter=blob:none`) et l'extraction limitée au sous-dossier (sparse checkout), si le serveur le permet ; sinon le commit est récupéré en entier. Chaque copie comporte un dépôt `git/` et un arbre de travail `tree/` **sans dossier `.git`** : les métadonnées Git ne sont jamais analysées, même avec `--all`.

**Fichiers tels que stockés.** L'extraction n'applique ni conversion de fin de ligne, ni filtre (`.gitattributes` neutralisé, Git LFS non résolu) : le résultat est le même sur tous les OS et indépendant de la configuration Git de la machine.

**Cache et `--keep-clone`.** Le cache se trouve dans `JLGSTAT_CACHE_DIR` si cette variable est définie, sinon dans `%LOCALAPPDATA%\jlgstat` (Windows), `~/Library/Caches/jlgstat` (macOS) ou `$XDG_CACHE_HOME/jlgstat` (à défaut `~/.cache/jlgstat`, Linux).

- Sans `--keep-clone`, la copie est faite dans `<cache>/tmp/` et supprimée à la fin, que l'analyse réussisse ou échoue. Sur interruption (Ctrl+C), la suppression est tentée ; si le système la refuse, le reste est éliminé par `--clear-cache`.
- Avec `--keep-clone`, la copie est conservée dans `<cache>/repos/`, une entrée par dépôt, ref demandée et sous-dossier ; son chemin est écrit sur stderr (sauf `--quiet`).
- Si une entrée conservée existe, elle est réutilisée et mise à jour (fetch superficiel) ; sans `--keep-clone`, elle est supprimée à la fin du run.

**`--clear-cache`.** `jlgstat --clear-cache` supprime toutes les entrées conservées et les restes de runs interrompus, affiche le nombre d'entrées et la place libérée, puis quitte avec le code `0` sans analyse (message supprimé par `--quiet`). `jlgstat <url> --clear-cache` ne supprime que les entrées de ce dépôt. Seuls les dossiers portant le marqueur `jlgstat-entry.json`, écrit dès la création de chaque copie, sont supprimés. Un répertoire local dont le nom ressemble à une URL est refusé (code `1`).

**Messages.** Sauf `--quiet`, `jlgstat` écrit sur stderr le dépôt et la ref récupérés. Les identifiants éventuellement présents dans l'URL (`https://user:token@…`) n'apparaissent jamais dans les messages ni dans le rapport.

**Hors périmètre.** Sous-modules (non récupérés), contenu Git LFS (les fichiers pointeurs sont comptés), plusieurs URLs dans une même commande, client Git embarqué, verrouillage du cache entre deux runs simultanés.

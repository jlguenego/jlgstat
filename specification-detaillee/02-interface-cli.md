# jlgstat — Spécification détaillée : interface en ligne de commande

[← Sommaire](README.md)

## 3. Interface en ligne de commande

```text
jlgstat [path] [options]

path                  Répertoire à analyser (défaut : .)
--json                Rapport JSON sur stdout, sans texte décoratif
--depth <n>           Profondeur maximale d'agrégation affichée des répertoires (défaut : 2)
--largest <n>         Nombre de fichiers du classement (défaut : 10)
--all                 Inclut les fichiers normalement exclus/ignorés, sous réserve de sécurité
--include <glob>      Filtre d'inclusion ; option répétable
--exclude <glob>      Exclusion supplémentaire ; option répétable
--compare <file>      Compare l'analyse courante à un snapshot JSON antérieur
--output <file>       Écrit le rapport au chemin indiqué
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
```

**Conventions :**

- `--depth` limite l'agrégation *affichée* et non le scan ; les totaux restent ceux de l'ensemble du périmètre. `--largest 0` masque le classement.
- Les options invalides produisent une erreur explicite et un code de sortie `1`.
- `path` doit désigner un **répertoire**. Un fichier, un chemin inexistant ou plusieurs chemins produisent une erreur explicite (code `1`). Pour cibler des fichiers précis, utiliser `--include`.

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

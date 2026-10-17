# jlgstat — Spécification détaillée : parcours et comptage

[← Sommaire](README.md)

## 4. Règles de parcours et de périmètre

### 4.1 Mode par défaut

- Parcours récursif du répertoire cible.
- Respect des fichiers `.gitignore` (racine et imbriqués, y compris les négations), **qu'un dépôt Git soit présent ou non**. Le résultat est identique pour un dépôt et pour une copie sans `.git`.
- `.git/info/exclude` et le `core.excludesFile` global ne sont **pas** lus : le résultat ne doit pas dépendre de la configuration de la machine.
- Seuls les `.gitignore` situés sous la racine analysée sont pris en compte ; ceux des répertoires parents sont ignorés.
- Exclusion par défaut des dépendances, artefacts et caches usuels (liste au §4.1.1). La liste est versionnée dans le code et publiée dans la documentation.
- Les exclusions par défaut sont explicites, stables et visibles dans les métadonnées du rapport.
- Ne pas suivre les liens symboliques de répertoires afin d'éviter les cycles et les sorties du périmètre ; signaler les liens ignorés.
- Ne pas scanner les fichiers binaires comme du texte.
- Fichiers illisibles : les compter dans les anomalies, continuer l'analyse et signaler le caractère partiel des résultats.
- Ignorer par défaut les fichiers spéciaux (sockets, périphériques, pipes).
- Les liens symboliques ignorés et les fichiers spéciaux sont des **exclusions**, pas des anomalies : ils ne rendent pas l'analyse partielle.

#### 4.1.1 Liste des exclusions par défaut

Noms de répertoires exclus **à toute profondeur**, en correspondance exacte :

| Écosystème | Répertoires |
|---|---|
| VCS | `.git`, `.hg`, `.svn` |
| JavaScript | `node_modules`, `.next`, `.nuxt`, `.svelte-kit`, `.turbo`, `.parcel-cache`, `.cache`, `dist`, `build`, `out`, `coverage`, `.nyc_output`, `storybook-static` |
| Python | `__pycache__`, `.venv`, `venv`, `.tox`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `*.egg-info` |
| JVM | `.gradle` |
| PHP / Ruby | `vendor`, `.bundle` |
| IaC | `.terraform` |

Fichiers exclus : `.DS_Store`, `Thumbs.db`.

**Exclusions conditionnelles** : ces répertoires ne sont exclus que si un fichier de projet de l'écosystème correspondant se trouve dans le **même répertoire parent**.

| Répertoire | Exclu seulement si le parent contient |
|---|---|
| `bin`, `obj` | `*.csproj`, `*.fsproj`, `*.vbproj` ou `*.sln` |
| `target` | `Cargo.toml`, `pom.xml`, `build.gradle` ou `build.gradle.kts` |

Ainsi, le `bin/` d'un CLI Node ou un répertoire de scripts reste analysé.

**Non exclus** : `.vscode`, `.idea` et les autres dossiers de configuration d'éditeur. Ils sont petits, souvent versionnés, et sont classés en « configuration ».

Les lockfiles, `*.min.js` et `*.map` **ne sont pas exclus** : ils sont inventoriés et rangés dans la catégorie « générés » (§5.5).

### 4.2 Mode `--all`

Inclut les éléments normalement écartés par `.gitignore` et les exclusions techniques par défaut, **mais** conserve les protections contre cycles de liens, fichiers spéciaux et erreurs d'accès. Les fichiers binaires sont inventoriés sans comptage de lignes. Le rapport distingue clairement ce mode du mode par défaut.

### 4.3 Conventions de comptage

- **Fichier :** fichier régulier inclus dans le périmètre, binaire ou texte ; distinguer fichiers texte analysés et fichiers binaires.
- **Lignes physiques :** nombre de lignes d'un fichier texte, en considérant LF, CRLF et CR comme fins de ligne. Un fichier vide contient 0 ligne ; un fichier `abc` sans saut final contient 1 ligne ; `abc\n` contient 1 ligne ; `abc\n\n` contient 2 lignes.
- **Lignes non vides :** lignes contenant au moins un caractère qui n'est pas un blanc au sens de la classe `\s` de JavaScript (espace, tabulation, espaces Unicode dont NBSP, BOM…). Pour les fichiers en repli 8 bits (§4.4), seuls l'espace, la tabulation, FF et VT sont des blancs.
- **Lignes de commentaires :** lignes de commentaire identifiées par le moteur de syntaxe (§5.6) ; pour les formats non reconnus, valeur `null` (non calculable), jamais d'estimation présentée comme exacte.
- **Lignes de code :** dans la sortie, distinguer explicitement `physicalLines`, `nonEmptyLines` et, lorsque calculable, `codeLines` (hors blancs et commentaires). Le terme « lignes de code » n'est jamais utilisé pour désigner sans précision des lignes physiques.
- **Taille :** octets logiques des fichiers inclus, sans prétendre mesurer les blocs réellement occupés sur disque.
- **Dossiers :** nombre de répertoires effectivement traversés, racine exclue ; profondeur maximale relative à la racine (racine = 0).
- **Extensions :** suffixe du nom de fichier **converti en minuscules** (`App.TS` → `.ts`). Un nom commençant par un point et sans autre point (`.gitignore`, `.env`) est rangé dans `[sans extension]`, comme les fichiers sans point (`Makefile`) ; `.eslintrc.json` a l'extension `.json`. Les extensions composées (`.d.ts`, `.test.ts`) sont regroupées par extension simple dans le tableau principal et peuvent recevoir une classification additionnelle.
- **Langages :** regroupement selon une table de correspondance versionnée (ex. `.ts` + `.tsx` → TypeScript, `.yml` + `.yaml` → YAML) ; le tableau par extension est la source de vérité, notamment pour les formats ambigus.

### 4.4 Texte, binaire et encodages

- **Binaire :** détection par signatures et par contenu sur les premiers octets (au plus quelques Ko) ; un fichier binaire n'est jamais lu intégralement.
- **UTF-8**, avec ou sans BOM : décodé et compté normalement.
- **UTF-16 LE/BE** : détecté par le BOM, décodé et compté normalement.
- **Repli 8 bits :** tout autre fichier non binaire (Latin-1, Windows-1252, etc.) est compté au niveau des octets — les fins de ligne LF/CR étant identiques, le comptage des lignes reste exact — et marqué `encoding: "unknown-8bit"`.
- Aucune bibliothèque de détection statistique d'encodage (type chardet) : le résultat doit rester déterministe.
- **Fichiers volumineux :** pas de plafond de taille. Tout fichier texte est compté entièrement, en flux, par blocs (64 Ko), avec une mémoire constante. Les fichiers de plus de 50 Mo sont listés dans un avertissement informatif (qui n'affecte pas `complete`).

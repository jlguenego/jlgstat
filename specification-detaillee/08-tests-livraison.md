# jlgstat — Spécification détaillée : tests et livraison

[← Sommaire](README.md)

## 11. Tests et critères d'acceptation

### 11.1 Tests fonctionnels

- Répertoire vide ; fichier vide ; fichier sans saut final ; CRLF/LF/CR ; lignes vides ; lignes ne contenant que des blancs Unicode.
- Fichiers sans extension, dotfiles, extensions multiples, casse des extensions, noms Unicode.
- JSON/YAML/Markdown/TypeScript/Python et fichiers inconnus.
- Fichiers binaires, fichiers très gros, UTF-8 avec et sans BOM, UTF-16 LE/BE, Latin-1/Windows-1252.
- `.gitignore` racine et imbriqué, règles de négation, avec et sans `.git`, dossiers techniques, `--all`, `--include`, `--exclude` et leurs combinaisons (§3.2).
- Liens symboliques et cycles, accès refusé, fichiers supprimés pendant l'analyse.
- Cible qui est un fichier ou qui n'existe pas.
- Agrégation par dossier sans double comptage dans les totaux globaux ; entrée `./ (root files)`.
- Percentiles et seuils validés sur des jeux de données calculés à la main.
- Commentaires : chaînes contenant des marqueurs de commentaire, lignes mixtes, blocs multilignes ; résultats confrontés à `scc`.
- Sortie JSON parsable et conforme au schéma, même sur analyse partielle.
- `--output` : écrasement, choix du format par extension, écriture atomique.
- Comparaison avec zéro initial, snapshots non homogènes et version majeure incompatible.
- Codes de sortie `0`, `1` et `2`.

### 11.2 Matrice de compatibilité

CI sur Windows, macOS et Linux, avec Node.js 22 et 24 ; l'installation, le typage, le build et les tests passent par Bun (`bun install --frozen-lockfile`, `bun test`). Tests du binaire npm réellement packagé (`bun pm pack`, installation de l'archive, puis exécution du binaire installé sous Node.js), pas uniquement des scripts de développement.

### 11.3 Critères d'acceptation UX

1. `npx jlgstat .` fonctionne sans configuration ni interaction sur les trois OS.
2. `npx jlgstat` analyse le dossier courant.
3. Le rapport identifie immédiatement le volume total, les extensions dominantes et les fichiers/répertoires les plus volumineux.
4. `--json` produit un objet JSON exploitable automatiquement, sans bruit stdout.
5. Aucun fichier du projet n'est modifié et aucune donnée n'est transmise par l'outil.
6. Les exclusions et les analyses partielles sont explicites.
7. Les résultats sont reproductibles pour un même corpus, mêmes options et même version, quelle que soit la locale ou la configuration Git de la machine.
8. Les performances sont mesurées et publiées sur des corpus représentatifs.

## 12. Découpage de réalisation proposé

**Lot A — Fondations P0 :** packaging npm, CLI, parcours, exclusions, comptage fiable, inventaire extensions, synthèse, JSON, tests OS.

**Lot B — Radiographie P0 :** distribution P50/P90/P99, seuils, concentration, plus gros fichiers, agrégation répertoires, `--depth`, `--largest`, UX terminal.

**Lot C — Enrichissements P1 :** commentaires/blancs, catégories, volume de sources classifiées, `--all` et filtres avancés, comparaison de snapshots.

**Lot D — Industrialisation :** benchmarks, robustesse extrême, documentation, publication npm, CI et fixtures de non-régression.

# jlgstat — Spécification détaillée : métriques

[← Sommaire](README.md)

## 5. Métriques obligatoires

### 5.1 Synthèse générale (P0)

- Nombre total de fichiers inclus ; nombre de fichiers texte, binaires et illisibles.
- Nombre total de lignes physiques et non vides des fichiers texte analysables.
- Taille cumulée en octets (avec présentation lisible, voir §6.1).
- Nombre de dossiers traversés et profondeur maximale.
- Nombre d'extensions distinctes ; nombre de langages détectés si applicable.
- Durée d'analyse en millisecondes.
- Mode de parcours, nombre d'exclusions, nombre d'anomalies et indicateur de complétude.

### 5.2 Tableau par extension et par langage (P0)

Pour chaque extension :

- Nombre de fichiers.
- Nombre de lignes physiques.
- Nombre de lignes non vides.
- Taille en octets.
- Pourcentage du volume total de lignes physiques analysées.
- Moyenne de lignes par fichier.

Tri initial par nombre de lignes décroissant ; ordre stable en cas d'égalité (puis par extension, ordre lexicographique). Les fichiers JSON, YAML, Markdown, HTML, CSS, SQL, etc. restent visibles : ne pas les éliminer sous prétexte qu'ils ne sont pas du code exécutable.

La vue par langage figure toujours dans le JSON (`byLanguage`). Dans le terminal, elle n'est affichée **que si elle regroupe effectivement plusieurs extensions** ; sinon elle ferait doublon avec le tableau par extension.

### 5.3 Distribution des tailles (P0)

- Taille moyenne et médiane (P50) en lignes physiques, sur les fichiers texte analysables.
- P90 et P99, calculés selon la méthode **nearest-rank**.
- Taille du plus grand fichier.
- Nombre de fichiers strictement supérieurs à 500, 1 000 et 5 000 lignes.
- Pourcentage de lignes concentrées dans les 10 fichiers les plus volumineux.
- Top 10 des fichiers par nombre de lignes, avec chemin relatif, extension, lignes et octets ; `--largest` modifie sa longueur.

Ces mesures décrivent la **distribution/fragmentation** du code, sans prétendre mesurer directement sa complexité.

### 5.4 Répartition par répertoire (P0)

- Top 10 des répertoires par volume de lignes, avec nombre de fichiers et octets.
- Agrégation **cumulative** des descendants, signalée dans l'en-tête de colonne (« cumulative ») pour éviter de sommer deux fois parents et enfants.
- Par défaut, le terminal montre les répertoires jusqu'à la **profondeur 2**, avec indentation pour rendre la hiérarchie visible ; `--depth <n>` modifie ce niveau. Le JSON contient tous les répertoires, avec leur profondeur.
- Une pseudo-entrée **`./ (root files)`** regroupe les fichiers situés directement à la racine. La somme des répertoires de niveau 1 et de cette entrée est égale au total.
- Chemins relatifs, séparateurs normalisés `/` dans le JSON.

Exemple :

```text
Directory (cumulative)     Files     Lines
src/                         620   150,000
  src/app/                   310    80,000
  src/lib/                   200    52,000
tests/                       150    30,000
./ (root files)               12     1,400
```

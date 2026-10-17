# jlgstat — Spécification détaillée : terminal, JSON et comparaison

[← Sommaire](README.md)

## 6. Présentation terminal

Rapport par défaut structuré ainsi :

1. En-tête `jlgstat`, chemin cible, mode et durée.
2. Synthèse chiffrée : fichiers, lignes, taille, extensions.
3. Tableau par extension (et regroupement par langage si pertinent, §5.2).
4. Distribution : moyenne, P50/P90/P99, seuils et concentration top 10.
5. Top 10 des plus gros fichiers.
6. Top 10 des répertoires.
7. Répartition par catégories si disponible.
8. Avertissements et exclusions significatives.
9. Mention d'auteur, en pied de rapport : `jlgstat: an idea by Jean-Louis GUENEGO (JLG), developed with AI.` (également en fin d'aide `--help` et dans le champ JSON `credit`, §7.2).

Contraintes UX : affichage lisible en terminal étroit, chiffres alignés, unités homogènes, couleurs optionnelles, aucune animation imposée ; `NO_COLOR` respecté.

### 6.1 Format des nombres

Format **fixe, indépendant de la locale**, pour des sorties déterministes et comparables : séparateur de milliers `,` (`1,234,567`), tailles en **base 1000** (`kB`, `MB`, `GB`, comme npm), pourcentages avec une décimale.

### 6.2 Très grands dépôts

Pas de mode séparé : le rapport a la même structure quelle que soit la taille du dépôt. Les tableaux ont des plafonds fixes :

- tableau des extensions : 15 lignes au plus, puis une ligne `+ N more extensions (X lines, Y %)` ;
- classements : 10 entrées (ou `--largest`).

Le JSON est toujours complet, sans troncature.

### 6.3 Progression

- Rien pendant la première seconde.
- Ensuite, une seule ligne réécrite sur place (`12,340 files…`) sur **stderr**, uniquement si stderr est un terminal (TTY), effacée avant l'affichage du rapport.
- Jamais en CI ni dans un pipe ; supprimée par `--quiet`. Jamais sur stdout.

## 7. JSON et intégration IA (P0)

`--json` écrit un **unique objet JSON valide** sur stdout. Diagnostics et erreurs vont sur stderr. Aucun texte de bannière, couleur ou progression ne pollue stdout. Champs numériques bruts non formatés ; champs absents représentés de manière cohérente (`null` quand non calculables).

### 7.1 Versionnement du schéma

- `schemaVersion` au format `majeur.mineur`.
- **Mineur :** uniquement des ajouts de champs. Les consommateurs doivent ignorer les champs inconnus.
- **Majeur :** renommage, suppression ou changement de sens d'un champ ; impose une version majeure de l'outil.
- Schéma 1.1 : ajout du champ `credit` (mention d'auteur).
- Un JSON Schema formel est publié dans le paquet npm, accompagné de fixtures de référence.

### 7.2 Structure indicative

```json
{
  "schemaVersion": "1.1",
  "toolVersion": "1.0.0",
  "credit": "jlgstat: an idea by Jean-Louis GUENEGO (JLG), developed with AI.",
  "root": ".",
  "scan": {
    "mode": "default",
    "durationMs": 842,
    "complete": true,
    "warnings": [],
    "excludedCount": 320,
    "defaultExcludes": ["node_modules", ".git", "dist"],
    "include": [],
    "exclude": []
  },
  "summary": {
    "files": 1540,
    "textFiles": 1500,
    "binaryFiles": 40,
    "unreadableFiles": 0,
    "directories": 130,
    "maxDepth": 7,
    "bytes": 15400000,
    "physicalLines": 210000,
    "nonEmptyLines": 174000
  },
  "byExtension": [
    {
      "extension": ".ts",
      "files": 800,
      "bytes": 9000000,
      "physicalLines": 120000,
      "nonEmptyLines": 99000,
      "shareOfPhysicalLines": 0.5714285714
    }
  ],
  "byLanguage": [],
  "distribution": {
    "mean": 140,
    "p50": 80,
    "p90": 350,
    "p99": 1100,
    "max": 6200,
    "over500": 90,
    "over1000": 20,
    "over5000": 1,
    "top10LineShare": 0.19
  },
  "largestFiles": [],
  "largestDirectories": [],
  "categories": []
}
```

Les valeurs ci-dessus sont illustratives. Le rapport JSON doit être compact mais suffisamment descriptif pour un agent ; une IA n'a pas besoin de lire tous les fichiers pour obtenir ces métriques.

## 8. Comparaison de snapshots (P1)

- `--json > before.json` ou `--output before.json` enregistre un état initial.
- `--compare before.json` analyse l'état courant puis affiche les différences absolues et relatives : fichiers, lignes, octets, extensions, catégories et principaux répertoires.
- **Homogénéité :**
  - version majeure de `schemaVersion` incompatible → erreur, code `1` ;
  - mode, exclusions par défaut ou filtres différents → la comparaison est faite, avec un avertissement en tête du rapport et `homogeneous: false` dans le JSON ;
  - la racine (`root`) n'est pas comparée, afin de pouvoir comparer deux clones ou deux emplacements.
- Éviter les pourcentages trompeurs lorsque la valeur initiale est zéro (`null` et mention « n/a »).
- Aucun besoin de Git ou d'historique Git.
- Une sortie `--json --compare ...` conserve un JSON valide contenant les données courantes et les écarts.

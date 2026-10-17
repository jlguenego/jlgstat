# jlgstat — Spécification détaillée : architecture et robustesse

[← Sommaire](README.md)

## 9. Performance et architecture

### 9.1 Contraintes et choix techniques

- CLI npm publié sous le nom **`jlgstat`** (nom disponible sur le registre npm au 17 octobre 2026), avec entrée `bin`, exécutable via `npx` sans installation globale.
- **Node.js ≥ 22** (`engines.node: ">=22"`), soit les LTS 22 et 24 : c'est le runtime des utilisateurs (`npx`).
- Code en **TypeScript strict**, compilé en **JavaScript ESM** ; le paquet publié ne contient que le code compilé, sans étape de build chez l'utilisateur. Licence **MIT**.
- Outillage de développement : **Bun** remplace npm et Node.js pour installer les dépendances (`bun install`, verrouillage par `bun.lock`, pas de `package-lock.json`), lancer les scripts (`bun run …`), exécuter les tests (`bun test`, runner intégré à Bun) et empaqueter (`bun pm pack`). Le code de `src/` n'utilise que les API Node.js (`node:*`), jamais d'API propre à Bun, afin que le paquet publié tourne sous Node.js. Node.js reste nécessaire en développement uniquement pour le test du paquet et les benchmarks, qui exécutent le CLI sous le runtime des utilisateurs.
- Pas de dépendance à Python, Go, Rust ou à un exécutable système installé séparément.
- Parcours asynchrone et lectures concurrentes **bornées** ; éviter de charger simultanément tous les fichiers en mémoire.
- Traitement en flux ou par blocs pour les gros fichiers ; gestion des backpressures et des limites de descripteurs ouverts.
- Ne jamais lire intégralement un fichier binaire massif pour simplement déterminer sa nature.
- Utiliser des bibliothèques npm matures lorsqu'elles améliorent la robustesse, l'ergonomie ou la performance ; éviter de multiplier les dépendances sans bénéfice.
- Candidats : `@nodelib/fs.walk` ou équivalent pour le parcours, `ignore` pour les règles `.gitignore` et les filtres, `isbinaryfile` pour les binaires, `picocolors` pour l'affichage, `commander` ou `node:util.parseArgs` pour la CLI.

### 9.2 Moteur de comptage

- Moteur **100 % Node.js**, sans binaire embarqué.
- `scc` sert d'**oracle** dans les tests et les benchmarks pour vérifier les chiffres, mais n'est pas une dépendance du paquet.
- La question d'un moteur externe ne sera rouverte que si les objectifs du §9.3 ne sont pas atteints.

### 9.3 Objectifs indicatifs à benchmarker

Sur SSD local, cache et machine de référence documentés :

| Corpus | Cible indicative |
|---|---:|
| 10 000 fichiers | moins de 2 s |
| 50 000 fichiers | moins de 5 s |
| 100 000 fichiers | moins de 10 s |

Ces chiffres sont **des objectifs**, pas des garanties ; mesurer aussi les octets lus, les lignes, le temps de démarrage, la mémoire maximale et la proportion de fichiers exclus. Le premier `npx` peut télécharger le package et dépend du réseau ; le benchmark du scanner doit isoler ce coût.

## 10. Robustesse, confidentialité et codes de sortie

- Aucune télémétrie, aucun envoi de fichiers ou de statistiques.
- Lecture seule ; ne pas créer de fichiers sauf demande explicite `--output` ou redirection du shell.
- Éviter les chemins absolus et les informations personnelles dans les sorties JSON par défaut ; chemins relatifs au projet.
- Ne jamais exécuter de code contenu dans le dépôt analysé.
- Les chemins avec espaces, Unicode, accents et caractères spéciaux doivent fonctionner.
- Éviter les fuites de ressources, les boucles de liens symboliques et les blocages sur des fichiers inaccessibles.

**Codes de sortie :**

| Code | Signification |
|---:|---|
| `0` | Analyse complète réussie |
| `1` | Erreur empêchant l'analyse : option invalide, chemin introuvable ou non répertoire, snapshot illisible ou incompatible, écriture `--output` impossible |
| `2` | Rapport produit mais partiel : fichiers illisibles, fichiers disparus pendant l'analyse, erreurs d'accès |

Les sorties partielles indiquent `complete: false` et détaillent les avertissements. Les liens ignorés, les fichiers spéciaux et les avertissements informatifs (gros fichiers) ne provoquent pas le code `2`.

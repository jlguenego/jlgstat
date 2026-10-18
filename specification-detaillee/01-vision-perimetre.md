# jlgstat — Spécification détaillée : vision et périmètre

[← Sommaire](README.md)

## 1. Vision et objectifs

`jlgstat` est un outil CLI npm permettant d'obtenir rapidement une radiographie **quantitative** d'un projet informatique, sans analyse sémantique, sans LLM, sans appel réseau par l'outil (sauf pour récupérer un dépôt explicitement désigné par son URL, §3.4) et sans configuration obligatoire.

Commande principale :

```bash
npx jlgstat .
```

La commande `npx jlgstat` analyse le répertoire courant. L'argument facultatif désigne un répertoire à analyser, ou l'URL d'un dépôt Git (§3.4) :

```bash
npx jlgstat https://github.com/owner/repo
```

### 1.1 Publics

- Développeurs découvrant un dépôt.
- Responsables techniques et consultants reprenant un projet important.
- Agents IA ayant besoin d'un résumé quantitatif avant d'explorer les sources.
- Équipes souhaitant suivre l'évolution du volume d'un projet.

### 1.2 Promesse UX

- Une commande, sans assistant interactif ni fichier de configuration requis.
- Rapport terminal immédiatement lisible, trié et synthétique.
- Résultat déterministe pour un état de fichiers et des options donnés.
- Windows, macOS et Linux ; Node.js/npm seuls prérequis. La commande `git` n'est requise que pour analyser un dépôt par son URL (§3.4).
- Aucun fichier du projet modifié ; aucune donnée envoyée à un serveur par `jlgstat`. Le seul accès réseau est la récupération, par `git`, d'un dépôt dont l'utilisateur a donné l'URL.
- Pas de dépendance à un service d'IA ni de consommation de tokens pour calculer les statistiques. **La lecture ultérieure du rapport par une IA peut, elle, consommer des tokens.**

### 1.3 Hors périmètre

Pas d'analyse de fonctionnalités, de qualité du code, de complexité cyclomatique, de dépendances entre modules, de classes/fonctions, de vulnérabilités, de couverture de tests, de score arbitraire de difficulté IA ou d'estimation fiable du temps de développement.

### 1.4 Langue

Le rapport terminal, `--help`, les messages d'erreur, le README et les noms de champs JSON sont **en anglais**. Les libellés cités en français dans cette spécification (ex. `[sans extension]`) sont traduits dans l'outil (`[no extension]`).

## 2. Périmètre et priorités

**P0 — V1 obligatoire :** inventaire par extension, volumes, distribution, principaux fichiers et répertoires, exclusions, terminal et JSON, fiabilité et multiplateforme.

**P1 — V1 étendue souhaitée :** lignes vides et commentaires, classification source/tests/configuration/généré, comparaison de snapshots, statistiques par profondeur, mode exhaustif `--all`.

**P2 — Après V1 :** détection des fichiers générés au-delà des règles du §5.5.1, bascule de syntaxe par bloc dans les fichiers multi-langages, historiques et tendances, exports additionnels et optimisations fondées sur les benchmarks.

Toutes les fonctionnalités ci-dessous appartiennent à la **cible produit** ; leur priorité indique l'ordre de livraison, pas une suppression de la spécification.

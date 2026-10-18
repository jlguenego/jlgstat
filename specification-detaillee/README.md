# jlgstat — Spécification détaillée

**Version :** 1.2  
**Statut :** spécification de référence, points de conception arbitrés  
**Date :** 17 octobre 2026

`jlgstat` est un outil CLI npm (`npx jlgstat .`) qui produit une radiographie **quantitative** d'un projet informatique : inventaire par extension, volumes, distribution, principaux fichiers et répertoires. Il fonctionne sans analyse sémantique, sans LLM, sans appel réseau (sauf pour récupérer un dépôt donné par son URL) et sans configuration obligatoire.

## Sommaire

| Fichier | Sections |
|---|---|
| [01-vision-perimetre.md](01-vision-perimetre.md) | §1 Vision et objectifs · §2 Périmètre et priorités |
| [02-interface-cli.md](02-interface-cli.md) | §3 Interface en ligne de commande, filtres, `--output`, dépôt distant par URL |
| [03-parcours-comptage.md](03-parcours-comptage.md) | §4 Parcours, exclusions par défaut, conventions de comptage, encodages |
| [04-metriques.md](04-metriques.md) | §5.1 – §5.4 Synthèse, extensions, distribution, répertoires |
| [05-categories-commentaires.md](05-categories-commentaires.md) | §5.5 – §5.6 Catégories, blancs et commentaires, table de langages |
| [06-sorties.md](06-sorties.md) | §6 Terminal · §7 JSON · §8 Comparaison de snapshots |
| [07-architecture-robustesse.md](07-architecture-robustesse.md) | §9 Performance et architecture · §10 Robustesse et codes de sortie |
| [08-tests-livraison.md](08-tests-livraison.md) | §11 Tests et acceptation · §12 Découpage de réalisation |
| [09-decisions.md](09-decisions.md) | §13 Décisions arrêtées |

Les renvois de type « §5.5.1 » utilisent la numérotation ci-dessus, identique dans tous les fichiers.

---

**Principe directeur :** une commande, zéro configuration, un rapport quantitatif fiable et rapide, compréhensible par un humain et directement exploitable par un agent IA.

# jlgstat — Spécification détaillée : décisions arrêtées

[← Sommaire](README.md)

## 13. Décisions arrêtées

| # | Sujet | Décision | Réf. |
|---:|---|---|---|
| 1 | `.gitignore` hors dépôt Git | Toujours respectés ; `.git/info/exclude` et config globale ignorés | §4.1 |
| 2 | Priorité des filtres | défauts/`.gitignore` (sautés par `--all`) → `--include` → `--exclude` (gagne toujours) | §3.2 |
| 3 | Syntaxe des globs | Syntaxe `.gitignore`, relative à la cible | §3.1 |
| 4 | Encodages | UTF-8, UTF-16 (BOM), repli 8 bits sans détection statistique | §4.4 |
| 5 | Commentaires | Table de syntaxes maison + automate ; ligne mixte = code | §5.6 |
| 6 | Catégories | Une seule par fichier ; généré > tests > doc > config > sources | §5.5 |
| 7 | Schéma JSON | `majeur.mineur` ; mineur = ajouts seulement ; JSON Schema publié | §7.1 |
| 8 | Moteur de comptage | Node.js pur ; `scc` comme oracle de test | §9.2 |
| 9 | Très grands dépôts | Plafonds fixes + `+ N more` ; JSON complet | §6.2 |
| 10 | Codes de sortie | 0 complet / 1 erreur / 2 partiel | §10 |
| 11 | Node.js | ≥ 22 | §9.1 |
| 12 | `--output` | Format selon l'extension ; écrasement atomique | §3.3 |
| 13 | Top répertoires | Profondeur 2 par défaut, cumulatif, entrée `./ (root files)` | §5.4 |
| 14 | Extensions | Minuscules ; dotfile sans autre point = `[sans extension]` | §4.3 |
| 15 | Blancs | Classe `\s` de JavaScript | §4.3 |
| 16 | Gros fichiers | Pas de plafond ; flux ; avertissement au-delà de 50 Mo | §4.4 |
| 17 | Cible | Un seul répertoire ; sinon erreur | §3 |
| 18 | Progression | stderr TTY après 1 s, `--quiet` | §6.3 |
| 19 | Vue langages | Terminal seulement si elle regroupe ; toujours en JSON | §5.2 |
| 20 | `--compare` non homogène | Avertir et comparer ; erreur si majeur de schéma incompatible | §8 |
| 21 | Langue | Anglais (terminal, aide, doc, JSON) | §1.4 |
| 22 | Format des nombres | `1,234,567`, base 1000, indépendant de la locale | §6.1 |
| 23 | Stack | TypeScript → ESM, `bun test`, MIT, nom npm `jlgstat` | §9.1 |
| 24 | Exclusions par défaut | Liste multi-écosystèmes ciblée ; `.vscode`/`.idea` conservés | §4.1.1 |
| 25 | `bin`, `obj`, `target` | Exclus seulement à côté d'un fichier de projet .NET, Rust ou JVM | §4.1.1 |
| 26 | Table de langages | ~35 langages en 3 familles de syntaxe | §5.6.1 |
| 27 | Docstrings Python | Commentaire si elles commencent une instruction | §5.6 |
| 28 | Fichiers multi-langages | Syntaxe du conteneur uniquement | §5.6 |
| 29 | JSON/YAML/TOML | Configuration, sauf sous des dossiers de données → « autres » | §5.5.3 |
| 30 | Périmètre « sources » | Toute extension de la table de langages, y compris HTML/CSS/SQL/Shell | §5.5 |
| 31 | Tests | Nom de dossier à toute profondeur + motifs de nom de fichier | §5.5.2 |
| 32 | Fichiers générés | Chemin + marqueurs d'en-tête + minification, dès la V1 | §5.5.1 |
| 33 | Outillage de développement | Bun (install, `bun.lock`, scripts, tests, pack) ; runtime publié inchangé : Node.js ≥ 22 | §9.1 |
| 34 | Mention d'auteur | `jlgstat: an idea by Jean-Louis GUENEGO (JLG), developed with AI.` en fin d'aide, en pied du rapport terminal et dans le champ JSON `credit` (schéma 1.1) | §6, §7.2 |
| 35 | Dépôt par URL | L'argument peut être une URL Git (https, http, ssh, git, file, SCP), y compris une URL de navigateur avec ref et sous-dossier ; un répertoire local existant reste prioritaire | §3.4 |
| 36 | Réseau et `git` | Réseau uniquement pour une URL explicite, via la commande `git` de la machine et ses authentifications ; pas de client Git embarqué | §1, §3.4 |
| 37 | Récupération | `init` + `fetch --depth 1` ; fetch partiel et sparse checkout pour un sous-dossier ; arbre sans `.git` ; fichiers tels que stockés | §3.4 |
| 38 | `--ref` | Branche, tag ou SHA complet ; l'emporte sur la ref de l'URL, avec avertissement | §3.4 |
| 39 | Cache | Copie supprimée en fin de run ; `--keep-clone` la conserve ; une entrée existante est réutilisée et mise à jour | §3.4 |
| 40 | `--clear-cache` | Vide tout le cache, ou les entrées d'une URL ; ne supprime que les dossiers marqués | §3.4 |
| 41 | Rapport d'un dépôt | `root` = URL sans identifiants (+ sous-dossier) ; champ `source` (schéma 1.2) | §7.2 |
| 42 | Hors périmètre URL | Sous-modules, contenu LFS, plusieurs URLs, verrouillage du cache | §3.4 |

Aucun point de conception ne reste ouvert. Les listes ci-dessus pourront être complétées pendant l'implémentation, par ajout de règles et sous couvert de tests.

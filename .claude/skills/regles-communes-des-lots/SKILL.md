---
name: regles-communes-des-lots
description: Les règles que chaque consigne de Skilloria répète — périmètre du lot, migrations, quatre langues, messages et codes, contrôles, mémoire, rapport d'ARRÊT. À charger AU DÉBUT de tout lot ou consigne sur ce dépôt (principal, S1, S2, S3, relecteur), avant d'écrire une ligne, et dès qu'il est question de créer une branche lot/, une migration, une clé messages/*.json, un code d'erreur, un diagnostic scripts/diag-*, de mettre à jour CLAUDE.md ou docs/, ou de rédiger le rapport de fin de lot — même si la consigne ne nomme pas ces règles.
---

# Les règles communes de chaque lot

Ce fichier **ne fait pas foi** : il rassemble ce que le dépôt écrit déjà, avec l'adresse de chaque règle.
En cas de doute, la section citée l'emporte — **CLAUDE.md** (chargé à chaque session) et `docs/`. Une règle
qui n'est écrite nulle part dans le dépôt n'est pas ici ; si vous en avez besoin, demandez-la à Youssef.

## 1. Le périmètre

- **Une branche par lot**, créée depuis la tête nommée par la consigne ; vérifiez la tête avant de commencer
  et dites-la dans le rapport (ARRÊT 26 : « créée depuis `1182e02` … vérifié avant de commencer »).
- **Aucun `git push`, aucune écriture en base depuis un worktree** (§G.6). Ni Docker ni base, sauf si la
  consigne le dit. Les diagnostics qui écrivent en base existent (§E.4) : `node scripts/diag.mjs` les écarte
  par défaut ; `--avec-ecritures` ne se passe jamais de soi-même.
- **Les décisions figées (§D de CLAUDE.md) ne se rouvrent pas** sans arbitrage de Youssef. Un défaut trouvé
  hors du lot se **nomme** dans le rapport ; il ne s'élargit pas le lot tout seul (§G.8 : « corrigés sans
  arbitrage, ce qui aurait élargi le lot tout seul »).
- **La règle de lecture (décision du 26/09/2026)** : CLAUDE.md est l'index ; dans `docs/`, on ne lit **que**
  les sections qui touchent le lot, trouvées par l'index et par mots-clés. Le rapport donne la liste **Lu** et
  **Non relu**.
- **Avant d'écrire une fonction, une route ou un test**, lisez dans les migrations les contraintes RÉELLES
  des tables touchées : CHECK, FK, NOT NULL, longueurs, déclencheurs (§G.10, §E.88).
- `supabase/snippets/` appartient à Youssef et ne se livre jamais (§G.6) ; pas de `git add -A` aveugle.

## 2. Les migrations

- **Créez le fichier avec `npm run db:new <nom>`**, jamais un nom inventé ; le nom est un suffixe descriptif.
- **Plage et horodatage** (§G.2) : le suffixe dans la plage attribuée par la consigne (tableau §G.2 ; le
  tronc est `0xxxxx`), l'horodatage **strictement supérieur au plus récent de toutes les branches et de tous
  les worktrees**. Le cliquet de `diag-migration-donnees` rougit hors plage.
- **Jamais de référence à une migration par son numéro ni par sa position** (§G.3) : par son suffixe.
- **L'en-tête dit l'ordre de passage** : AVANT, APRÈS ou indifférent (§G.4).
- **Ce qui RESTREINT part au déploiement SUIVANT** (§G.4, §E.72, §E.91, §E.94) : déclencheur, contrainte,
  `not null`, politique, fonction ou droit retirés, ligne désactivée ou supprimée, action refusée — tout ce
  qui ferait échouer un geste du code EN LIGNE. `diag-deux-temps` le vérifie (voir la skill
  `deploiement-deux-temps`).
- **Toute action nouvelle du grand livre** s'ajoute à la liste fermée, SQL **et** TypeScript, code **et** clés
  du détail, passe par `journaliser()` ou une RPC qui l'appelle, a **un seul écrivain** (§D.26) — et **arrive
  avec son test pgTAP** (§G.4 ter, `supabase/tests/database/`, `begin; … rollback;`, données fabriquées par
  les chemins normaux).
- **Une postcondition vérifie la STRUCTURE** ; aucune sonde ne lit une table métier ni ne touche une donnée
  réelle (§G.4 ter, §E.77).
- Une migration ajoutée = une ligne en **§B** de `docs/architecture.md`, et la requête de staging à jour
  (`supabase/verifications/staging-avant-push.sql`, gardée par `diag-requete-staging`).

## 3. Les quatre langues

- **Aucune phrase en dur dans le JSX** : `t('clé')`, et la clé existe dans `messages/fr.json`, `en.json`,
  `es.json`, `de.json` (CLAUDE.md, « i18n »). `diag-parite-i18n` exige les mêmes chemins dans les quatre.
- **Une clé à variable s'appelle AVEC sa variable** — sinon l'écran affiche le nom de la clé
  (§E.95, `diag-variables-i18n`).
- **Les valeurs de la base** (branches, spécialités, libellés d'écosystème) passent par la table
  `translations` et `tBDD()` ; le client lit la taxonomie par `/api/taxonomy?locale=…`, jamais par
  `supabase.from('branches')`.
- Une phrase qui colle un nom à une préposition casse sur le repli : relisez-la dans les quatre langues
  (§E.90).
- Conflit sur `messages/*.json` : union des clés (§G.7 — **NON VÉRIFIÉ** par un outil, discipline seule).

## 4. Les messages et les codes

Les points de la checklist que le dépôt nomme (rapports de `docs/reprise.md`) :

| Point | Ce qu'il demande (tel qu'écrit dans les rapports) |
|---|---|
| 0 | Aucun nom (d'écosystème) et aucune valeur produit dans le code ; état propre |
| 2 | L'écosystème réellement résolu : par l'adresse de la requête (§D.3, §E.85) |
| 5 | La garde tranche au serveur ou en base ; l'écran ne fait que déclarer et prévenir |
| 12 | Codes stables : aucun code renommé, chaque code nouveau nommé |
| 13-14 | Messages actionnables, dans les quatre langues |
| 15 | V0 = la production : le même chemin de code partout |

Les autres points de la checklist **ne sont pas écrits dans le dépôt** : ne les devinez pas.

- Réponse d'erreur d'une route : `{ error, code? }`, statut juste (CLAUDE.md, « API route conventions »).
- **Une erreur technique n'est pas un refus métier** : une lecture en panne se dit (503 nommé), elle ne rend
  jamais un verdict (§E.22, §E.42).
- **Le mot « seuil » est interdit** : plafond, alerte, filtre, note (§D.9).
- **Aucune couleur littérale** dans un composant : jetons `--sk-*` (§D.12). **Aucun bouton Retour** (§D.45).
- Un écran ne simule jamais un travail (§D.13).

## 5. Les contrôles — l'épreuve d'un lot

Dans cet ordre, et chaque résultat chiffré dans le rapport :

1. `npx tsc --noEmit` — 0 erreur hors `.next/` ; **puis** `npm run build` : les deux ne sont pas
   interchangeables (§E.2).
2. `npm run lint` — **le cliquet** : les comptes ne peuvent que descendre (§G.5 ter, `diag-lint-cliquet`).
3. `node scripts/diag-controles-a-rejouer.mjs` — les diagnostics qui lisent les fichiers du lot (§E.14).
4. `node scripts/diag.mjs` — la série statique : **trois états**, vert / rouge / n'a pas tourné ; un muet
   compte autant qu'un rouge (§E.57).
5. **Tout contrôle nouveau s'éprouve par MUTATION** : casser la règle, voir le rouge, rétablir, vérifier que
   l'arbre est identique (§G.5). Un contrôle jamais vu rouge ne prouve rien.
6. Les tests pgTAP ne tournent pas ici (ni Docker ni base) : donnez le **nombre attendu** et écrivez
   **NON exécutés ici**.

Pièges à lire avant d'écrire un diagnostic : §E.3, §E.7, §E.8, §E.22, §E.33, §E.34, §E.38 (index de CLAUDE.md).

## 6. La mémoire — dans le même commit

- **Chaque commit met à jour la section qui le concerne** (règle de maintenance, en tête de CLAUDE.md) :
  migration → §B · route ou chaîne → §C · décision → §D (sa ligne dans CLAUDE.md, son détail dans
  architecture) · piège → §E (`docs/pieges.md`) · course fermée → §F · convention → §G · dette → §H ·
  écran → §P2. `diag-memoire-a-jour` force la trace ; `diag-memoire-exacte` vérifie liens et comptes.
- **Une affirmation non vérifiable ne s'écrit pas**, ou se marque **NON VÉRIFIÉ**.
- **Budget de CLAUDE.md : 100 000 caractères** (§G.5 bis).
- **Un texte de mémoire ne s'écrit jamais par une chaîne shell** ; un remplacement passe par une fonction,
  jamais par une chaîne (`$&`, `` $` ``) (§G.9).
- Commentaires du code **en français**, à la densité du fichier touché.

## 7. Le rapport — l'ARRÊT

La forme des rapports de `docs/reprise.md` (ARRÊTS 24 à 28) :

```
## ⛔ ARRÊT n — <le lot> (<date>)
Branche, créée depuis <commit> (vérifié). Aucun git push, aucune écriture en base.
**Lu** : … **Non relu** : …
### Ce que l'audit a trouvé            (si le lot commence par un audit)
### Les points — ce qui est fait, et ce qui le prouve
| # | Fait | Prouvé par |
### Les migrations nouvelles — leur ordre (AVANT / APRÈS), la requête de staging (⓪, créé, retiré)
### Le nombre de tests de base attendu — NON exécutés ici
### L'épreuve — tsc, build, lint (cliquet), parité i18n, série complète, mutations (n sur n rougissent)
### Ce qui reste, et se dit
### Pour Youssef — dans l'ordre
```

**Puis vous vous arrêtez** — c'est ce que dit « ⛔ ARRÊT » : le lot attend sa relecture avant le déploiement
(ARRÊT 26, « Pour Youssef », étape 1).

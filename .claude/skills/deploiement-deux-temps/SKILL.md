---
name: deploiement-deux-temps
description: La séquence de déploiement d'un lot de Skilloria — version de Postgres, db reset local, db lint, tests pgTAP, requête de staging, next build, db push, git push aussitôt — et la règle des deux temps (ce qui restreint part au déploiement SUIVANT). À charger dès qu'il est question de déployer, de pousser des migrations sur staging ou en production, de préparer les étapes « Pour Youssef », de classer une migration AVANT ou APRÈS, de remettre à jour diag-deux-temps, la requête staging-avant-push.sql ou CODE_EN_LIGNE, ou de rédiger une seconde livraison — même si la demande dit seulement « mettre en ligne » ou « push ».
---

# Le déploiement en deux temps

Ce fichier **ne fait pas foi** : la séquence vit dans **CLAUDE.md §G.4, §G.4 bis, §G.4 ter**, la mise en
production dans `docs/mise-en-production.md`. En cas d'écart, ce sont eux qui ont raison.

**Qui fait quoi.** Une session Claude **prépare et vérifie** ; elle ne lance ni Docker ni base, et ne pousse
rien (§G.6). **Depuis le 03/10/2026, les tests tournent sur GitHub Actions, plus sur le PC de Youssef**
(CLAUDE.md §G.13, `docs/integration-continue.md`) : la demande de fusion de la branche du lot déclenche
`.github/workflows/controles.yml`, qui rejoue sur une base JETABLE démarrée dans le runner les étapes 1 (`db reset`),
2 (`db lint`), 3 (`test db`) et 5 (`npm run build`, barrière comprise, §D.51) — et c'est son résultat qui dit que
les tests passent. Restent **des gestes de Youssef, jusqu'au lot DevOps 2** : l'étape 0 (version de Postgres de la
base liée), l'étape 4 (la requête de staging), l'étape 6 (`db push`) et l'étape 7 (le `git push` / la fusion qui
déploie). **Principe, écrit dès maintenant : la production reçoit EXACTEMENT le commit validé sur staging.**

## 1. Les deux temps — la règle

- **Premier temps (AVANT le déploiement)** : n'ajoute que du nouveau. Une migration AVANT ne doit rien
  refuser de ce que le code **EN LIGNE** écrit encore.
- **Second temps (APRÈS, au déploiement SUIVANT)** : tout ce qui RESTREINT — déclencheur, contrainte,
  `not null`, politique, fonction ou droit retirés, ligne désactivée ou supprimée, action refusée (GL006), clé
  retirée d'une liste blanche (§G.4, §E.72, §E.91). Une signature appelée par le code en ligne ne se supprime
  qu'au déploiement suivant : ajout, déploiement, puis suppression — jamais les trois ensemble.
- **Une migration APRÈS est horodatée après TOUTES les migrations AVANT en attente** (le push les applique dans
  l'ordre des noms). Plage de la seconde livraison du regroupement : `05xxxx` (§G.2).
- L'ordre est **écrit dans l'en-tête de chaque migration** ; on ne pousse jamais sans l'avoir lu (§G.4).

**Le contrôle** : `node scripts/diag-deux-temps.mjs` (lisez son en-tête avant de le modifier).
- Il lit les migrations EN ATTENTE (celles qui suivent l'état ⓪ de la requête de staging).
- Une **exception** du premier temps porte sa raison ET sa preuve, vérifiée sur le commit EN LIGNE déclaré
  dans `CODE_EN_LIGNE` — **à remettre au commit déployé à chaque push** (§G.4). Types de preuve :
  `aucun_ecrivain`, `refus_nomme`, `colonnes_neuves`, `recreee`.
- Une restriction du second temps se **déclare** dans `SECOND_TEMPS` : ses écrivains (recalculés et
  comparés) et le test qui les prouve.
- **Ce qu'il ne voit pas** (son en-tête, §E.94) : que les VALEURS écrites passent — seul le test nommé le
  prouve ; une fonction redéfinie qui lève là où l'ancienne ne levait pas ; une reprise qui change une valeur
  que l'ancien code compare. **Ces cas se jugent en lisant l'ancien code (le commit déployé) contre la
  migration.**

## 2. Avant de préparer le déploiement — ce que la session vérifie

1. Les migrations en attente, leur en-tête (AVANT / APRÈS), leur horodatage (§G.2) — aucun numéro cité (§G.3).
2. `node scripts/diag-deux-temps.mjs` vert, `CODE_EN_LIGNE` au commit réellement en ligne.
3. `node scripts/diag-requete-staging.mjs` vert : dans `supabase/verifications/staging-avant-push.sql`, ⓪ dit la
   dernière migration appliquée, et les deux listes « prochain push » (ce qui est retiré, ce qui est créé) sont
   EXACTEMENT ce que font les migrations qui suivent ⓪ (§G.4 ter, étape 4 ; §E.80).
4. `node scripts/diag-tests-grand-livre.mjs` vert : toute action nouvelle a son test (§G.4 ter).
5. `node scripts/diag-postconditions-structure.mjs` vert : aucune sonde sur une donnée réelle (§E.77).
6. `npx tsc --noEmit` et `npm run build` verts (§E.2).
7. Le **nombre de tests pgTAP attendu**, compté sur les `plan(n)` des fichiers — écrit **NON exécutés ici**.

## 3. La séquence — pour Youssef, dans cet ordre, chaque étape verte avant la suivante

Recopiée de **CLAUDE.md §G.4 ter** (« LA SÉQUENCE DE DÉPLOIEMENT D'UN LOT DE MIGRATIONS »). **Les étapes 1, 2, 3
et 5 sont celles que GitHub Actions exécute sur la demande de fusion (§G.13)** : Youssef ne les relance pas sur son
poste — il lit les trois contrôles **statique**, **base**, **application** de la demande de fusion, et ne passe à
l'étape 4 que tous verts. Le rapport donne toujours le nombre de tests attendu, pour le comparer à ce que GitHub affiche.

0. Docker lancé, sur la branche du lot : `npx supabase link --project-ref <ref>` (staging :
   `wnayuerhakekxccgimeg`), puis `node scripts/verifier-version-postgres.mjs` — **au moins 17.6.1.121**, sinon
   on met staging à jour d'abord (§E.76).
1. `npx supabase db reset --local` — rejoue toutes les migrations sur la base jetable (§G.4 bis). Une
   postcondition PARTIELLE n'est pas un échec. Sous Windows, « EUNKNOWN … uv_spawn » = Smart App Control (§E.82).
2. `npx supabase db lint -s public --level error` — **sortie vide = aucune erreur**.
3. `npx supabase test db --local` — tous verts, au nombre attendu. Jamais sur la base liée ni par URL.
4. **La requête de staging** (`supabase/verifications/staging-avant-push.sql`), collée dans l'éditeur SQL de
   staging, lecture seule : **un seul `ÉCART` → on s'arrête.**
5. `npm run build`.
6. `npx supabase db push` — sur le projet lié.
7. `git push` **aussitôt après** : entre 6 et 7, le code en ligne appelle ce que le push a changé (§E.72) — la
   fenêtre se compte en minutes.

Après le push : ⓪ sort en ÉCART tant que le nouvel état n'est pas déclaré dans la requête ; `CODE_EN_LIGNE`
passe au commit déployé. C'est le premier geste du lot suivant.

## 4. La seconde livraison

Quand une restriction attend que la première livraison soit en ligne (ARRÊT 28) : la première livraison part
avec ses migrations AVANT ; la seconde, sur sa propre branche, porte les migrations APRÈS (`05xxxx`), déclarées
dans `SECOND_TEMPS`, et ne se déploie qu'une fois la première en ligne et `CODE_EN_LIGNE` remis à jour. La
même séquence s'applique, de l'étape 0 à l'étape 7.

## 5. La production

Elle suit `docs/mise-en-production.md` (étapes 0 à 7 : la base sur une version corrigée, les migrations, le
paramétrage, les secrets du coffre, l'authentification, les variables, les adresses, le premier
administrateur). **Lisez la section concernée** avant d'écrire une étape pour Youssef ; ne la résumez pas de
mémoire.

## 6. Ce que le rapport écrit pour Youssef

Le bloc « Pour Youssef — dans l'ordre » des ARRÊTS (`docs/reprise.md`) : la contre-relecture d'abord, puis
les étapes 0 à 7 avec la branche, le nombre de tests attendu, ce que la requête de staging doit dire (⓪, créé,
retiré), les messages que les migrations afficheront au push (et ce qu'un autre nombre voudrait dire), puis
les essais à faire sur staging, écran par écran.

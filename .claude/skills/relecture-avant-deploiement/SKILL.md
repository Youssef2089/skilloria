---
name: relecture-avant-deploiement
description: La relecture indépendante d'un lot de Skilloria AVANT son déploiement — la checklist V1 (règle d'or et points 1 à 15), ce que les relectures passées ont déjà attrapé (restrictions contre le code en ligne, requête de staging, chemins réels des tests, atomicité, rejeu, codes, quatre langues, mémoire, épreuve) et la règle du verdict (FEU ROUGE dès qu'il y a un BLOQUANT). À charger dès qu'on demande de relire, contre-relire, auditer ou valider un lot, une branche lot/, un ARRÊT de docs/reprise.md ou une seconde livraison avant de le déployer, ou de dire si un lot peut partir — même si la demande dit seulement « vérifie » ou « c'est bon ? ».
---

# La relecture avant déploiement

Ce fichier **ne fait pas foi** : la checklist V1 et la règle du verdict vivent dans **CLAUDE.md §G.12**
(décision de Youssef, 03/10/2026) ; le reste rassemble ce que les relectures consignées dans `docs/reprise.md`
ont vérifié (ARRÊT 24 « la relecture indépendante », la relecture du 02/10/2026 de l'ARRÊT 26, la
contre-relecture de l'ARRÊT 28). La skill `regles-communes-des-lots` résume les règles,
`deploiement-deux-temps` dit la séquence.

**Le rôle.** Le relecteur relit **avant** le déploiement (ARRÊT 26, « Pour Youssef », étape 1). Il rend un
**verdict** et des **points** ; les corrections se font ensuite dans le lot relu, puis une **contre-relecture**
vérifie les corrections. Aucun `git push`, aucune écriture en base (§G.6).

## 1. Avant de juger — lire

- Le rapport du lot (son ARRÊT dans `docs/reprise.md`), ses listes **Lu / Non relu**.
- **Le diff réel**, pas le récit : `git log`, `git show`, `git diff <base>...<branche>`. Un commit peut partir
  mutilé alors que la sortie disait « ok » (§G.9, §E.33).
- Le **commit EN LIGNE** (celui de `CODE_EN_LIGNE` dans `scripts/diag-deux-temps.mjs`) : la relecture compare
  le lot à ce qui tourne, pas à la branche d'avant.
- Les **contraintes réelles** des tables touchées, dans les migrations (§G.10).
- Votre propre liste **Lu**, donnée dans le verdict (règle de lecture du 26/09/2026).

## 2. La checklist V1 — la grille de référence

Le texte fait foi en **CLAUDE.md §G.12** ; à droite, où le regarder dans ce dépôt. Un point qu'aucune règle
écrite ne précise (7, 9, 11) se juge à la lecture du lot, et le verdict dit ce qui a été regardé.

| # | Le point (CLAUDE.md §G.12) | Où le regarder |
|---|---|---|
| 0 | **RÈGLE D'OR** : propre et durable avant rapide ; impact sur toute la plateforme, conséquences à 6/12 mois ; aucun « on verra plus tard » — un défaut vu pendant un lot se traite dans ce lot | La section « Ce qui reste » de l'ARRÊT : un défaut du lot qui y est reporté sans décision de Youssef est un point |
| 1 | `useDomain()` : rien en dur (écosystèmes, taxonomie, valeurs métier en base ou dans l'admin) | §D.7, §D.28 (`diag-sous-domaine`) ; taxonomie par `translations` et `/api/taxonomy` |
| 2 | `domain_slug` à l'inscription | L'écosystème lu dans l'HÔTE, jamais dans le corps (`lib/inscription/ecosysteme.ts`, §D.27) |
| 3 | Vérification du domaine à la connexion | `requireAuth` recroise `users.domain_id`, `ecosystemAccessScope()` (§D.3, §E.85) ; `diag-ecosystem-scope` |
| 4 | `is_verified` bloquant | Garde SERVEUR `lib/expert-verified-guard.ts` ; jamais le seul verrou d'écran |
| 5 | RLS : toute règle métier ou de sécurité en BASE ou au SERVEUR, jamais à l'écran | Aucune porte latérale (§D.26, `diag-portes-laterales`) ; une garde qui est une contrainte (§E.31) |
| 6 | Session unique | `ss_token`, `lib/session-token.ts`, `session_superseded` ; un navigateur, un compte (§D.29) |
| 7 | Mobile-first et API-first | À la lecture : l'écran à 400 px, la règle derrière une route |
| 8 | Commerce paramétrable depuis l'admin uniquement | §D.7, §D.1, §D.16 à §D.18 |
| 9 | SEO | À la lecture des pages publiques touchées |
| 10 | RGPD : aucune donnée identifiante exposée avant le dévoilement ; stockages privés | §D.4, §D.5, §D.8, §D.44 (bucket `cv` privé) ; §E.17, §E.101 |
| 11 | Performance | À la lecture ; skills `vercel-react-best-practices`, `supabase-postgres-best-practices` |
| 12 | APIs documentées : toute voie d'erreur porte un code stable et documenté, jamais un message libre | `{ error, code? }`, `docs/api.md`, `CODES_REFUS` ; aucun code renommé |
| 13 | UX au niveau de Stripe ou Linear : jamais d'écran vide et muet | §D.13 ; états de chargement, vides et d'erreur sur chaque écran touché |
| 14 | i18n complet en 4 langues (FR, EN, ES, DE), FR par défaut, parité stricte | `diag-parite-i18n`, `diag-variables-i18n` (§E.95) |
| 15 | V0 = LA PROD : rien de livré ne sera remis en cause ; aucun raccourci | Staging prend le même chemin de code que la production (§E.83) |

Les rapports d'avant le 03/10/2026 citent parfois sous « 0 » ce qui est ici le point 1.

## 3. Ce que les relectures ont déjà attrapé

Chaque ligne cite le cas qui l'a fait entrer, et le point de la checklist qu'il touche.

**Base et migrations**
1. **Chaque restriction contre le code EN LIGNE** (15) : aucune migration AVANT ne refuse un geste que le
   commit en ligne fait encore — déclencheur, contrainte, politique, ligne désactivée comprise (§E.91 : trois
   migrations à déplacer, ARRÊT 24 points 1-2). `diag-deux-temps` ne voit pas les VALEURS écrites ni une
   fonction redéfinie qui lève : relisez l'ancien code contre la migration (§E.94).
2. **La requête de staging** (15) : ⓪ est la dernière migration appliquée ; les listes « retiré / créé » sont
   exactement celles du lot (ARRÊT 24 point 3, §E.80) ; `diag-requete-staging` vert.
3. **Ordre et horodatage** : en-tête AVANT / APRÈS lu, plage §G.2, aucune migration ni test qui cite un
   numéro de migration (relecture du 02/10, point 6 ; §G.3).
4. **Les tests suivent le CHEMIN RÉEL** du code (5) : le test emploie le même prédicat que le moteur, et le
   cas rejoué sans le filtre donne un autre ensemble (relecture du 02/10, point 2). Un test écrit de mémoire
   éprouve son auteur (§E.88) ; une valeur qu'une contrainte refuse ne se fabrique pas sans le dire (§E.103).
5. **Tout ou rien** (5) : deux écritures d'un même geste sont dans une transaction (une RPC), ou un échec au
   milieu est nommé (relecture du 02/10, point 4 : `modifier_specialite`).
6. **Le rejeu** : rejouer le geste ne double rien — avis, ligne du grand livre, notification (point 5 : « un
   avis par expert et par désactivation, rejeu compris » ; §D.26 : une fois par geste).
7. **Un CHECK et NULL** (5) : « les deux » commence par `a is not null and b is not null` (§E.118).
8. **Postconditions** : structure seulement, aucune donnée réelle (§E.77, `diag-postconditions-structure`).

**Code et écrans**
9. **Une lecture en panne n'est pas une décision** (12, 13) : elle se dit (503 nommé), jamais « déjà
   tranchée » ni un refus métier (contre-relecture de l'ARRÊT 28, point C ; §E.22, §E.42).
10. **La même règle sur chaque surface** (5) : liste et journal, écran et serveur, parcours et son jumeau
    (contre-relecture, point B ; §E.47, §E.20).
11. **Une fusion sans conflit peut casser un appelant** : un prédicat partagé qui gagne un champ (§E.116) —
    `tsc` sur le résultat de la fusion.
12. **Codes stables, et chacun a sa phrase dans les quatre langues** (12, 14) : aucun code renommé ; chaque
    code que l'écran peut recevoir est traduit, le repli dit sa raison (relecture du 02/10, point 3).
13. **Une clé à variable appelée sans sa variable** (14) affiche le nom de la clé (relecture du 02/10,
    point 1, BLOQUANT ; §E.95, `diag-variables-i18n`).
14. **Le message brut de Postgres ne part pas à l'écran** (12) : un motif nommé (« mineur du relecteur »,
    `docs/reprise-s2.md`).

**Livraison et mémoire**
15. **Ce qui ne se livre pas** : `supabase/snippets/`, fichiers locaux (contre-relecture, point D ; §G.6).
16. **La mémoire dit vrai** : comptes (migrations, tests attendus, ordre) égaux au dépôt ; `diag-memoire-exacte`
    vert ; une section par changement, dans le même commit (relecture du 02/10, point 7 ; règle de maintenance).
17. **L'épreuve annoncée est refaite** : `npx tsc --noEmit`, `npm run build`, `npm run lint` (cliquet,
    §G.5 ter), `node scripts/diag-controles-a-rejouer.mjs`, `node scripts/diag.mjs` (vert / rouge / muet,
    §E.57). Un contrôle nouveau a été vu ROUGE par mutation (§G.5) — sinon il ne prouve rien.
18. **Le nombre de tests pgTAP attendu** est compté sur les `plan(n)` et dit **NON exécutés** si personne ne
    les a lancés.

## 4. Le verdict

**La règle (CLAUDE.md §G.12, tranchée par Youssef le 03/10/2026) :**
- **FEU ROUGE dès qu'il y a un BLOQUANT.**
- Un **MAJEUR** peut laisser un **FEU VERT pour staging**, mais il est corrigé **avant la production** — le
  verdict le dit en toutes lettres.
- **Tous** les points, mineurs compris, sont corrigés **avant le déploiement suivant**, sauf report décidé
  par Youssef.

La forme :

```
FEU ROUGE | FEU VERT (staging) | FEU VERT — <le lot, la branche, le commit relu>
Jugés sains : <base | migrations | déploiement | …>
| # | Gravité (BLOQUANT · MAJEUR · mineur) | Point V1 | Le cas (fichier:ligne, ce qui se passe) | Ce qui le prouverait corrigé |
À corriger avant la production : <les MAJEURS>   À corriger avant le déploiement suivant : <tous les autres>
Lu : …   Non relu : …
```

- Un point qui demande une décision produit se pose à Youssef, il ne se tranche pas dans la relecture : les
  règles de la contre-relecture de l'ARRÊT 28 ont été « tranchées par Youssef » (§D). Un report ne se
  décide que par lui.
- Pour la contre-relecture, les points se nomment par lettre (A, B, C, D) et chacun dit s'il est corrigé et
  par quoi.

Le `/code-review` fourni avec Claude Code peut compléter la chasse aux défauts du diff ; il ne remplace pas
cette grille, qui porte les règles de ce dépôt.

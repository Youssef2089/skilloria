---
name: relecture-avant-deploiement
description: La relecture indépendante d'un lot de Skilloria AVANT son déploiement — la liste de ce que le relecteur vérifie (restrictions contre le code en ligne, requête de staging, contraintes réelles, chemins réels des tests, atomicité, rejeu, quatre langues, codes, mémoire, épreuve) et la forme du verdict (FEU ROUGE / FEU VERT, points BLOQUANT, MAJEUR, mineur). À charger dès qu'on demande de relire, contre-relire, auditer ou valider un lot, une branche lot/, un ARRÊT de docs/reprise.md ou une seconde livraison avant de le déployer, ou de dire si un lot peut partir — même si la demande dit seulement « vérifie » ou « c'est bon ? ».
---

# La relecture avant déploiement

Ce fichier **ne fait pas foi** : il rassemble ce que les relectures consignées dans `docs/reprise.md` ont
vérifié (ARRÊT 24 « la relecture indépendante », la relecture du 02/10/2026 de l'ARRÊT 26, la contre-relecture
de l'ARRÊT 28) et les sections de CLAUDE.md qui les fondent. Les règles elles-mêmes vivent dans CLAUDE.md et
`docs/` ; la skill `regles-communes-des-lots` les résume, `deploiement-deux-temps` dit la séquence.

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

## 2. La liste de vérifications

Chaque ligne cite le cas qui l'a fait entrer.

**Base et migrations**
1. **Chaque restriction contre le code EN LIGNE** : aucune migration AVANT ne refuse un geste que le commit
   en ligne fait encore — déclencheur, contrainte, politique, ligne désactivée comprise (§E.91 : trois
   migrations à déplacer, ARRÊT 24 points 1-2). `diag-deux-temps` ne voit pas les VALEURS écrites ni une
   fonction redéfinie qui lève : relisez l'ancien code contre la migration (§E.94).
2. **La requête de staging** : ⓪ est la dernière migration appliquée ; les listes « retiré / créé » sont
   exactement celles du lot (ARRÊT 24 point 3, §E.80) ; `diag-requete-staging` vert.
3. **Ordre et horodatage** : en-tête AVANT / APRÈS lu, plage §G.2, aucune migration ni test qui cite un
   numéro de migration (relecture du 02/10, point 6 ; §G.3).
4. **Les tests suivent le CHEMIN RÉEL** du code : le test emploie le même prédicat que le moteur, et le
   cas rejoué sans le filtre donne un autre ensemble (relecture du 02/10, point 2). Un test écrit de mémoire
   éprouve son auteur (§E.88) ; une valeur qu'une contrainte refuse ne se fabrique pas sans le dire (§E.103).
5. **Tout ou rien** : deux écritures d'un même geste sont dans une transaction (une RPC), ou un échec au milieu
   est nommé (relecture du 02/10, point 4 : `modifier_specialite`).
6. **Le rejeu** : rejouer le geste ne double rien — avis, ligne du grand livre, notification (point 5 : « un
   avis par expert et par désactivation, rejeu compris » ; §D.26 : une fois par geste).
7. **Un CHECK et NULL** : « les deux » commence par `a is not null and b is not null` (§E.118).
8. **Postconditions** : structure seulement, aucune donnée réelle (§E.77, `diag-postconditions-structure`).

**Code et écrans**
9. **Une lecture en panne n'est pas une décision** : elle se dit (503 nommé), jamais « déjà tranchée » ni un
   refus métier (contre-relecture de l'ARRÊT 28, point C ; §E.22, §E.42).
10. **La même règle sur chaque surface** : liste et journal, écran et serveur, parcours et son jumeau
    (contre-relecture, point B ; §E.47, §E.20).
11. **Une fusion sans conflit peut casser un appelant** : un prédicat partagé qui gagne un champ (§E.116) —
    `tsc` sur le résultat de la fusion.
12. **Codes stables, et chacun a sa phrase dans les quatre langues** : aucun code renommé ; chaque code que
    l'écran peut recevoir est traduit, le repli dit sa raison (relecture du 02/10, point 3 ; checklist 12,
    13-14).
13. **Une clé à variable appelée sans sa variable** affiche le nom de la clé (relecture du 02/10, point 1,
    BLOQUANT ; §E.95, `diag-variables-i18n`).
14. **Le message brut de Postgres ne part pas à l'écran** : un motif nommé (« mineur du relecteur »,
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

## 3. Le verdict

La forme des relectures consignées :

```
FEU ROUGE | FEU VERT — <le lot, la branche, le commit relu>
Jugés sains : <base | migrations | déploiement | …>
| # | Gravité (BLOQUANT · MAJEUR · mineur) | Le cas (fichier:ligne, ce qui se passe) | Ce qui le prouverait corrigé |
Lu : …   Non relu : …
```

- **Le critère qui sépare FEU ROUGE et FEU VERT n'est pas écrit dans le dépôt** : le verdict dit pourquoi.
  (La relecture du 02/10 — FEU ROUGE — portait un point BLOQUANT et un MAJEUR.)
- Un point qui demande une décision produit se pose à Youssef, il ne se tranche pas dans la relecture : les
  règles de la contre-relecture de l'ARRÊT 28 ont été « tranchées par Youssef » (§D).
- Pour la contre-relecture, les points se nomment par lettre (A, B, C, D) et chacun dit s'il est corrigé et
  par quoi.

Le `/code-review` fourni avec Claude Code peut compléter la chasse aux défauts du diff ; il ne remplace pas
cette liste, qui porte les règles de ce dépôt.

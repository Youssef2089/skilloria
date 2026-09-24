# Reprise — lot « journal des transactions » (arrêt du 24/09/2026)

> Note de passage écrite à l'arrêt de la session, à la demande de l'architecte. Elle dit **ce qui est
> commité**, **ce qui reste**, et **le point exact** où le travail s'est arrêté. Elle ne remplace ni
> [CLAUDE.md](../CLAUDE.md) ni les trois fichiers de mémoire : elle s'efface quand le lot reprend.

## 1. Ce qui est fait — l'étape 0 est FERMÉE, cinq commits sur `feat/sprint-archi-orga`

Chaque commit porte son contrôle et sa preuve par mutation (**COMMITE AVANT DE MUTER** respecté :
la campagne tourne sur l'arbre commité et restaure par `git checkout`).

| Étape | Commit | Ce qu'il livre | Preuve |
|---|---|---|---|
| **0.1** | `2ed5fd7` | Les **sept** écritures d'audit à `entity_id: null` (six réglages d'argent) — mesuré en base : **0 ligne** pour ces sept actions sur 127. La parade est le **TYPE** (`AuditLogParams` sans `?` ni `null`) ; tsc a nommé **trois** sites de plus (variables typées nullables). Identifiant **dérivé** (`lib/admin/identifiant-derive.ts`), le dériveur des tâches y délègue. | `diag-audit-jamais-nul` — **14/14** ; `diag-cron-supervision` réécrit (il s'ancrait sur `createHash`, §E.34) |
| **0.2** | `a72650b` | L'avertissement d'inactivité (CNIL, 23 mois) laisse une ligne d'audit **par sortie** (`inactivity_warning_sent` / `_failed` + cause) ; `purgeAccount` exige un **contexte** fermé (`ContextePurge`) et `account_purged` dit son origine. Correction de l'énoncé : la purge traçait déjà, c'est l'**avertissement** qui ne laissait rien. | `diag-account-lifecycle` §C bis — **11/11** |
| **0.3** | `aba42ba` | Aucune donnée personnelle dans `audit_logs.detail` : **huit** écritures fermées (la base n'en montrait que quatre — le contrôle a trouvé `identity_updated` et `org_invitation_revoked`). Migration `audit_sans_donnee_personnelle` : liste des clés **en base** (source unique), fonction pure récursive, `audit_logs_nettoyer_compte(uid, email)` appelée par la purge **avant** le jalon. Mesuré avant : 4 lignes, 5 comptes. | `diag-audit-sans-donnee-personnelle` — **15/15** |
| **0.4** | `1e81da3` + `0b5d320` | Adresses IP et navigateurs conservés **12 mois** (réglable 1–60, `/admin/durees`, 4ᵉ champ, i18n ×4), puis mis à NULL dans `audit_logs` **et** `session_logs` par `ip_retention_purge` (04:20, SQL pur, **légale** au catalogue) qui écrit son verdict par `cloturer_run_cron` — même guichet que les tâches HTTP. Mesuré avant : 29 lignes d'audit et 185 sessions avec IP. | `diag-durees-reglables` §J — **16/16** après deux trous trouvés et fermés (`0b5d320`) |
| **0.5** | `f225380` | Verdict sur les trois tables : `rate_limit_hits` **VIVANTE** (écrite par la fonction SQL `rate_limit_check()` — la revue s'était trompée, un écrivain SQL ne se voit pas depuis `app/`+`lib/`, §E.61) ; `user_section_visits` et `subscription_history` **MORTES**. **Rien n'est supprimé.** | `diag-tables-mortes` — **4/4** |

**Mémoire tenue dans chaque commit** : §E.68 (pieges) + index CLAUDE.md ; architecture §B.2 (deux
migrations), §C.8 (la purge : trois chemins, la trace, le journal nettoyé), §H.2 (le verdict) ;
produit §P3.4, §P3.6 (**dix** tâches), écran `durees` ; mise-en-production (dix tâches).
Compte des migrations dans la mémoire : **88**.

## 2. Les migrations à rejouer — sur une BASE LOCALE JETABLE d'abord, puis staging

Deux migrations nouvelles dans ce lot, dans cet ordre :

| Fichier | Ordre de passage | Ce qu'elle exécute dans sa postcondition |
|---|---|---|
| `20260924000010_audit_sans_donnee_personnelle.sql` | **indifférent** (trois fonctions, aucune ligne touchée) | signatures par `to_regprocedure`, la liste couvre les 4 clés mesurées, la fonction pure **exécutée** sur un objet imbriqué, le nettoyage **exécuté** sur un compte inexistant (0 ligne) |
| `20260924000020_conservation_ip.sql` | **AVANT le déploiement** (la route lit la colonne) | signatures, colonne NOT NULL, contrainte **éprouvée** (0 et 61 refusés, sous-transactions), limite exécutée, tâche planifiée et cataloguée, `cron_purge_health()` la voit, l'effacement **exécuté puis annulé** (sonde) |

> ⚠️ Non vérifié ici : si les trois migrations précédentes du sprint (`20260923000050_tarif_par_recherche`,
> `20260923000060_plafond_par_acteur`, `20260924000000_depense_par_acteur_et_action`) ont été
> **re-poussées** après l'échec du `db push` d'hier. La requête de contrôle est dans
> [scripts/requetes/24-09-verifier-echec-db-push.sql](../scripts/requetes/24-09-verifier-echec-db-push.sql).
> `npx supabase db reset --local` rejoue les 88 depuis zéro.

## 3. État des validations à l'arrêt

- `tsc` : **0 erreur** hors `.next/`. `lint` : **65 / 25** (base 66 / 28). i18n : **3 708 clés × 4**, à parité.
- Série `node scripts/diag.mjs` : tout vert, **sauf** :
  - `diag-cron-purges` — **rouge attendu** sur staging tant que `conservation_ip` n'est pas appliquée
    (il exige désormais `ip_retention_purge` avec verdict : c'est sa fonction) ;
  - `diag-supabase` — préexistant : plantage libuv **à la sortie** sous Windows, verdict vert avant.
- `next build` : **NON VÉRIFIÉ** dans cet environnement — `next/font` n'a pas pu télécharger
  *Plus Jakarta Sans* / *Geist Mono* (réseau vers Google Fonts refusé, sandbox ou non). À lancer sur un
  poste avec accès réseau avant de livrer.
- `git push` : **aucun**, comme demandé. Base : **aucune écriture** (toutes les mesures sont des `select`).

## 4. Ce qui reste — l'ÉTAPE 1, pas commencée dans le code

**Le point exact d'arrêt.** Toutes les lectures préparatoires de l'étape 1 étaient faites, **aucune
ligne écrite** (ni migration, ni module, ni contrôle) :
- la revue de conception et le mandat ont été **extraits du transcript** (ils ne sont pas dans le
  dépôt) — la liste de départ des actions (point E), les **onze** manquantes, les **cinq refus** à
  nommer (plafond atteint, expert inapte, garde d'éligibilité, quota de CV, dépôt sans jugement), les
  **trois purges** séparées, le **nettoyage du journal** comme action à part ;
- le précédent d'ajout seul est lu : `transactions_block_delete` (`stripe_fondations`) — `raise … using
  errcode = 'restrict_violation'` sur `before delete` ;
- **CLAUDE.md fait 99 323 caractères sur 100 000** : écrire §D.26 exige d'abord de **déplacer ~4 000
  caractères** vers `docs/architecture.md` (candidats mesurés : §G, la section « Database » anglaise
  périmée, §D.25).

**La conception retenue pour l'étape 1** (arbitrée par le mandat, non encore écrite) :
1. **Table `grand_livre`** en ajout seul : `horodatage` · `piece` · `piece_origine` · `type_action`
   (FK vers `grand_livre_actions`, la liste **fermée en base**, une famille par action) · `acteur_id` +
   `acteur_type` · `ecosysteme_id` · `sujet_type` + `sujet_id` · `statut` (reussi / echoue / refuse) ·
   `detail` jsonb passé par `audit_logs_detail_sans_pii()` **à l'insertion** (aucune donnée
   personnelle par construction) · `origine` (utilisateur / tache_planifiee / administrateur / systeme) ·
   `cout_usd` + `unite_facturee`. **Date en tête des index** ; la migration écrit que le partitionnement
   viendra sans changer le modèle.
2. **Le verrou** : `revoke update, delete, truncate` **et** trigger `before update or delete` qui lève
   (`errcode` dédié) sauf si `current_setting('grand_livre.nettoyage', true)` a été posé par `set local`
   **à l'intérieur** de la future RPC de nettoyage (étape 4) — le seul chemin.
3. **La fonction unique** : `journaliser(...)` (exige pièce et type, raise sinon) ; **RPC métier +
   journal en un appel** montrée sur **une action réelle** : `regler_durees_place(...)` (l'écran
   `/admin/durees`, écriture + ligne de journal dans la même transaction) — et côté SQL, la tâche
   `effacer_adresses_ip()` génère sa pièce par `gen_random_uuid()` et journalise succès et échec.
4. **La pièce** : `lib/journal/piece.ts` (type marqué, `nouvellePiece()` à l'entrée de la route),
   paramètre **obligatoire** partout — jamais de contexte ambiant (`AsyncLocalStorage` interdit), donc
   transmise **explicitement** dans la fermeture d'`after()`.
5. **Le contrôle** `diag-grand-livre` : liste SQL == liste TS (deux sens), aucune écriture directe dans
   `grand_livre` hors `journaliser`, l'action branchée passe par la RPC, la pièce créée avant toute
   écriture, la postcondition **tente** un UPDATE et un DELETE et exige qu'ils lèvent. Éprouvé par
   mutation. Le détecteur de données personnelles à **partager** avec `diag-audit-sans-donnee-personnelle`
   (module `scripts/lib/`, pas un jumeau).
6. **Mémoire** : CLAUDE.md §D.26 (la règle : toute action nouvelle s'ajoute à la liste fermée et passe
   par la fonction, sinon le contrôle rougit) ; architecture : pourquoi pas de trigger d'écriture
   (`SET LOCAL` et PostgREST), pourquoi pas de partitionnement, comment la pièce traverse pg_cron et
   `after()` ; pieges : §E.68 est déjà écrit.

Puis **ARRÊT** après l'étape 1 : rendre le socle, sa preuve par mutation et la liste des migrations
— Youssef les rejoue sur une base locale jetable avant staging, et valide avant tout branchement
(étapes 2 à 4).

## 5. Ce qui n'est PAS dans le dépôt

- La **revue de conception** (24/09/2026) et le **mandat** ne vivent que dans le transcript de session.
  Si le lot reprend dans une autre session, il faudra soit les recoller ici, soit les redonner.
- Les scripts de mutation des cinq étapes sont dans le scratchpad de session (`e0-*-mutations.mjs`),
  volontairement hors dépôt : ils réécrivent des fichiers suivis et restaurent par `git checkout`.

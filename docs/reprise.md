# Reprise — le lot du grand livre

> **À lire en premier par une session qui repart.** Tenu à jour toutes les cinq actions.
> Ce fichier dit **où en est le lot** ; le **pourquoi** vit dans la mémoire — §D.26, §C.20, §C.21
> et §H.3 de [architecture.md](architecture.md). Rien ici ne remplace le code : en cas de doute,
> `node scripts/diag-grand-livre.mjs` compte ce qui est branché.

**Dernière mise à jour : 26/09/2026.** Branche `feat/sprint-archi-orga`. Aucun `git push`, aucune écriture en base.

## Le mandat, en une phrase par étape

- **Étape 2** — chaque action de `grand_livre_actions` (55) a **exactement un** écrivain, prouvé par le contrôle.
- **Étape 3** — une colonne `piece` sur `audit_logs`, `ai_spend_events`, `stripe_events`, `cron_run_log`
  (pièce née en SQL, transmise dans le corps HTTP), `notifications`. Pas de reprise de l'historique.
- **Étape 4** — l'écran `/admin` du grand livre (filtres, pièce complète, lien vers l'objet, montants, nom
  rejoint à la lecture ou « compte supprimé », pagination réelle, troncature annoncée) et le batch de
  nettoyage (manuel, rétention réglable, plancher légal, annonce avant, confirmation, sa propre ligne).

## Fait

| Famille | Actions |
|---|---|
| (a) argent et réglages | `reglage_modifie` (6 familles), `paiement_recu`, `plafond_atteint`, `refus_plafond_atteint`, `ip_effacees` |
| (b) candidature et dévoilement | `candidature_deposee` (et la pièce du rejeu), `refus_depot_sans_jugement`, `refus_expert_inapte`, `refus_garde_eligibilite`, `refus_quota_cv`, `candidature_declinee`, `candidature_retenue`, `devoilement_ouvert`, `devoilement_ferme` |
| (c) le moteur, deux sens | `recherche_lancee`, `_filtree`, `_classee`, `_correspondances`, `_notifiee`, `_terminee`, `_echouee`, `_abandonnee` |
| (d) annonce, profil, CV, disponibilité | `annonce_publiee`, `annonce_modifiee`, `annonce_depubliee`, `annonce_expiree`, `cv_televerse`, `profil_publie`, `profil_modifie`, `disponibilite_basculee` |
| (e) comptes | `compte_suspendu`, `compte_reactive`, `compte_valide`, `compte_refuse`, `session_revoquee`, `suppression_programmee`, `suppression_annulee`, `email_change`, `mot_de_passe_change`, `telephone_verifie` |
| (e) gouvernance | `membre_invite`, `invitation_revoquee` (`bd77104`), `invitation_renvoyee`, `invitation_acceptee`, `role_membre_change`, `membre_retire`, `membre_parti` — **(e) fait** |
| (f) collaboration | `sous_traitance_publiee`, `sous_traitance_candidature` |
| (g) RGPD | `compte_purge_demande`, `compte_purge_inactivite`, `compte_purge_admin`, `inactivite_avertie` |
| messagerie | `message_envoye` |

**Compte : 54 / 55** — reste `journal_nettoye`, dont l’écrivain SQL (le nettoyage) est avancé en fin d’étape 2 ; son écran suit en étape 4.

## ▶ ÉTAPE 2 — LE COMPLÉMENT, EN COURS (GO de Youssef le 26/09/2026)

Un commit par point ; ce tableau se met à jour **à chaque commit**. L'arrêt est à la fin de l'étape 2.
Décisions de Youssef sur l'audit : voir le prompt du GO (2.1 à 2.13) — rien d'autre n'est ouvert.

| Point | État | Commit |
|---|---|---|
| Règle de lecture (CLAUDE.md) | fait | `2e80de3` |
| 2.9 parité i18n — `diag-parite-i18n` (éprouvé : orpheline es, manquante de → rouge) | fait | voir `git log` |
| 2.10 lint 65/25 — `diag-lint-cliquet` (éprouvé : 66/26 → rouge) | fait | voir `git log` |
| 2.2 les 24 lignes « tenue » → PARTIELLE si une sonde saute (garde éprouvée) | fait | voir `git log` |
| 2.3 le bloc annulé gardé (172 appels, gel 3 dont 1 défaut nommé) ; trous de `grand_livre.id` documentés | fait | voir `git log` |
| 2.5 les clés : type par action (`lib/journal/detail.ts`, portes génériques, 6 routes `satisfies`) + contrôle SQL C bis (54 sites, relais suivis, 14 appels .rpc typés) | fait | ce commit |
| 2.6, 2.11, 2.1, 2.4, 2.7, 2.8, 2.12, 2.13 | à faire | — |

## ⛔ ARRÊT 1 — AUDIT DU COMPLÉMENT RENDU, OK REÇU (26/09/2026)

**Où on en est.** Phase A acceptée : le rejeu local passe les 45, `db lint` est vide. Mais **24 des 45 ont
sauté une sonde** faute de données. Le complément (étapes 1 et 2 du prompt du 26/09) : l'audit ci-dessous
est rendu, **aucun code n'est écrit**. Prochaine action : l'étape 2, **après l'OK de Youssef seulement**.
Tag de sauvegarde local : `sauvegarde-avant-complement` → `24f03b9`.

**État de départ des validations (26/09/2026, avant toute modification)** : `tsc` vert ; `next build` vert ;
lint 65 erreurs / 25 avertissements (base 66/28) ; parité i18n 3 710 clés × 4 langues, 0 écart — **mesurée à
la main, aucun diagnostic ne garde la parité globale** ; cliquet des plages vert (gel 4) ; série `diag`
103 verts / 0 rouge / 5 muets (3 écartés parce qu'ils écrivent, 2 plantages Windows) — les mêmes qu'avant.

### 0.2 — Contradictions entre le prompt et le dépôt

1. **Le prompt suppose des « refus d'une recherche » pour chevauchement et garde d'éligibilité. Il n'y en a
   pas.** Les cinq refus nommés visent le **dépôt** (`refus_garde_eligibilite` = les gardes de
   `deposerCandidature`). Une recherche **inéligible** s'écrit `recherche_terminee` (`issue: ineligible`, avec
   sa raison) — c'est la décision §C.21 (« un refus légitime est une recherche terminée »). Un run qui **ne
   prend pas le bail** n'écrit **rien** au grand livre : une ligne de console
   (`lib/matching/run-for-expert.ts:217-220`), rien n'est lancé (§D.22 : « rien n'a échoué »). À trancher :
   est-ce un geste (le second demandeur « attend ») qui mérite une ligne ?
2. **Politiques `FOR ALL`** : la règle 5 les interdit « dans ce lot » ; la baseline en porte au moins une
   (`organization_invitations_admin_all`, `TO authenticated`). Préexistante, hors des 45 — signalée, pas touchée.
3. **CLAUDE.md dit « There is no test framework »** : pgTAP le change ; la section sera réécrite avec l'étape 2.
4. **« La convention veut l'anglais » pour les codes** : aucune convention écrite dans le dépôt ne le dit
   (CLAUDE.md : commentaires en français). Sans conséquence — la décision de report s'écrira dans CLAUDE.md.

### 1.1 — Inventaire des fonctions créées ou remplacées par les 45

Périmètre : les 45 fichiers ; chaque `create [or replace] function`, DERNIÈRE définition ; « écrit » = INSERT,
UPDATE ou DELETE dans le corps, ou écrivain du grand livre (point fixe depuis `journaliser`) ; appels relevés
dans toutes les postconditions, hors littéraux ; « sauté » = dans la branche qui suit un `raise notice
'…SAUTEE…'`. Le premier passage du balayage comptait à tort les signatures citées en chaîne — corrigé.

**35 fonctions, dont 34 écrivent.**

| Au rejeu local | Nombre | Fonctions |
|---|---|---|
| a TOURNÉ, chemin d'écriture | 2 | `journaliser`, `journaliser_reglage` |
| a tourné, **lecture** | 1 | `grand_livre_chemins` |
| a tourné, **chemin de refus seulement** (lève avant d'écrire) | 1 | `constater_devoilement_ferme` (fin future → 22023) |
| sonde **SAUTÉE** | 24 | `accepter_invitation`, `anonymiser_compte`, `changer_statut_compte`, `cloturer_annonce`, `constater_annonces_expirees`, `constater_avertissement_inactivite`, `creer_invitation`, `decliner_candidature`, `devoiler_candidature`, `enregistrer_paiement`, `envoyer_message`, `inserer_candidature_jugee`, `maj_membre_organisation`, `ouvrir_depot_candidature`, `programmer_suppression_compte`, `publier_annonce`, `regler_durees_place`, `renvoyer_invitation`, `retenir_candidature`, `revoquer_invitation`, `solder_depot_en_echec`, `statuer_sur_expert`, `statuer_sur_organisation`, `verifier_telephone` |
| **AUCUNE sonde** | 7 | `regler_tarif_ia`, `regler_plafonds_ia`, `regler_quota_ia`, `regler_matching`, `regler_note_jugement`, `set_default_package` (citées seulement dans les signatures), `journaliser_verification` (appelée par `statuer_sur_*`, sautées) |

**Compte : sur les 34 fonctions qui écrivent, 2 ont exécuté leur écriture au rejeu local ; 32 jamais.**

### 1.2 — Les sondes sur données réelles : le bloc annulé, et ce qui pourrait en sortir

- **Structure** : 161 appels d'écrivains dans les postconditions ; **161** sont dans un bloc qui lève
  `SONDE_ANNULEE` et dont le gestionnaire relance toute autre erreur, **ou** dans un bloc qui attend une erreur
  nommée (`when sqlstate '…'`) et lève `NON TENUE` si elle ne vient pas. (Mon premier balayage en signalait 2 à
  tort — les sondes GL004 ① et ①bis, dont le gestionnaire vérifie le message au lieu de `null` : la garde de 2.3
  devra accepter cette forme.) L'annulation d'un sous-bloc n'est **ni** un UPDATE **ni** un DELETE : le verrou du
  grand livre ne la bloque pas, et aucune ligne n'en reste.
- **Sorties externes** : dans tout le dépôt, `net.http_post` n'apparaît que dans le pilote des tâches
  (`purges_rgpd_pg_cron`, `verdict_ecrit_par_la_tache`) ; **aucune** fonction sondée ne l'atteint. Aucun
  `http_*`, `dblink`, `pg_notify` ; aucune fonction du lot n'insère de notification ni n'envoie d'e-mail (ils
  partent du TypeScript). Version de pg_net : déclarée sans version — **NON VÉRIFIÉE** (pas de base) ; sans objet
  pour les sondes.
- **Séquences** : seule `grand_livre.id` est une identité (`bigint generated always as identity`) ; toutes les
  autres tables touchées sont en `uuid`. Chaque sonde annulée — comme chaque GL005 ou transaction avortée —
  **consomme des numéros** : les trous sont **structurels**. Rien dans le code ni la doc ne suppose la
  contiguïté ; à écrire pour l'étape 4 : l'écran et le batch ne lisent **jamais** un trou comme une ligne manquante.

### 1.3 — Le refus au plafond porte la pièce de la recherche

`lib/matching/rerank.ts:423-426` relit le budget **entre chaque lot** avec `args.journal` ; les deux sens le
passent (`lib/matching/index.ts:423,433`, `lib/matching/run-for-expert.ts:449`) ; `budgetDisponible()`
(`lib/ai-budget.ts:150-212`) écrit `refus_plafond_atteint` par `journaliserRefusPlafond()` (l. 230) sous ce
contexte, puis la notation s'arrête (`arret_code: 'plafond_atteint'`). **Même pièce : oui.** Pour le
chevauchement et l'éligibilité d'une recherche : voir 0.2 ①.

### 1.4 — Surcharges

Balayage de **toute** la chaîne (123 fonctions) : signatures créées moins signatures supprimées par `drop
function`. **0 surcharge.** Éprouvé : en ignorant les `drop`, il en retrouve 7 (dont les 4 que le lot a
supprimées : `maj_membre_organisation`, `programmer_suppression_compte`, `ouvrir_depot_candidature`,
`set_default_package`). Limite : une surcharge posée à la main sur staging hors migration lui échappe — d'où la
vérification **en base** de 2.4.

### 1.5 — Les clés contre la liste blanche

**Aucun contrôle ne compare aujourd'hui les clés écrites par un appelant à sa liste blanche** (les sondes
recopient la forme à la main). Mesuré : **62 sites** (28 TypeScript, 34 SQL), **0 écart** ; le balayage mord
(une clé retirée → 1 écart nommé). **Angle mort** : 4 détails dynamiques au premier niveau
(`effacer_adresses_ip`, `regler_durees_place`, `set_default_package`, `journaliser_verification`), et surtout
**7 RPC appelées depuis 11 sites** (`regler_tarif_ia`, `regler_plafonds_ia`, `regler_quota_ia`,
`regler_matching`, `regler_note_jugement`, `regler_durees_place`, `set_default_package`, plus `statuer_sur_*` via
le relais `journaliser_verification`) dont le détail est **construit dans le TypeScript** et passé en jsonb :
ces clés-là ne sont comparées nulle part. 2.5 doit les couvrir.

### 1.6 — Suspendre l'occupant du siège plateforme

**Refus nommé**, avant la RPC : `refuseAdminActionOnTarget()` rend `self_forbidden` (son propre compte) ou
`target_is_admin` (tout autre administrateur) — l'occupant du siège est l'un ou l'autre. Traduits dans les 4
langues, gérés par l'écran (`app/[locale]/admin/utilisateurs/[id]/page.tsx:270`). **Reste** : si la cible
**devient** administrateur entre la lecture et l'écriture, `changer_statut_compte` lève 23503 et la route
répond `db_error` (500) — un code générique. 2.6 : nommer ce cas dans la fonction.

### 1.7 — Ce que la base vide ne prouve pas

1. **`grand_livre_une_fois_idx` (UNIQUE)** posé sur un `grand_livre` **déjà rempli** par le socle
   (`ip_effacees`, `reglage_modifie`) : un doublon (pièce, action, sujet) ferait échouer la création.
2. **`grand_livre_actions.cles_detail NOT NULL DEFAULT '{}'`** : sans risque (le défaut remplit), vérifiable.
3. **Trois colonnes nullables** (`candidature_depots.piece`, `publications.expiration_constatee_at`,
   `candidatures.fermeture_constatee_at`) : les lignes existantes restent à NULL ; `piece` NULL est géré par le
   rejeu (`estPiece()`).
4. **Le passif des deux constats** : au premier passage, toute annonce publiée **déjà** expirée et toute
   candidature dévoilée dont l'échange est **déjà** fermé seront constatées — des lignes datées du constat, pas
   de l'expiration (voulu, §C.21). Le volume est à lire.
5. **La tâche `constats_trigger`** : planifiée par la migration, elle exige les deux secrets du Vault
   (`cron_secret`, `purge_cron_base_url`) — sans eux, elle lève à chaque passage.
6. **Quatre signatures SUPPRIMÉES** (`maj_membre_organisation` à 4 arguments, `programmer_suppression_compte(uuid,
   timestamptz)`, `ouvrir_depot_candidature` à 4 arguments, `set_default_package(uuid)`) : le code **en ligne** les
   appelle encore. Entre le `db push` et le déploiement, ces gestes échouent. Ordre imposé : push **puis**
   déploiement immédiat (déjà écrit dans les en-têtes).
7. **La sonde §E.69** (`journal_paiement`) exige que l'index de `transactions.stripe_invoice_id` soit **partiel** :
   à lire sur staging.
8. **Surcharges hors migration** (1.4) : le nombre de signatures par nom, pour les 35 fonctions.
Ces huit points font la requête unique de 2.8.

### 1.8 — Le plan de tests

- **Outil** : pgTAP par `npx supabase test db --local` (CLI 2.108.0 : `--local`, `--linked`, `--db-url` —
  **toujours `--local` explicite, jamais `--linked`** ; un contrôle le gardera dans la doc et les scripts).
  `db lint --help` m'a été refusé : la présence de `--fail-on` est **à vérifier par Youssef**.
- **Où** : `supabase/tests/database/grand_livre/*.test.sql` (dossier absent aujourd'hui). Chaque fichier :
  `begin; select plan(n); … select * from finish(); rollback;` — rien ne survit.
- **Fabriques par les chemins normaux** : un compte par `insert into auth.users` avec `raw_user_meta_data`
  (`role`, `domain_slug`) → `on_auth_user_created` → `handle_new_user`, **et le test vérifie que
  `public.users` existe** (le trigger avale ses erreurs) ; une organisation par `creer_organisation_avec_admin()`
  (elle naît avec son siège) ; un expert approuvé par `statuer_sur_expert()` ; une annonce publiée par
  `publier_annonce()` ; une candidature par `ouvrir_depot_candidature()` + `inserer_candidature_jugee()`. Aucun
  `session_replication_role`, aucun trigger désactivé. Les fabriques sont des fonctions `pg_temp` partagées par
  inclusion (`\ir _fabriques.sql`) — **à confirmer au premier lancement** (inclusion psql sous `test db`) ;
  repli : recopiées par fichier.
- **Combien** : **24 fichiers** — un par geste sauté (23) + un pour les six RPC de réglage sans sonde et
  `set_default_package` ; `journaliser_verification` est couverte par le fichier des arbitrages. Chaque geste :
  effet métier, **exactement une** ligne sous sa pièce, détail conforme, chemin de refus et rejeu quand la
  fonction en a. Estimation ~160 assertions. Critère : **35 fonctions, 35 éprouvées, 0 jamais exécutée.**

## PHASE B — APRÈS LE FEU VERT DU REJEU LOCAL (décisions de Youssef, 26/09/2026)

1. **Les 7 gestes deviennent des actions** : inscription d'un expert, préinscription d'une organisation,
   création d'un administrateur, annonce créée en brouillon, mission écartée par l'expert, événement Stripe
   rouvert à la main, tâche lancée à la main.
2. **La règle des rattachements** : le nom d'une action dit ce qui s'est passé — si filtrer sur une action
   rend des lignes qui ne sont pas ce que son nom annonce, c'est une action distincte. **Distinctes, imposées** :
   `taxonomie_modifiee`, `ecosysteme_modifie`, `organisation_modifiee`, `identite_modifiee`,
   `cv_reinitialise` (son détail dit que le profil sort de la vitrine). **Les neuf autres rattachements**
   de §H.3 ter : appliquer la règle, garder ceux qui la tiennent, rendre la liste gardé/séparé.
3. **Les 7 routes hors périmètre sont confirmées** — chacune ÉCRITE dans la liste d'exclusion du contrôle,
   avec sa raison (aucune exclusion silencieuse).
4. **Critère de fin** : 55 + 7 + les actions séparées. CHAQUE action a EXACTEMENT UN appelant, sauf le
   nettoyage (`journal_nettoye`), qui vient avec l'écran. Le rapport donne le compte exact. Le contrôle
   devient STRICT et la mesure des routes devient un contrôle (exceptions nommées, §G.8).
5. Puis l'**étape 3** (colonne `piece` sur les sous-journaux) et l'**étape 4** (l'écran et le batch).

## Validations à rejouer avant chaque commit

`npx tsc --noEmit` · `npx next build` (séparément, §E.2) · `npm run lint` (base 65/25, tenue par `diag-lint-cliquet`) · `node scripts/diag.mjs`
(série statique ; 5 muets attendus : 3 écartés parce qu'ils écrivent, 2 qui plantent sur l'environnement Windows) ·
mutation du nouveau contrôle, **après** le commit.

## ⚠️ Les migrations du lot n'ont JAMAIS tourné (§E.70)

Mesuré le 26/09/2026 : 22 sondes ne demandant aucune donnée auraient levé sur une base vierge — donc
aucune migration de l'étape 2 n'avait été rejouée. Corrigées en place (non appliquées nulle part) et
gardées par un contrôle de classe. **Le rejeu sur base jetable avant staging n'est pas une formalité.**

## Migrations depuis `origin/feat/sprint-archi-orga`

`git diff --name-only origin/feat/sprint-archi-orga -- supabase/migrations` — à rejouer sur une base jetable
(`npx supabase db reset --local`) avant staging (§G.4 bis).

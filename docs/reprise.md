# Reprise — le lot du grand livre

> **À lire en premier par une session qui repart.** Tenu à jour toutes les cinq actions.
> Ce fichier dit **où en est le lot** ; le **pourquoi** vit dans la mémoire — §D.26, §C.20, §C.21
> et §H.3 de [architecture.md](architecture.md). Rien ici ne remplace le code : en cas de doute,
> `node scripts/diag-grand-livre.mjs` compte ce qui est branché.

**Dernière mise à jour : 28/09/2026.** Branche `feat/sprint-archi-orga`. Aucun `git push`, aucune écriture en base.

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

## ▶ PHASE B, ÉTAPE 2 — DÉCISIONS DE YOUSSEF SUR L'AUDIT (28/09/2026)

**A.** Le compte d'un membre invité se journalise — **pas** en déplaçant la page côté serveur (un appel direct à
l'API d'authentification avec la clé publique resterait sans trace) : le **seul passage obligé de toute création de
compte est `handle_new_user`**, c'est donc lui qui écrit la ligne, par `journaliser()`, dans la même transaction.
Pièce lue dans les métadonnées de l'inscription quand l'appelant l'y met, sinon née dans la fonction (l'origine le dit).
Exception écrite dans `docs/architecture.md`. Un test pgTAP par voie, appel direct sans pièce compris.
**B.** `DELETE /api/profile/cv` est **supprimée**. **SIGNUP** : `auth.signUp` gardé. Le reste de l'audit est accepté
(`ecosysteme_cree` séparée ; une fonction SQL unique pour la règle branche/spécialité).

| Point | État | Commit |
|---|---|---|
| B route morte supprimée — aucun appelant (`app/`, `lib/`, `components/`, `hooks/`, `context/`, `scripts/` : relu), aucun contrôle ne la réclame (`mesure-routes-sans-trace` la listait parmi les « sans trace » ; aucun inventaire ne la nomme) ; `docs/api.md` : section barrée, renvoi vers `cv/reset` | fait | `fe2d406` |
| A `compte_cree` — migration `journal_compte_cree` : `handle_new_user` recréée, écrit sa ligne par `journaliser()` ; **une action, la voie DÉCLARÉE en détail** (la règle du nom : le trigger ne sait pas par quelle voie un compte arrive, les métadonnées sont écrites par l'appelant) ; pièce des métadonnées (origine `utilisateur`, acteur le compte ; voie `administrateur` : `systeme`, sans acteur) ou née dans la fonction (`systeme`) ; **IN006** voie inconnue/incohérente ou pièce illisible ; **`taxonomie_inscription_refus`** : la règle branche/spécialité une fois, appelée par le trigger ET `register-expert` (la copie de la route est retirée). Pièce + voie posées par `register-expert`, `register-org`, `create-admin`, `creer-premier-administrateur.mjs`, `/invitation/[token]`. Test `inscription/compte_cree.test.sql` (22 : sept voies — freelance, CDI, client, cabinet, ESN, invité, administrateur —, deux appels directs, IN006 ×4, IN005 annule la ligne, taxonomie ×4). Exception écrite en `architecture.md` §D.26 | fait, non exécuté | `434ace8` |
| 2.1 `expert_inscrit` — la ligne de `register-expert` sous la pièce de `compte_cree` : réussie DANS le `try` (un journal qui refuse fait nettoyer le compte : pas de compte finalisé sans sa ligne), échouée APRÈS `atomicCleanup` (`cause` = code, `compte_nettoye`). Un échec AVANT la création (validation, OTP, adresse prise) n'écrit rien : rien n'a changé, la route rend son code. Écrivain `lib/comptes/journal-inscription.ts` ; preuves D ter (réussie, échouée) + SQL `handle_new_user` (compte_cree) ; test `grand_livre/inscriptions.test.sql` (freelance, CDI, échec, GL004, GL005) | fait, non exécuté | `c1470c3` |
| 2.1 `organisation_preinscrite` — la ligne de `register-org` sous la pièce de `compte_cree` : réussie DANS le `try` après la naissance de l'organisation (sujet l'organisation, `org_type`, `domaine_public`), échouée APRÈS `atomicCleanup` (sujet le compte, `cause`, `organisation_nettoyee`). Acteur : client ou cabinet (l'ESN s'inscrit cabinet). Même écrivain ; preuves D ter ; test : client, cabinet, ESN, échec, GL004 | fait, non exécuté | `db1c8c0` |
| 2.1 `administrateur_cree` — `promouvoir_administrateur()` : la bascule ET la ligne en une fonction (succès/échec, même pièce) ; AD002 (acteur non administrateur, levé, sans ligne), AD001 (compte non créé pour l'administration : ligne échouée). Deux appelants, un écrivain : `create-admin` et le script du jour zéro (qui n'écrivent plus `users` directement). `fab_admin` naît par ce chemin. `diag-admin-create` lit la bascule EN BASE ; `diag-ecritures-effectives` : l'`update` conditionnel au gel avec sa raison (AD001). Test `grand_livre/administrateur_cree.test.sql` (9) | fait, non exécuté | `8bd7395` |
| 2.1 annonce créée en brouillon — **deux actions** `annonce_creee` / `sous_traitance_creee` (la règle du nom et le précédent de la publication : un besoin d'expert n'est pas une annonce d'organisation — **+1 action au décompte**, dite ici). `POST /api/publications` : pièce à l'entrée, ligne APRÈS l'insertion, `journal_error` + identifiant. `sous_traitance_creee` dit si l'organisation personnelle est née avec le besoin. Test `grand_livre/annonce_creee.test.sql` (8 : client, cabinet, ESN, freelance, CDI, jamais sous l'autre nom, GL004 ×2) | fait, non exécuté | `ef148f5` |
| 2.1 `mission_ecartee` — `ecarter_mission()` : match du couple sous verrou, profil de l'ACTEUR vérifié en base, écart compté (EC001) puis journalisé ; idempotent sans ligne ; la route `dismiss` n'écrit plus `matches` (elle ne laissait aucune trace). Test `grand_livre/mission_ecartee.test.sql` (8 : freelance, CDI, sous-traitance, idempotence, profil d'autrui, annonce inconnue, fermée au navigateur) | fait, non exécuté | `3974f8c` |
| 2.1 `evenement_stripe_rouvert` — `rouvrir_evenement_stripe()` : garde dans le `WHERE`, réouverture + ligne en une transaction, `non_coince` sans ligne ; sujet dérivé de l'identifiant Stripe ; **le motif n'entre pas au grand livre** (texte libre). `diag-billing-socle` suit la garde en base ; gel des écritures : l'`update` conditionnel avec sa raison. Test `grand_livre/evenement_stripe_rouvert.test.sql` (7) | fait, non exécuté | `0bc7c07` |
| 2.1 `tache_lancee_a_la_main` — nouvelle signature d'`admin_cron_run_now` (contexte du journal) : AD002, commande dans un sous-bloc (échec écrit, cause SQLSTATE), ligne sur le sujet dérivé de la tâche, `etait_active`. **DETTE NOMMÉE : l'ancienne signature `(text, uuid)` est gardée (§E.72) — à supprimer par une migration du déploiement SUIVANT.** `diag-cron-supervision` E5 suit la dernière définition (§E.34). Test `grand_livre/tache_lancee_a_la_main.test.sql` (8 : tâches fabriquées par `cron.schedule` dans la transaction annulée) | fait, non exécuté | `fc1d29e` |
| 2.2 `taxonomie_modifiee` — les six routes (branche, spécialité × créée, modifiée, supprimée) par un écrivain `lib/taxonomie/journal-taxonomie.ts` ; détail objet, opération, branche, noms de champs, langues ; écosystème de l'objet (les lectures des deux suppressions et de la mise à jour de spécialité prennent `domain_id`). Six preuves D ter, une par route. Test `grand_livre/rattachements.test.sql` (6) | fait, non exécuté | `15c0306` |
| 2.2 `ecosysteme_cree` — `POST /api/admin/ecosystemes` : la ligne sur les deux issues de la configuration (`configuration_creee`), sujet et écosystème = le nouvel écosystème, slug seulement. Écrivain `lib/ecosystemes/journal-ecosysteme.ts`. Test : +3 dans `rattachements.test.sql` | fait, non exécuté | `b9fa385` |
| 2.2 `ecosysteme_modifie` — `[id]` PATCH, `[id]/visuel` POST et DELETE : l'opération en détail (`modification`, `activation`, `desactivation`, `visuel_depose`, `visuel_retire`) ; noms, clés, type — jamais une valeur. Trois preuves D ter. Test : +3 dans `rattachements.test.sql` | fait, non exécuté | ce commit |

## ⛔ ARRÊT 7 — PHASE B, AUDIT RENDU (29/09/2026). DEUX DÉCISIONS AVANT LE CODE.

**À FAIRE AVANT TOUTE DÉMONSTRATION (reporté par Youssef)** : l'essai d'inscription d'un expert **sur staging**
(freelance et CDI), de bout en bout — e-mail de confirmation compris.

**Étape 0.** `origin/feat/sprint-archi-orga` = HEAD = `15b50d5` (git fetch). `git status` : seul `supabase/snippets/`
non suivi (fichiers de Youssef, non touchés). Tag local `sauvegarde-avant-phase-b`. Départ : série `diag` 109 verts /
0 rouge / 5 muets (les mêmes) ; `tsc` 0 ; lint 65/25. Staging et local en Postgres 17.6.1.166 (lu).
**Contradictions relevées** :
① le prompt dit « l'inscription et la préinscription passent par `createUser` » — **le code passe par `auth.signUp`**
sur un client anonyme (`signUpWithConfirmation`, `lib/auth-signup.ts`), et c'est voulu : `admin.createUser`
n'envoie PAS l'e-mail de confirmation (piège P1 de ce fichier). Seul `create-admin` passe par `createUser` (adresse
confirmée d'office). Le nettoyage (`atomicCleanup` : public.users puis auth) existe déjà. **Je garde `signUp`**.
② « 55 + 7 » dans ce fichier, « 56 + 7 » dans le prompt : le prompt est juste (`refus_recherche_en_cours`, 56ᵉ).
③ ce fichier exemptait le nettoyage de « un appelant exactement » ; le prompt l'inclut — il est construit ici.
④ **UN FAIT QUI CONTREDIT LA LISTE DES SEPT** (décision A ci-dessous). ⑤ **Une route morte** (décision B).

**Étape 1 — l'audit (lecture seule).**

*2.1 — les sept gestes : qui écrit aujourd'hui, pour qui.*

| Geste | Fichier · ce qui écrit | Populations |
|---|---|---|
| inscription d'un expert | `app/api/auth/public/register-expert/route.ts` : `signUpWithConfirmation` (auth.users → `handle_new_user` → users + profiles), puis `users.update` (téléphone, CGU), `logAudit('expert_registered')` ; échec → `atomicCleanup` | expert freelance (`expert`), expert CDI (`cdi`) |
| préinscription d'une organisation | `app/api/auth/register-org/route.ts` : `signUpWithConfirmation`, `users.update`, RPC `creer_organisation_avec_admin`, `logAudit('org_pre_registered')` ; échec → `atomicCleanup` (organisation d'abord) | client (`entreprise`), cabinet, ESN (`cabinet` + `org_type = 'esn'`) |
| création d'un administrateur | `app/api/admin/create-admin/route.ts` : `auth.admin.createUser` (rôle de pont `entreprise`), relecture du miroir, `users.update` (user_type admin), `logAudit` ; **et** `scripts/creer-premier-administrateur.mjs` (jour zéro, même geste) | admin |
| annonce créée en brouillon | `app/api/publications/route.ts` POST : `publications.insert` (+ `ensurePersonalOrg` pour une sous-traitance : l'organisation personnelle naît à la volée), `logAudit` | client, cabinet, ESN (`mission`, `offre`) ; **collaboration entre experts** (`sous_traitance`, freelance ET CDI, organisation personnelle) |
| mission écartée | `app/api/me/missions/[id]/dismiss/route.ts` : `matches.update({status:'dismissed'})` — **aucune trace, pas même d'audit** | expert freelance, expert CDI |
| événement Stripe rouvert | `app/api/admin/facturation/route.ts` POST : `stripe_events.update({status:'failed'})`, `logAudit` | admin |
| tâche lancée à la main | `app/api/admin/cron-jobs/[name]/run/route.ts` : RPC `admin_cron_run_now` (requalifie ou insère la ligne `cron_run_log`), `logAudit` | admin |

*2.2 — les 14 rattachements, la règle appliquée (« filtrer sur l'action ne rend que ce que son nom annonce »).*

| Route | Action | Pourquoi |
|---|---|---|
| `create/update/delete-branch`, `create/update/delete-speciality` (6) | **`taxonomie_modifiee`** (imposée) — gardées ensemble | chacune modifie LA taxonomie ; le détail dit l'objet (`branche`/`specialite`) et l'opération (`creee`/`modifiee`/`supprimee`) |
| `admin/ecosystemes` POST | **`ecosysteme_cree` — SÉPARÉE** | une création filtrée sous « écosystème modifié » serait un chiffre juste sous une étiquette fausse (§E.24) |
| `admin/ecosystemes/[id]` PATCH, `[id]/visuel` POST/DELETE (2) | **`ecosysteme_modifie`** (imposée) — gardées | le visuel est une propriété de l'écosystème ; le détail dit `champs` et l'opération |
| `profile/cv/reset` | **`cv_reinitialise`** (imposée) | le détail dit `retire_de_la_vitrine` (vrai si le profil était visible) |
| `profile/cv` DELETE | **décision B** | route MORTE (aucun appelant, lu) qui ne vide que le fichier |
| `me/identity` | **`identite_modifiee`** (imposée) | prénom, nom |
| `me/organisation` PATCH, `me/organisation/logo` POST/DELETE (2) | **`organisation_modifiee`** (imposée) — gardées | le logo est une propriété de l'organisation ; le détail dit `champs` |
Gardées sous une action imposée : **8** ; séparée : **1** (`ecosysteme_cree`) ; en attente : **1** (décision B).

*2.3 — les sept exclusions*, chacune ÉCRITE avec sa raison dans le contrôle : `auth/init-session` (session, pas un
geste métier) ; `me/candidatures/[id]/view` (consultation) ; `me/missions/[id]` GET (marque de lecture) ;
`me/notifications` et `me/notifications/[id]/read` (lecture des notifications) ; `me/locale` (préférence
d'affichage) ; `cron/stripe-reconcile` (la vérification nocturne écrit son propre journal de tâche — sous-journal).

*2.5 — les cinq sous-journaux, lus dans `supabase/.temp/schema.sql`.* Aucun trigger sur aucun. **audit_logs** :
`id uuid`, `user_id` NOT NULL → users (RESTRICT), `domain_id` NOT NULL → domains, `action` varchar(50), `entity_type`,
`entity_id` NOT NULL, `detail`, `ip_address`, `user_agent`, `created_at` ; RLS active, aucune politique.
**ai_spend_events** : `provider` (CHECK rerank|claude), `domain_id`/`organization_id`/`profile_id` → SET NULL, `units`,
`cost_usd` (≥ 0), `action` (CHECK 7 valeurs), `context`, CHECK `ai_spend_un_seul_acteur` ; RLS, aucune politique.
**stripe_events** : `id text` PK, `type`, `payload` NOT NULL, `livemode`, `status` (CHECK 4), `attempts`, `error`,
`organization_id` → SET NULL, `received_at`, `processed_at` ; RLS, aucune politique. **cron_run_log** : `id bigint`
identité, `job_name`, `requested_at`, `request_id`, `http_status`, `timed_out`, `error_msg`, `response_body`,
`reconciled_at`, `trigger_source` (CHECK schedule|manual), `triggered_by`, `summary`, `verdict_source` (CHECK),
`attendu_de_la_tache` ; RLS, aucune politique. **notifications** : `user_id` → users (CASCADE), `domain_id` → domains,
`type`, `channel` (CHECK), `status` (CHECK), `entity_id`, horodatages d'envoi ; RLS **avec** `notifications_self_read`
et `notifications_self_update` (le navigateur marque ses notifications lues). → **`piece uuid` nullable** sur les
cinq, sans reprise ; pour `cron_run_log`, la pièce naît dans `trigger_purge_cron` et voyage dans le corps HTTP.

*Grand livre (lu).* Index date en tête : `(horodatage desc)`, `(horodatage desc, acteur_id)`, `(…, ecosysteme_id)`,
`(…, type_action)`, `(piece)`, `(sujet_id, horodatage desc)` ; RLS active, **aucune politique**, `SELECT` au seul
`service_role` → la lecture de l'écran passera par une fonction SECURITY DEFINER bornée à l'administrateur.

*2.6 — primitives.* `components/ui/PageHeader`, `EmptyState`, `StatusPill`, `MasterDetail`, la coquille
`components/shell/DashboardShell` (montée par le layout admin). Écrans admin voisins à imiter : `/admin/consommation`,
`/admin/taches-planifiees`.

*Au passage.* **Confirmation d'adresse en échec** : GoTrue renvoie sur `/auth/callback` sans session ; l'écran pose
`hasError` et affiche son message traduit (jamais la page brute) — mais générique : à rendre actionnable selon le
code reçu. **Branche/spécialité** : la règle vit dans `register-expert` ET `handle_new_user` → une seule définition,
une fonction SQL appelée par les deux.

**DÉCISIONS DEMANDÉES À YOUSSEF (le code ne commence qu'après)** :
**A.** Le compte d'un **membre invité** naît **dans le navigateur** (`supabase.auth.signUp` sur la page
`/invitation/[token]`) : aucun serveur, donc aucune ligne — seule l'acceptation, plus tard, s'écrit. C'est une
huitième population de « compte créé » que la liste des sept ne nomme pas. Proposition : passer cette inscription
par une route serveur (`signUpWithConfirmation`, nettoyage en cas d'échec) et une action **`membre_inscrit`**.
**B.** `DELETE /api/profile/cv` n'a **aucun appelant** et ne vide que le fichier (le profil reste marqué analysé à
moitié). Proposition : **la supprimer** plutôt que de la journaliser sous une action que rien n'emprunte.

## ⛔ ARRÊT 6 — LOT S FAIT (28/09/2026) : FINIR LE PUSH PROPREMENT.

**Validations** : `tsc` 0 ; `next build` vert ; lint 65/25 ; parité 3 712 clés ; cliquet vert ; série `diag` **109 verts
/ 0 rouge / 5 muets** (les mêmes). Rien n'a tourné sur une base. **Staging reste à moitié migré, ancien code en ligne** :
jusqu'au déploiement, l'offre par défaut et l'ouverture du dépôt de candidature y échouent (ligne ㉒).
**Prochaine action (Youssef)** : la séquence ci-dessous, de l'étape 0 — le `db push` reprend à `journal_annonce_publiee`.

## ▶ LOT S — LE PUSH S'EST ARRÊTÉ À MI-CHEMIN SUR STAGING (28/09/2026)

**L'état, lu dans `migration list` (Youssef)** : appliquées sur staging jusqu'à `20260925000190`
(journal_recherche_abandonnee) — **GELÉES**. Arrêt sur `20260925000200_journal_annonce_publiee` : sa sonde a pris un
VRAI brouillon sans zone et tenté de le publier (23514, `publications_publiee_requiert_zones_check`) — la base avait
raison, la sonde tort ; rien d'écrit. **29 migrations non appliquées** (`000200` → `20260928000010`), corrigibles en
place. Le code n'est PAS poussé : staging tourne l'ancien code sur une base à moitié migrée. Postgres de staging
passé à **17.6.1.166** ; cause racine du plantage de « vrai appelant » : supautils en 17.6.1.104 (corrigé ≥ 17.6.1.121).
**Décision de Youssef** : les sondes sur données réelles sortent des migrations ; les tests prouvent les gestes.

| Point | État | Commit |
|---|---|---|
| 1, 2, 4 **16 migrations non appliquées** perdent leur sonde sur données réelles (200, 220, 230, 280, 290, 300, 320, 360, 370, 380, 390, 400, 410, 420, 430, 440) ; reste dans chacune : signatures par types, listes blanches, colonnes/index, refus du texte libre, et — sur identifiants INVENTÉS — compte/invitation/membre/fil inconnu (320, 360, 380, 390, 400, 410, 430, 440), fin future refusée (280), motif inconnu et échec sans cause (430) ; la reprise voulue du passif des annonces (230) reste. Les 29 lignes de fin renvoient à leur preuve (le test, ou le module TS pour les 9 actions écrites en TypeScript). `diag-grand-livre` : 36 preuves de CONTENU de sonde retirées, planchers re-mesurés (131 appels, 9 migrations). Test `invitations` : rôle dans la ligne d'invitation, échéance dans la ligne de renvoi. Les 21 appliquées (≤ journal_recherche_abandonnee) : **gelées, intactes** | fait, non exécuté | ce commit |
| 7 la requête de staging relue contre l'état du push interrompu : **② mise à jour** (l'index d'unicité EXISTE, unique → attendu 1), **⑦ mise à jour** (seules les deux colonnes du reste du lot doivent être absentes), **⑨ mise à jour** (seules deux anciennes signatures restent → 2) ; **ajoutées** : ㉑ `cles_detail` et `candidature_depots.piece` présentes (2), ㉒ `set_default_package(uuid)` et l'ancien `ouvrir_depot_candidature` absents (0 — et donc ces deux gestes ÉCHOUENT sur staging jusqu'au déploiement), ㉓ `exiger_ecriture` présente (1). Inchangées : ①, ③–⑥, ⑧, ⑩–⑳ (⑪ attend toujours 13 : les portes se ferment dans une migration non appliquée) | fait | ce commit |
| 6 §E.76 : cause racine **VÉRIFIÉE** (supautils, 17.6.1.104, corrigé ≥ 17.6.1.121 — un appel à une RPC refusée au navigateur tuait le serveur) ; `scripts/verifier-version-postgres.mjs` (lit `supabase/.temp/postgres-version`, refuse sous 17.6.1.121 ; ici : 17.6.1.166 ✅) ; séquence de déploiement : étape 0 (CLAUDE.md §G.4 ter, ci-dessous) ; `docs/mise-en-production.md` : étape 0, la production naît sur une version corrigée, et la liste à cocher | fait | ce commit |
| 5 la règle : CLAUDE.md §G.4 ter, §E.77 ; `diag-postconditions-structure` (tables métier DÉRIVÉES — 23 référentiels, 48 métier —, héritage gelé par suffixe, 29 migrations soumises : aucune lecture métier, aucune écriture directe, chaque ligne de fin renvoie à un fichier qui existe ; 2 exceptions écrites, l'inscription qui relit le compte qu'elle fabrique) | fait | ce commit |
| 3 (d'abord) aucune preuve ne disparaît : les gestes que seules les sondes prouvaient passent aux tests — `invitations` +4 (renvoi : statut non admis, une autre pièce écrit une seconde ligne ; acceptation : statut non admis, invitation échue) et 2 renforcées (échéance du renvoi relue, adresse comparée sans casse) ; `annonce_publiee` (l'organisation dans la ligne) ; `compte_suspendu` (de/vers de la réactivation) | fait, non exécuté | ce commit |

## ⛔ ARRÊT 5 — 26 FICHIERS SUR 27 VERTS, 206 TESTS, AUCUN PLANTAGE (28/09/2026). LA CAUSE DU PLANTAGE RESTE À TRANCHER.

**Ce que Youssef a obtenu** : 26 fichiers verts. `vrai_appelant/appelant.test.sql` s'est arrêté ligne 62, après
une assertion : `could not determine polymorphic type because input has type unknown` — `is(:'accepte',
'acceptee', …)`, deux littéraux non typés passés à une fonction polymorphe. Les 10 autres assertions n'ont pas
tourné : **la question du plantage n'est pas tranchée**.
**Corrigé** : les deux arguments typés `::text`. Le fichier entier relu pour la même forme : c'était la **seule**
occurrence — le premier `is()` compare deux `text[]` typés, le dernier deux `bigint`, `coalesce(p.proconfig, '{}')`
prend son type de la colonne (et son assertion est passée), `format()` prend `variadic "any"`, qui n'est pas une
résolution polymorphe. Rien d'autre touché ; la propriété prouvée est la même.
**Prochaine action (Youssef)** : `db reset --local`, puis `test db --local` — ce passage tranche le plantage
(voir ARRÊT 4, ②/③).

## ⛔ ARRÊT 4 — LOT C : LE PLANTAGE DU TEST « APPELANT » (28/09/2026). CAUSE NON TRANCHÉE.

**Ce que Youssef a obtenu** : `db reset` vert (les deux migrations nouvelles « postcondition tenue », l'inscription
d'un expert exécutée pour de vrai) ; `db lint` vide ; `test db` : 4 fichiers verts, puis
`grand_livre/appelant.test.sql` → **signal 11**, « Failed process was running: select * from pg_temp.essai(); »,
récupération de la base, **22 fichiers non exécutés**.

| Point | Fait | Commit |
|---|---|---|
| C.1 le test réécrit : `vrai_appelant/appelant.test.sql` — même propriété (11 assertions), changements de rôle en **instructions** comme PostgREST, **un appel par instruction** (le journal nommera la RPC), passe **en dernier** ; garde J de `diag-tests-grand-livre` (aucun rôle changé dans un corps `$…$`, ces fichiers en dernier) ; `supabase/verifications/repro-segfault-appelant.sql` (local seulement) : six formes étiquetées, de la plus nue à celle de l'ancien test | fait, non exécuté | ce commit |
| C.2 / C.3 la cause | **NON TRANCHÉE** — aucun moyen de l'établir sans exécuter. Le prochain passage la tranche (voir ci-dessous) ; §E.76 écrit ce qui est établi et marque la cause NON VÉRIFIÉE | — |
| C.4 la requête de staging | inchangée | — |

**Ce que le prochain passage tranchera.** ① Les 22 fichiers bloqués donnent enfin leur verdict (le fichier qui
change de rôle passe après eux). ② Si `vrai_appelant/appelant.test.sql` passe : la forme de l'ancien test était en
cause — la reproduction dira laquelle (A à E), et §E.76 sera réécrit avec le coupable. ③ S'il plante : le journal
nomme l'appel, c'est un **défaut critique du produit** (un appel PostgREST tuerait la base) — on s'arrête, sans
contournement.

## ⛔ ARRÊT 3 — LE LOT T EST FAIT (28/09/2026). LA PHASE B N'EST TOUJOURS PAS COMMENCÉE.

**Validations à l'arrêt** : `tsc` 0 erreur (hors `.next/`) ; `next build` vert ; lint 65/25 (cliquet vert) ; parité
i18n **3 712** clés × 4 (+2 : les messages d'échec d'inscription de la page d'invitation) ; cliquet des plages vert ;
série `diag` **108 verts / 0 rouge / 5 muets** — les 5 mêmes (3 écartés parce qu'ils écrivent, 2 plantages
Windows). **Rien n'a tourné sur une base** : 27 fichiers de test, 2 migrations nouvelles, 15 du lot corrigées en place.

**Migrations nouvelles** : `20260928000000_inscription_specialites`, `20260928000010_ecritures_effectives`.
**Corrigées en place (lot, jamais poussées)** : liste_blanche_par_action, journal_reglages, journal_devoilement_ouvert,
journal_annonce_depubliee, journal_annonce_expiree, journal_devoilement_ferme, journal_compte_suspendu,
journal_compte_valide, journal_suppression_programmee, journal_invitation_revoquee, journal_invitation_renvoyee,
journal_invitation_acceptee, journal_membres, journal_message_envoye, portes_laterales_fermees.

**Prochaine action (Youssef)** : la séquence de CLAUDE.md §G.4 ter, étapes 1 à 4, puis retour des sorties.

## ▶ LOT T — LES TESTS ONT TOURNÉ CHEZ YOUSSEF (28/09/2026)

**Ce qu'il a obtenu** : `db reset --local` vert (47 migrations du lot, « PARTIELLE » où une sonde saute) ;
`db lint` vide ; `test db --local` **FAIL** — 23 fichiers, 59 tests ; 15 fichiers arrêtés avant leur premier test
sur `column "speciality_id" of relation "profiles" does not exist` (`handle_new_user`) ; échecs partiels :
`annonce_depubliee` (2), `invitations` (4, 13), `membres` (4, 5, 8). Requête de staging : 12 OK, 0 ÉCART, 3 À LIRE
(6 annonces déjà expirées, 3 lignes au grand livre, 55 actions). Sous-dossiers parcourus, `_fabriques.psql` ignoré,
`\ir` résout : les trois doutes sont levés.

| Point | État | Commit |
|---|---|---|
| T.1 l'inscription : `handle_new_user` recréé (migration `20260928000000_inscription_specialites`) — `speciality_ids`, taxonomie vérifiée en base, rôle inconnu **lève** (IN001, plus de compte fantôme), codes IN001–IN005 ; test `inscription/roles.test.sql` (5 rôles + « Autre » + 7 refus, 21 assertions) ; requête de staging +3 lignes (16–18) ; `diag-admin-create` réancré sur la dernière définition (§E.34) ; `diag-cron-supervision` ne confond plus `"trigger"` et `trigger` ; page d'invitation : plus de message GoTrue brut (2 libellés × 4 langues) | fait, non exécuté | ce commit |
| T.2 la classe : `db lint` appelle plpgsql_check **sans table** (vu dans la CLI ; filtre exact NON VÉRIFIÉ) → test `plpgsql_check.test.sql` (4 assertions : chaque couple fonction de trigger / table, puis les autres fonctions plpgsql) + garde H ; `diag-colonnes-supprimees` attribue **par instruction** (INSERT, ON CONFLICT, SET, tables supprimées, chaînes vidées ; défaut `into v_x` qui avalait `from` corrigé) — 5 témoins ; balayage : **130 fonctions et vues, 0 autre citation morte** ; §E.73 | fait | ce commit |
| T.3 les six échecs : **le test avait tort, pas le produit** — une sous-requête dans la même instruction que l'appel lit l'instantané d'avant l'écriture (preuve : les assertions séparées passaient) ; hypothèse RLS **écartée** (les 4 RPC sont DEFINER + search_path, lu dans le code) ; **12** assertions corrigées (les 6 + 6 de même forme jamais exécutées), garde I ; `appelant.test.sql` (9 : service_role écrit et journalise, authenticated refusé 42501, écriture directe sans effet) ; LA CLASSE : `exiger_ecriture()` EC001 — 18 écritures du lot en place, 8 fonctions appliquées recréées (`20260928000010_ecritures_effectives`), `diag-ecritures-effectives` (66 écritures, 27 exigent, 39 au gel à raisons) ; §E.74 | fait, non exécuté | ce commit |
| T.4 la bascule : `POST /api/profile/disponibilite` (un champ de la voie, comparer-puis-poser, une ligne exigée, `disponibilite_basculee` sous la pièce par l'écrivain unique) ; `lib/profil/bascule-disponibilite.ts` partagé par les deux tableaux (4 bascules : `availability_status`, `open_to_cdi`, `cdi_status`, `open_to_freelance`) — mêmes optimisme, retour en arrière et toasts ; `profiles_self_update` fermée en place + droit d'écrire `profiles` retiré au navigateur (un onglet périmé échoue au lieu de réussir à vide) ; `diag-portes-laterales` : **13 sur 13** (14 sur 14 dans l'histoire), 0 exception ; requête de staging ⑪ → 13 ; `ensure_rls` n'accorde aucun droit (CLAUDE.md marqué PÉRIMÉ, §M0) | fait, non exécuté | ce commit |
| T.5 une règle, une définition : **le TypeScript fait foi** (`deriveCandidatureLifecycle` : si ; `effectiveConversationExpiry` : quand) ; la base les lit. Elle portait `status = 'unlocked'` — seconde définition partielle → elle reçoit `p_statut_lu` et compare (migration du lot corrigée en place, signature `(uuid, uuid, timestamptz, text)`, l'ancienne retirée) ; issues `deja` · `change` · `introuvable` nommées ; route : `devoilements_changes` ; test +3 (10) ; `diag-grand-livre` refuse tout statut en dur dans la fonction | fait, non exécuté | ce commit |
| T.6 ce que le rapport ne prouvait pas — **mutations** (toutes après commit) : 2.3 **NE MORDAIT PAS** (une sonde privée de son annulation restait verte : un bloc imbriqué qui attend GL005 prêtait sa qualité au parent) → corrigée (`7dc823a`), re-mutée ×2 → rouge, §E.75 ; 2.5 clé hors liste dans un détail SQL → rouge ; 2.5 liste TS ≠ base (`message_envoye` amputé en TS) → rouge ; 2.8 écriture client rétablie → rouge, politique rouverte → rouge ; 2.9 clé retirée en espagnol → rouge. **Le défaut nommé du gel de 2.3** : `20260923000060_plafond_par_acteur`, sa postcondition MODIFIE l'alerte réelle de l'acteur `profile` puis la RESTAURE hors bloc annulé — sur staging, **rien n'en reste** (même transaction, aucun trigger sur la table, grand livre inexistant le 23/09), migration appliquée donc intouchée. **Les 3 lignes de staging** : les sondes du socle sont annulées ou attendent une erreur (lu) ; hypothèse : trois passages réels de `ip_retention_purge` (04:20 UTC, 25–27/09) — la requête de staging le tranche (lignes ⑲ attendu 0, ⑳ la ventilation) | fait | `47a5822`, `7dc823a`, ce commit |

**Si la ligne ⑲ de la requête n'est pas 0 — ce que la phase B fera des restes.** Le grand livre est en ajout seul
(GL001) : rien ne se supprime hors du nettoyage. Un reste ne sera **ni effacé ni masqué** : il se **contrepasse**
par une ligne nouvelle qui cite sa pièce en `piece_origine` (§D.26), et l'écran de l'étape 4 l'affichera avec sa
contrepassation. Le nettoyage (rétention) le traitera comme toute ligne — par l'âge, jamais par sa nature.

## ⛔ ARRÊT 2 — L'ÉTAPE 2 EST FAITE (26/09/2026). LA PHASE B N'EST PAS COMMENCÉE.

**Validations à l'arrêt** : `tsc` 0 erreur (hors `.next/`) ; `next build` vert ; lint 65/25 (cliquet vert) ;
parité i18n 3 710 clés × 4, 0 écart ; cliquet des plages vert ; série `diag` **107 verts / 0 rouge / 5 muets**
— les 5 mêmes qu'au départ (3 écartés parce qu'ils écrivent, 2 plantages Windows `UV_HANDLE_CLOSING`).
**Rien n'a tourné sur une base** : ni les migrations corrigées, ni les tests, ni la requête de staging.

**Migrations** : 2 nouvelles (`20260926000000_journal_refus_recherche_en_cours`,
`20260926000010_portes_laterales_fermees`) ; 24 des 45 corrigées EN PLACE ; aucune renommée, supprimée ou
réordonnée ; aucune migration déjà appliquée touchée.

**En attente d'arbitrage** : ① `profiles_self_update` (DÉFAUT NOMMÉ, 2.8) — les bascules de disponibilité des
tableaux de bord écrivent `profiles` depuis le navigateur sans `disponibilite_basculee` ; ② le passif des
dévoilements tient par une DATE de mise en service (`constats_mise_en_service`), pas par un marquage en
migration comme les annonces — la règle d'expiration de l'échange vit en TypeScript.

**Prochaine action (Youssef)** : la séquence de CLAUDE.md §G.4 ter, étapes 1 à 4 ; retour des sorties ;
puis 5 à 7 seulement si tout est vert et la requête sans `ÉCART`.

## ▶ ÉTAPE 2 — LE COMPLÉMENT (GO de Youssef le 26/09/2026)

Un commit par point ; ce tableau se met à jour **à chaque commit**. L'arrêt est à la fin de l'étape 2.
Décisions de Youssef sur l'audit : voir le prompt du GO (2.1 à 2.13) — rien d'autre n'est ouvert.

| Point | État | Commit |
|---|---|---|
| Règle de lecture (CLAUDE.md) | fait | `2e80de3` |
| 2.9 parité i18n — `diag-parite-i18n` (éprouvé : orpheline es, manquante de → rouge) | fait | voir `git log` |
| 2.10 lint 65/25 — `diag-lint-cliquet` (éprouvé : 66/26 → rouge) | fait | voir `git log` |
| 2.2 les 24 lignes « tenue » → PARTIELLE si une sonde saute (garde éprouvée) | fait | voir `git log` |
| 2.3 le bloc annulé gardé (172 appels, gel 3 dont 1 défaut nommé) ; trous de `grand_livre.id` documentés | fait | voir `git log` |
| 2.5 les clés : type par action (`lib/journal/detail.ts`, portes génériques, 6 routes `satisfies`) + contrôle SQL C bis (54 sites, relais suivis, 14 appels .rpc typés) | fait | `97fb107` + correctif `d89a621` (deux gardes de la porte cassées par le type générique, et le `satisfies` retiré non vu — trouvés par mutation) |
| 2.6 le siège plateforme : gardes de compte relues SOUS VERROU dans `changer_statut_compte`, refus nommé `target_is_admin` / `self_forbidden` (403) ; sonde `self_forbidden` exécutée | fait | voir `git log` |
| 2.11 passif SANS ligne : annonces marquées par la migration (`annonce_active()`) ; dévoilements par la date de mise en service (`constats_mise_en_service`, issue fermée `constate`/`passif`/`deja`) ; §E.72 la règle des signatures supprimées ; secrets du Vault → requête de staging (la tâche reste HTTP : la règle des dévoilements vit en TS) ; index unique, colonnes, index §E.69, surcharges → requête de staging | fait | ce commit |
| 2.7 le chevauchement s'écrit : `refus_recherche_en_cours` (migration `20260926000000`, écrivain unique, sur `occupe` seulement) ; la liste fermée compte 56 actions ; langue des codes reportée, écrite dans CLAUDE.md | fait | voir `git log` |
| 2.8 les portes latérales : 13 mesurées, 12 fermées (migration `20260926000010`), `profiles_self_update` reste ouverte — DÉFAUT NOMMÉ, arbitrage (les bascules de disponibilité des tableaux de bord écrivent `profiles` depuis le navigateur et n'écrivent pas `disponibilite_basculee`) ; `diag-portes-laterales` | fait, arbitrage demandé | ce commit |
| 2.1 les tests pgTAP : **22 fichiers, 157 assertions** (et non 24 fichiers : les gestes d'une même famille partagent un fichier — invitations, membres, purges, réglages ; plus `socle` et `refus_recherche_en_cours`) ; **38 fonctions créées depuis le socle, 38 appelées** (les 35 de l'inventaire, les 7 sans sonde comprises, plus les 3 du socle) ; 33/56 actions citées, 23 au gel à raisons (22 écrites par le TypeScript, `journal_nettoye` sans écrivain avant l'étape 4) ; `diag-tests-grand-livre` ; CLAUDE.md §G.4 ter. **AUCUN test n'a tourné** : pas de Docker ici — `test db --local` est à lancer par Youssef | fait, non exécuté | ce commit |
| 2.4 une fonction, une signature : `supabase/tests/database/une_signature.test.sql` (2 assertions, `pg_proc` du schéma public hors extensions, table d'exceptions à raison obligatoire — **0 exception**) ; garde F de `diag-tests-grand-livre` (éprouvée : comptage retiré, raison facultative → rouge) | fait, non exécuté | ce commit |
| 2.13 la requête unique de staging : `supabase/verifications/staging-avant-push.sql` — **un** SELECT, lecture seule, **15 lignes** (attendu / observé / verdict OK·ÉCART·À LIRE) : doublons de l'index unique, nom d'index libre (§E.60), index partiel §E.69, deux secrets du Vault par leur nom, pg_cron/pg_net, `constats_trigger` absente, 4 colonnes et 1 table du lot absentes, 4 anciennes signatures présentes, 0 surcharge, 12 politiques retirées présentes, 0 porte posée à la main, et trois volumes (passif des annonces, lignes du socle, actions) | fait, non exécutée | ce commit |
| 2.12 la séquence de déploiement : CLAUDE.md §G.4 ter (7 étapes) et ci-dessous | fait | ce commit |

### La séquence de déploiement (CLAUDE.md §G.4 ter) — ce que Youssef lance

0. après `npx supabase link` : `node scripts/verifier-version-postgres.mjs` — au moins 17.6.1.121, sinon mettre staging à jour d'abord (§E.76)
1. `npx supabase db reset --local`
2. `npx supabase db lint -s public --level error` — sortie vide = aucune erreur (pas de `--fail-on`)
3. `npx supabase test db --local`
4. la requête `supabase/verifications/staging-avant-push.sql` dans l'éditeur SQL de staging — un `ÉCART` → arrêt
5. `npm run build`
6. `npx supabase db push`
7. `git push`, aussitôt après

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

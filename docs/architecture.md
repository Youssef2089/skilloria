# Architecture — Skilloria

> **Deuxième des trois fichiers de la mémoire du projet.** Les deux autres :
> [CLAUDE.md](../CLAUDE.md) (règle de maintenance, décisions figées §D, pièges §E, worktrees §G) et
> [docs/produit.md](produit.md) (les parcours, les écrans, les règles métier).
>
> Écrit depuis le code, les migrations et les diagnostics — pas depuis une conversation. Chaque
> affirmation est vérifiable dans le dépôt ; ce qui ne l'est pas est marqué **NON VÉRIFIÉ**.
> **Relu contre le code le 16 septembre 2026** (§M1 dans [CLAUDE.md](../CLAUDE.md)).
>
> *Ouvrez ce fichier quand vous allez toucher au code et voulez savoir où vous mettez les pieds.*

---

## A. Ce qu'est Skilloria

Place de marché **multi-écosystème** (un écosystème = un sous-domaine = une ligne `domains`) qui met
en relation des **organisations** et des **experts certifiés**. Français par défaut, servi en
4 langues. Next.js 16 + Supabase + Vercel.

**Les populations** — `users.user_type` (CHECK en base) :

| Type | Ce qu'il fait |
|---|---|
| `expert_freelance` | Dépose un CV, se rend visible, reçoit des missions, postule. Peut publier un **besoin de sous-traitance** via une organisation personnelle. |
| `expert_cdi` | Idem, sur des offres CDI. Route et parsing CV dédiés. |
| `client` | Membre d'une organisation. Publie des annonces, reçoit des candidatures, déverrouille, échange. |
| `cabinet` | Même dashboard que `client` (`/dashboard/entreprise`). |
| `admin` | Back-office plateforme. |

**ESN n'est pas un type d'utilisateur** : c'est une valeur de `organizations.org_type`
(`client` \| `cabinet` \| `esn` \| `freelance`). `register-org` mappe `org_type='esn'|'cabinet'`
→ `user_type='cabinet'` (`metadataRoleFromOrgType`, TODO signalé dans [lib/auth-routing.ts](../lib/auth-routing.ts)).
`org_type='freelance'` désigne l'**organisation personnelle** d'un expert (sous-traitance).

**Où l'argent entre** — et il n'entre pas encore : voir §D.1. Le chemin existe et est complet :
`/api/billing/offers` → `/api/billing/checkout` (Checkout **hébergé** chez Stripe, aucune donnée de
carte ne touche le serveur) → `/api/stripe/webhook` (**seule** source de droits) → `/api/billing/portal`
et `/api/billing/change-plan`. Le catalogue (`packages`, `package_features`) est édité au back-office
et synchronisé vers Stripe ([lib/billing/catalogue.ts](../lib/billing/catalogue.ts)).

Ce que l'offre gouverne ([lib/entitlements.ts](../lib/entitlements.ts), codes de features contractuels
avec le seed) : `publications_per_month`, `active_publications_max`,
`revealed_candidates_per_publication`, `manual_unlocks_per_month`. Les refus sortent en **402**
(`quota_publications_reached`, `quota_active_publications_reached`, `unlock_limit_reached`).

---

## B. Le modèle de données et son histoire

### B.1 Les tables, par rôle

**Identité / tenant** — `domains`, `domain_configs`, `users`, `roles`, `profiles`,
`profile_experiences`, `profile_educations`, `profile_languages`, `session_logs`, `translations`,
`countries`, `work_zones`.

**Organisations** — `organizations`, `organization_members`, `organization_invitations`,
`organization_domains` (→ **TRACE HISTORIQUE**, §B.2), `verification_attempts`, `verification_providers`.

**Boucle cœur** — `publications`, `matches`, `candidatures`, `candidature_views`,
`conversations`, `messages`, `notifications`, `notification_preferences`.

**Commerce** — `packages`, `package_features`, `package_history`, `subscription_history`,
`transactions`, `usage_counters`, `promo_codes`, `promo_code_uses`, `stripe_events`.

**Taxonomie** — `branches`, `specialities`, `public_email_domains`, `blocked_email_domains`.

> Ces quatre tables manquaient à cet inventaire, alors que `branches` est citée dans **20** fichiers
> et `specialities` dans **19** : l'inscription d'un expert en dépend (§P1.1). Un inventaire
> incomplet est pire qu'absent — on le croit exhaustif.

**Moteur & exploitation** — `matching_settings`, `matching_notes_partielles`, `relance_overruns`,
`ai_quotas`, `ai_spend_caps`, `ai_spend_seuils_acteur`, `ai_spend_events`, `ai_model_tarifs`,
`duree_reglages`, `ai_redaction_failures`, `rate_limit_hits`, `features`,
`cron_job_catalog`, `cron_run_log`, `cron_run_leases`, `plateforme`, `audit_logs`.

**Marketing / contenu — CRÉÉES PAR LA BASELINE, ET JAMAIS TOUCHÉES PAR LE CODE.**
`ad_placements`, `blog_posts`, `campaigns`, `dashboard_stats`, `leads`,
`newsletter_subscriptions`, `profile_alerts`, `referrals`, `testimonials`,
`user_section_visits`, `waitlist`.

> **Onze tables existent et ne sont lues ni écrites par aucune ligne de `app/` ou `lib/`**
> (balayage du 16/09/2026). Elles ne sont pas un projet en cours : ce sont des vestiges du dump
> de baseline. Les taire ferait croire, à qui explore la base, que ces fonctionnalités existent.
> **NON VÉRIFIÉ** : rien ne dit si elles portent des données de production — on ne les a pas lues.

### B.2 Les déplacements structurants — ceux qui piègent

**① L'abonnement est remonté de `organization_domains` vers `organizations`.**
Migration `abonnement_sur_organisation`. Colonnes désormais sur `organizations` :
`package_id`, `package_started_at`, `package_valid_until`, `stripe_subscription_id`,
`stripe_subscription_status`, `package_source_event_at`. Les mêmes colonnes ont été **supprimées** de
`organization_domains`, index unique et CHECK compris.
Motif produit : une organisation accède à **tous** les écosystèmes actifs avec **un seul** abonnement
et **un seul** quota partagés ; un abonnement porté par le couple (organisation, domaine) produisait
un défaut d'argent silencieux — payer sur un écosystème, retomber sur l'offre gratuite sur un autre.
Ce qui n'a **pas** bougé, délibérément : `usage_counters` / `usage_increment` / `usage_peek`
(clé primaire **sans** `domain_id` — le quota partagé est voulu), `packages`, `package_features`,
l'invariant « offre par défaut = gratuite ».

> **`organization_domains` est une TRACE HISTORIQUE. Elle n'alimente plus AUCUNE décision.**
> Son commentaire de table le dit en toutes lettres. Elle conserve quel écosystème a servi à
> l'inscription, et quand. Rien d'autre. Une absence de ligne pour un couple (organisation,
> écosystème) ne signifie **rien** : c'est le cas normal de tous les écosystèmes sauf celui
> d'inscription. Ni l'accès, ni l'abonnement, ni le cloisonnement ne s'y lisent.

**② `matches.score` est supprimée, remplacée par `relevance_score` + `relevance_tier`.**
Migration `score_de_pertinence`. Deux grandeurs différentes, deux colonnes :
- `matches.relevance_score numeric` borné **[0,1]** — score brut du reranker, **propre à une annonce**.
  Jamais normalisé sur le vivier (normaliser réintroduirait la compétition entre experts). Accompagné
  de `relevance_model` et `relevance_scored_at` : changer de reranker change l'échelle.
- `matches.relevance_tier text` ∈ `{strong, normal}` — le **palier affiché**, **figé au moment de la
  notation** (« strong » = au-dessus du seuil de notification en vigueur **ce jour-là**). Jamais
  recalculé à l'affichage : le seuil est réglable, un recalcul rebaptiserait des matches anciens.
- `candidatures.ai_match_score numeric` borné **[0,10]** — la note de **Claude au dépôt d'une
  candidature**, adossée à `ai_assessment jsonb` (`{reason, pitch_org, model, evaluated_at}`) et
  `ai_model`. **À ne jamais afficher à côté de `relevance_score`** : deux questions, deux moments.
- Index : `matches_profile_score_idx` supprimé → `matches_profile_relevance_idx`.

**③ Profil et annonce passent au multivalué.** Migration `profil_annonce_multivalues`.
Supprimées : `profiles.speciality_id`, `profiles.seniority`, `publications.speciality_id`,
`publications.seniority`. Renommée : `publications.location` → `location_note`.
Ajoutées : `speciality_ids`, `seniorities`, `work_zone_ids`, `work_zone_countries`.
Cette migration passe **AVANT** le déploiement du code, qui doit partir dans la foulée.

**④ Les préférences de notification quittent `users`.** Migration
`notification_preferences_par_evenement`. `users.notify_match_email` / `notify_match_sms`
**supprimées** → table `notification_preferences (user_id, event_type, channel, enabled)`.
**Absence de ligne = ACTIVÉ** : seules les désactivations sont stockées (opt-out).
Renommages sur `notifications` : `match_email_dispatch_at` → `email_dispatch_at` (idem `attempts`,
`sms_*`).

**⑤ Les purges RGPD changent de déclencheur.** Migration `purges_rgpd_pg_cron` : Vercel Cron →
**pg_cron + pg_net**. Contrainte plateforme : aucun batch, aucun cron hébergé. L'ordonnancement suit
la base. Les routes `/api/cron/*` restent, protégées par `CRON_SECRET`.
Tâches planifiées aujourd'hui : `purge_deletions_trigger`, `purge_inactive_trigger`,
`cron_run_reconcile`, `cron_run_log_purge`, `rate_limit_hits_purge`, `matching_retry_trigger`,
`expert_relance_trigger`, `matching_notes_partielles_purge`.

**⑥ L'archive.** `supabase/_archive/` (18 fichiers) contient les migrations d'avant la baseline. Ce
sont des **traces**, elles ne sont pas rejouées. La baseline (`00000000000000_baseline.sql`) crée
32 tables `_backup_*_20260422` que la migration suivante supprime aussitôt — héritage du dump, pas un
modèle.
> ⚠️ **Et l'archive n'était pas que de l'histoire.** Les **seuls** seeds de
> `verification_providers` y vivaient — donc jamais rejoués. Une base reconstruite les perdait
> silencieusement. Cf. §E.10.

**⑦ Le paramétrage de production est versionné.** Migration `parametrage_de_production`. La recette
construisait la **structure** sans **aucune donnée de référence** : une base parfaite et morte, où
**100 % des inscriptions échouaient** (`handle_new_user` lève sur une table `domains` vide) et où le
site s'affichait aux couleurs par défaut **sans que rien n'alerte**.
Sont désormais versionnés, avec leurs **UUID explicites** (sans quoi les 167 traductions seraient
orphelines) : `domains`, `domain_configs`, `branches`, `specialities`, `countries`,
`verification_providers`, `translations`, `public_email_domains`.
`ON CONFLICT DO NOTHING` partout — il **reconstruit**, il n'écrase jamais un réglage ajusté.
**Ce qui n'y est pas, et ne peut pas y être** : les deux secrets du Vault (`cron_secret`,
`purge_cron_base_url`), les réglages d'authentification du projet Supabase, les variables
d'environnement et les sous-domaines Vercel. Ils vivent dans
[docs/mise-en-production.md](mise-en-production.md).

**⑦ bis — CE QUI SE POSE À LA MAIN EST DÉSORMAIS GARDÉ, et le garder a trouvé un défaut.**
Un réglage non versionnable n'a qu'une trace : la procédure qui le nomme. Ce lien ne tenait sur rien.
[scripts/diag-parametrage-manuel.mjs](../scripts/diag-parametrage-manuel.mjs) le tient — sans base,
sans réseau : il reconstruit depuis les migrations **quelle tâche dépend de quel secret**
(SQL exécutable uniquement : l'en-tête de la migration *nomme* les deux secrets en commentaire, et un
contrôle qui lirait le texte brut resterait vert après leur disparition — §E.7), puis vérifie que la
procédure les nomme, que le **nombre de tâches annoncé** est le nombre réel (§E.16), et que le miroir
`CRON_SECRET` existe aux deux bouts. Éprouvé par **cinq mutations**, cinq détectées.

**Le défaut qu'il a trouvé en naissant** : la procédure ne listait qu'**un** chemin de redirection
Supabase, `/auth/callback`. Le code en demande **deux** — `/<langue>/nouveau-mot-de-passe` est celui
de toute réinitialisation de mot de passe **et de toute invitation d'administrateur**
([lib/admin/admin-invitation.ts](../lib/admin/admin-invitation.ts),
`app/[locale]/mot-de-passe-oublie/page.tsx`). Supabase **refuse** toute adresse absente de sa liste :
sur une production neuve, personne n'aurait pu reprendre son compte, **et le premier administrateur
n'aurait pas pu ouvrir sa session**. Le refus tombe sur l'utilisateur, dans un lien reçu par e-mail,
et ne laisse aucune trace chez nous. Corrigé dans la procédure, et gardé.
Le balayage couvre `app/`, `lib/` **et** `components/`, et il distingue par la **forme** : une adresse
**absolue** part chez Supabase, un chemin **relatif** (`logout({ redirectTo: '/' })`) est un
`router.push` interne. Les confondre l'aurait fait crier à tort — donc désactiver.

**⑦ ter — LE PROBLÈME DU JOUR ZÉRO : personne ne pouvait administrer une production neuve.**
Les deux chemins qu'on croirait ouverts sont fermés, et **aucun des deux ne le dit** :
`POST /api/admin/create-admin` est gardée par `requireAdmin` **et** exige un jeton de
re-authentification — il faut déjà en être un ; et une inscription ordinaire ne peut pas produire un
administrateur, parce que `handle_new_user` ne connaît que expert / cdi / entreprise / cabinet et,
pour tout autre rôle, fait `RAISE WARNING` puis `RETURN NEW` — compte `auth.users` créé, **aucune**
ligne `public.users`, aucune erreur remontée : un compte fantôme qui **occupe l'adresse e-mail**.
L'en-tête de la route l'écrivait déjà — *« ce bootstrap-là est un chantier distinct »* — et le
chantier n'existait nulle part.
[scripts/creer-premier-administrateur.mjs](../scripts/creer-premier-administrateur.mjs) le ferme : il
refait **exactement** ce que fait la route (rôle de pont `entreprise`, vérification du miroir,
bascule en `user_type='admin'` / `status='active'`, constat que le **siège plateforme** a été pourvu
par son trigger), sous la garde d'écriture (§E.4), **et il refuse de servir une seconde fois** —
sinon il serait une porte dérobée permanente, sans re-authentification ni trace nominale.
Il **n'envoie pas** l'invitation : l'écran « mot de passe oublié » est déjà ce chemin, et en écrire
un second en ferait un jumeau (§E.20).
⚠️ Il écrit en base **hors du périmètre** de `diag-scripts-destructeurs` (qui ne balaie que
`scripts/diag-*.mjs`) : il est **gardé**, pas **découvert** — quatrième cas de l'angle mort de §E.4.

**⑧ Le format du numéro d'identification quitte le code pour le référentiel pays.**
Migration `format_numero_identification`. `countries` gagne `registre_numero_libelle`,
`registre_numero_exemple`, `registre_numero_longueur_min`, `registre_numero_longueur_max`,
`registre_numero_alphanumerique`. La même migration retire `default 'FR'` de
`organizations.country` — la colonne reste `NOT NULL`, c'est le **défaut** qui disparaît.

Le numéro était validé par `/^\d{9}$/` — le format **français** — codé en dur **aux deux bouts**,
client et serveur, libellé « SIREN » et refus « 9 chiffres attendus ». Un *company number*
britannique (8 alphanumériques) ou un ICE marocain était refusé **à la saisie**, avant toute
vérification. Un `switch (pays)` en TypeScript aurait fait d'un pays de plus un **déploiement** ;
le référentiel porte déjà 64 pays, leurs noms en quatre langues, leur indicatif et leur drapeau.

> **Pas de colonne `regex`, et c'est délibéré.** C'était la forme évidente. Écartée pour deux
> raisons : une expression régulière **lue en base et exécutée côté serveur** ouvre un risque de
> déni de service par retour arrière catastrophique sur une valeur que le code ne contrôle plus ;
> et elle inviterait à encoder une **validité** (clé de contrôle, damier) qu'on ne sait pas
> vérifier, alors qu'on ne cherche qu'une **forme**. On décrit donc la forme : une longueur, et le
> droit ou non aux lettres.

> **`NULL` veut dire « accepté », jamais « refusé ».** Seule la France est renseignée — la seule
> règle que le dépôt **prouve**. Les 63 autres restent à `NULL` et leur saisie passe. Les remplir
> est désormais une **écriture de données**, pas un déploiement : c'est tout l'objet de la
> migration. Ce n'est pas un travail laissé en plan, c'est le refus d'inscrire dans une table de
> réglages des formats nationaux que rien ici ne permet de vérifier.

La lecture est partagée : [lib/pays/numero-identification.ts](../lib/pays/numero-identification.ts)
(serveur **et** client) et [lib/pays/referentiel-client.ts](../lib/pays/referentiel-client.ts) (le
chargement de `/api/countries`, sorti de `CountrySelect` **avant** de se dupliquer une quatrième
fois). `scripts/diag-pays-organisation.mjs` tient les deux unicités.

---

## C. Les chaînes fonctionnelles, de bout en bout

> **§C et §P1 décrivent les mêmes parcours, pour deux usages différents — ce n'est pas un doublon.**
> **§C** est un **repérage** : où vivent les règles, quel fichier ouvrir. On le lit avec le code sous
> les yeux.
> **§P1** est le **produit** : ce qui se passe, dans l'ordre, ce qui bloque et pourquoi, et ce que
> l'utilisateur voit quand ça refuse. On le lit **sans** le code.
> En cas de divergence entre les deux, **§P1 fait foi** : c'est lui qui est écrit pour être relu.

### C.1 Dépôt de CV et visibilité (expert)
`POST /api/profile/upload-cv` (freelance) · `POST /api/profile/cdi-upload-cv` (CDI) — routes
**distinctes et gardées par `user_type`** (403 `wrong_user_type`), `maxDuration = 60`.
Interrupteur `ENABLE_AI_CV_PARSING` → 503 `ai_disabled`. Quota lu en base (`ai_quotas`,
[lib/ai-quotas.ts](../lib/ai-quotas.ts)) : absent ⇒ **refus**, jamais de repli. Parsing par
`claude-haiku-4-5-20251001`, cache SHA-256, consentement RGPD requis. Le bucket `cv` est **privé**
(service-role uniquement, jamais d'URL) ; `avatars` est privé depuis la migration `avatars_private`
(URLs signées courtes, générées serveur).
**Visibilité** : prédicat unique [lib/profile-visibility.ts](../lib/profile-visibility.ts) — lu par la
route (qui refuse), le formulaire (qui prévient) et la bannière (qui dit **quels champs manquent**).
Le résumé est borné **200–800 caractères** : en dessous il n'y a pas matière à juger, au-dessus il
sort du document envoyé au moteur. Le même prédicat existe en contrainte base
(`profiles_visible_requiert_criteres_check`) : toute évolution touche **les trois**.
Le matching est relancé via `after()` (§E.5).

### C.2 Publication d'une annonce (organisation)
`POST /api/publications` → `POST /api/publications/[id]/publish`. Prédicat unique
[lib/publications/publishable.ts](../lib/publications/publishable.ts) + contrainte
`publications_publiee_requiert_zones_check`.
**Sémantique de l'ensemble vide, asymétrique et voulue** : zones de travail **obligatoires**
(`&&` sur un ensemble vide est toujours faux → annonce publiée et silencieusement invisible) ;
spécialités et séniorités **facultatives**, vide = « aucune contrainte sur cet axe », pas « personne ».
Gate qualité IA ([lib/verification/ai-publication-quality.ts](../lib/verification/ai-publication-quality.ts)).
Gates commerce : 402 `quota_publications_reached` / `quota_active_publications_reached`.
**Expiration à 30 jours calculée À LA LECTURE** — aucun job, aucun statut basculé, `expires_at` n'est
jamais écrit ([lib/publications/expiry.ts](../lib/publications/expiry.ts), source unique).

### C.3 Mise en relation et notification
[lib/matching/](../lib/matching/) — quatre temps, chacun sait se taire ou parler :
1. **Réglages** (`settings.ts`) lus dans `matching_settings` par écosystème : `feed_threshold`,
   `notify_threshold`, `notify_enabled`, `rerank_model`, `rerank_batch_size`.
   **Aucun repli codé en dur** : absents ⇒ le moteur refuse **et le dit**.
2. **Vivier** (`pool.ts`) — filtres SQL sur des critères **déclarés par l'expert lui-même** (branche,
   spécialités, séniorités, zones, disponibilité, ouverture croisée) et sur ses **décisions**
   (décliné, déjà postulé). Aucun jugement de pertinence n'écarte personne, et **aucun plafond de
   vivier**. Chaque filtre rend son décompte.
3. **Notation** (`rerank.ts`, Cohere, `ENABLE_RERANKING`) — par lots, budget relu entre chaque lot
   ([lib/ai-budget.ts](../lib/ai-budget.ts), `ai_spend_caps` / `ai_spend_events`).
4. **Réconciliation** (`reconcile.ts`) puis **notifications** (`shared.ts`) — upsert idempotent
   préservant `dismissed` et les candidatures engagées ; on ne notifie que sur les **inserts frais**
   au-dessus du seuil.

Deux sens : `runMatchingForPublication` (annonce → experts) et `runMatchingForExpert`
(expert → annonces). La trace d'un run est écrite dans `publications.matching_stats` par **un seul**
constructeur (deux chemins qui écrivaient chacun leur objet pouvaient oublier une clé, et une clé
absente se lit `null`, qu'une somme SQL affiche zéro : la supervision aurait dit « tout va bien »).
Un run interrompu reste **INACHEVÉ**, donc visible et rejouable ; la reprise s'appuie sur
`matching_notes_partielles` (ce qui est noté ne se renote pas — migration `reprise_notation`).
**Relance** (migration `relance_expert`) : un déclenchement refusé n'est plus perdu, il est
**reporté** ; RPC `programmer_relance_expert` / `solder_relance_expert` / `prochaine_relance_expert`.
Plafond anti-abus **20/heure/expert**, en constante nommée dans le code, **volontairement sans champ
dans `/admin/matching`** ; les dépassements sont comptés dans `relance_overruns`.
**Canaux** : seul `email` est ouvert (§D.2). Digest pour les opportunités (anti-rafale), per-item pour
les messages.

### C.4 Candidature
`POST /api/candidatures` (`maxDuration = 60`). Claude juge **au dépôt**, sur un seul couple
profil × annonce, via `after()` (`ENABLE_AI_CANDIDATURE_ASSESSMENT`, `claude-sonnet-5`) → écrit
`ai_match_score`, `ai_assessment`, `ai_model`. Le `pitch_org` est adressé à l'organisation et
**affiché avant le déverrouillage payant** : d'où l'interdiction, dans le prompt, de nommer un
employeur ou un client — ce texte doit rester compatible avec le masquage.
Les pannes de rédaction sont journalisées (`ai_redaction_failures`, migration `pannes_de_redaction`)
et distinguées par cause (plafond / interrupteur / erreur) : `candidature_ai_health()` les confondait
en un seul « sans jugement IA ».
**État de vie dérivé à la lecture** ([lib/candidatures/lifecycle.ts](../lib/candidatures/lifecycle.ts)) :
deux buckets, `active` / `archived`, avec une **raison** nommée (`selected`, `exchange_open`,
`awaiting_review`, `exchange_expired`, `publication_expired`, `publication_closed`, `rejected`, …).
`status` est la **mécanique**, l'état de vie est le **fait**. Dérivation **serveur uniquement** : le
client rend la raison, il ne la calcule pas. Statuts vestigiaux jamais écrits par le produit, couverts
en lecture : `shortlisted`, `withdrawn`, `archived`.

### C.5 Dévoilement et messagerie
`POST /api/candidatures/[id]/unlock` (quota manuel, 402) et auto-dévoilement top-1 à la création
(sans quota) — mécanique partagée dans [lib/unlock.ts](../lib/unlock.ts), idempotente.
Le dévoilement ouvre une `conversation` avec `expires_at = unlock + 15 j`
([lib/conversations/expiry.ts](../lib/conversations/expiry.ts), **source unique**).
**Politique de divulgation, une seule fonction** :
`disclosurePolicyForCandidatureLifecycle()` ([lib/expert-disclosure.ts](../lib/expert-disclosure.ts)).
**Cinq écrans**, mais **QUATRE chemins de code** — la distinction compte, parce qu'on audite des
chemins, pas des écrans :
`/api/me/candidatures-org` (candidatures agrégées) · `/api/publications/[id]/candidatures`
(candidatures d'une annonce **ET** sous-traitance : c'est la **même** route, cf.
[components/collaboration/SousTraitanceDetailView.tsx](../components/collaboration/SousTraitanceDetailView.tsx)) ·
`/api/me/conversations` (inbox) · `/api/conversations/[id]/messages` (fil).
Chercher un cinquième appel, c'est chercher ce qui n'existe pas.
`/api/conversations/[id]/messages` : envoi refusé **409** une fois la fenêtre close ; l'aperçu et le
compteur de non-lus sont calculés en SQL **par conversation** (migration `apercus_conversations` —
l'ancienne version lisait les 500 derniers messages toutes conversations confondues et produisait un
résultat **faux**, pas tronqué).

### C.6 Commerce et abonnement
Catalogue édité dans `/admin/packages`, synchronisé vers Stripe **avant** l'écriture locale (échec de
synchro ⇒ écriture refusée, message explicite). Clés d'**idempotence dérivées et stables**
([lib/billing/idempotence.ts](../lib/billing/idempotence.ts)) : deux synchros concurrentes ne créent plus
deux produits.
Webhook `/api/stripe/webhook` — **la seule route qui ACCORDE DES DROITS sans identité d'appelant** :
Stripe n'a ni session, ni jeton, ni domaine, et l'authentification est la **signature** du corps.

> ⚠️ Ce document écrivait « la seule route de l'application sans `requireAuth` ». **C'est faux, et
> beaucoup trop large** : **18 routes sur 128** n'appellent ni `requireAuth`, ni `requireAdmin`, ni
> `requireOrgRole` (mesuré le 16/09/2026, commentaires retirés). Quatre sont des crons gardés par
> `CRON_SECRET` ; les autres sont publiques par construction (inscription, OTP, pays, taxonomie,
> résolution d'invitation, désinscription, contact) ou valident le jeton elles-mêmes
> (`init-session`, `logout`). Aucune n'accorde de droits — **c'est ce qui distingue le webhook**, et
> c'est ce qu'il fallait écrire. Corps lu **brut** (`request.text()`, jamais `.json()`).
Idempotence par contrainte de base : `stripe_event_claim()` est un `INSERT … ON CONFLICT` dont la clé
primaire est l'identifiant Stripe. Un événement `livemode` sur un environnement hors production est
**ignoré** (journalisé, 200) — on ne fait pas échouer l'endpoint, Stripe le désactiverait.
`applyPackageState()` écrit `package_id` / `package_valid_until` sur **`organizations`**.
**L'expiration est décidée À LA LECTURE** ([lib/entitlements.ts](../lib/entitlements.ts)) : aucun batch,
aucun cron. Dépassée ⇒ retour à l'offre par défaut.
**Fail-open assumé** sur toute la couche Droits : un moteur commercial en panne ne bloque jamais
l'usage produit (limite `null` = illimité). Ne pas « corriger » en fail-closed.
Une organisation abonnée voit le montant **prélevé** (lu dans `transactions`), jamais le prix du
catalogue : les `Price` Stripe sont immuables.
L'attribution manuelle (`/api/admin/assign-org-package`) **refuse** de passer par-dessus un abonnement
Stripe vivant ([lib/billing/attribution-manuelle.ts](../lib/billing/attribution-manuelle.ts)).

---

## F. La classe de défaut « lire puis écrire »

**Le motif.** L'applicatif lit une ligne, décide, puis écrit. Entre les deux, une autre exécution passe.
Le client Supabase JS **ne sait pas ouvrir de transaction multi-requêtes** : la fenêtre ne peut pas être
fermée côté code. Rien ne lève, rien ne casse — une des deux écritures est simplement **perdue**, ou
l'objet est créé **deux fois**.

**Où la garantie vit désormais : en base, en une seule instruction.**

| Défaut | Garantie, et où elle vit |
|---|---|
| Deux modifications de profil simultanées : une relance perdue | `programmer_relance_expert()` / `solder_relance_expert()` — un seul `UPDATE … RETURNING`, `SECURITY DEFINER`, `service_role` seul. `solder` **ne solde que ce qui était dû** (`due_at <= debut_run`) : un déclenchement arrivé pendant le run n'est pas effacé. |
| Transfert de l'offre par défaut en deux `UPDATE` : fenêtre où une cible n'a **aucune** offre par défaut, et une inscription tombant dedans ne reçoit rien | RPC `set_default_package()` — tout dans une seule transaction serveur. Étendue à la cible `collaboration` par `collaboration_default_coverage`. |
| Deux livraisons du même événement Stripe : double crédit | `stripe_event_claim()` — `INSERT … ON CONFLICT DO UPDATE … WHERE status = 'failed'`, clé primaire = identifiant Stripe. Le verrou de ligne PostgreSQL sérialise. « Aucune lecture-puis-écriture ici : elle aurait précisément le trou qu'on ferme. » |
| Deux synchros catalogue quasi simultanées : **deux** produits Stripe (le rattrapage par `products.search` ne voit pas le produit créé quelques secondes plus tôt — index différé ~1 min) | Clé d'idempotence **dérivée et stable** ([lib/billing/idempotence.ts](../lib/billing/idempotence.ts)). Un UUID aléatoire ou un horodatage redonnerait deux créations : aucune protection. |
| Consommation d'un quota | `usage_increment()` — un seul `INSERT … ON CONFLICT DO UPDATE` sous garde de limite. |
| Limitation de débit | `rate_limit_check()` — vérifie **et** enregistre atomiquement. Contrat : un refus **n'enregistre pas** le hit. |
| Course à la création d'une organisation personnelle | Index unique partiel `organizations_personal_owner_unique_idx` ; `23505` ⇒ on relit et on retourne l'existante. |
| Deux offres pour un même `price` Stripe : le webhook tirerait au sort des droits payés | Index unique `idx_packages_stripe_price_monthly`. |
| **Une place incluse donnée DEUX fois** : deux jugements terminés au même instant lisent 0, concluent tous deux `0 < 1`, et dévoilent tous deux | migration `place_incluse_unique` |
| **Une annonce active de plus que l'offre** : deux publications simultanées lisent le même compte et passent toutes deux | migration `place_annonce_active` |
| **Une organisation à ZÉRO administrateur** : deux admins qui se rétrogradent au même instant lisent tous deux « il en reste 2 » | migration `siege_administrateur` — trigger `organizations_cliquet_siege_admin` + RPC `maj_membre_organisation` |
| **La PLATEFORME à zéro administrateur** : deux admins qui programment leur suppression au même instant | migration `siege_admin_plateforme` — table `plateforme`, `cliquet_siege_admin()` |
| **Une organisation née sans aucun membre** : `register-org` insère l'org, PUIS le membre — un échec entre les deux laisse une coquille | migration `organisation_jamais_sans_membre` |
| **Deux runs du même cron qui se chevauchent** : `expert_relance_trigger` tourne toutes les 5 min pour un run de 300 s max — le chevauchement est **structurel**, et deux runs simultanés reçoivent **le même profil** et repaient le même travail d'IA | migration `bail_de_run_cron` — `cron_run_leases`, RPC `prendre_bail_run` / `rendre_bail_run`, [lib/cron/bail-de-run.ts](../lib/cron/bail-de-run.ts) |

> ⚠️ **CES SIX LIGNES MANQUAIENT.** Elles sont toutes de la classe que cette section recense, et
> toutes postérieures à sa rédaction. Une section qui liste les garanties de concurrence et en
> oublie six ne se lit pas comme incomplète : elle se lit comme exhaustive. **Le bail de run et le
> siège plateforme n'apparaissaient nulle part dans ce fichier** — deux mécanismes entiers,
> invisibles.

**Ce qui reste ouvert sur cette classe.**
- La clé d'idempotence Stripe ne vit que **24 h**. Elle ferme la **course** (quelques secondes), pas la
  récupération d'un produit orphelin découvert des jours plus tard — c'est pour ce seul cas que
  `products.search` reste sur le chemin.
- Un événement Stripe **bloqué en `received`** (crash ou timeout avant marquage) refuse tous les
  réessais. **Délibéré** : mieux vaut un événement non appliqué et visible qu'un double crédit. Il se
  repère par `idx_stripe_events_status` et se rejoue en repassant la ligne à `failed`. Rien n'automatise
  ce repérage aujourd'hui.
- [lib/collaboration/ensure-personal-org.ts](../lib/collaboration/ensure-personal-org.ts) reste
  **transactionnel par compensation** (échec en aval ⇒ suppression de l'org, CASCADE), pas par
  transaction serveur.
- ~~La branche `feat/s1-ux-profil` porte une migration `verrou_run_et_unicite_notifications` qui
  n'est pas sur le tronc~~ — **elle y est** :
  `supabase/migrations/20260912200000_verrou_run_et_unicite_notifications.sql`. Cette ligne était
  périmée ; elle envoyait chercher un travail déjà fait.

---

## H. Ce qui reste ouvert

Uniquement ce qui est établi depuis le code ou depuis un TODO réel.

**Commerce / Stripe**
- `ENABLE_BILLING` n'est pas posé : le mur est fermé, rien n'encaisse (§D.1). La date d'ouverture n'est
  pas fixée. La marche à suivre pour le premier paiement est écrite dans
  [docs/stripe-premier-paiement.md](stripe-premier-paiement.md).
- Aucun repérage automatique d'un `stripe_events` bloqué en `received` (§F).

**Vérification par SMS (OTP d'inscription)**
- **La Tunisie (+216) est bloquée par Vonage sur l'API Verify, et ce point N'EST PAS DANS LE CODE.**
  Vérifié : ce n'est ni Fraud Defender Countries (activé sur les deux canaux), ni une Traffic Rule —
  c'est une **liste de pays restreints propre à Verify**, qui exige un **ticket au support Vonage**.
  Les journaux Verify affichaient `BLOCKED`, deux fois, sur Orange Tunisie.
  **Ne cherchez pas la cause dans le dépôt : elle n'y est pas.** Ce qui a été fait, c'est rendre
  l'échec **visible** (§E.13). Le déblocage appartient à Youssef.
- **Le webhook de statut Vonage est un CHOIX DIFFÉRÉ, pas un oubli.** Sans lui, le serveur ne peut
  pas savoir si un SMS a été **remis** : il ne connaît que l'acceptation de la demande. Cesser
  d'affirmer qu'il est parti et donner une sortie apporte l'essentiel du bénéfice pour une fraction
  du travail — un webhook est une **adresse publique à exposer, à sécuriser et à déclarer chez
  Vonage**. Il viendra si des échecs invisibles sont constatés en production.

**Moteur**
- Le canal SMS est fermé au dispatcher (§D.2). Rouvrir exige d'abord de basculer le défaut de préférence
  en **opt-in** et de rendre les interrupteurs aux écrans — ni l'un ni l'autre n'est fait.
  ⚠️ **Sans rapport avec l'OTP d'inscription** : autre API (Verify v2), autre chemin, aucun point
  commun. `scripts/diag-canal-sms.mjs` tient cette séparation dans les deux sens.
- `lib/database.types.ts` est périmé et **inutilisé** (§E.1). Le régénérer et typer les clients
  supprimerait toute la classe E.1 ; personne ne l'a fait.

**Divulgation**
- `reveal_contact` est un **point d'extension** conçu mais **non branché**
  ([lib/expert-disclosure.ts](../lib/expert-disclosure.ts)) : le packaging commerce qui l'ouvrirait n'existe
  pas.

**Erreurs converties en verdicts (§E.22)**
- **Les neuf cas identifiés sont fermés**, et le recensement de la classe est **sous cliquet**
  ([scripts/diag-echec-silencieux.mjs](../scripts/diag-echec-silencieux.mjs)) : **37 occurrences
  au départ** (mesurées sur `c063ad1`), **33 gelées** aujourd'hui, **toutes relues une par une** —
  aucune ne traverse une garde. Une NEUVE rougit.
  ⚠️ **Trois des neuf ont été trouvés APRÈS un premier gel trop confiant.** Un cliquet fige un
  inventaire, il ne le juge pas : y mettre une ligne sans l'ouvrir, c'est déclarer légitime ce
  qu'on n'a pas lu. La leçon vaut pour tous les cliquets du dépôt.
- Ce qui reste ouvert, et c'est un **choix de couverture, pas un défaut** :
  [scripts/diag-erreurs-avalees.mjs](../scripts/diag-erreurs-avalees.mjs) recense **143 emplacements
  sur 68 fichiers** de la même famille élargie (erreur **non lue**, erreur **ignorée**, erreur
  convertie). Il **rend toujours 0** — son en-tête le dit : « ni un contrôle qui échoue, ni un
  cliquet » — et il ne balaie que `app/` + `lib/`, **pas `components/`**. Les 143 n'ont pas été
  relus un par un ; les six qui traversaient une garde, si.
- `joinBlockReason` était le **seul fail-open** de la classe ; il refuse désormais à l'écriture et se
  tait à l'affichage. Aucun autre n'a été trouvé — **mesuré, pas supposé**.

**Dette nommée dans le code**
- `metadataRoleFromOrgType` mappe encore `esn → cabinet` ; sans conséquence sur le routing aujourd'hui,
  à revoir si un autre appelant dépend de la distinction ([lib/auth-routing.ts](../lib/auth-routing.ts)).
- Factorisation V1 (freelance) / V3 (CDI) en attente, TODO posés sur : [lib/cv-parser-cdi.ts](../lib/cv-parser-cdi.ts),
  [app/api/profile/cdi-upload-cv/route.ts](../app/api/profile/cdi-upload-cv/route.ts),
  `app/[locale]/dashboard/cdi/profil/page.tsx`, `app/[locale]/dashboard/cdi/profil/valider/page.tsx`.
- [app/api/auth/finalize-org-registration/route.ts](../app/api/auth/finalize-org-registration/route.ts) :
  TODO V2 — migrer vers une file de travaux.
- [lib/nav-config.ts](../lib/nav-config.ts) : une entrée de menu non cliquable, fonctionnalité non livrée.
- `scripts/diag.mjs` — lanceur **cassé et inachevé**, retiré de `package.json` pour cesser de piéger
  (`912d437`). Il reste dans le dépôt, réattribué.
- `scripts/diag-lot2b-expert.mjs`, `diag-lot2c-org.mjs`, `diag-lot3-messagerie.mjs` s'annoncent
  eux-mêmes **« DONNÉES OBSOLÈTES depuis le cleanup »**.
- `scripts/diag-readonly-expert-achwek.mjs` cible une **adresse e-mail réelle** ; à retirer ou à
  anonymiser au regard du registre RGPD.
- Trois scripts écrivent en base hors du périmètre de la garde (§E.4).

**Mise en production**
- Le paramétrage de référence est versionné (§B.2 ⑦). **Ce qui ne peut pas l'être** — deux secrets du
  Vault, réglages d'authentification, variables d'environnement, sous-domaines, **et le premier
  administrateur** — est décrit pas à pas dans [docs/mise-en-production.md](mise-en-production.md),
  pour quelqu'un de non technique. **Huit** étapes, et l'ordre a été corrigé le 18/09/2026 : la
  vérification des tâches planifiées demande d'ouvrir le back-office, donc elle suppose les variables
  d'environnement, les sous-domaines **et un administrateur** — elle était placée en quatrième
  position, où elle est **inatteignable**. Le document annonçait pourtant « l'ordre compte : chacune
  suppose la précédente ». Elle est désormais la dernière.
  **Gardé** par [scripts/diag-parametrage-manuel.mjs](../scripts/diag-parametrage-manuel.mjs)
  (§B.2 ⑦ bis) pour tout ce qui est mécaniquement vérifiable ; l'ordre, lui, ne l'est pas.
- **Quatre** des huit tâches planifiées passent par `trigger_purge_cron` et **lèvent** sans les deux
  secrets du Vault : `purge_deletions_trigger`, `purge_inactive_trigger`, `matching_retry_trigger`,
  `expert_relance_trigger`. Les deux premières portent une **obligation légale** (RGPD art. 17 et
  CNIL). Elles ne se plaignent qu'au journal de la base : rien à l'écran.
- **`ensure_rls` est ÉPROUVÉ.** Sa branche `create` avait été sautée par un `if not exists` sur tous
  les environnements connus, donc **jamais exécutée nulle part** ; `CREATE EVENT TRIGGER` exige un
  privilège que le rôle `postgres` de Supabase ne possède pas toujours, et un refus aurait fait
  échouer la migration **au 4ᵉ fichier**, les suivantes ne s'appliquant pas.
  **Le 16 septembre 2026, les 52 migrations se sont déroulées sur une base VIERGE en local, sans une
  seule erreur. La branche `create` s'est exécutée pour la première fois, sans refus de privilège.**

**Conformité**
- L'inscription au **registre des traitements** reste à faire pour `cron_run_log.response_body`, qui
  conserve des UUID de comptes (décision arbitrée au titre de l'art. 5.2, migration
  `cron_run_log_retention`).

**Arbitrages TRANCHÉS — ne pas les rouvrir**
- **La plage du tronc est `0xxxxx`** (§G.2). La consigne « 1xxxxx » était fausse.
- **La note sur 10 affichée à l'expert sur ses candidatures est VOULUE** (§D.6). Ce n'était pas un
  écart, c'est une décision produit.

**Arbitrages en attente (signalés par ce document)**
- La règle de fusion UNION sur `messages/*.json` n'est imposée par rien (§G.7).
- ~~Les seuils de `verification_providers` sans écran~~ — **CLOS** : `/admin/seuils` est livré (§P2.4).
  Reste sans écran : **`ai_spend_caps`**, les plafonds de dépense IA — `/admin/matching` affiche la
  dépense du mois **sans** le plafond en regard.
- ~~Cinq des sept points de dépense IA n'enregistrent rien~~ — **CLOS.** Les **sept** consultent le
  plafond avant d'appeler et enregistrent après, au tarif du modèle réellement appelé (§E.13).
  Gardé par un contrôle **de classe** : un huitième point ajouté demain rougit s'il est muet.
- ~~`ai_spend_caps` et `ai_spend_seuils_acteur` n'ont aucun écran~~ — **CLOS.** Les deux se règlent
  sur `/admin/matching`, chacun dans le bloc qui porte déjà sa valeur, bornés au serveur et tracés
  sous **deux** actions distinctes. L'écran écrit lequel **bloque** et lequel **alerte** (§P3.7).
- ~~La durée de validité d'une invitation vit en dur, dans DEUX fichiers~~ — **CLOS.** Elle rejoint
  `duree_reglages` (`invitation_jours`), et la seconde copie a disparu : `invitationExpiryIso()` est
  la source unique. Non rétroactive — la date est **écrite** à l'envoi et réécrite au renvoi — donc
  **aucune garde de comptage**, et l'écran le dit.
- ~~Trois des huit tâches planifiées ne sont pas dans `cron_job_catalog`~~ — **CLOS.** Les huit sont
  nommées et traduites en quatre langues.
- ~~La dépense IA n'est pas répartie par acteur~~ — **CLOS.** Chaque événement nomme son acteur
  **déclencheur** (« qui fait monter la facture »), et **un seul** : contrainte en base
  (`ai_spend_un_seul_acteur`) *et* dans le type (`ActeurIA` est une union, pas deux champs
  optionnels), pour que les deux sommes ne comptent jamais deux fois la même dépense.
  `/admin/matching` affiche le découpage, l'alerte étant **recalculée à chaque affichage** —
  rien n'est stocké, aucune tâche planifiée. **Un dépassement alerte, il ne bloque pas.**
  La dépense antérieure au découpage apparaît en clair sur une ligne **« non imputable »** :
  elle n'est **jamais proratisée** sur les autres, et elle décroît d'elle-même (lecture mensuelle).
  Ces deux réglages ont désormais leur écran (voir ci-dessus).

---

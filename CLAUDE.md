# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ## ⛔ RÈGLE DE MAINTENANCE — À LIRE AVANT TOUTE CHOSE
>
> **CHAQUE WORKTREE MET À JOUR LA SECTION QUI LE CONCERNE DANS SON PROPRE COMMIT.**
> **Livrer une fonctionnalité sans mettre à jour ce fichier, c'est livrer à moitié.**
>
> Ce fichier est la **mémoire du projet**. Il n'y en a pas d'autre. Sans cette règle, l'architecte
> redevient la source unique — et les mêmes oublis reviennent : trois résumés qui se contredisent,
> une panne décrite comme réparée alors qu'elle tourne encore, trois correctifs refaits parce que
> personne ne savait qu'ils étaient livrés.
>
> Concrètement, dans le **même commit** que le changement :
> une migration → §B · une route ou une chaîne → §C · une décision produit → §D · un piège coûteux →
> §E · une course fermée en base → §F · une convention de travail → §G · une dette assumée → §H.
>
> **Une affirmation non vérifiable dans le dépôt ne s'écrit pas ici**, ou se marque **NON VÉRIFIÉ**.
> Une mémoire fausse est pire qu'une mémoire absente : elle se cite.
>
> Les sections anglaises ci-dessous contiennent des énoncés **PÉRIMÉS**, signalés sur place et
> récapitulés en **§M0**.
>
> **Par où entrer, selon ce que vous cherchez :**
> · *Je reprends le projet, ou j'y reviens après des mois* → **§P1 à §P4 (LE PRODUIT)**.
> · *Je vais toucher au code et je veux savoir où je mets les pieds* → **§A à §H**, et **§E** avant
>   d'écrire un diagnostic.
> · *Je cherche une décision déjà arbitrée* → **§D**, puis **§P4** pour ce qui est éteint exprès.
> · *Je cherche une valeur chiffrée et qui peut la changer* → **§P3**.

@AGENTS.md

> **Next.js 16 warning (from AGENTS.md):** this is not the Next.js in your training data. APIs, conventions and file structure differ. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. Notable already-observed differences: middleware lives in `proxy.ts` (not `middleware.ts`) and exports a `proxy()` function; `params`/`headers()`/`cookies()` are async and must be awaited.

## Project

Skilloria is a **multi-tenant, multilingual talent marketplace** (French-first) built on Next.js 16 (App Router, React 19) + Supabase (Postgres/Auth/Storage) + Anthropic Claude for AI. It connects organisations with certified ecosystem experts (currently the "microsoft" tenant). Deployed on Vercel. <!-- ⚠️ PÉRIMÉ (« currently the microsoft tenant ») — voir §M0 -->

## Commands

```bash
npm run dev        # dev server (localhost:3000 — proxy.ts simulates the "microsoft" subdomain locally)
                   # ⚠️ PÉRIMÉ — voir §M0 : le slug vient de DEV_DOMAIN_SLUG, rien n'est codé en dur
npm run build      # production build
npm run lint       # eslint (flat config, eslint.config.mjs)

# Database (Supabase CLI, versioned migrations) — never edit remote schema by hand
npm run db:new <name>   # scaffold a new timestamped migration in supabase/migrations/
npm run db:diff         # diff local vs remote → migration
npm run db:push         # apply migrations to the linked remote
npm run db:pull          # pull remote schema into a migration
npm run db:lint         # lint the schema
```

There is **no test framework**. Verification is done via ad-hoc diagnostic scripts in `scripts/` (`diag-*.mjs`, run with `node`), which connect to Supabase with the service-role key and exercise real flows (matching, verification, messaging). Use them as the pattern when you need to validate a backend change end-to-end.

Environment is targeted per-remote with `supabase link <ref>` (staging ref `wnayuerhakekxccgimeg`); the linked ref lives in gitignored `supabase/.temp/`, so `config.toml` itself is env-agnostic.

## Architecture

### Multi-tenancy by subdomain
Each tenant is a "domain" (e.g. `microsoft.skilloria.io`). Resolution flow:
1. `proxy.ts` extracts the subdomain from the `host` header and injects it as the `x-subdomain` request header (also injects `x-pathname` for the dashboard role guard). ~~Locally it hardcodes `microsoft`.~~ **⚠️ PÉRIMÉ — voir §M0** : `resolveSubdomainFromHost()` lit `DEV_DOMAIN_SLUG` en dev et lève si elle manque. Le matcher du proxy **exclut `/api`** : sur les routes API, `x-subdomain` est posé par le client (`useSecureFetch`) — cf. §D.3.
2. Server components read `x-subdomain` via `getDomainConfig()` ([lib/get-domain-config.ts](lib/get-domain-config.ts)), which loads the `domains` + `domain_configs` rows and returns a `DomainConfig` (branding, colors, ecosystem labels, featured products). Falls back to `defaultDomainConfig` ([lib/domain-config.ts](lib/domain-config.ts)) on any error.
3. The root layout ([app/[locale]/layout.tsx](app/[locale]/layout.tsx)) wraps the tree in `<DomainProvider>`; client code reads it via `useDomain()` ([context/DomainContext.tsx](context/DomainContext.tsx)).
4. Every authenticated request re-checks that the user's `domain_id` matches `x-subdomain` (`domain_mismatch` → 403). Tenant isolation is enforced on the server, not just in the URL. **⚠️ PÉRIMÉ — voir §M0 et §D.3** : l'égalité stricte ne vaut que pour les **experts** ; une organisation accède à tous les écosystèmes **actifs**, un admin à tous. La règle vit dans `ecosystemAccessScope()`.

### i18n (next-intl) — two translation layers
- **Static UI strings**: `messages/{fr,en,es,de}.json`, accessed with `t('key')`. Locales are `fr` (default) `en` `es` `de`, always prefixed (`/fr/...`). Config in [i18n/routing.ts](i18n/routing.ts), [i18n/request.ts](i18n/request.ts). **No hardcoded strings in JSX** — a hard project rule.
- **Dynamic DB values** (taxonomy: branches, specialities, domain labels): stored in the `public.translations` table keyed by `(table_name, row_id, field, locale)`, resolved via `loadTranslations(locale)` + `tBDD(...)` ([lib/translations.ts](lib/translations.ts)), FR fallback automatic, cached in-memory per locale. **Do not query taxonomy tables directly from the client** — go through `/api/taxonomy?locale=...`.

### Authentication & sessions (two-token model)
Auth is Supabase, but with a **custom single-session layer on top**:
- The client sends `Authorization: Bearer <supabase_access_token>`. Server routes call `requireAuth(request)` ([lib/auth-guard.ts](lib/auth-guard.ts)), which validates the JWT, loads the user + domain + organization context, and returns `{ user, domain, organization, supabaseAdmin }`.
- A **separate opaque session token** (`ss_token` httpOnly cookie) enforces "one active session per user". Its **sha256 hash** is stored in `users.last_session_token` (cookie keeps the raw value); mismatch → 403 `session_superseded`. Lifecycle helpers in [lib/session-token.ts](lib/session-token.ts). Login calls `/api/auth/init-session`; logout calls `/api/auth/logout`. Cookie is scoped to `.skilloria.io` in prod (cross-subdomain) and suffixed `_staging` on staging to avoid clobbering prod.
- **Client-side fetches must use `useSecureFetch()`** ([lib/secure-fetch.ts](lib/secure-fetch.ts)) — it injects the bearer token, `x-subdomain`, `credentials: 'include'`, and auto-handles `session_superseded` by signing out + redirecting. Public endpoints (countries, taxonomy, OTP, register-org) are the only ones that use bare `fetch`.
- Account-deletion grace period is gated inside `requireAuth` (allowlist of reachable paths); `requireOrgApproved(ctx)` gates org-restricted routes.

### User types → dashboards (the "voie" split)
`users.user_type` drives routing via [lib/auth-routing.ts](lib/auth-routing.ts) (single source of truth):
- `expert_freelance` → `/dashboard/freelance`
- `expert_cdi` → `/dashboard/cdi`
- `client` / `cabinet` → `/dashboard/entreprise` (one unified org dashboard; `/dashboard/cabinet` is a redirect stub)
- `admin` → `/admin`

The dashboard server layout enforces this with `assertDashboardRoleGuard()` ([lib/dashboard-routing-guard.ts](lib/dashboard-routing-guard.ts)), which reads `x-pathname`, looks up the user by hashed session token, and redirects on segment/role mismatch.

### AI pipelines (Anthropic Claude)
Two self-contained subsystems under `lib/`, each with an `index.ts` orchestrator, kill-switches, and fail-safe (never block the caller on AI error):
- **Matching** ([lib/matching/](lib/matching/)) — **⚠️ PÉRIMÉ sur le rôle de Claude — voir §M0 et §C.3 : Claude est SORTI de la mise en relation, la notation est faite par un reranker (Cohere).** bidirectional — publication→experts (`runMatchingForPublication`) and expert→publications (`runMatchingForExpert`), sharing `shared.ts` + a **reconcile** engine (`reconcile.ts`) that upserts matches idempotently, preserving `dismissed`/engaged candidatures and only notifying on *fresh* inserts above a threshold. Eligibility scope: same domain, correct user_type, CV parsed, visible, AI consent given, verification approved, not in DND.
- **Verification** ([lib/verification/](lib/verification/)): company verification where **AI is the systematic decider**, not a fallback. Sirene/Companies House provide data; Claude compares field-by-field and produces a confidence score vs a per-country threshold from `verification_providers`. Never auto-*rejects* (business rule) — below threshold → `pending_admin_review`.
- **CV parsing** — **⚠️ PÉRIMÉ sur le quota et les modèles — voir §M0 et §C.1** : `/api/profile/upload-cv` parses PDFs with Claude Haiku (SHA-256 cached, rate-limited 3/24h, RGPD consent required). Model IDs in use: `claude-haiku-4-5-*` (parsing/matching), `claude-sonnet-4-6` (heavier reasoning). Guarded by `ENABLE_AI_CV_PARSING` kill-switch → 503 `ai_disabled`.

### API route conventions
Routes live in `app/api/**/route.ts`. Typical header: `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'`. They return plain `Response` objects with JSON bodies of shape `{ error, code? }` on failure. Auth guards throw `AuthError` (has `.toResponse()`). See [docs/api.md](docs/api.md) for the profile/CV endpoint contracts and [app/api/me/candidatures/route.ts](app/api/me/candidatures/route.ts) as a reference implementation. Cron endpoints under `app/api/cron/` are protected by `CRON_SECRET`.

### Supabase clients
- **Browser (anon key)**: `lib/supabase.ts` — for the client-side auth session only.
- **Server (service-role key)**: instantiated per-module (`getSupabaseAdmin()` pattern repeated in auth-guard, translations, get-domain-config) with `persistSession: false`. RLS is re-granted by an `ensure_rls` event trigger, so **security is enforced in guard code**, not by relying on a REVOKE holding.

## Environment variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY`, `ENABLE_AI_CV_PARSING`, `ENABLE_AI_CANDIDATURE_ASSESSMENT` (jugement au dépôt d une candidature), `COHERE_API_KEY` / `ENABLE_RERANKING` (moteur de mise en relation — reranking, cf. [lib/matching/rerank.ts](lib/matching/rerank.ts)), `RESEND_API_KEY` / `RESEND_FROM_EMAIL` (transactional email via Resend, templates in [lib/emails/](lib/emails/)), `SIRENE_API_TOKEN`, `VONAGE_API_KEY` / `VONAGE_API_SECRET` (phone OTP), `PHONE_OTP_HMAC_SECRET`, `REAUTH_HMAC_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`, `DEV_DOMAIN_SLUG`. Secrets/`.env*` files are blocked from reads — do not attempt to open them.

- **Manquantes dans la liste ci-dessus** (ajoutées ici, cf. §M0) : `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` (scopées **par environnement** Vercel — un secret de webhook par endpoint), `ENABLE_BILLING` (le second verrou du mur payant, cf. §D.1), `VONAGE_SMS_FROM`, `VERCEL_ENV` (lu par `isProduction()`, [lib/env.ts](lib/env.ts)).
- Les trois interrupteurs IA (`ENABLE_AI_CV_PARSING`, `ENABLE_AI_CANDIDATURE_ASSESSMENT`, `ENABLE_RERANKING`) passent tous par `capaciteActive()` ([lib/interrupteurs.ts](lib/interrupteurs.ts)) : la valeur doit être **exactement `'true'`**, tout le reste éteint la capacité (§E.9).

- **`DEV_DOMAIN_SLUG`** (développement uniquement) : sur `localhost` il n'y a pas de sous-domaine pour déduire l'écosystème servi. Cette variable fournit le slug d'un domaine **actif** de la base (ex. celui utilisé pour vos tests), lu par `resolveSubdomainFromHost()` ([lib/subdomain.ts](lib/subdomain.ts)) — source unique partagée par `proxy.ts` et les routes `/api` publiques. **Aucun écosystème n'est codé en dur** (règle multi-écosystème) : si la variable est absente en dev, la résolution échoue avec un message actionnable. En production, le slug vient du host de la requête et un hôte non résolvable échoue (aucun repli). Ligne à ajouter dans `.env.local` : `DEV_DOMAIN_SLUG=microsoft` (remplacez `microsoft` par le slug de votre domaine de test).

## Project conventions
- **UX bar is high** (Stripe/Linear/Vercel level): sticky banners, inline validation errors, focus highlights, deliberate loading/empty states on every page.
- Code comments are in **French** and often reference internal work-lot labels (e.g. "11F", "Lot 2a", "C2", "S3"). Match the existing comment density and language of the file you edit.
- Path alias `@/*` → project root (see [tsconfig.json](tsconfig.json)).

---

# MÉMOIRE DU PROJET

> Écrite depuis le code, les migrations et les diagnostics — pas depuis une conversation.
> Chaque affirmation est vérifiable dans le dépôt. Ce qui ne l'est pas est marqué **NON VÉRIFIÉ**.
> État de référence : branche `feat/sprint-archi-orga`, commit `1bcb038` (2026-09-09).

## M0. Corrections à l'existant — énoncés PÉRIMÉS des sections ci-dessus

Rien n'a été supprimé. Les énoncés ci-dessous sont contredits par le code actuel ; ils sont
marqués sur place par `⚠️ PÉRIMÉ — voir §M0`.

| Énoncé (sections anglaises ci-dessus) | Ce que dit le code |
|---|---|
| « proxy.ts … Locally it hardcodes `microsoft` » (§Commands, §Multi-tenancy) | Aucun slug n'est codé en dur. `resolveSubdomainFromHost()` ([lib/subdomain.ts](lib/subdomain.ts)) lit `DEV_DOMAIN_SLUG` sur localhost et **lève une erreur actionnable** si la variable manque ; en production le slug vient du host, et un hôte non résolvable rend `null` (aucun repli). La section §Environment variables du même fichier l'énonçait déjà correctement : le fichier se contredisait. |
| « Every authenticated request re-checks that the user's `domain_id` matches `x-subdomain` » | Vrai pour les **experts uniquement**. `requireAuth` délègue à `resolveEcosystemAccess()` ([lib/ecosystem-guard.ts](lib/ecosystem-guard.ts)), qui applique `ecosystemAccessScope()` ([lib/ecosystem-scope.ts](lib/ecosystem-scope.ts)) : expert → `own`, client/cabinet → `all_active`, admin → `platform`, type inconnu → refus. |
| « Matching … Anthropic Claude » (§AI pipelines) | **Claude est sorti de la mise en relation.** Le moteur est un reranker (Cohere, [lib/matching/rerank.ts](lib/matching/rerank.ts)) ; seuils et modèle sont lus dans `matching_settings` ([lib/matching/settings.ts](lib/matching/settings.ts)). Claude ne subsiste qu'au **dépôt d'une candidature** ([lib/candidatures/ai-assessment.ts](lib/candidatures/ai-assessment.ts)). |
| « CV parsing … rate-limited 3/24h » | Le quota n'est plus dans le code : il est lu en base (table `ai_quotas`, [lib/ai-quotas.ts](lib/ai-quotas.ts)). Ligne absente ⇒ la route **refuse** (`quota_config_missing`), elle ne devine pas. |
| « Model IDs in use: `claude-haiku-4-5-*`, `claude-sonnet-4-6` » | Incomplet. En usage : `claude-haiku-4-5-20251001` (parsing CV, vérifications), `claude-sonnet-4-6` (repli des vérifications), `claude-sonnet-5` (jugement de candidature, pitch). |
| §Environment variables | Manquent : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ENABLE_BILLING`, `VONAGE_SMS_FROM`, `VERCEL_ENV`. |
| « currently the "microsoft" tenant » | Aucun écosystème n'est codé en dur nulle part. `/admin/ecosystemes` en crée ; `microsoft` n'est qu'un slug de test usuel. |
| **§P3.3 — « Seuil d'auto-approbation d'expert : défaut 9/10 »** | **FAUX, deux fois.** ① La valeur réelle est **8**. ② Elle ne vit **pas** dans la colonne `confidence_threshold` mais dans **`config->>'auto_approve_threshold'`** (jsonb). Le chemin expert *lit* la colonne puis ne s'en sert **jamais** — j'avais documenté le `DEFAULT 9` de la baseline, qui ne gouverne rien. Établi par requête sur la base réelle, cf. §E.10. |

Tout le reste des sections anglaises a été revérifié et tient.

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
→ `user_type='cabinet'` (`metadataRoleFromOrgType`, TODO signalé dans [lib/auth-routing.ts](lib/auth-routing.ts)).
`org_type='freelance'` désigne l'**organisation personnelle** d'un expert (sous-traitance).

**Où l'argent entre** — et il n'entre pas encore : voir §D.1. Le chemin existe et est complet :
`/api/billing/offers` → `/api/billing/checkout` (Checkout **hébergé** chez Stripe, aucune donnée de
carte ne touche le serveur) → `/api/stripe/webhook` (**seule** source de droits) → `/api/billing/portal`
et `/api/billing/change-plan`. Le catalogue (`packages`, `package_features`) est édité au back-office
et synchronisé vers Stripe ([lib/billing/catalogue.ts](lib/billing/catalogue.ts)).

Ce que l'offre gouverne ([lib/entitlements.ts](lib/entitlements.ts), codes de features contractuels
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

**Moteur & exploitation** — `matching_settings`, `matching_notes_partielles`, `relance_overruns`,
`ai_quotas`, `ai_spend_caps`, `ai_spend_events`, `ai_redaction_failures`, `rate_limit_hits`,
`cron_job_catalog`, `cron_run_log`, `audit_logs`.

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
[docs/mise-en-production.md](docs/mise-en-production.md).

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
[lib/ai-quotas.ts](lib/ai-quotas.ts)) : absent ⇒ **refus**, jamais de repli. Parsing par
`claude-haiku-4-5-20251001`, cache SHA-256, consentement RGPD requis. Le bucket `cv` est **privé**
(service-role uniquement, jamais d'URL) ; `avatars` est privé depuis la migration `avatars_private`
(URLs signées courtes, générées serveur).
**Visibilité** : prédicat unique [lib/profile-visibility.ts](lib/profile-visibility.ts) — lu par la
route (qui refuse), le formulaire (qui prévient) et la bannière (qui dit **quels champs manquent**).
Le résumé est borné **200–800 caractères** : en dessous il n'y a pas matière à juger, au-dessus il
sort du document envoyé au moteur. Le même prédicat existe en contrainte base
(`profiles_visible_requiert_criteres_check`) : toute évolution touche **les trois**.
Le matching est relancé via `after()` (§E.5).

### C.2 Publication d'une annonce (organisation)
`POST /api/publications` → `POST /api/publications/[id]/publish`. Prédicat unique
[lib/publications/publishable.ts](lib/publications/publishable.ts) + contrainte
`publications_publiee_requiert_zones_check`.
**Sémantique de l'ensemble vide, asymétrique et voulue** : zones de travail **obligatoires**
(`&&` sur un ensemble vide est toujours faux → annonce publiée et silencieusement invisible) ;
spécialités et séniorités **facultatives**, vide = « aucune contrainte sur cet axe », pas « personne ».
Gate qualité IA ([lib/verification/ai-publication-quality.ts](lib/verification/ai-publication-quality.ts)).
Gates commerce : 402 `quota_publications_reached` / `quota_active_publications_reached`.
**Expiration à 30 jours calculée À LA LECTURE** — aucun job, aucun statut basculé, `expires_at` n'est
jamais écrit ([lib/publications/expiry.ts](lib/publications/expiry.ts), source unique).

### C.3 Mise en relation et notification
[lib/matching/](lib/matching/) — quatre temps, chacun sait se taire ou parler :
1. **Réglages** (`settings.ts`) lus dans `matching_settings` par écosystème : `feed_threshold`,
   `notify_threshold`, `notify_enabled`, `rerank_model`, `rerank_batch_size`.
   **Aucun repli codé en dur** : absents ⇒ le moteur refuse **et le dit**.
2. **Vivier** (`pool.ts`) — filtres SQL sur des critères **déclarés par l'expert lui-même** (branche,
   spécialités, séniorités, zones, disponibilité, ouverture croisée) et sur ses **décisions**
   (décliné, déjà postulé). Aucun jugement de pertinence n'écarte personne, et **aucun plafond de
   vivier**. Chaque filtre rend son décompte.
3. **Notation** (`rerank.ts`, Cohere, `ENABLE_RERANKING`) — par lots, budget relu entre chaque lot
   ([lib/ai-budget.ts](lib/ai-budget.ts), `ai_spend_caps` / `ai_spend_events`).
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
**État de vie dérivé à la lecture** ([lib/candidatures/lifecycle.ts](lib/candidatures/lifecycle.ts)) :
deux buckets, `active` / `archived`, avec une **raison** nommée (`selected`, `exchange_open`,
`awaiting_review`, `exchange_expired`, `publication_expired`, `publication_closed`, `rejected`, …).
`status` est la **mécanique**, l'état de vie est le **fait**. Dérivation **serveur uniquement** : le
client rend la raison, il ne la calcule pas. Statuts vestigiaux jamais écrits par le produit, couverts
en lecture : `shortlisted`, `withdrawn`, `archived`.

### C.5 Dévoilement et messagerie
`POST /api/candidatures/[id]/unlock` (quota manuel, 402) et auto-dévoilement top-1 à la création
(sans quota) — mécanique partagée dans [lib/unlock.ts](lib/unlock.ts), idempotente.
Le dévoilement ouvre une `conversation` avec `expires_at = unlock + 15 j`
([lib/conversations/expiry.ts](lib/conversations/expiry.ts), **source unique**).
**Politique de divulgation, une seule fonction** :
`disclosurePolicyForCandidatureLifecycle()` ([lib/expert-disclosure.ts](lib/expert-disclosure.ts)).
Les **cinq** surfaces qui projettent un profil expert vers une organisation la traversent —
candidatures agrégées, candidatures d'une annonce, sous-traitance, inbox, fil de messages.
`/api/conversations/[id]/messages` : envoi refusé **409** une fois la fenêtre close ; l'aperçu et le
compteur de non-lus sont calculés en SQL **par conversation** (migration `apercus_conversations` —
l'ancienne version lisait les 500 derniers messages toutes conversations confondues et produisait un
résultat **faux**, pas tronqué).

### C.6 Commerce et abonnement
Catalogue édité dans `/admin/packages`, synchronisé vers Stripe **avant** l'écriture locale (échec de
synchro ⇒ écriture refusée, message explicite). Clés d'**idempotence dérivées et stables**
([lib/billing/idempotence.ts](lib/billing/idempotence.ts)) : deux synchros concurrentes ne créent plus
deux produits.
Webhook `/api/stripe/webhook` — **la seule route de l'application sans `requireAuth`** (l'appelant est
Stripe, l'authentification est la signature). Corps lu **brut** (`request.text()`, jamais `.json()`).
Idempotence par contrainte de base : `stripe_event_claim()` est un `INSERT … ON CONFLICT` dont la clé
primaire est l'identifiant Stripe. Un événement `livemode` sur un environnement hors production est
**ignoré** (journalisé, 200) — on ne fait pas échouer l'endpoint, Stripe le désactiverait.
`applyPackageState()` écrit `package_id` / `package_valid_until` sur **`organizations`**.
**L'expiration est décidée À LA LECTURE** ([lib/entitlements.ts](lib/entitlements.ts)) : aucun batch,
aucun cron. Dépassée ⇒ retour à l'offre par défaut.
**Fail-open assumé** sur toute la couche Droits : un moteur commercial en panne ne bloque jamais
l'usage produit (limite `null` = illimité). Ne pas « corriger » en fail-closed.
Une organisation abonnée voit le montant **prélevé** (lu dans `transactions`), jamais le prix du
catalogue : les `Price` Stripe sont immuables.
L'attribution manuelle (`/api/admin/assign-org-package`) **refuse** de passer par-dessus un abonnement
Stripe vivant ([lib/billing/attribution-manuelle.ts](lib/billing/attribution-manuelle.ts)).

---

## D. Les décisions figées

Un worktree ne les rouvre pas sans arbitrage. Chacune a été vérifiée dans le code ; les écarts avec la
formulation usuelle sont signalés.

**D.1 — Le lancement est gratuit et rien n'encaisse. Deux verrous, tous deux au serveur.**
[lib/billing/config.ts](lib/billing/config.ts) :
① la **clé Stripe scopée par environnement** — absente ⇒ 503 ; et le contrôle va **dans les deux
sens** : `sk_test_` en production (les clients croient payer) et `sk_live_` hors production (les tests
débitent de vraies cartes) sont **tous deux refusés durement** ;
② l'**interrupteur `ENABLE_BILLING`**, qui doit valoir exactement `'true'`.
**Aucune variable `NEXT_PUBLIC_`** : le verrou serait lisible dans le bundle, et l'UI pourrait diverger
du serveur. L'UI apprend l'état du mur par une réponse serveur.
Corollaire gardé par `diag-murs-fermes.mjs` : **aucun bouton désactivé** sur un mur de conversion (un
bouton qu'on ne peut pas cliquer promet une porte qui n'existe pas), et le mur reste **fermé par
ignorance** (`=== true`, jamais une vérité simple).

**D.2 — Les SMS de notification sont coupés AU DISPATCHER. Les OTP sont intacts.**
[lib/notifications/canaux.ts](lib/notifications/canaux.ts) : `CANAUX_OUVERTS = ['email']`.
Un seul point, **fermé par défaut** — couper événement par événement laisserait le prochain événement
ajouté repartir tout seul par recopie de `channels: ['email','sms']`.
Les **OTP d'authentification ne passent pas par là** : autre API Vonage (Verify v2,
`api.nexmo.com/v2/verify`), appelée directement par les routes d'auth, sans toucher ni ce module, ni le
dispatcher, ni [lib/sms/vonage.ts](lib/sms/vonage.ts) (`rest.nexmo.com/sms/json`).
Code V2 **conservé délibérément** : `runChannel`, le gabarit SMS et les branches `channel === 'sms'`
sont inatteignables tant que le canal est fermé — ce n'est pas un oubli.
⚠️ Rouvrir `sms` **réactive une dépense sortante immédiatement**. Prérequis minimum : préférence par
défaut en **opt-in** (aujourd'hui l'absence de ligne vaut activé, §B.2 ④) et interrupteurs rendus aux
écrans.

**D.3 — Un expert appartient à un écosystème à vie ; une organisation les voit tous.**
[lib/ecosystem-scope.ts](lib/ecosystem-scope.ts), `ecosystemAccessScope()` :
expert → `own` · client/cabinet → `all_active` · admin → `platform` (écosystème **désactivé compris** :
c'est de là qu'on le réactive) · **tout autre type → `null` = REFUS**, aucun `default:` permissif.
Le cloisonnement des **données** se fait sur `publications.domain_id` et `candidatures.domain_id`, via
`activeEcosystemId(auth)` — un nom unique et **greppable**, parce qu'un filtre manquant ne lève rien :
il renvoie simplement trop de lignes. Le filtre est posé **dans** la recherche par identifiant, pas
après : un objet hors écosystème est **introuvable** (404, jamais 403 — « cet objet existe, mais
ailleurs » serait déjà une fuite).
`x-subdomain` **est falsifiable** : le proxy ne l'injecte pas sur `/api` (son matcher exclut `api`),
c'est le client qui le pose via `useSecureFetch`. La garde ne dépend donc pas de l'appelant, elle
recroise l'en-tête avec `users.domain_id` et la population. Gardé par
`diag-cloisonnement-ecosysteme.mjs` et `diag-ecosystem-scope.mjs`.

**D.4 — Le nom de l'expert s'affiche abrégé, au serveur ; e-mail et téléphone ne sortent JAMAIS.**
[lib/expert-name-code.ts](lib/expert-name-code.ts) (calcul pur, **sans aucun import**, pour être
exécutable tel quel par le diagnostic) + [lib/expert-name-masking.ts](lib/expert-name-masking.ts)
(libellés de repli traduits).
Règle : 1ʳᵉ lettre du prénom + 2 premières lettres du nom, majuscules, sans espace ni point.
`Youssef Cherif → YCH`. **Asymétrie voulue** : nom absent → 3 lettres du **prénom** ; prénom absent →
**2 lettres seulement** du nom (le patronyme est la partie identifiante, on n'en donne jamais plus).
Séparateurs sautés (`D'Amico → DA`), `normalize('NFC')`, `toUpperCase()` et **non**
`toLocaleUpperCase()` (en turc `i → İ` : le même nom s'afficherait différemment selon le serveur).
`reveal_contact` vaut **`false` partout, toujours**, même après dévoilement. Aucun chemin serveur ne
projette `email` / `phone` / `linkedin_url` / `cv_url` vers un utilisateur d'organisation.

**D.5 — Le dévoilement se referme quand la candidature bascule en archive, sauf si elle est retenue.**
[lib/expert-disclosure.ts](lib/expert-disclosure.ts) : **l'état de vie prime sur le statut**. Un
`status='unlocked'` figé en base ne rouvre rien une fois la candidature archivée — sinon une
organisation pourrait publier, déverrouiller, laisser expirer, et se constituer une base de profils
identifiés (détournement de finalité).
Le motif de l'archivage est **indifférent** : expiration 30 j, clôture manuelle, retrait, fenêtre
d'échange close, refus — clôturer plutôt que laisser expirer ne contourne rien.
`selected` est **actif sans limite de durée** ([lib/candidatures/lifecycle.ts](lib/candidatures/lifecycle.ts) §2) :
un candidat retenu ne se re-masque jamais, la relation commerciale existe.
Ce qui se ferme est le **chemin d'accès permanent**, pas la trace : le corps des messages n'est pas
réécrit, on n'efface aucun historique et on ne prétend pas l'avoir anonymisé. L'en-tête d'un fil
archivé, lui, re-masque.

**D.6 — Aucun score de PERTINENCE chiffré à l'expert ; la note de CANDIDATURE sur 10, OUI, et c'est VOULU.**
Ce qui est vrai et gardé (`diag-score-de-pertinence.mjs`) : `relevance_score` n'est **jamais lu** par
`/api/me/missions` ni `/api/me/missions/[id]` (il est seulement passé en **chaîne** à `.order()`), et
les vues expert n'affichent **aucun nombre** de pertinence. Seul le **palier** sort
(`strong` / `normal`). Deux valeurs et pas trois : une troisième réintroduirait une graduation, donc un
classement, donc la comparaison entre experts — que le produit interdit.
**L'AUTRE MOITIÉ DE LA RÈGLE, ET ELLE EST DÉLIBÉRÉE.** La note de **candidature** `ai_match_score`
**est** servie à l'expert par `/api/me/candidatures` et **affichée** sous la forme `N/10` —
[components/dashboard/CandidaturesTrackingView.tsx:291](components/dashboard/CandidaturesTrackingView.tsx#L291),
monté par `/dashboard/freelance/candidatures` et `/dashboard/cdi/candidatures`, plus
`CandidatureDetailPanel` (`timeline.ai_proposed`). `diag-score-de-pertinence.mjs` la classe
explicitement parmi les occurrences **légitimes**.
**Ce fut un temps signalé ici comme un écart. Ce n'en est pas un : c'est une décision produit,
arbitrée.** Les deux grandeurs ne disent pas la même chose — la pertinence explique *pourquoi ce
profil apparaît* et n'est ni calibrée ni comparable d'une annonce à l'autre ; la note de candidature
dit *ce que vaut ce dossier*, sur une échelle tenue par un texte. La première se compare entre
experts, la seconde non.
**La règle, en une phrase : aucun score de PERTINENCE chiffré à l'expert ; la note de CANDIDATURE
sur 10, oui, et c'est voulu.**

**D.7 — Le commerce se pilote depuis le back-office. Rien en dur.**
Écrans : `/admin/packages`, `/admin/matching`, `/admin/quotas-ia`, `/admin/organisations/[id]`,
`/admin/ecosystemes`, `/admin/taches-planifiees`, `/admin/taxonomie`.
`lib/entitlements.ts` ne contient **aucune** valeur de prix ni de quota — seulement les **codes** de
features (contrat avec le seed) et le mapping `org_type → target_role`.
La règle est plus large que le commerce : **un réglage règle quelque chose, ou il le dit**
(`diag-reglages-inertes.mjs`). Les trois cas déjà corrigés — les seuils du moteur (qui vivaient dans le
prompt), le quota d'analyses de CV (six écritures en dur pour un réglage), le plafond de dépense.
Le seed (`commerce_seed`) est `ON CONFLICT DO NOTHING`, **jamais `DO UPDATE`** : un redéploiement ne
doit pas écraser une valeur ajustée par un admin.
Exception **assumée et documentée** : le plafond anti-abus de relance (20/h/expert) reste une constante
de code — « un seuil anti-abus n'est pas un réglage commercial, et le rendre réglable invite à le
désactiver le jour où il gêne ».

---

## E. Les pièges vérifiés

**E.1 — Les clients Supabase ne sont pas typés. Une colonne supprimée casse au runtime, en silence.**
`lib/database.types.ts` existe (3911 lignes) mais **aucun** `createClient<Database>` n'en fait usage
dans tout le dépôt : les clients sont instanciés nus. Le fichier est en outre **périmé** (il déclare
encore `organization_domains.package_id`, supprimée ; son propre en-tête signale qu'il a été généré
avant les migrations de vérification).
Conséquence : les colonnes vivent dans des **chaînes** — `.select('id, seniority, …')`,
`.eq('speciality_id', x)`. Ni `npx tsc` ni `next build` n'en voient rien.
Le filet est un **cliquet** : [scripts/diag-colonnes-supprimees.mjs](scripts/diag-colonnes-supprimees.mjs),
qui fige la dette fichier par fichier et refuse toute **nouvelle** occurrence. La dette est aujourd'hui
**vide** — le cliquet est donc un simple refus.

**E.2 — `tsc` et `next build` ne sont pas interchangeables.**
`tsconfig.json` inclut `**/*.ts`, `**/*.tsx`, `**/*.mts`, plus `.next/types/**` et `.next/dev/types/**`.
- `npx tsc` type-vérifie **tout le dépôt**, y compris des fichiers que `next build` ne compile jamais
  (p. ex. `scripts/backfill-matching-experts.mts`).
- Les types de routes générés par Next (`.next/types/**`) **n'existent qu'après un build** : sur un
  clone frais, `tsc` n'a rien à y vérifier.
Lancer l'un ne dispense donc pas de l'autre. Et **aucun des deux** ne voit E.1.

**E.3 — Les fins de ligne CRLF cassent tout motif qui traverse un saut de ligne.**
Le dépôt n'a **pas de `.gitattributes`** ; les fichiers sortent en CRLF. Un diagnostic dont la regex
franchit un `\n` était **vert chez son auteur et rouge partout ailleurs** — quinze diagnostics étaient
concernés (commit `23fbb82`). La parade, désormais en tête de **32** scripts :

```js
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
```

Corollaire de la même famille : **un diagnostic doit tourner depuis n'importe quel worktree, sans
préparation** — ni chargeur d'alias, ni variable d'environnement, ni réseau. Une version de
`diag-cloisonnement-ecosysteme.mjs` importait le code par l'alias `@/` et mourait en
`ERR_MODULE_NOT_FOUND` : ni verte ni rouge, elle **ne vérifiait plus rien**, et personne ne pouvait dire
depuis quand. Convention retenue : import **relatif avec extension explicite**.

**E.4 — Des scripts de diagnostic ÉCRIVENT en base.**
Sur la famille `diag-*.mjs`, l'inoffensif et le destructeur ont le même visage. Un worktree s'est fait
prendre. Parade : [scripts/garde-ecriture.mjs](scripts/garde-ecriture.mjs) — sans `--db` (ou `--live`),
le script **refuse**, annonce table par table ce qu'il écrirait, et sort en **code 2**
(`0` vert · `1` rouge · **`2` n'a pas tourné**) : sortir en `1` se lirait comme un contrôle en échec et
pousserait quelqu'un à « réparer » en passant le drapeau.
Sous garde aujourd'hui : `diag-lot-expert-verification`, `diag-lot2b-expert`, `diag-lot2c-org`,
`diag-lot3-messagerie`, `diag-suspension`. Le balayage
[scripts/diag-scripts-destructeurs.mjs](scripts/diag-scripts-destructeurs.mjs) **découvre** les
écrivains au lieu de tenir une liste.
⚠️ **Angle mort vérifié** : ce balayage ne couvre que `scripts/diag-*.mjs`. Trois scripts écrivent en
base **hors** de son périmètre et **sans garde** : `scripts/cleanup-test-data.mjs` (suppression
irréversible), `scripts/verify-test-profile-once.mjs`, `scripts/backfill-matching-experts.mts`.

**E.5 — Le couperet de Vercel tue tout travail d'après-réponse hors d'un `after()`.**
Un `void promise` lancé après la réponse est tué : ni effet, ni erreur visible. Toute route qui poursuit
après avoir répondu utilise `import { after } from 'next/server'` **et** déclare un `maxDuration`
explicite. En place sur : `/api/candidatures`, `/api/conversations/[id]/messages`, `/api/profile`,
`/api/profile/cdi-upload-cv`, `/api/me/sync-matching`, `/api/admin/approve-expert`,
`/api/admin/reject-expert`, `/api/me/organisation/invitations(/[id])`, `/api/cron/purge-inactive`.
Le piège est nommé sur place : [app/api/candidatures/route.ts:454](app/api/candidatures/route.ts#L454)
et [app/api/conversations/[id]/messages/route.ts:533](app/api/conversations/[id]/messages/route.ts#L533).
`maxDuration = 60` est le plafond Hobby ; les crons longs montent à `300`.

**E.6 — Les cycles RLS produisent une récursion `42P17`.**
Deux policies qui se lisent l'une l'autre (`profiles.profiles_org_unlocked_read` → `candidatures`,
`candidatures.candidatures_expert_read` → `profiles`) font que **toute** requête
`SELECT … FROM public.profiles` d'un utilisateur authentifié répond
`42P17 infinite recursion detected in policy` — que PostgREST rend en **500 silencieux** côté client.
Parade, appliquée systématiquement : encapsuler le corps de la policy dans une fonction
**`SECURITY DEFINER` + `search_path` verrouillé**, qui bypasse RLS et **casse la boucle**, tout en
restant bornée à `auth.uid()`.
Traces : `supabase/_archive/20260603120000_fix_profiles_rls_recursion.sql` (le cas fondateur),
`rls_deletion_read_lock` (helper anti-récursion), `org_members_write_hardening`
(`is_active_admin_of_org`).
À savoir aussi : un event trigger `ensure_rls` **active RLS sur toute nouvelle table** du schéma
`public` — la sécurité est donc **dans le code de garde**, pas dans un REVOKE qui tiendrait.

**E.7 — Un contrôle qui lit un COMMENTAIRE reste vert quand la règle disparaît.**
Trois occurrences vérifiées :
- **`diag-billing-socle`** cherchait le simple nom `organization_domains` et se déclenchait sur le
  **commentaire de colonne qui énonce la règle qu'il défend** — « un contrôle qui punit la
  documentation de sa propre règle finit par être désactivé ». Corrigé : le motif exige une
  manipulation DDL/DML, pas une mention.
- **`diag-abonnement-organisation`** matchait le commentaire de migration qui cite, mot pour mot, la
  décision remplacée. Corrigé : SQL **exécutable uniquement**, commentaires retirés.
- **`diag-controle-acces-ecosysteme`** : les fragments de garde (`!target.active`, …) s'écrivent aussi
  dans un commentaire, et « un commentaire n'a jamais refusé personne ».

Parade généralisée : un helper `sansCommentaires()` / `strip()` / `stripSql()` en tête de la plupart des
diagnostics — *« un anti-pattern doit pouvoir être DOCUMENTÉ »*. Symétriquement,
`diag-expert-name-masking` vérifie qu'un **commentaire ne ment pas** sur une règle de sécurité.
Cas réel de commentaire menteur encore en place : l'en-tête de
[app/api/admin/assign-org-package/route.ts:14-20](app/api/admin/assign-org-package/route.ts#L14) décrit
toujours `organization_domains` comme cible et annonce deux refus (`no_active_domain` 404,
`multiple_active_domains` 409) que **le corps du même fichier** (lignes 124-125) déclare disparus — le
code écrit sur `organizations`.

**E.8 — Un contrôle qui teste une présence ET une absence séparément passe sur une écriture qui satisfait les deux.**
`applyPackageState` contient **aussi** une lecture de diagnostic sur `organizations` : un contrôle à la
maille de la **fonction** (« `organizations` est cité » ET « `package_id` est cité ») restait vert alors
que l'**écriture**, elle, était partie sur la table de trace. Corrigé en exigeant
`.from('organizations')` **immédiatement suivi** de `.update(` —
[scripts/diag-billing-socle.mjs:235](scripts/diag-billing-socle.mjs#L235).
Même famille : une assertion non ancrée dans `diag-zones-de-travail` attrapait le bloc **voisin** qui
portait le même motif et passait en vert alors que la condition avait été retirée
([scripts/diag-zones-de-travail.mjs:374](scripts/diag-zones-de-travail.mjs#L374)) — **trouvée par
mutation**. Règle : **ancrer** l'assertion sur le bloc qu'elle vise, jamais lâcher une regex sur tout le
fichier.

**E.10 — UNE VALEUR POSÉE À LA MAIN EN BASE NE SURVIT PAS À UNE RECONSTRUCTION, ET PERSONNE NE LE SAIT.**
C'est le piège le plus coûteux établi à ce jour, parce qu'il ne laisse **aucune trace exploitable**.

Le seuil d'auto-approbation des experts vaut **8**. Le seed l'avait posé à **9**. **Le chiffre 8
n'existait nulle part dans le dépôt** : ni migration, ni constante, ni commentaire. Il a été posé à
la main dans l'éditeur SQL le **16 juin 2026** — le commit du jour (`0371a40`, *« seuil sain —
corrige l'auto-approbation de profils incohérents »*) touche **deux fichiers TypeScript et zéro
migration**, et seule la colonne `updated_at` de la ligne en portait la marque.
**Il a fallu croiser un message de commit et un horodatage de base pour le reconstituer.**
Idem pour `config.blocking_flags`, absent du seed et présent en base.

**Ce que ça produit.** Toutes les écritures sur `verification_providers` vivent dans
`supabase/_archive/`, dont l'en-tête dit *« À EXÉCUTER MANUELLEMENT — NE PAS APPLIQUER VIA
`db push` »*. Conséquence en deux temps :
· **rassurant** — `db push` ne peut pas écraser un réglage ajusté : la table n'est touchée par
  aucune migration rejouée ;
· **et c'est le piège** — sur une base reconstruite (`db reset`, nouvelle production), la table est
  **VIDE**. Aucune erreur, aucun signal. La recette se terminait sur un succès **vert** en
  produisant une base structurellement parfaite et **fonctionnellement morte**.

**La parade, posée dans la migration `parametrage_de_production`** : le paramétrage de référence est
**extrait de la base réelle et versionné** — écosystèmes, configurations, branches, spécialités,
pays, fournisseurs de vérification (seuil **8** compris) et 167 traductions. `ON CONFLICT DO NOTHING`
partout : il reconstruit, il n'écrase jamais.
**La règle qui en découle : un réglage qui n'est pas dans le dépôt n'existe pas.** Une valeur posée
à la main est perdue d'avance — ce n'est pas une question de discipline, c'est une question de
mécanisme.

**E.11 — Trois replis différents pour une même absence de configuration, dont un qui invente.**
Les trois chemins de vérification lisent leur seuil en base. Ils se comportaient différemment quand
la ligne manque :

| Chemin | Configuration absente ⇒ | Verdict |
|---|---|---|
| `expert-verification` | `pending_admin_review`, motif nommé, **aucun appel IA** | ✔ |
| `publication-verification` | `pending_review`, motif nommé, **aucun appel IA** | ✔ |
| `verification/index` | ~~`FALLBACK_DECISION_THRESHOLD = 7`~~ | ✘ **devinait** |

Le troisième tranchait sur un nombre **que personne n'avait choisi et qu'aucun écran ne montrait** —
et son propre en-tête annonçait « fallback threshold = **9** » pendant que la constante valait **7**.
Il fallait lire les deux pour le voir.
**Aligné** : plus aucun repli, refus explicite avec motif nommé, **avant** toute dépense — on ne paie
pas une décision qu'on ne saura pas trancher.
La même famille frappait **l'origine du site** : huit endroits construisaient leurs liens d'e-mail
sur `NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`. En production, une variable oubliée envoyait
à de **vrais destinataires** des liens vers `localhost` — approbation d'expert, refus d'organisation,
invitation, **toutes** les notifications, et l'avertissement d'inactivité à 23 mois qui est une
**obligation légale**. L'envoi réussissait, le lien était mort, rien n'alertait.
Source unique désormais : [lib/site-url.ts](lib/site-url.ts) — repli explicite **hors** production,
`null` **en** production, et chaque appelant **n'envoie pas** plutôt que d'expédier un lien mort.
Gardé par [scripts/diag-configuration-absente.mjs](scripts/diag-configuration-absente.mjs), qui
balaie **`app/` ET `lib/`** (438 fichiers) et vérifie que chacun des 8 appelants garde.

**E.12 — Une migration de DONNÉES n'est validée par rien, et son seul usage est une base que personne n'a sous la main.**
Même famille que **E.1** (« les clients Supabase ne sont pas typés »), et pour la même raison de fond :
**aucun outil de compilation ne peut l'attraper.**

Le cas réel : la migration `parametrage_de_production` a été livrée **sans avoir jamais été jouée**.
Elle a échoué au **deuxième statement** :

```
ERROR: column "tags" is of type text[] but expression is of type jsonb (SQLSTATE 42804)
```

Les valeurs avaient été extraites de la base **via PostgREST — qui rend du JSON** — puis sérialisées
en `::jsonb` sans jamais confronter chaque valeur au **type réel** de sa colonne.
`domain_configs.tags` est un `text[]`.

**Pourquoi rien ne l'a vu :**
· `npx tsc` ne voit rien — c'est du SQL dans un `.sql` ;
· `next build` non plus, pour la même raison ;
· `diag-sql-litteraux` valide la **lexique** des chaînes, pas la **grammaire** ni les types ;
· et surtout : **ce fichier n'a qu'un seul usage, une base NEUVE.** Personne ne l'exerce au
quotidien. Le premier à le découvrir aurait été celui qui met en production.

**Un deuxième effet, aussi grave :** une erreur au statement 2 **masque tout ce qui suit**. Rien ne
dit si le reste est bon — et on est tenté de corriger la ligne fautive puis de repousser, au cas par
cas, jusqu'à ce que ça passe. **C'est la mauvaise méthode** : il faut établir la liste **complète**
des écarts avant de toucher au fichier.

**La parade : [scripts/diag-migration-donnees.mjs](scripts/diag-migration-donnees.mjs).**
Il **reconstruit le schéma depuis les migrations** (CREATE / ALTER / DROP / RENAME, dans l'ordre) et
confronte chaque valeur écrite au type de sa colonne. La bonne référence est bien les migrations, pas
la base actuelle : sur une base neuve, le schéma vient de là. Il tourne **sans base, sans réseau,
sans identifiants**, donc depuis n'importe quel worktree.
Il couvre : familles de types (tableau / jsonb / booléen / entier / décimal / uuid / temps / texte),
**colonnes inexistantes**, **`NOT NULL` sans défaut omises**, **arité**, **ordre des clés
étrangères**, et l'ordre de `translations` — qui n'a **aucune** clé étrangère (`row_id` est un uuid
libre), donc une dépendance que PostgreSQL ne voit pas et qu'il faut lire **dans les données**.
Sur les 51 migrations : **35 insertions analysées, 1913 valeurs confrontées**.

> ⚠️ **ET IL DIT CE QU'IL NE SAIT PAS LIRE.** Les 12 `insert … select … from (values …) cross join`
> sont déclarées **non analysables**, nommément, plutôt que jugées. Un contrôle qui invente un verdict
> sur ce qu'il ne comprend pas fait croire à une couverture qui n'existe pas — et c'est exactement
> comme ça qu'une migration non éprouvée a été livrée.
> **Seul un rejeu réel les couvre** : `supabase db reset` sur une base locale, ou `begin; … rollback;`
> sur un distant. Les deux exigent une base ; celui-ci n'exige rien, et c'est pour ça qu'il tournera.

**Deux faux positifs, corrigés en l'exécutant** — et ils valent d'être nommés, parce qu'un contrôle
qui crie à tort est désactivé le jour même : la liste de valeurs s'arrêtait au `;`, si bien que
`on conflict (name) do nothing` était lu comme **un tuple de plus** (six migrations saines
dénoncées) ; et la règle « `translations` doit être la **dernière** insertion » dénonçait
`public_email_domains`, que **aucune** traduction ne référence.

**E.9 — Autres pièges nommés dans le dépôt, à connaître.**
- **pg_cron valide la FORME d'une expression, pas sa satisfaisabilité.** `0 3 30 2 *` (30 février) est
  acceptée et ne se déclenchera **jamais** : aucune erreur, aucune ligne dans `job_run_details`. D'où le
  parti pris de `/admin/taches-planifiees` : **on ne reçoit jamais d'expression cron**, mais des
  composants typés et bornés.
- **Ne JAMAIS granter le schéma `cron` à `service_role`.** Le point d'exposition reste une fonction
  `SECURITY DEFINER` nommée. Répété dans cinq migrations.
- **Un webhook Stripe lu en `.json()` casse la signature** (HMAC des octets exacts) — de façon
  intermittente et incompréhensible.
- **Les interrupteurs échouent FERMÉ**, tous, via `capaciteActive()`
  ([lib/interrupteurs.ts](lib/interrupteurs.ts)) : la valeur doit être exactement `'true'`. Deux
  conventions opposées coexistaient ; `0`, `off`, `FALSE`, `flase` **laissaient l'IA active** et
  dépenser. Conséquence assumée : une capacité sans variable est **éteinte** — il faut donc déclarer
  `=true` en Preview comme en Production.
- **Le fail-safe n'est pas uniforme, et c'est voulu** : `entitlements` et `rate-limit` sont
  **fail-open** (une panne commerciale ne bloque pas l'usage) ; `ai-budget` est **fail-closed**
  (« ne pas savoir combien on a dépensé n'autorise pas à dépenser plus »).

**E.13 — UNE API ASYNCHRONE QUI REND UN IDENTIFIANT DE DEMANDE NE DIT PAS QUE LE MESSAGE EST PARTI.**

**Le piège.** Un fournisseur accepte une demande et rend un identifiant. Le code lit cet identifiant
comme une confirmation d'envoi, alors qu'il ne confirme que la **réception de la demande**. Ce qui se
passe ensuite — routage, filtrage, blocage — n'est pas dans cette réponse.

**La preuve, dans ce dépôt.** Vonage **Verify v2** (`api.nexmo.com/v2/verify`) répond `request_id`,
puis peut bloquer l'envoi. Sur la **Tunisie (+216)**, les journaux Verify affichent `BLOCKED` **après**
cette réponse. Le code rendait 200, l'écran lançait son compte à rebours et affichait six cases de
code — pour un SMS qui ne partirait jamais. **Six mois d'inscriptions perdues sans une ligne de log
côté produit.**

**Ce qui est en place.** Les routes d'envoi rendent `livraison_confirmee: false`, les écrans disent
« **demande transmise** » et jamais « SMS envoyé », et une **sortie** s'ouvre quand le compte à rebours
expire : un lien vers le formulaire de contact existant, prérempli avec le numéro et le pays.

**La règle générale.** Un écran qui **affirme plus que ce qu'on sait** est un écran mort : il enferme
quelqu'un dans une attente qu'aucun événement ne viendra rompre. Quand l'état réel n'est connaissable
qu'après coup, on dit ce qu'on sait — « transmis » — et on donne une action.
⚠️ Vaut pour **tout** fournisseur asynchrone, pas seulement les SMS : e-mail, webhook de paiement,
file de traitement. La question à poser est toujours la même : *cette réponse prouve-t-elle le
RÉSULTAT, ou seulement la PRISE EN COMPTE ?*

**E.14 — UN CORRECTIF APPLIQUÉ À UN PARCOURS ET NON RÉTROPORTÉ À SON JUMEAU SE LIT COMME CORRIGÉ
ALORS QU'IL EST VIVANT.**

**Le piège.** Deux écrans font la même chose par deux codes recopiés. On corrige l'un, on documente la
correction dans **son** commentaire, et le dépôt affirme désormais que le défaut est fermé. Il l'est à
un endroit sur deux, et la recherche du défaut s'arrête sur le commentaire qui dit qu'il est réglé.

**La preuve, dans ce dépôt.** `PhoneOtpField` portait, en commentaire, l'explication d'une regex
laxiste corrigée : `/^\+[1-9]\d{6,14}$/` laissait passer un numéro structurellement E.164 mais **non
attribuable**, le bouton s'activait, le serveur refusait, et l'écran affichait « Service SMS
indisponible » pour une faute de saisie. Le correctif n'a **jamais** été rétroporté à
`inscription/organisation`, qui portait la même regex **six mois plus tard**. Et ses ≈200 lignes
jumelles avaient en plus leur propre table d'erreurs, plus pauvre.

**Pire encore sur le troisième jumeau** — les paramètres du compte — qui avait son propre `toE164` :
`if (s.startsWith('0')) return '+33' + s.slice(1)`. Un utilisateur marocain qui tapait `0612345678`
enregistrait un numéro **français** en croyant enregistrer le sien. Le code n'échouait pas : il
**inventait**, exactement ce que [lib/phone.ts](lib/phone.ts) refuse de faire, en-tête à l'appui.

**Le remède, et c'est le seul qui tienne.** Ce n'est pas « penser à rétroporter » : c'est **supprimer le
jumeau**. Une saisie de téléphone ([components/phone/SaisieTelephone.tsx](components/phone/SaisieTelephone.tsx)),
un parcours OTP ([components/PhoneOtpField.tsx](components/PhoneOtpField.tsx)), trois usages.
`scripts/diag-saisie-telephone.mjs` **rougit** si une seconde implémentation réapparaît — c'est la
seule forme qui empêche la divergence de revenir.

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
| Deux synchros catalogue quasi simultanées : **deux** produits Stripe (le rattrapage par `products.search` ne voit pas le produit créé quelques secondes plus tôt — index différé ~1 min) | Clé d'idempotence **dérivée et stable** ([lib/billing/idempotence.ts](lib/billing/idempotence.ts)). Un UUID aléatoire ou un horodatage redonnerait deux créations : aucune protection. |
| Consommation d'un quota | `usage_increment()` — un seul `INSERT … ON CONFLICT DO UPDATE` sous garde de limite. |
| Limitation de débit | `rate_limit_check()` — vérifie **et** enregistre atomiquement. Contrat : un refus **n'enregistre pas** le hit. |
| Course à la création d'une organisation personnelle | Index unique partiel `organizations_personal_owner_unique_idx` ; `23505` ⇒ on relit et on retourne l'existante. |
| Deux offres pour un même `price` Stripe : le webhook tirerait au sort des droits payés | Index unique `idx_packages_stripe_price_monthly`. |

**Ce qui reste ouvert sur cette classe.**
- La clé d'idempotence Stripe ne vit que **24 h**. Elle ferme la **course** (quelques secondes), pas la
  récupération d'un produit orphelin découvert des jours plus tard — c'est pour ce seul cas que
  `products.search` reste sur le chemin.
- Un événement Stripe **bloqué en `received`** (crash ou timeout avant marquage) refuse tous les
  réessais. **Délibéré** : mieux vaut un événement non appliqué et visible qu'un double crédit. Il se
  repère par `idx_stripe_events_status` et se rejoue en repassant la ligne à `failed`. Rien n'automatise
  ce repérage aujourd'hui.
- [lib/collaboration/ensure-personal-org.ts](lib/collaboration/ensure-personal-org.ts) reste
  **transactionnel par compensation** (échec en aval ⇒ suppression de l'org, CASCADE), pas par
  transaction serveur.
- La branche `feat/s1-ux-profil` porte une migration `verrou_run_et_unicite_notifications` qui n'est
  **pas** sur le tronc : même famille, à intégrer.

---

## G. Les règles de travail entre worktrees

**G.1 — Les worktrees.** `git worktree list` en compte **sept** (et non trois) :
`skilloria` (tronc, `feat/sprint-archi-orga`), `skilloria-s1` (`feat/s1-ux-profil`),
`skilloria-s2` (`feat/s2`), `skilloria-s3` (`feat/s3`), plus trois worktrees `parallel/*`
(`freelance-mon-profil`, `client-publication-mission`, `cdi-dashboard-profil`) dont les branches
correspondent à un sprint antérieur. **Les trois branches actives sont S1, S2, S3 au-dessus du tronc.**
`feat/s3` est très en retard sur le tronc.

**G.2 — Numérotation des migrations par plage.** Le format est `AAAAMMJJ` + suffixe à 6 chiffres.
Plages **observées dans le dépôt** :

| Plage | Auteur | Exemples |
|---|---|---|
| `0xxxxx` | tronc | `20260903000000_abonnement_sur_organisation`, `20260903000020_reglages_matching_et_depense` |
| `2xxxxx` | S1 | `20260904200000_relance_expert`, `20260911200000_reprise_notation` |
| `3xxxxx` | S2 | `20260910300000_stripe_socle_serveur`, `20260910300010_quota_analyses_cv` |

> **TRANCHÉ.** La plage du tronc est **`0xxxxx`**. La consigne orale « 1xxxxx » était fausse, elle
> est corrigée. Toute migration du tronc porte un suffixe `0xxxxx` **et** un horodatage strictement
> supérieur au plus récent existant, **tous worktrees confondus** — la vérification se fait sur
> chaque branche, pas seulement sur HEAD.

Une collision de numéros s'est déjà produite (commit `e33fdab`), et une migration a dû être
renumérotée **avant application** (`912d437`) : numérotée sous quatre migrations déjà appliquées, elle
se serait rejouée **avant** elles sur une base vierge.

**G.3 — Jamais de référence à une migration par son numéro, ni par sa position.**
Un numéro cité vieillit mal et ment ensuite ; « la dernière migration dont le nom contient *stripe* » se
trompe de fichier dès qu'une migration s'ajoute ou qu'un renumérotage change l'ordre.
Convention : résolution **par suffixe descriptif**, avec un résolveur qui **refuse de tourner** sur zéro
ou deux correspondances (`function migration(suffixe)`, repris tel quel plutôt que réécrit).
La règle est **gardée par un contrôle** : `diag-billing-socle.mjs` balaie les modules de facturation, la
route, le diagnostic lui-même et la migration, et échoue sur tout `20\d{12}`. Le motif utilise des
**lookarounds sur les chiffres**, pas `\b` — un horodatage est suivi d'un `_`, qui est un caractère de
mot, et `\b20\d{12}\b` ne mordait donc **jamais** sur le cas réel.

**G.4 — Ordre de passage d'une migration : il est écrit en tête de chaque fichier.**
Trois cas, chacun explicite dans l'en-tête : **AVANT** le déploiement (n'ajoute que du nouveau, ou
supprime des colonnes que le code en ligne lit encore — le code doit alors partir *dans la foulée*),
**APRÈS** le déploiement (`nettoyage_organisations_fantomes` : exécutée avant, elle supprimerait des
lignes que l'ancien code recrée dans la minute), ou **indifférent** (`index_echelle`).
Ne jamais pousser une migration sans lire cet en-tête.

**G.5 — Le diagnostic s'éprouve par MUTATION.** Écrire le contrôle ne suffit pas : il faut casser
délibérément la règle et vérifier que le contrôle **rougit**, puis la rétablir. C'est ainsi qu'ont été
trouvés E.7 et E.8. Plusieurs commits en portent la trace explicite (`c7cc8e6` : « 62 contrôles,
15 mutations » ; `6558515` : « 42 contrôles, campagne de mutation »).

**G.5 bis — La règle de maintenance de ce fichier est GARDÉE PAR UN CONTRÔLE.**
[scripts/diag-memoire-a-jour.mjs](scripts/diag-memoire-a-jour.mjs) — il lit git, rien d'autre.
Sur les **ajouts** seulement (une migration, une route `app/api/**/route.ts`, un script de
`scripts/`), il vérifie **commit par commit** que `CLAUDE.md` a été touché dans le même commit, et
**nomme** le fichier ajouté et la section où l'écrire. Échappatoire assumée et tracée :
`[memoire:n/a]` dans le message de commit. Trois codes de sortie : `0` vert · `1` manquement ·
`2` n'a pas tourné.
`--base=<ref>` dit ce qu'une plage — donc ce que trois worktrees — a oublié ; `--sections` vérifie
qu'aucune réécriture n'a perdu un chapitre.
> ⚠️ **Il force la TRACE, pas la VÉRITÉ.** Son vert dit seulement que le fichier a été touché, jamais
> que ce qui y est écrit est juste. Un contrôle qui promettrait la justesse serait pire qu'absent :
> on cesserait de relire.

**G.6 — Aucun push, aucune écriture en base depuis un worktree.**
La moitié « écriture en base » est **gardée dans le dépôt** (§E.4 : `garde-ecriture.mjs` +
`diag-scripts-destructeurs.mjs`), avec l'angle mort des trois scripts hors périmètre.
La moitié « aucun push » est une **convention d'équipe — NON VÉRIFIÉE dans le dépôt** : aucun hook,
aucune configuration ne l'impose.

**G.7 — Conflits `messages/*.json` résolus en UNION. NON VÉRIFIÉ.**
Aucun `.gitattributes`, aucun pilote de fusion, aucune documentation dans le dépôt ne porte cette
règle : elle repose aujourd'hui sur la discipline. Les quatre fichiers `messages/{fr,en,es,de}.json`
sont touchés par presque tous les lots — c'est le point de conflit structurel du projet.
Plusieurs diagnostics vérifient qu'une clé existe **dans les quatre langues** et qu'aucune clé orpheline
ne survit (`diag-score-de-pertinence`, `diag-murs-fermes`).

---

## H. Ce qui reste ouvert

Uniquement ce qui est établi depuis le code ou depuis un TODO réel.

**Commerce / Stripe**
- `ENABLE_BILLING` n'est pas posé : le mur est fermé, rien n'encaisse (§D.1). La date d'ouverture n'est
  pas fixée. La marche à suivre pour le premier paiement est écrite dans
  [docs/stripe-premier-paiement.md](docs/stripe-premier-paiement.md).
- Aucun repérage automatique d'un `stripe_events` bloqué en `received` (§F).

**Vérification par SMS (OTP d'inscription)**
- **La Tunisie (+216) est bloquée par Vonage sur l'API Verify, et ce point N'EST PAS DANS LE CODE.**
  Vérifié : ce n'est ni Fraud Defender Countries (activé sur les deux canaux), ni une Traffic Rule —
  c'est une **liste de pays restreints propre à Verify**, qui exige un **ticket au support Vonage**.
  Les journaux Verify affichaient `BLOCKED`, deux fois, sur Orange Tunisie.
  **Ne cherchez pas la cause dans le dépôt : elle n'y est pas.** Ce qui a été fait ici, c'est rendre
  l'échec **visible** (§E.13) — le refus est nommé, distinct d'une panne, et il ouvre une sortie.
  Le déblocage appartient à Youssef.
- **Le webhook de statut Vonage est un CHOIX DIFFÉRÉ, pas un oubli.** Sans lui, le serveur ne peut
  pas savoir si un SMS a été **remis** : il ne connaît que l'acceptation de la demande. Cesser
  d'affirmer qu'il est parti et donner une sortie apporte l'essentiel du bénéfice pour une fraction
  du travail — un webhook est une **adresse publique à exposer, à sécuriser et à déclarer chez
  Vonage**. Il viendra si des échecs invisibles sont constatés en production.
- **`country_code: 'FR'` est CODÉ EN DUR à l'inscription d'une organisation**
  ([app/[locale]/inscription/organisation/page.tsx](app/[locale]/inscription/organisation/page.tsx),
  corps envoyé à `/api/auth/register-org`). Ce champ est le pays de **l'entreprise**, pas celui du
  téléphone — le déduire du numéro serait exactement l'invention silencieuse que §E.14 décrit.
  Conséquence vérifiable : `verification_providers` choisit le fournisseur sur ce code, donc **une
  société marocaine est vérifiée contre Sirene**. Ouvrir géographiquement les organisations exige un
  sélecteur de pays d'entreprise **et** une décision sur la couverture des fournisseurs. **Hors
  périmètre du lot SMS, et non traité.**

**Moteur**
- Le canal SMS est fermé au dispatcher (§D.2). Rouvrir exige d'abord de basculer le défaut de préférence
  en **opt-in** et de rendre les interrupteurs aux écrans — ni l'un ni l'autre n'est fait.
  ⚠️ **Sans rapport avec l'OTP d'inscription** : autre API (Verify v2), autre chemin, aucun point
  commun. Fermer l'un ne peut pas casser l'autre, et `scripts/diag-canal-sms.mjs` tient cette
  séparation dans les deux sens.
- `lib/database.types.ts` est périmé et **inutilisé** (§E.1). Le régénérer et typer les clients
  supprimerait toute la classe E.1 ; personne ne l'a fait.

**Divulgation**
- `reveal_contact` est un **point d'extension** conçu mais **non branché**
  ([lib/expert-disclosure.ts](lib/expert-disclosure.ts)) : le packaging commerce qui l'ouvrirait n'existe
  pas.

**Dette nommée dans le code**
- `metadataRoleFromOrgType` mappe encore `esn → cabinet` ; sans conséquence sur le routing aujourd'hui,
  à revoir si un autre appelant dépend de la distinction ([lib/auth-routing.ts](lib/auth-routing.ts)).
- Factorisation V1 (freelance) / V3 (CDI) en attente, TODO posés sur : [lib/cv-parser-cdi.ts](lib/cv-parser-cdi.ts),
  [app/api/profile/cdi-upload-cv/route.ts](app/api/profile/cdi-upload-cv/route.ts),
  `app/[locale]/dashboard/cdi/profil/page.tsx`, `app/[locale]/dashboard/cdi/profil/valider/page.tsx`.
- [app/api/auth/finalize-org-registration/route.ts](app/api/auth/finalize-org-registration/route.ts) :
  TODO V2 — migrer vers une file de travaux.
- [lib/nav-config.ts](lib/nav-config.ts) : une entrée de menu non cliquable, fonctionnalité non livrée.
- `scripts/diag.mjs` — lanceur **cassé et inachevé**, retiré de `package.json` pour cesser de piéger
  (`912d437`). Il reste dans le dépôt, réattribué.
- `scripts/diag-lot2b-expert.mjs`, `diag-lot2c-org.mjs`, `diag-lot3-messagerie.mjs` s'annoncent
  eux-mêmes **« DONNÉES OBSOLÈTES depuis le cleanup »**.
- `scripts/diag-readonly-expert-achwek.mjs` cible une **adresse e-mail réelle** ; à retirer ou à
  anonymiser au regard du registre RGPD.
- Trois scripts écrivent en base hors du périmètre de la garde (§E.4).

**Mise en production**
- Le paramétrage de référence est versionné (§B.2 ⑦). **Ce qui ne peut pas l'être** — deux secrets du
  Vault, réglages d'authentification, variables d'environnement, sous-domaines — est décrit pas à pas
  dans [docs/mise-en-production.md](docs/mise-en-production.md), pour quelqu'un de non technique.
- **Quatre** des huit tâches planifiées passent par `trigger_purge_cron` et **lèvent** sans les deux
  secrets du Vault : `purge_deletions_trigger`, `purge_inactive_trigger`, `matching_retry_trigger`,
  `expert_relance_trigger`. Les deux premières portent une **obligation légale** (RGPD art. 17 et
  CNIL). Elles ne se plaignent qu'au journal de la base : rien à l'écran.
- **`ensure_rls` n'a jamais été exécuté nulle part** — sa branche `create` est sautée par un
  `if not exists` sur tous les environnements connus. `CREATE EVENT TRIGGER` exige un privilège que
  le rôle `postgres` de Supabase ne possède pas toujours ; un refus ferait échouer la migration **au
  4ᵉ fichier sur 51**, et les 47 suivantes ne s'appliqueraient pas. **NON VÉRIFIÉ à ce jour** —
  éprouver le privilège avant le jour J (cf. la réponse en fin de lot).

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
- **Cinq des sept points de dépense IA n'enregistrent rien et ne consultent jamais le plafond**
  (§P4.3) : le « plafond Claude 100 $ » ne compte aujourd'hui que le jugement de candidature et le
  pitch. Le total est faux **avant** toute répartition par acteur.

---

# LE PRODUIT

> Ce que Skilloria **fait**, écran par écran et règle par règle. Les sections A–H au-dessus sont un
> guide de repérage — où vivent les choses, quels pièges les entourent. Celle-ci est le produit
> lui-même : c'est elle qu'on lit quand on reprend le projet, ou qu'on y revient dans six mois.
>
> Chaque chapitre de §P1 doit se lire **seul**, sans avoir lu le code.
> Tout y est vérifié dans le dépôt ; ce qui ne l'est pas est marqué **NON VÉRIFIÉ**.

## P1. Les six parcours, de bout en bout

### P1.1 — L'expert dépose son CV et devient visible

**Qui.** `expert_freelance` ou `expert_cdi`. Un expert appartient à **un** écosystème, à vie (§D.3).

**1. Il s'inscrit.** `/inscription/[role]` → `POST /api/auth/public/register-expert`.
La route est **publique** (bare `fetch`, pas `useSecureFetch`) et résout l'écosystème elle-même via
`resolveSubdomainFromHost()` : le proxy n'injecte pas `x-subdomain` sur `/api`.
L'inscription exige une **branche et une spécialité choisies dans le référentiel**, pas du texte
libre — avant la migration `taxonomie_specialite_autre_et_inscription`, la spécialité était stockée
dans `profiles.title`, `branch_id`/`speciality_id` restaient NULL, et **le profil n'alimentait pas le
matching**. Si la spécialité n'est pas au référentiel, l'expert saisit « Autre » et le texte part en
modération.
L'acceptation des CGU est **horodatée et versionnée** en base (migration
`legal_consent_and_inactivity`) : une case cochée non tracée n'a aucune valeur juridique.
Le rattachement à l'écosystème vient des métadonnées d'inscription — `handle_new_user` **refuse**
un `domain_slug` absent ou inconnu depuis la migration `fix_handle_new_user_domain_slug`, là où la
baseline retombait silencieusement sur `microsoft`.

**2. Il vérifie son téléphone.** OTP par SMS (Vonage **Verify v2**, `api.nexmo.com/v2/verify` — un
chemin entièrement distinct du canal SMS de notification, qui est fermé, cf. §D.2).
Limites : **1 envoi / 60 s** et **3 / heure** par numéro, plus **10 / heure par IP** sur la route
publique (`rate_limit_check`, atomique en base). La vérification du code est **fail-closed** et
clée par IP.

**Il CHOISIT SON PAYS, il ne compose pas d'indicatif.** L'écran affichait un badge **« 🇫🇷 » figé** et
un placeholder `+33` : un expert marocain, tunisien ou canadien ne pouvait pas saisir son numéro, et
rien ne lui annonçait que le champ exigeait un `+`. Il y a désormais un sélecteur de pays
([components/phone/SaisieTelephone.tsx](components/phone/SaisieTelephone.tsx)), et **le E.164 est
composé par le code**, jamais par l'utilisateur.
- Le référentiel vient de **la base** (`countries`, 64 pays, via `/api/countries`) — aucune liste en
  dur, et **aucune liste de pays autorisés** : un filtrage géographique éventuel sera un réglage.
- Le **pays par défaut** vient du `sort_order` du référentiel, pas d'une constante de code.
- On stocke le **code ISO**, jamais l'indicatif seul : `+1` est partagé par les États-Unis et le Canada.
- Changer de pays **ne vide jamais** le numéro déjà tapé ; le **placeholder vient du pays choisi**, pas
  de la langue (les messages prescrivaient `+33` en français, `+34` en espagnol, `+49` en allemand) ;
  un numéro **collé avec son indicatif** (`+216…`, `00216…`) bascule le sélecteur ; les **chiffres
  arabes-indiens et persans** sont acceptés.
- Recherche dans la liste par **nom, code ISO ou indicatif**.

**Ce qu'il voit quand l'envoi échoue, et ce qu'il peut faire.** Le motif réel de Vonage est traduit en
codes stables ([lib/otp/vonage-refus.ts](lib/otp/vonage-refus.ts)) puis en messages dans les quatre
langues. Deux refus sont **distincts parce que leurs issues le sont** :
- **« les SMS ne sont pas disponibles vers ce pays »** — réessayer est inutile, l'issue est de nous
  écrire (c'est le cas de la Tunisie, cf. §H) ;
- **« service momentanément indisponible »** — réessayer a du sens, et il n'y a rien d'autre à faire.
Avant, tout tombait dans le second, y compris un numéro simplement mal saisi.

**L'écran n'affirme pas que le SMS est parti** (§E.13) : il dit « **demande transmise** », et quand le
compte à rebours expire sans code reçu, il ouvre une **sortie** — un lien vers le formulaire de contact
existant, prérempli avec le numéro et le pays. **Aucun canal nouveau**, et le sujet transite par un
**jeton** (`probleme=otp`), jamais du texte libre : cet e-mail part vers l'équipe.

⚠️ Les **trois** parcours — inscription expert, inscription organisation, paramètres du compte —
utilisent le **même** composant. C'était trois codes recopiés avec trois validations et trois tables
d'erreurs différentes ; §E.14 raconte ce que ça a coûté.
Un index **UNIQUE PARTIEL** sur `users(phone) WHERE phone_verified` tient la règle « 1 numéro
vérifié = 1 compte » : c'est la seule barrière réelle contre la multiplication de comptes — la
vérification IA d'expertise est franchissable, un recruteur recycle un CV authentique.

**3. Il dépose son CV.** `/dashboard/{freelance,cdi}/profil` → `POST /api/profile/upload-cv`
(freelance) ou `/api/profile/cdi-upload-cv` (CDI). **Deux routes distinctes, gardées par
`user_type`** : un `expert_cdi` sur la route freelance reçoit **403 `wrong_user_type`**.
- PDF, **5 Mo** maximum, bucket `cv` **privé** (service-role seul, jamais d'URL).
- Consentement RGPD requis (`profiles.ai_consent_at`).
- Interrupteur `ENABLE_AI_CV_PARSING` → **503 `ai_disabled`** s'il n'est pas exactement `'true'`.
- Quota **3 analyses / 24 h**, lu en base (`ai_quotas`), **pas dans le code** : ligne absente ⇒ la
  route **refuse** (`quota_config_missing`), elle ne devine pas.
- Parsing par `claude-haiku-4-5-20251001`, résultat **caché par SHA-256** du fichier : redéposer le
  même PDF ne repaie pas.
- `maxDuration = 60`. Le matching qui suit part dans un `after()` (§E.5).

**4. Il devient visible — ou il apprend pourquoi il ne l'est pas.**
Le prédicat de visibilité vit **une seule fois**, dans
[lib/profile-visibility.ts](lib/profile-visibility.ts), et il a **trois** lecteurs : la route (qui
refuse), le formulaire (qui prévient avant l'envoi), et la bannière (qui dit **quels champs
manquent**). Le même prédicat existe en contrainte base
(`profiles_visible_requiert_criteres_check`) — trois copies dérivent, et c'est déjà ce qui a fait
échouer une migration.
Exigé : titre, résumé **200–800 caractères**, compétences, branche, spécialités, séniorités, zones
de travail, disponibilité, expériences, langues, CV analysé, consentement IA.
Les bornes du résumé ne sont pas une préférence de rédaction : **en dessous de 200 il n'y a pas
matière à juger, au-delà de 800 le texte sort du document envoyé au moteur** et n'est plus lu.
Ce qu'il voit quand ça refuse : la liste **nommée** des champs manquants, traduite dans les quatre
langues (`profile_validation.field_errors`) — jamais « votre profil est incomplet ».

**5. Il est vérifié.** `/dashboard/{freelance,cdi}/profil/valider` →
[lib/verification/expert-verification.ts](lib/verification/expert-verification.ts).
`verification_status` passe à `pending` **avant** l'appel (l'écran ne ment pas sur ce qui se passe),
puis Claude croise trois axes avec recherche web native.
- score ≥ `auto_approve_threshold` **et** aucun drapeau disqualifiant → **`approved`**,
  `verified_at` posé, `verified_by` NULL (automatique), `users.is_verified` basculé ;
- sinon → **`pending_admin_review`** : un humain tranche depuis `/admin/experts/[id]` ;
- **erreur** (timeout, rate-limit, JSON invalide) → `pending_admin_review`. **Jamais**
  d'auto-approbation sur une panne.
- Consentement IA absent → le statut **reste** `pending`, rien n'est appelé.
Idempotent : rejouable, le dernier verdict écrase le précédent.

**Où ça bloque, et pourquoi.** Tant que le profil n'est pas `approved`, **visible**, CV analysé et
consentement donné, il n'entre pas dans le vivier (§P1.3). Les écrans « Missions » affichent alors
un état vide **explicite** (« profil pas encore validé »), jamais un cache périmé.

---

### P1.2 — L'organisation publie une annonce

**Qui.** Un membre d'une `organization` (`org_type` ∈ `client` \| `cabinet` \| `esn`), ou un expert
via son **organisation personnelle** (`org_type = 'freelance'`, §P1.2 bis).

**1. L'organisation s'inscrit.** `/inscription/organisation` → `POST /api/auth/register-org`.
C'est la seule instruction `insert into organization_domains` de tout le dépôt — une ligne, une
fois, et cette table n'est plus qu'une **trace historique** (§B.2 ①).

**2. Elle est vérifiée.** [lib/verification/](lib/verification/) — **l'IA est le décideur
systématique, pas un repli**. Sirene (FR) ou Companies House (UK) fournissent les données ; Claude
compare **champ par champ** et produit un score de confiance, comparé au
`verification_providers.confidence_threshold` du pays (**défaut 9 sur 10**).
**Règle métier : jamais d'auto-rejet.** En dessous du seuil → `pending_admin_review`, un humain
tranche depuis `/admin/organisations/[id]`.
`requireOrgApproved(ctx)` garde ensuite les routes réservées.

**3. Elle rédige.** `/dashboard/entreprise/annonces/nouvelle` → `POST /api/publications`.
Champs structurants : branche, spécialités (multiples), séniorités (multiples), compétences requises,
**zones de travail** (multiples), `location_note` (texte libre, ex-`location`).

**4. Elle publie.** `POST /api/publications/[id]/publish`. Trois portes, dans cet ordre :

- **Complétude** — prédicat unique [lib/publications/publishable.ts](lib/publications/publishable.ts),
  doublé d'une contrainte base `publications_publiee_requiert_zones_check`.
  Exigés : titre, description, branche, **zones de travail**.
  La sémantique de l'ensemble vide est **asymétrique, et c'est voulu** :
  · **zones obligatoires** — `&&` sur un ensemble vide est toujours faux, une annonce sans zone
    serait publiée et **silencieusement invisible** ;
  · **spécialités et séniorités facultatives** — vide signifie « aucune contrainte sur cet axe »,
    jamais « ne correspond à personne ». Une annonce incomplète doit matcher **large**, pas rien.

- **Qualité (IA)** — [lib/verification/ai-publication-quality.ts](lib/verification/ai-publication-quality.ts),
  provider `opportunity_quality_check`, **seuil 7/10**. Le prompt refuse explicitement qu'un champ
  optionnel vide fasse descendre sous 7, et traque les coordonnées en clair (téléphone, e-mail) —
  une annonce qui contourne la messagerie contourne le dévoilement payant.

- **Commerce** — deux quotas, deux refus **402** :
  `quota_publications_reached` (publications du mois) et `quota_active_publications_reached`
  (annonces actives simultanées). Cf. §P1.6.

**5. Elle vit 30 jours.** **L'expiration est calculée À LA LECTURE.** Aucun job, aucun cron, aucun
statut basculé : `publications.expires_at` n'est **jamais écrit**. La règle se réduit à
`status = 'published' AND published_at > now() - 30 jours`, et vit une seule fois dans
[lib/publications/expiry.ts](lib/publications/expiry.ts).
L'organisation peut aussi clôturer à la main (`POST /api/publications/[id]/close`).

**Ce que voit l'utilisateur quand ça refuse.** Un refus nomme **ce qui bloque et ce qu'on peut
faire** (`diag-refus-actionnables.mjs` le garde) : les champs manquants pour la complétude, le motif
pour la qualité, et pour le quota — la limite atteinte **et** l'issue. Les murs de conversion ne
portent **aucun bouton désactivé** (§D.1).

#### P1.2 bis — La sous-traitance entre experts
Un expert publie un **besoin** et est mis en relation avec d'autres **experts**.
Blocage structurel : `publications.organization_id` est NOT NULL. D'où une **organisation
personnelle** (`org_type = 'freelance'`, `owner_user_id` renseigné), créée **paresseusement**.
Elle hérite de 100 % du moteur commerce — quotas, masquage, dévoilement, messagerie 15 j — sans
aucune logique dupliquée.
**Elle naît au moment de PUBLIER, pas à l'ouverture de l'écran** : avant la correction, tout expert
vérifié qui ouvrait « Sous-traitance » par curiosité repartait avec une organisation, et
`/admin/collaboration` mesurait la curiosité. Un index unique partiel
(`organizations_personal_owner_unique_idx`) tranche les courses ; la migration
`nettoyage_organisations_fantomes` a supprimé les fantômes — **après** le déploiement du code, sinon
les écrans les auraient recréés dans la minute.

### P1.3 — La mise en relation et la notification

**Ce que c'est.** Le moteur rapproche une annonce et des experts. Il tourne dans **les deux sens** :
`runMatchingForPublication` (une annonce vient d'être publiée) et `runMatchingForExpert` (un expert
vient de modifier son profil).

**Claude n'est plus là.** Il notait cent profils **dans un seul prompt**, en les comparant les uns
aux autres — et « ne les compare pas entre eux » n'était qu'une phrase dans ce prompt, que rien ne
garantissait. Le vivier était plafonné à cent **sans `ORDER BY`** : une liste d'autorisés stable et
invisible, où le 101ᵉ n'existait pas.
Le **reranking** (Cohere) note chaque couple (annonce, profil) **indépendamment**. Il n'y a donc plus
rien à couper, plus de plafond, et **l'absence de compétition devient une propriété du moteur au lieu
d'une consigne**.

**Quatre temps, et chacun sait se taire ou parler.**

1. **Les réglages** — `matching_settings`, **une ligne par écosystème**, créée par un déclencheur
   pour tout domaine nouveau. **Aucune valeur de repli dans le code** : ligne absente ⇒ le moteur
   **refuse et le dit**. Un repli codé en dur serait un second réglage, invisible, qui prendrait la
   main le jour où l'on comprend le moins ce qui se passe.

2. **Le vivier** ([lib/matching/pool.ts](lib/matching/pool.ts)) — la règle est explicite :
   > *Aucun profil n'est écarté sans une raison **nommable et contestable**. Le backend filtre sur
   > des critères **déclarés par l'expert lui-même**. Il n'exclut jamais sur un jugement de
   > pertinence.*

   Filtres : même écosystème, `user_type` compatible avec le type d'annonce (ou **ouverture
   croisée** cochée : `open_to_cdi` / `open_to_freelance`, défaut **fermé**), branche, spécialités,
   séniorités, zones (`&&`), disponibilité (`availability_status` / `cdi_status`), vérification
   `approved`, `visible`, CV analysé, consentement IA — **et ses décisions** : avoir décliné
   l'annonce, ou y avoir déjà postulé. Un refus et une candidature sont des **actes de l'expert**,
   pas des jugements portés sur lui.
   Chaque filtre rend **son propre décompte** : sans cela « 3 candidats » ne dit pas si le vivier est
   petit ou si un filtre est trop serré, et personne ne sait quoi corriger.
   Lecture paginée par tranches de 1000, identifiants par paquets de 200.

3. **La notation** — Cohere (`rerank-v4.0-fast` par défaut), par lots de 200, 4 lots en parallèle,
   **budget relu entre chaque lot** ([lib/ai-budget.ts](lib/ai-budget.ts)). Interrupteur
   `ENABLE_RERANKING`, qui doit valoir exactement `'true'`.
   Au plafond, **la fonctionnalité se dégrade et le DIT** : elle ne disparaît pas en silence et ne
   continue pas à dépenser. Le module rend toujours une **raison nommable**, écrite dans la trace du
   run. Fail-safe **fermé** ici, à l'inverse du reste du projet : *ne pas savoir combien on a dépensé
   n'autorise pas à dépenser plus.*
   Le score produit vit dans **[0,1]**, il est **propre à une annonce**, et il n'est **jamais
   normalisé sur le vivier** — normaliser reviendrait à classer les experts les uns par rapport aux
   autres, c'est-à-dire à réintroduire la compétition que le produit interdit.

4. **La réconciliation puis les notifications** ([lib/matching/reconcile.ts](lib/matching/reconcile.ts))
   — upsert **idempotent** qui préserve les `dismissed` et les candidatures engagées, et ne notifie
   que sur les **inserts FRAIS** au-dessus du seuil. Un ré-run ne re-notifie personne.

**La trace n'est pas un détail.** Chaque run écrit `publications.matching_stats` : périmètre, notés,
lots en échec, distribution des scores, seuil appliqué. C'est ce qui distingue « noté, personne ne
correspond » de « jamais noté ». Un run interrompu reste **INACHEVÉ**, donc visible et rejouable, et
la reprise s'appuie sur `matching_notes_partielles` : **ce qui est noté ne se renote pas** — avant,
un run tué à 60 s repartait de zéro et **repayait les lots déjà payés**, jusqu'à l'abandon silencieux
au bout de cinq tentatives.
La trace est construite par **un seul** constructeur pour les deux chemins de sortie : tant que
chacun écrivait son objet, l'un pouvait oublier une clé — et une clé absente se lit `null`, qu'une
somme SQL affiche **zéro**. La supervision aurait dit « tout va bien » sur un moteur muet.

**La relance : reporter n'est pas annuler.** Un expert modifie son profil, le moteur tourne ; il le
modifie à nouveau dans l'heure, et l'ancien garde-fou de débit **refusait** — le déclenchement était
**perdu**, ses dernières modifications jamais notées, et rien ne le signalait. Désormais on
**reporte** : `programmer_relance_expert()` écrit l'échéance **en une seule instruction en base**
(§F), `prochaine_relance_expert()` la réclame, `solder_relance_expert()` ne solde **que ce qui était
dû** — un déclenchement arrivé pendant le run n'est pas effacé.
Délai **60 minutes**, attente totale bornée à **6 heures**, tâche `expert_relance_trigger` toutes les
5 minutes.
Un plafond anti-abus de **20 programmations / heure / expert** protège l'**écriture** (pas le coût :
la temporisation borne déjà le coût). Il vit en **constante nommée dans le code**, et n'a
**volontairement aucun champ** dans `/admin/matching` — *un seuil anti-abus n'est pas un réglage
commercial, et le rendre réglable invite à le désactiver le jour où il gêne.* En échange, les
dépassements sont **comptés** (`relance_overruns`) et affichés.

**La notification.** Trois événements (`new_match_opportunity`, `new_candidature_received`,
`new_message`), déclarés **une seule fois** dans [lib/notifications/catalog.ts](lib/notifications/catalog.ts)
— lu à la fois par l'écran de réglages et par le dispatcher, pour qu'un interrupteur affiché soit
toujours un interrupteur honoré.
Le public est **un fait, pas un type** : « a un profil expert », « est membre actif d'une org »,
« tout le monde ». Un expert qui publie via son organisation personnelle reçoit donc légitimement les
trois — un découpage par `user_type` l'aurait privé du réglage correspondant.
Regroupement : **digest** pour les opportunités (anti-rafale : un run peut produire 20 matches d'un
coup), **un envoi par élément** pour les messages.
**Seul le canal e-mail est ouvert** (§D.2). Et **`notify_enabled` vaut `false` par défaut sur chaque
écosystème** (§P4) : aujourd'hui, personne n'est notifié.

**Ce que l'expert voit.** Son flux est **ordonné** par le score, mais le score **ne sort pas de
l'API** : `/api/me/missions` le passe en **chaîne** à `.order()` et ne lit jamais sa valeur. L'expert
reçoit un **palier** — « Correspondance forte » ou « Correspondance » — **figé au moment de la
notation**. Jamais recalculé à l'affichage : le seuil est réglable et les scores ne sont pas
comparables entre deux runs, un recalcul rebaptiserait des matches anciens en silence.
Deux paliers et pas trois : une troisième valeur réintroduirait une graduation, donc un classement,
donc la comparaison entre experts.

---

### P1.4 — L'expert postule

**1. Il ouvre une mission.** `/dashboard/{freelance,cdi}/missions/[id]`. Il peut la **décliner**
(`POST /api/me/missions/[id]/dismiss`) — le match passe `dismissed`, et le vivier ne le reproposera
plus : c'est **sa décision**, pas un jugement.

**2. Il postule.** `POST /api/candidatures`, `maxDuration = 60`.
La candidature porte `publication_id`, `profile_id`, `match_id`, `domain_id`, un `cover_message`
facultatif, et `status = 'received'`.

**3. Claude juge — au dépôt, et seulement là.**
[lib/candidatures/ai-assessment.ts](lib/candidatures/ai-assessment.ts), `claude-sonnet-5`, lancé dans
un **`after()`** (sinon la plateforme le tuerait sans trace, §E.5), sous l'interrupteur
`ENABLE_AI_CANDIDATURE_ASSESSMENT`.
Il note **un seul couple** profil × annonce, sur **10**, et produit `ai_assessment` :
- `reason` — adressé à l'**expert** ;
- `pitch_org` — adressé à l'**organisation**, et **affiché AVANT le déverrouillage payant**. D'où
  l'interdiction, dans le prompt, de nommer un employeur ou un client : **ce texte doit rester
  compatible avec le masquage**.

Cette note (`candidatures.ai_match_score`, bornée **[0,10]**) est une **autre grandeur** que le score
de pertinence du matching (`matches.relevance_score`, borné [0,1]). Les deux ne doivent **jamais**
être affichés côte à côte : ils répondent à deux questions différentes — *pourquoi ce profil
apparaît* / *que vaut ce dossier* — à deux moments différents.

**Quand le résumé n'est pas écrit, on sait pourquoi.** `ai_redaction_failures` distingue trois
causes — **plafond** de dépense atteint (un choix, pas une panne), **interrupteur** coupé, **erreur**.
`candidature_ai_health()` les confondait toutes en « sans jugement IA », et elles n'appellent pas la
même action.

**4. Il suit ses candidatures.** `/dashboard/{freelance,cdi}/candidatures`.
L'**état de vie est dérivé à la lecture**, côté serveur
([lib/candidatures/lifecycle.ts](lib/candidatures/lifecycle.ts)) : `status` est la **mécanique**,
l'état de vie est le **fait**. Une candidature `unlocked` dont la fenêtre de 15 j est passée
affichait « Échange ouvert » — un libellé menteur.
Deux buckets, **et toujours une raison nommée** : jamais un « Archivée » nu.
· actif — `selected`, `exchange_open`, `awaiting_review` ;
· archivé — `exchange_expired`, `publication_expired`, `publication_closed`, `rejected`, plus les
  vestiges `withdrawn` / `archived` (jamais écrits par le produit, couverts en lecture pour que
  d'éventuelles lignes historiques tombent dans un bucket honnête).
`until` porte la fin de la fenêtre encore ouverte — c'est le **seul** endroit où l'utilisateur
apprend qu'il a 15 j ou 30 j, **avant** que la fenêtre se ferme.
Le client **rend** la raison, il ne la calcule pas : il ne peut pas afficher actif ce que le serveur
dit archivé.
Le **point de vue diffère, pas l'état** : l'expert voit ses candidatures déposées, l'organisation ses
candidats reçus — le même module sert les deux côtés, sinon l'entreprise lirait « Échange ouvert »
sur ce que l'expert voit archivé.

> ⚠️ **ÉCART CONNU (§D.6).** L'expert **voit** `ai_match_score` sous la forme **`N/10`** sur
> `/dashboard/{freelance,cdi}/candidatures`
> ([CandidaturesTrackingView.tsx:291](components/dashboard/CandidaturesTrackingView.tsx#L291)) et
> dans le panneau de détail. Ce qu'il ne voit jamais, c'est le score de **pertinence**. La règle
> « l'expert ne voit jamais de note chiffrée » est donc **plus large que le code**.

---

### P1.5 — L'organisation lit, dévoile, échange

**1. Elle reçoit.** `/dashboard/entreprise/candidatures` et
`/dashboard/entreprise/annonces/[id]/candidatures`. Tri **serveur** par `ai_match_score` décroissant.

**2. Elle voit un CODE, pas un nom.** L'expert est affiché **`YCH`** — première lettre du prénom,
deux premières du nom, majuscules, sans espace ni point. Le calcul est **au serveur** : le navigateur
de l'entreprise ne reçoit **jamais** le nom complet.
Le format « trois majuscules » est un **signal de pseudonymisation** : il ne peut pas être confondu
avec un vrai nom, contrairement à l'ancienne forme « Prénom + lettre » qui ressemblait à une identité
tronquée. (Détail des cas limites : §D.4.)
Avant déverrouillage, elle dispose du `preview`, du `pitch_org` rédigé par Claude, et de la note sur
10 — de quoi décider, **sans identité**.

**3. Elle dévoile.** Deux chemins, **une seule mécanique** ([lib/unlock.ts](lib/unlock.ts),
idempotente) :
· **auto-dévoilement** du meilleur candidat à la création de la candidature — **sans quota** ;
· **dévoilement manuel** `POST /api/candidatures/[id]/unlock` — **sous quota**, refus **402
  `unlock_limit_reached`**.
Statuts acceptés en entrée : `received`, `in_review`, `shortlisted`.
Le dévoilement pose `unlocked_at`, ouvre une `conversation` avec
`expires_at = unlock + 15 jours`, et notifie l'expert (`candidature_unlocked`).

**Ce que le dévoilement donne — et ce qu'il ne donne jamais.**
[lib/expert-disclosure.ts](lib/expert-disclosure.ts) est la **seule** fonction de divulgation, et les
**cinq** surfaces qui projettent un profil expert vers une organisation la traversent : candidatures
agrégées, candidatures d'une annonce, sous-traitance, inbox, fil de messages. *Si une surface décide
encore seule, la faille reste ouverte.*
· dévoilé et **actif** → photo + nom complet ;
· **jamais** → `email`, `phone`, `linkedin_url`, `cv_url`. `reveal_contact` vaut `false` partout,
  toujours, même après paiement. Aucun chemin serveur ne les projette.

**4. Le dévoilement se REFERME.** Dès que la candidature bascule en **archivé**, le profil redevient
masqué au niveau strict d'avant déverrouillage. **L'état de vie prime sur le statut** : un
`status = 'unlocked'` figé en base ne rouvre rien.
Sans cette règle, une organisation pourrait publier, déverrouiller, laisser expirer, et **se
constituer une base de profils identifiés** — un détournement de la finalité du traitement.
Le **motif** de l'archivage est indifférent : expiration 30 j, clôture manuelle, retrait, fenêtre
d'échange close, refus. **Clôturer ses annonces plutôt que les laisser expirer ne contourne rien.**
**Exception : `selected`.** Un candidat **retenu** est actif **sans limite de durée** et ne se
re-masque jamais — la relation commerciale existe, le fait est acquis.
Ce qui se ferme est le **chemin d'accès permanent**, pas la trace : le corps des messages n'est pas
réécrit. On n'efface aucun historique, et on ne prétend pas l'avoir anonymisé. L'en-tête d'un fil
archivé, lui, re-masque.

**5. Elles échangent.** `/dashboard/entreprise/messages/[id]` ↔ `/dashboard/{freelance,cdi}/messages/[id]`.
Fenêtre **15 jours** à compter du déverrouillage
([lib/conversations/expiry.ts](lib/conversations/expiry.ts), source unique). Contrairement aux
annonces, `conversations.expires_at` **est réellement écrit** en base.
Fenêtre close → l'envoi est refusé **409**. La lecture reste possible : on ferme un chemin, on
n'efface pas.
Message : **5000 caractères** maximum (refus 400 `invalid_content`). Notification `new_message` par **e-mail uniquement** — décision
produit explicite : *une conversation compte 5 à 10 allers-retours ; un SMS par message sature le
destinataire pour ~0,08 € pièce.* Le canal SMS **n'existe pas** pour cet événement, l'écran de
réglages ne peut donc pas l'afficher.
L'aperçu de chaque fil et son compteur de non-lus sont calculés **en SQL, par conversation**. L'ancienne
version lisait les **500 derniers messages toutes conversations confondues** puis gardait le premier
vu par fil : au-delà de 500 messages cumulés, les conversations les moins récentes n'apparaissaient
dans **aucune** ligne lue. Ce n'était pas une troncature, c'était un résultat **faux** — un fil sans
aperçu se lit « personne n'a rien écrit », l'inverse de la vérité.

**6. Elle tranche.** `POST /api/candidatures/[id]/select` (→ `selected`, `selected_at`) ou
`/reject` (→ `rejected`, avec motif). Le refus **re-masque** immédiatement (bucket archivé).

### P1.6 — Le commerce, les offres, les quotas

**Rien n'encaisse aujourd'hui.** Le chemin de paiement est **construit, câblé et testable**, et il
est fermé par **deux verrous** (§D.1, §P4). Ce chapitre décrit ce qui existe, pas ce qui tourne.

**1. Le catalogue.** `packages` + `package_features`, édités dans `/admin/packages`.
Seed initial — **modifiable au back-office**, `ON CONFLICT DO NOTHING` et jamais `DO UPDATE` pour
qu'un redéploiement n'écrase pas une valeur ajustée :

| Offre | Prix/mois | Annonces/mois | Annonces actives | Candidats dévoilés/annonce | Dévoilements manuels/mois |
|---|---|---|---|---|---|
| **Free** (défaut) | — | 2 | 2 | 1 | 2 |
| **Business** | 349 € | illimité | 5 | illimité | illimité |
| **Elite** | 899 € | illimité | illimité | illimité | illimité |

Une offre applicable aux clients **et** aux cabinets est **une seule ligne** (`target_role = 'all'`) :
le seed initial les dupliquait, l'admin voyait chaque offre en double et devait éditer deux fois le
même prix.
Invariant **gardé en base** : l'offre par défaut est **gratuite**
(`packages_default_must_be_free`). La désigner se fait par la RPC `set_default_package()`, atomique
(§F).

**2. L'abonnement.** Il vit sur **`organizations`** — `package_id`, `package_started_at`,
`package_valid_until`, `stripe_subscription_id`, `stripe_subscription_status`,
`package_source_event_at` — et **plus** sur `organization_domains` (§B.2 ①).
**Un seul abonnement, un seul quota, partagés entre TOUS les écosystèmes.** Une organisation accède
à tous les écosystèmes actifs ; seules les **données** sont cloisonnées.
`usage_counters` n'a **délibérément pas** de `domain_id` dans sa clé : le quota partagé est **voulu**.

**3. Les droits, lus à la lecture.** [lib/entitlements.ts](lib/entitlements.ts) :
- `package_id` non nul **et** (`package_valid_until` nul **ou** futur) → cette offre ;
- sinon → l'offre `is_default` active couvrant le `target_role` de l'organisation (mapping
  `esn` → `cabinet`), la ligne spécifique primant sur la ligne `'all'`.

**L'expiration est décidée À LA LECTURE. Aucun batch, aucun cron.**
**Fail-open assumé** sur toute la couche Droits : un moteur commercial en panne ne bloque **jamais**
l'usage produit (limite `null` = illimité, `console.warn`). ⚠️ **Ne pas « corriger » en fail-closed :
c'est un choix délibéré, pas un oubli.**

**4. La consommation.** `usage_increment()` — un seul `INSERT … ON CONFLICT DO UPDATE` sous garde de
limite (§F). Période = mois civil pour les compteurs mensuels, epoch (`1970-01-01`) pour les
compteurs `never`.

**5. Le parcours d'achat** (fermé, cf. §P4).
`/dashboard/entreprise/offre` → `/api/billing/offers` → `/api/billing/checkout` → Stripe →
`/api/billing/return`. Ensuite `/api/billing/portal` (portail client) et `/api/billing/change-plan`.
**Checkout HÉBERGÉ, jamais de formulaire intégré** : aucune donnée de carte ne touche ce serveur ni
notre DOM. Le périmètre PCI-DSS reste le plus léger, et le SDK navigateur a été **retiré des
dépendances**.
Cette route **n'accorde aucun droit** : elle rend une URL. **Les droits viennent du webhook, et de
lui seul.**

**6. Le webhook.** `/api/stripe/webhook` — **la seule route de l'application sans `requireAuth`**, et
ce n'est ni un oubli ni à corriger : l'appelant est Stripe, il n'a ni session, ni jeton, ni domaine.
L'authentification est la **signature cryptographique** du corps.
- Corps lu **brut** (`await request.text()`, **jamais** `.json()`) : la signature est un HMAC des
  **octets exacts**. Un JSON désérialisé puis re-sérialisé est un autre texte — c'est le piège n°1
  des webhooks Stripe, et il échoue de façon intermittente et incompréhensible.
- **Idempotence par contrainte de base** : `stripe_event_claim()` est un `INSERT … ON CONFLICT` dont
  la clé primaire **est** l'identifiant Stripe. Deux livraisons simultanées sont sérialisées par le
  verrou de ligne PostgreSQL.
- Un événement `livemode` arrivé sur un environnement hors production est **ignoré** (journalisé,
  **200**) : on ne fait pas échouer l'endpoint, Stripe le désactiverait.
- **Ce n'est pas un batch** : c'est une requête HTTP entrante déclenchée par un fait. C'est même ce
  qui **évite** de balayer périodiquement les abonnements pour savoir qui a payé. La règle « zéro
  batch, zéro cron d'hébergeur » est tenue.

**7. Ce que l'organisation voit.** Le montant **PRÉLEVÉ**, lu dans `transactions` — **jamais** le
prix du catalogue. Les `Price` Stripe sont **immuables** : une organisation abonnée à 349 € y reste
quand le catalogue passe à 399 €, et lui montrer 399 € serait un litige commercial en puissance.

**8. L'attribution manuelle.** `/admin/organisations/[id]` → `POST /api/admin/assign-org-package`,
pour les comptes **pilotes**. Elle **refuse** (409 `org_has_stripe_subscription`) de passer par-dessus
un abonnement Stripe vivant : sinon l'offre changerait sans facturation ni remboursement, puis le
prochain événement Stripe la réécrirait — l'admin verrait son geste s'annuler seul, sans explication.
Le refus est **au serveur** : griser un bouton ne garderait rien.

**9. La synchronisation du catalogue.** La synchro vers Stripe **précède** l'écriture locale : son
échec la **refuse**, avec un message explicite. Sinon Skilloria afficherait 399 € pendant que Stripe
prélève 349 €, et personne ne le verrait — les deux côtés fonctionnent parfaitement, séparément.
Les clés d'idempotence sont **dérivées et stables** (§F) : deux synchros concurrentes ne créent plus
deux produits.

---

## P2. Les écrans qui existent

### P2.1 — Public (hors session)
| Écran | À quoi il sert |
|---|---|
| `/` | Accueil de l'écosystème servi par le sous-domaine (branding, couleurs, libellés, produits mis en avant). |
| `/qui-sommes-nous` · `/contact` | Présentation ; formulaire de contact. |
| `/inscription` · `/inscription/[role]` · `/inscription/confirmation` | Inscription expert (branche + spécialité **structurées**, CGU horodatées, OTP téléphone). |
| `/inscription/organisation` (+ `/confirmation`) | Inscription organisation (SIREN/numéro, vérification à suivre). |
| `/connexion` · `/mot-de-passe-oublie` · `/nouveau-mot-de-passe` · `/auth/callback` | Session. |
| `/invitation/[token]` | Acceptation d'une invitation à rejoindre une organisation. |
| `/reactivation` | Réactivation d'un compte pendant la grâce de 90 j. |
| `/ecosysteme-indisponible` | **Un écran par motif de refus d'écosystème** — et non un « accès refusé » nu : un expert égaré lit *votre écosystème est celui-ci, voici l'adresse*. |
| `/cgu` · `/mentions-legales` · `/politique-de-confidentialite` | Documents légaux, servis depuis `docs/legal/*.md`. |

### P2.2 — Expert freelance et expert CDI
**Parité vérifiée : 14 écrans de chaque côté, aucun manquant ni d'un côté ni de l'autre.**

| Écran (× 2 : `/dashboard/freelance/…` et `/dashboard/cdi/…`) | À quoi il sert |
|---|---|
| *(index)* | Tableau de bord : missions recommandées, candidatures, badges, état du profil. |
| `missions` · `missions/[id]` | Le flux des opportunités, ordonné par pertinence, **sans aucun nombre affiché** — deux paliers. Décliner s'y fait. |
| `candidatures` · `candidatures/[id]` | Suivi des candidatures, par **état de vie dérivé** avec sa raison. ⚠️ **Affiche `N/10`** (§D.6). |
| `messages` · `messages/[id]` | Messagerie, fenêtre 15 j. |
| `profil` · `profil/valider` | Saisie du profil et dépôt du CV ; lancement de la vérification. |
| `mon-profil` | Le profil **tel que l'organisation le verra**. |
| `sous-traitance` · `sous-traitance/nouveau` · `sous-traitance/[id]` | Publier un besoin et recevoir des experts (via l'organisation personnelle, §P1.2 bis). |
| `parametres` | Compte, langue, notifications, sessions, suppression. |

> **Dette de parité SIGNALÉE DANS LE CODE, pas dans les écrans.** La parité de *surface* est
> complète, mais quatre fichiers portent un `TODO post-merge V1+V3 : factoriser` —
> [lib/cv-parser-cdi.ts](lib/cv-parser-cdi.ts),
> [app/api/profile/cdi-upload-cv/route.ts](app/api/profile/cdi-upload-cv/route.ts),
> `app/[locale]/dashboard/cdi/profil/page.tsx`, `…/profil/valider/page.tsx`.
> **Deux copies dérivent** : c'est le risque de parité réel de ce projet, et il est dans le code, pas
> dans la liste des écrans.

### P2.3 — Organisation (client, cabinet, ESN — un seul dashboard)
`client`, `cabinet` et `esn` partagent **`/dashboard/entreprise`**. `/dashboard/cabinet` est une
**redirection** conservée pour les anciens signets — pas un écran.

| Écran | À quoi il sert |
|---|---|
| `/dashboard/entreprise` | Tableau de bord : annonces, candidatures reçues, compteurs. |
| `annonces` · `annonces/nouvelle` · `annonces/[id]` · `annonces/[id]/modifier` | Cycle de vie d'une annonce. |
| `annonces/[id]/candidatures` | Les candidats d'une annonce, triés serveur, **masqués** avant dévoilement. |
| `candidatures` | Toutes les candidatures reçues, toutes annonces confondues. |
| `messages` · `messages/[id]` | Messagerie avec les experts dévoilés. |
| `membres` | Membres, rôles (`admin`/`editor`/`viewer`), invitations. |
| `organisation` | Fiche et statut de vérification de l'organisation. |
| `offre` | Offre en cours, consommation, parcours d'achat (**mur fermé**, §P4). |
| `parametres` | Compte et préférences du membre. |

> **Asymétrie d'écrans, VÉRIFIÉE et VOULUE** : l'expert a `mon-profil` (se voir comme l'autre le
> voit) ; l'organisation n'a **pas** d'équivalent. Ce n'est pas un oubli de parité — l'organisation
> n'est pas *regardée* par les experts de la même façon.

### P2.4 — Administration
| Écran | À quoi il sert |
|---|---|
| `/admin` | Tableau de bord plateforme. |
| `utilisateurs` · `utilisateurs/[id]` | Comptes : statut, rôle d'organisation, sessions, purge, ré-invitation. |
| `experts` · `experts/[id]` | Modération des vérifications d'experts (approuver / refuser avec motif). |
| `organisations` · `organisations/[id]` | Modération des organisations ; attribution manuelle d'offre ; consommation. |
| `packages` · `packages/new` · `packages/[id]` | Catalogue commerce : offres, limites, offre par défaut, synchro Stripe. |
| `matching` | Les **deux seuils** par écosystème, le modèle de reranking, la taille de lot, `notify_enabled` ; pannes de rédaction et dépassements de relance. |
| `quotas-ia` | Les quotas anti-abus IA (analyses de CV). |
| `taxonomie` · `taxonomie/[id]` | Branches et spécialités, et leurs traductions. |
| `ecosystemes` · `ecosystemes/[id]` | Créer un écosystème, le traduire, l'ouvrir — **et dire ce qui manque**. |
| `taches-planifiees` · `taches-planifiees/[job_name]` | Supervision pg_cron : activer/désactiver, reprogrammer, déclencher, historique. |
| `collaboration` | Les organisations personnelles d'experts. |

| `seuils` | **Les seuils de jugement** : auto-approbation d'expert, vérification d'entreprise, qualité d'annonce — par pays et par type. Dit **ce que chaque seuil produit**, montre la colonne inerte **comme inerte**, et **journalise** chaque modification. |

> **§P2.4 a longtemps dit « il n'existe aucun écran pour `verification_providers` ». C'est désormais
> FAUX** : [/admin/seuils](app/[locale]/admin/seuils/page.tsx) existe, et §P3.3 le reflète.
> Ce qui reste vrai : **`ai_spend_caps` n'a toujours aucun écran** — seule la *dépense* du mois est
> affichée, sur `/admin/matching`, sans son plafond à côté.

---

## P3. Les règles métier, rassemblées

Pour chacune : **sa valeur**, **d'où elle vient**, **qui peut la changer**.
« Back-office » = un écran `/admin` l'expose. « Base » = la valeur est en base mais **aucun écran ne
l'expose**. « Code » = un déploiement est nécessaire.

### P3.1 — Commerce et quotas
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Annonces par mois | Free 2 · Business ∞ · Elite ∞ | `package_features` | **Back-office** `/admin/packages` |
| Annonces actives simultanées | Free 2 · Business 5 · Elite ∞ | `package_features` | **Back-office** |
| Candidats dévoilés par annonce | Free 1 · Business ∞ · Elite ∞ | `package_features` | **Back-office** |
| Dévoilements manuels / mois | Free 2 · Business ∞ · Elite ∞ | `package_features` | **Back-office** |
| Prix | 0 / 349 € / 899 € | `packages.price_monthly` | **Back-office** (+ synchro Stripe) |
| Offre par défaut | Free | `packages.is_default`, RPC `set_default_package()` | **Back-office** |
| Invariant « l'offre par défaut est gratuite » | — | contrainte `packages_default_must_be_free` | **Personne** — migration |
| Sièges maximum | **inactif** | `packages.max_seats` | **Personne** (§P4) |

### P3.2 — Moteur de mise en relation
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Seuil d'entrée dans le flux | **0** (tout profil éligible entre) | `matching_settings.feed_threshold` | **Back-office** `/admin/matching` |
| Seuil de notification | **1** | `matching_settings.notify_threshold` | **Back-office** |
| Notifications actives | **`false`** | `matching_settings.notify_enabled` | **Back-office** (§P4) |
| Modèle de reranking | `rerank-v4.0-fast` | `matching_settings.rerank_model` | **Back-office** |
| Taille de lot | 200 (borne 1–1000) | `matching_settings.rerank_batch_size` | **Back-office** |
| Contrainte `notify_threshold ≥ feed_threshold` | — | CHECK en base | **Personne** — migration |
| Plafond de dépense mensuel | rerank 200 $ · claude 100 $ | `ai_spend_caps` | **Base** (aucun écran) |
| Coût unitaire retenu | 0,000002 $/document | **Code** `lib/matching/rerank.ts` | Déploiement |
| Lots en parallèle | 4 | **Code** | Déploiement |
| Délai fournisseur | 10 s | **Code** | Déploiement |
| Délai de relance | **60 min** | **Code** `DELAI_RELANCE_MINUTES` | Déploiement |
| Attente totale bornée | **6 h** | **Code** `ATTENTE_MAX_HEURES` | Déploiement |
| Plafond de programmation de relance | **20 / h / expert** | **Code** `RELANCE_MAX_PAR_HEURE` | Déploiement — **volontairement non réglable** (§D.7) |
| Pagination du vivier | 1000 lignes · 200 identifiants | **Code** | Déploiement |

### P3.3 — IA et contenus
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Analyses de CV | **3 / 24 h** | `ai_quotas` | **Back-office** `/admin/quotas-ia` |
| Taille de CV | 5 Mo, PDF | **Code** | Déploiement |
| Seuil qualité d'annonce | **7 / 10** | `verification_providers` (`opportunity_quality_check`) | **Back-office** `/admin/seuils` |
| Seuil d'auto-approbation d'expert | **8 / 10** | `verification_providers.config->>'auto_approve_threshold'` — **le jsonb, PAS la colonne** | **Back-office** `/admin/seuils` |
| Drapeaux disqualifiants d'expert | `CV_PROFILE_INCOHERENT`, `SUSPICIOUS_CONTENT`, `DOMAIN_MISMATCH` | `verification_providers.config->>'blocking_flags'` | **Back-office** `/admin/seuils` — liste vide **refusée** |
| `verification_providers.confidence_threshold` sur la ligne expert | 7 — **lue puis JAMAIS utilisée** par le chemin expert | colonne | — |
| Seuil de vérification d'entreprise | **7 / 10** (`ai_coherence_check`) | `verification_providers.confidence_threshold` | **Back-office** `/admin/seuils` |
| Ligne absente pour un pays | **refus explicite**, revue manuelle, aucun appel IA | **Code** — plus aucun repli (§E.11) | — |
| « Jamais d'auto-rejet » | — | **Code** — règle métier | Arbitrage |
| Résumé de profil | **200–800 caractères** | **Code** `lib/profile-visibility.ts` | Déploiement |
| Document envoyé au moteur | 25 compétences · 6 expériences · 300 car. chacune | **Code** | Déploiement |
| Message de conversation | **5000 caractères** | **Code** `MAX_CONTENT_LEN` | Déploiement |
| Texte rendu par Claude (reason, pitch_org) | **400 caractères** | **Code** `MAX_CARACTERES_TEXTE` | Déploiement |

### P3.4 — Délais et cycles de vie
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Durée de vie d'une annonce | **30 j**, calculés **à la lecture** | **Code** `lib/publications/expiry.ts` | Déploiement |
| Fenêtre d'échange | **15 j** depuis le dévoilement, **écrits** en base | **Code** `CONVERSATION_TTL_DAYS` | Déploiement |
| Grâce avant suppression définitive | **90 j** | **Code** `GRACE_DAYS` | Déploiement |
| Avertissement d'inactivité | **23 mois** | **Code** `WARNING_MONTHS` | Déploiement |
| Purge d'inactivité (CNIL) | **24 mois** | **Code** `PURGE_MONTHS` | Déploiement |
| Rétention du détail d'exécution cron | 90 j (`response_body`) | migration `cron_run_log_retention` | Migration |
| Horaires des tâches planifiées | cf. §P3.6 | `cron.job` | **Back-office** `/admin/taches-planifiees` |

### P3.5 — Sécurité et abus
| Règle | Valeur | Origine | Qui peut la changer |
|---|---|---|---|
| Session unique par utilisateur | — | `users.last_session_token` (sha256) | Arbitrage |
| OTP : envois par numéro | **1 / 60 s** et **3 / h** (public) · **5 / h** (connecté) | **Code** | Déploiement |
| OTP : envois par IP | **10 / h** (public) | **Code** | Déploiement |
| « 1 numéro vérifié = 1 compte » | — | index UNIQUE PARTIEL sur `users(phone)` | Migration |
| Le dernier administrateur d'une organisation | ne peut pas se retirer | policies `organization_members` | Migration |
| Contact expert (`email`/`phone`) | **jamais exposé**, même après paiement | **Code** `reveal_contact: false` | Arbitrage |

### P3.6 — Les huit tâches planifiées (pg_cron, plus aucun cron d'hébergeur)
| Tâche | Horaire | Ce qu'elle fait |
|---|---|---|
| `purge_deletions_trigger` | 03:00 | Efface les comptes dont la grâce de 90 j est échue (RGPD art. 17). |
| `purge_inactive_trigger` | 03:30 | Avertit à 23 mois, purge à 24 (CNIL recrutement). |
| `cron_run_reconcile` | 03:15 et 03:45 | Recoupe le journal applicatif et `cron.job_run_details`. |
| `cron_run_log_purge` | 04:10 | Applique la rétention dissociée du journal. |
| `rate_limit_hits_purge` | 04:00 | Purge les compteurs de débit. |
| `matching_retry_trigger` | toutes les 5 min | Reprend les runs de matching inachevés. |
| `expert_relance_trigger` | toutes les 5 min | Exécute les relances arrivées à échéance. |
| `matching_notes_partielles_purge` | 04:30 | Purge les brouillons de notation soldés. |

> Une tâche **invisible** a déjà tourné des mois sans que personne sache ce qu'elle faisait :
> planifiée en SQL inline, absente du journal applicatif et de la liste codée en dur. D'où
> `cron_job_catalog`, qui **nomme** chaque tâche.
> Et `/admin/taches-planifiees` **ne reçoit jamais d'expression cron** : pg_cron valide la **forme**
> (cinq champs), pas la **satisfaisabilité** — `0 3 30 2 *` (30 février) est acceptée et ne se
> déclenchera **jamais**, sans erreur ni ligne d'exécution. La purge CNIL s'arrêterait en silence.
> L'écran reçoit donc des **composants typés et bornés**.

### P3.7 — Les règles EN DUR qui devraient être réglables
Nommées, comme demandé. Chacune exige aujourd'hui un **déploiement** :

1. **Durée de vie d'une annonce (30 j)** et **fenêtre d'échange (15 j)** — deux règles que
   l'utilisateur voit, que le commerce pourrait vouloir différencier par offre, et qui vivent en
   constantes de code. Ce sont les plus mûres pour un passage en base.
2. **Grâce de suppression (90 j)**, **avertissement (23 mois)**, **purge (24 mois)** — contraintes
   légales, donc stables ; mais les rendre lisibles depuis un écran servirait le registre RGPD.
3. ~~Seuils de `verification_providers`~~ — **CLOS.** `/admin/seuils` les règle, borne **au serveur**
   (entier, 0–10), **refuse** d'écrire une clé que le chemin ne lit pas, refuse une liste de drapeaux
   vide, et **journalise** qui a changé quoi, depuis quelle valeur et depuis quelle adresse. La
   valeur réelle du seuil expert est **8**, dans le jsonb — ni 9, ni la colonne.
4. **Plafonds de dépense IA** (`ai_spend_caps`, 200 $ / 100 $) — en base, aucun écran, alors que
   c'est un réglage d'argent que `/admin/matching` affiche déjà à côté.
5. **Limites de l'OTP** (1/60 s, 3/h, 10/h par IP) — anti-abus, donc légitimement en code, selon le
   même raisonnement que le plafond de relance (§D.7).
6. **Taille de CV (5 Mo)**, **longueur de message (5000)**, **bornes du résumé (200–800)** — bornes de
   produit, en code. Les deux dernières sont **liées au moteur** (au-delà de 800, le texte n'est plus
   lu) : les rendre réglables sans rappeler ce lien serait un piège.

---

## P4. Ce qui est volontairement inactif

**Lisez cette section avant de « réparer » quoi que ce soit ici.** Chacun de ces quatre points
ressemble à un oubli et n'en est pas. Les retirer coûterait le travail déjà fait ; les activer sans
arbitrage coûterait de l'argent ou de la crédibilité.

### P4.1 — Le mur payant, derrière ses deux verrous
**Pourquoi c'est là.** Le lancement est **gratuit** et la date d'ouverture des abonnements **n'est
pas fixée**. Le chemin de paiement est entièrement construit pour être relu et éprouvé **avant**
d'être ouvert, pas écrit dans l'urgence le jour de l'ouverture.

**Comment c'est fermé** ([lib/billing/config.ts](lib/billing/config.ts)) :
① la **clé Stripe scopée par environnement** — absente ⇒ 503 ; et le contrôle va **dans les deux
sens** : une clé de **test en production** ferait croire aux clients qu'ils paient, une clé **live
hors production** débiterait de **vraies cartes** pendant les tests. Les deux sont refusées durement.
② l'**interrupteur `ENABLE_BILLING`**, qui doit valoir exactement `'true'`.
**Aucune variable `NEXT_PUBLIC_`** : le verrou serait lisible dans le bundle, et surtout l'UI pourrait
diverger du serveur. L'UI apprend l'état du mur par une **réponse serveur**.

**Ce qu'il faudra décider le jour de l'activation :**
- poser les **deux** variables, sur le **bon** environnement (deux gestes distincts et délibérés :
  c'est le but) ;
- créer l'endpoint webhook côté Stripe et récupérer **son** `STRIPE_WEBHOOK_SECRET` — il y en a un
  **par endpoint**, celui de test et celui de production sont **différents** ;
- synchroniser le catalogue **avant** d'ouvrir, pour qu'aucune offre ne soit sans `price` Stripe ;
- décider du sort des organisations déjà en **attribution manuelle** : le garde-fou refuse d'écraser
  un abonnement Stripe, l'inverse n'est pas gardé ;
- surveiller les `stripe_events` **bloqués en `received`** — un crash avant marquage bloque tous les
  réessais. C'est **délibéré** (mieux vaut un événement non appliqué et visible qu'un double crédit),
  mais **rien ne l'automatise** : `idx_stripe_events_status` est le seul moyen de les voir.
- La marche à suivre pour le premier paiement est écrite dans
  [docs/stripe-premier-paiement.md](docs/stripe-premier-paiement.md).

### P4.2 — Le canal SMS de notification, coupé au dispatcher
**Pourquoi c'est là.** Il n'a **jamais** été coupé, et ça a coûté : en production, **chaque
candidature déposée envoyait un SMS Vonage payant à tous les membres de l'organisation au téléphone
vérifié** — le filtre était une préférence en **opt-out** dont l'absence valait « activé », et les
interrupteurs avaient été retirés des écrans : personne ne pouvait s'en désinscrire.

**Comment c'est fermé.** `CANAUX_OUVERTS = ['email']`, **un seul point**, fermé par défaut. Couper
événement par événement laisserait le **prochain** événement ajouté repartir tout seul, par recopie
de `channels: ['email','sms']`.
**Les OTP ne passent pas par là** : autre API Vonage (Verify v2), appelée directement par les routes
d'auth. Les deux chemins n'ont **aucun point commun** — fermer celui-ci ne peut pas casser
l'inscription.
Le code V2 est **conservé délibérément** : `runChannel`, le gabarit SMS, `lib/sms/vonage.ts` et les
branches `channel === 'sms'` sont **inatteignables à l'exécution**. Ce n'est pas du code mort oublié.

**Ce qu'il faudra décider :**
- basculer le défaut de préférence en **opt-in** — aujourd'hui l'**absence de ligne** dans
  `notification_preferences` vaut **activé** ;
- **rendre les interrupteurs aux écrans** avant de rouvrir, pas après ;
- accepter le coût : ajouter `'sms'` à cette constante **réactive une dépense sortante
  immédiatement**, sur tous les événements qui le déclarent, sans autre changement.

### P4.3 — Les notifications de mise en relation, éteintes sur chaque écosystème
**Pourquoi c'est là.** `notify_enabled` vaut **`false` par défaut**, et `feed_threshold` vaut **0**.
Ce n'est pas une panne : c'est un refus de deviner.
Le score d'un reranker **n'est pas calibré** — le fournisseur écrit noir sur blanc qu'on ne peut ni
lire 0,91 comme « deux fois 0,44 », ni comparer les scores de deux requêtes. **7/10 sur l'échelle de
Claude ne vaut donc pas 0,7 ici : il n'existe aucune traduction.**
Les valeurs de départ sont choisies pour ne **rien casser** : `feed_threshold = 0` n'écarte **aucun**
expert par un nombre choisi au hasard (ce que la règle figée interdit), et `notify_enabled = false`
ne notifie personne. *Un moteur qui notifie 12 000 personnes sur un seuil deviné est pire qu'un
moteur qui ne notifie pas encore.*

**Ce qu'il faudra décider :** lire la **distribution réelle** des scores (`matching_stats`,
`matching_threshold_health()`), régler les deux seuils **sur les faits**, puis basculer
`notify_enabled` — **par écosystème**, depuis `/admin/matching`. Le levier est « montrer plus,
notifier moins ».

### P4.4 — `packages.max_seats` : affiché, et sans effet
**Pourquoi c'est là.** La colonne existe en base et **n'est lue par aucune garde** : la poser à 5 ne
limite rien. Un réglage qui ne règle rien est exactement le défaut corrigé ailleurs.
On ne retire pas la colonne — **la facturation au siège est prévue à l'ouverture des abonnements**,
c'est une fondation, pas un vestige.

**Comment c'est neutralisé.** Le champ est **visible et inactif** dans `/admin/packages/[id]`, avec
un libellé qui le dit. **Caché, il aurait été renseigné depuis la base par quelqu'un qui aurait cru
poser une limite.** Et c'est **en lecture seule au SERVEUR aussi** : `update-package` ne le lit pas —
désactiver l'`input` ne garde rien à lui seul.

**Ce qu'il faudra décider :** ce que « siège » signifie (membre actif ? invité compris ?), ce qui se
passe au dépassement (refus d'invitation ? facturation au prorata ?), et **quelle garde** le lit —
côté invitation **et** côté acceptation, sinon la limite se contourne par le second chemin.

### P4.5 — Et ce qui n'est PAS volontairement inactif, pour lever le doute
- `reveal_contact` est un **point d'extension conçu mais non branché** — pas un interrupteur. Le
  packaging commerce qui l'ouvrirait **n'existe pas**, et §D.4 dit qu'il reste `false` **toujours**.
- `lib/database.types.ts` **n'est pas un choix** : c'est un filet périmé et débranché (§E.1, §H).
- `scripts/diag.mjs` **n'est pas désactivé** : il est **cassé et inachevé**, et retiré de
  `package.json` pour cesser de piéger.

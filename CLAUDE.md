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
> §E (`docs/pieges.md`) · une course fermée en base → §F · une convention de travail → §G · une dette assumée → §H.
>
> **Une affirmation non vérifiable dans le dépôt ne s'écrit pas ici**, ou se marque **NON VÉRIFIÉ**.
> Une mémoire fausse est pire qu'une mémoire absente : elle se cite.
>
> Les sections anglaises ci-dessous contiennent des énoncés **PÉRIMÉS**, signalés sur place et
> récapitulés en **§M0**.
>
> **LA MÉMOIRE TIENT EN QUATRE FICHIERS.** Celui-ci est le seul chargé à chaque session — et il a
> un **budget : 100k caractères**, gardé par un contrôle (au-delà de 150k, Claude Code le tronque
> sans dire quelle section manque).
>
> · **CLAUDE.md** *(ici)* — règle de maintenance, conventions, §M0/§M1, **§D** décisions figées,
>   **§G** règles entre worktrees, et l'**index** des pièges.
> · **[docs/pieges.md](docs/pieges.md)** — **§E** : les pièges vérifiés, un par section, avec leur
>   cas mesuré et leur contrôle. Sorti d'ici le 20/09/2026 quand ce fichier a dépassé la limite.
> · **[docs/produit.md](docs/produit.md)** — **§P1 à §P4** : les parcours, les écrans, les règles
>   métier chiffrées, ce qui est volontairement inactif.
> · **[docs/architecture.md](docs/architecture.md)** — **§A, §B, §C, §F, §H** : le modèle de données
>   et son histoire, les chaînes de bout en bout, la classe « lire puis écrire », la dette ouverte.
>
> **Par où entrer, selon ce que vous cherchez :**
> · *Je reprends le projet, ou j'y reviens après des mois* → **[docs/produit.md](docs/produit.md)**.
> · *Je vais toucher au code et je veux savoir où je mets les pieds* →
>   **[docs/architecture.md](docs/architecture.md)**, et **[docs/pieges.md](docs/pieges.md)** avant
>   d'écrire un diagnostic — l'index §E ci-dessous dit lesquels lire d'abord.
> · *Je cherche une décision déjà arbitrée* → **§D ci-dessous**, puis **§P4** (produit) pour ce qui
>   est éteint exprès.
> · *Je cherche une valeur chiffrée et qui peut la changer* → **§P3** (produit).

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
> État de référence : branche `feat/sprint-archi-orga`, commit `1337324` (2026-09-16).
> **Relue ligne à ligne contre le code le 16 septembre 2026** — 18 écarts trouvés et corrigés,
> récapitulés en §M1. Ce qui n'était pas vérifiable est marqué **NON VÉRIFIÉ**, en toutes lettres.

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

## M1. La relecture du 16 septembre 2026 — les 18 écarts trouvés

Ce fichier a été écrit depuis ce que l'on croyait savoir, puis relu **ligne à ligne contre le code**.
Dix-huit affirmations étaient fausses ou périmées. Elles sont corrigées sur place ; ce tableau
existe pour une seule raison : **chaque écart dit quelque chose sur la façon dont on se trompe.**

| # | Ce qui était écrit | Ce que le code dit | Famille |
|---|---|---|---|
| 1 | §P1.2 — vérification d'entreprise : « défaut **9** sur 10 » | **7**, sur la ligne `ai_web_search`. Le 9 est celui de `sirene_insee`, **jamais lu** | colonne inerte |
| 2 | §P3.5 — dernier admin d'org : « policies `organization_members` » | **trigger** `organizations_cliquet_siege_admin` + RPC | origine fausse |
| 3 | §C.6 / §P1.6 — « la **seule** route sans `requireAuth` » | **18 routes sur 128**. La bonne phrase : la seule qui **accorde des droits** sans identité | règle trop large |
| 4 | §C.5 — « les **cinq** surfaces la traversent » | 5 écrans, **4 chemins** : la sous-traitance emprunte la route des candidatures d'annonce | règle trop large |
| 5 | §B.1 — inventaire des tables | **18 tables sur 64 manquaient**, dont `branches` et `specialities` | inventaire incomplet |
| 6 | §B.1 — rien sur les tables mortes | **11 tables** ne sont lues ni écrites par aucune ligne de `app/` ou `lib/` | silence trompeur |
| 7 | §F — table des garanties de concurrence | **six manquaient**, toutes de la classe que §F recense | inventaire incomplet |
| 8 | (nulle part) — le **bail de run** | `cron_run_leases` ferme un chevauchement **structurel** qui faisait repayer le même travail d'IA | mécanisme absent |
| 9 | (nulle part) — le **siège admin plateforme** | table `plateforme` + `cliquet_siege_admin()` | mécanisme absent |
| 10 | §P2.4 — écran `/admin/ecosystemes/[id]` | **n'existe pas** : panneau dans la liste, seule la route API porte ce chemin | écran fantôme |
| 11 | §P2.4 — `/admin/durees` | livré au lot 3, **absent du tableau** | oubli de maintenance |
| 12 | §P3.1 — trois offres | **quatre** : `Collaboration` (1/1/1/**0**) gouverne l'organisation personnelle d'un expert | inventaire incomplet |
| 13 | §P3.1 — « offre par défaut : Free » | **deux** défauts, un par cible | imprécision |
| 14 | §P3.6 — « `cron_job_catalog` **nomme chaque** tâche » | **5 sur 8**. Les trois du moteur sont muettes à l'écran — **corrigé depuis** : les huit sont nommées | le défaut qu'on prétend fermé |
| 15 | §E.3 — « en tête de **32** scripts » | **50** sur 71 | chiffre vieilli |
| 16 | §E.11 — « **438** fichiers » | **445** | chiffre vieilli |
| 17 | §E.12 — « **51** migrations, **35** insertions, **1913** valeurs » | **61 / 38 (sur 50 vues) / 1944** | chiffre vieilli |
| 18 | §F — « `verrou_run_et_unicite_notifications` n'est **pas** sur le tronc » | elle y est | affirmation périmée |

**Ce que ces dix-huit écarts ont en commun.** Aucun n'était un mensonge : chacun était **vrai le jour
où il a été écrit**, ou tiré d'une lecture trop rapide. C'est ce qui les rend dangereux — ils se
citent, et rien dans le fichier ne dit depuis quand ils n'ont pas été vérifiés.

**Deux fois pendant cette relecture, le piège §E.7 s'est refermé sur le relecteur lui-même** : un
`grep` a trouvé `disclosurePolicyForCandidatureLifecycle` dans un **commentaire** de
`lib/admin/user-actions-guard.ts` (faux sixième consommateur), et `requireAuth` dans le
**commentaire** de `stripe/webhook` qui énonce précisément la règle contestée. **Un contrôle, pas une
promesse de vigilance** : §E.16.

---

### M1 bis — La fusion de `feat/s2`, et comment la collision a été tranchée

Le 17/09/2026, `feat/s2` a été fusionné dans le tronc. **Les deux côtés avaient écrit dans la mémoire
du projet le même jour, sans se voir**, et les deux avaient raison. Résolution **en union** : aucune
section n'a disparu, aucune n'a été arbitrée.

**La collision.** Les deux côtés ont écrit un **§E.16**. Celui du tronc garde son numéro — il était
déjà cité **cinq fois** dans le fichier découpé ; ceux de `feat/s2` deviennent **§E.17** (l'URL
saisie servie à `<img src>`) et **§E.18** (l'embed ambigu). Leurs renvois internes ont suivi.
**On renumérote, on ne choisit pas.**

**Le replacement.** `feat/s2` a écrit contre le fichier **monolithique**, avant le découpage. Ses
sections ont donc été **replacées**, jamais empilées en fin de fichier : §D.8 dans §D et §E.17/§E.18
dans §E (aujourd’hui `docs/pieges.md`) ; §P1.2 (« 2 bis »), §P2.3, §P2.4, §P3.3 et §P3.5 dans
[docs/produit.md](docs/produit.md), chacune à sa place dans son tableau.

**La seule ligne non reprise telle quelle, et pourquoi.** `feat/s2` écrivait
`` | `ecosystemes` · `ecosystemes/[id]` | `` — or §M1 n°10 a **établi par mesure** que
`/admin/ecosystemes/[id]` n'existe pas : le détail est un panneau dans la page de liste. La ligne
fusionnée porte **toute** la substance de `feat/s2` (logo, favicon, bucket public, chemin dérivé de
`domain_id`, disparition de la saisie d'URL) **et** la correction du tronc. Reprendre la mention de
l'écran aurait réintroduit l'erreur que §M1 venait de fermer — vérifié par mutation :
`diag-memoire-exacte` rougit dessus.

**Les quatre `messages/*.json` se sont fusionnés seuls**, et la fusion est l'**union exacte** des
deux côtés : 3133 clés à la base, +21 côté tronc, +26 côté `feat/s2`, **3180** après fusion, parité
exacte sur les quatre langues. Deux clés ont disparu — `field_logo_url` et `logo_url_help` — parce
que `feat/s2` les a **délibérément supprimées** en remplaçant la saisie d'URL par un téléversement.
Une suppression voulue n'est pas une perte ; elle est vérifiée comme telle, pas supposée.


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

**D.8 — L'organisation PERSONNELLE d'un expert n'a PAS de logo, et c'est délibéré.**
L'organisation `org_type = 'freelance'` est **technique** : elle existe parce que
`publications.organization_id` est `NOT NULL` (§P1.2 bis). Le bucket `org-logos` et ses policies la
couvrent **sans exception** — une exception dans une policy est une dette — mais **aucune surface
d'édition** ne lui est ouverte, et son état vide reste les **initiales** de `company_name` (qui vaut
« Prénom Nom » de l'expert).

Le motif, pour que personne ne prenne ça pour un oubli et ne l'ouvre :
1. **L'expert a DÉJÀ une image, et elle est protégée.** `profiles.photo_url` est servie par URL
   signée **sous la gate de dévoilement** (`reveal_photo`). Un logo d'organisation personnelle serait
   une **seconde image de la même personne, SANS gate**.
2. **Ce serait donc un contournement du masquage**, sur la surface exacte où il compte : les cartes
   de casting ne masquent que sur `pub.confidential`. Un expert annonceur pourrait poser sa propre
   photo en « logo » et la faire voir hors de toute gate.
3. Lui donner une identité visuelle propre reviendrait à en faire une vraie entité — et il faudrait
   alors lui construire un écran dans un dashboard où elle n'a pas sa place.

Décision prise par Youssef, sur les trois arguments ci-dessus. **Rouvrir ce point suppose de trancher
le point 2 d'abord.**

**D.9 — LE MOT « SEUIL » EST INTERDIT. Quatre mots, un par comportement.**
Trois worktrees ont posé **trente-cinq** réglages sur plusieurs semaines. Chacun a écrit « seuil »
parce que c'était le mot du moment, et personne n'a imposé de vocabulaire. Résultat : **le
propriétaire du produit a ouvert `/admin/matching` et n'a pas su quoi faire.** C'est le seul verdict
qui compte, et il est sans appel.

| Mot | Ce qu'il fait | Exemple |
|---|---|---|
| **PLAFOND** | il **BLOQUE** — atteint, la fonctionnalité s'arrête | dépense mensuelle, quota d'analyses de CV |
| **ALERTE** | elle **SIGNALE** — elle marque, elle n'empêche rien | dépense par organisation, par expert |
| **FILTRE** | il **TRIE** — il décide ce qui est montré | `feed_threshold`, `notify_threshold` |
| **NOTE** | elle **JUGE** — elle qualifie un dossier | auto-approbation d'expert, vérification d'entreprise, qualité d'annonce |

**La règle : tout nouveau réglage se nomme plafond, alerte, filtre ou note — à l'écran, dans la doc,
et dans tout code neuf. Un réglage qui ne rentre dans aucun des quatre SE DIT** (une durée, un
référentiel, un interrupteur, un choix de modèle) **plutôt que de se faire appeler « seuil » par
défaut.** Un worktree qui écrit « seuil » réintroduit le défaut de ce lot.

> ⚠️ **L'EXCEPTION, ET ELLE EST DANS LE MÊME PARAGRAPHE — SINON LA RÈGLE MENT AU PREMIER `grep`.**
> **Les colonnes existantes y échappent encore** : `feed_threshold`, `notify_threshold`,
> `confidence_threshold`, `auto_approve_threshold`, `seuil_mensuel_usd`. Les clients Supabase ne
> sont pas typés (§E.1) : une colonne est lue **par son nom, dans une chaîne**, et un renommage
> **casse au runtime, en silence**, dans tout code qui la cite. Leur renommage est un **lot à lui
> seul**, avec son propre contrôle. C'est une décision, pas un oubli.
> Ce qui prend le vocabulaire **dès maintenant** : les écrans, la documentation, les messages i18n,
> les **noms de contraintes** (aucun lecteur en chaîne — `matching_settings_filtre_flux_check`), et
> tout code neuf.

**D.11 — UN ÉCRAN DE RÉGLAGE NE MONTRE QUE CE QUI SE DÉCIDE.**
Un réglage **mort**, **inerte** ou **technique** se **documente** ; il ne s'affiche pas avec un champ
de saisie et un bouton « Enregistrer » à côté.

**Un champ qui ne règle rien finit par être rempli.** C'est la règle qui manquait, et c'est
l'absence de cette règle qui a produit **35 réglages dont 16 sans écran et 2 qui ne gouvernent rien**.

**Ce qu'elle interdit, concrètement :**
· afficher un champ grisé avec trois lignes expliquant qu'il ne décide de rien — on l'a fait pour
  `sirene_insee`, et le résultat est un écran qu'on ne sait plus lire ;
· afficher un identifiant de base (`claude_expert_coherence_check`, `ai_coherence_check`) comme
  **titre** — ce sont des clés, pas des noms ;
· mêler un paramètre technique aux décisions produit. S'il doit rester réglable (§D.7), il vit
  **replié**, **à part**, et **en dessous**.

**Ce qu'elle exige en échange, et c'est la moitié qui compte :** l'information ne s'évapore pas.
La propriété de `/admin/seuils` — **déclarer ce qui ne gouverne rien** — était exemplaire ; elle
**migre** vers [docs/architecture.md](docs/architecture.md) §B.2 ⑨ et vers un contrôle qui la garde.
Retirer un champ sans écrire pourquoi ailleurs, c'est perdre la connaissance au lieu de la ranger.

> **La règle complète les deux précédentes** : §D.7 dit qu'un réglage règle quelque chose **ou le
> dit** ; celle-ci dit **où** il le dit — dans la documentation, jamais dans un champ de saisie.

**D.12 — AUCUNE COULEUR LITTÉRALE DANS UN COMPOSANT. Une seule source, réglée par écosystème.**
Une couleur se lit dans un jeton `--sk-*`, jamais écrite en toutes lettres. La source unique est
[lib/palette.ts](lib/palette.ts) ; les jetons sont posés **au serveur**, en littéral, sur `<html>`
par le layout racine. **Gardé par [`diag-couleurs-litterales`](scripts/diag-couleurs-litterales.mjs)**,
par [`diag-svg-couleurs`](scripts/diag-svg-couleurs.mjs) pour le piège §E.48, et par
[`diag-opacite-concatenee`](scripts/diag-opacite-concatenee.mjs) pour §E.50 — un suffixe d'opacité
ne se colle JAMAIS à une couleur, on écrit `color-mix`.

> ⛔ **LE GEL DU CLIQUET EST VIDE — 21/09/2026.** Parti de **3 180 couleurs dans 125 fichiers**,
> descendu à zéro espace par espace, un commit chacun. **Toute entrée qui y apparaîtra est une dette
> NOUVELLE**, à nommer et à justifier ; elle ne se glisse plus dans un inventaire existant.
> Il **reste en place**, vide : le retirer parce qu'il n'a plus rien à tolérer rouvrirait la porte.
>
> **LES E-MAILS SONT L'EXCEPTION, ET ELLE EST STRUCTURELLE.** Les clients de messagerie ne lisent
> **pas** les propriétés personnalisées : `color: var(--sk-text)` y est ignoré, et le texte tombe sur
> la couleur par défaut du client. Un e-mail ne porte donc que des **littéraux** — mais **résolus**
> depuis `lib/palette.ts` par [lib/emails/couleurs.ts](lib/emails/couleurs.ts), jamais recopiés.
> Ils portaient encore `#00B9FF`, qui n'est la marque de personne depuis ce lot.
> **Ce qui reste ouvert et se dit** : ce sont les valeurs de la palette **de référence**, pas celles
> de l'écosystème du destinataire — le point d'envoi ne reçoit que le nom de marque.

**Les valeurs sont celles de l'accueil**, mesurées le 21/09/2026
([docs/audit-couleurs.html](docs/audit-couleurs.html)) : c'était la seule surface du produit qui
tenait en quinze couleurs déclarées à un seul endroit, contre 184 teintes et 3180 littéraux ailleurs.

| Ce qui se règle | Ce qui ne se règle pas |
|---|---|
| les **huit rôles** — fond de page, bandeau, cartes, bordures, texte principal, texte secondaire, marque, boutons — par écosystème, dans `/admin/ecosystemes` | le **vert**, l'**ambre** et le **rouge** : ils disent un ÉTAT, pas une marque. Les rendre réglables inviterait à peindre une erreur en vert. |
| | le **texte tenu** et la **bordure douce** : mesurés sur l'accueil, non dérivables, et sans variation d'un écosystème à l'autre. |

**La garde de contraste REFUSE, et elle refuse au serveur.** Sept paires, minimum 4,5. Le refus nomme
la paire, son ratio et le minimum ([`diag-palette-contraste`](scripts/diag-palette-contraste.mjs)).

> **Et la palette juste ne prouve pas l'écran juste.** Une page peut lire deux bons jetons et les
> poser l'un sur l'autre. [`diag-contraste-par-ecran`](scripts/diag-contraste-par-ecran.mjs) ouvre
> **chaque bloc `style={{…}}` des 66 pages** de l'espace connecté, en extrait le couple
> *(texte, fond)* réellement écrit et le mesure — **212 couples, 0 sous son minimum**. Il ne devine
> **aucun** fond hérité : les **743** blocs qui peignent un texte sans déclarer leur fond sont
> comptés et **déclarés** (§E.38), jamais estimés (§E.40). Sa sortie `--json` alimente la colonne
> de [docs/audit-couleurs.html](docs/audit-couleurs.html) — **un chiffre d'audit se reçoit du
> contrôle, il ne se saisit pas** (§E.16, §E.24).
**Les bordures en sont exclues, à dessein** : la bordure de référence vaut 1,25, et l'exiger à 3
ferait rougir la palette de l'accueil elle-même dès le premier jour (§E.14).

> ⚠️ **`--sk-faint` (le texte tenu) vaut 3,63 : il ne porte JAMAIS d'information.** Titres de
> groupes, survols, séparateurs — des repères qu'on balaie. Un état vide **dit** quelque chose : il
> prend `--sk-muted`. **Cette règle ne se balaie pas** — aucun motif ne distingue un repère d'un
> texte qu'on lit — elle se lit écran par écran (§E.38).

> **Deux exemptions, nommées avec leur raison** : [lib/portraits-demo.ts](lib/portraits-demo.ts)
> (couleurs d'ILLUSTRATION : carnations, chevelures, vêtements — la garde de contraste n'a rien à
> dire d'une couleur de cheveux) et `MARQUES_TIERCES` dans `lib/palette.ts` (le logo d'un tiers garde
> SA couleur : la recolorer afficherait un logo LinkedIn qui n'est pas celui de LinkedIn).

**D.13 — UN ÉCRAN NE SIMULE JAMAIS UN TRAVAIL. Il l'attend, ou il dit ce qu'il sait déjà.**
Une recherche de missions a **quatre issues nommées**, et aucune autre :
`trouvees` · `aucune` · `ineligible` · `echec` ([lib/matching/issue-de-recherche.ts](lib/matching/issue-de-recherche.ts)).
L'union est **fermée** : il n'existe aucune branche « on ne sait pas encore » qui pourrait rester
affichée indéfiniment, et l'écran **refuse de compiler** sur une issue non traitée.

**Trois règles, et chacune ferme un défaut mesuré le 21/09/2026** (§E.51) :

① **La réponse connue au clic se dit AU CLIC.** Profil non visible, CV non analysé, consentement
  absent, profil non approuvé : quatre refus lisibles en **une lecture de ligne**. Ils sortent
  immédiatement, avec le bouton pour y remédier — jamais après une roue qui tourne.
② **Ce qui se lance s'attend.** La bascule de disponibilité **exécute** le moteur dans la requête.
  Aucun chronomètre ne décide de la fin d'une recherche : les deux qui le faisaient (75 s et 120 s)
  sont **supprimés**, pas désactivés.
③ **« Aucune mission » ne s'écrit que sur une recherche ACHEVÉE.** Un empêchement, un refus de
  débit, une panne de configuration : chacun dit ce qu'il est. Affirmer un résultat qu'on n'a pas
  est le défaut, pas le retard.

> **Le report garde son rôle — sur le SEUL chemin où la rafale existe.** Mesuré : ses deux appelants
> étaient `/api/profile` (un expert reprend son profil en dix passes) et la bascule de disponibilité
> (**un interrupteur à deux positions ne produit aucune rafale**). Il reste sur le premier, il est
> retiré du second. Et il ne s'applique pas à l'**approbation** : `lib/matching/relance.ts` l'énonce
> depuis le lot 6, le code ne l'appliquait pas, et un expert fraîchement approuvé lisait « aucune
> mission ne correspond ».
> ⚠️ **Sa durée est passée à 10 minutes, et sa raison a changé — §D.15.** Il ne porte plus la
> justesse (la clé du brouillon la donne par construction) ; il ne garde que l'anti-rafale.
> **Le plafond horaire, lui, s'applique partout** — et c'est le MÊME (`consommerPlafondHoraire`),
> pas une copie (§E.20).

**Gardé par [`diag-issue-de-recherche`](scripts/diag-issue-de-recherche.mjs)** — 10 mutations,
10 détections — et par [`diag-relance-expert`](scripts/diag-relance-expert.mjs), dont deux sections
ont été **réécrites** parce qu'elles défendaient l'ancienne règle et se contredisaient entre elles.

**D.14 — UNE SEULE COQUILLE POUR TOUT L'ESPACE CONNECTÉ. AUCUNE EXCEPTION.**
Les **66 pages** connectées portent le même cadre : `DashboardShell` — barre latérale, en-tête,
bouton Retour. Il est monté par les **sub-layouts**, jamais par une page.

**L'en-tête et la barre latérale sont BEIGES**, tous deux en `--sk-bandeau`. L'en-tête était en
`--sk-surface`, c'est-à-dire le **blanc des cartes** : deux surfaces du même cadre, deux couleurs.
`--sk-surface-2` porte aujourd'hui la même valeur mais ne dit pas la même chose — il nomme un fond
**dans** une carte, pas le cadre.

**Ce que la règle interdit, et qui existait :**
· une **liste d'exclusion** dans un sub-layout — il y en avait deux, dont une justifiée par un
  commentaire **faux** qui laissait une page sans aucune navigation (§E.53) ;
· une page qui **rebâtit** son cadre — trois copies dans un seul fichier ;
· un **second plein écran** (`minHeight: 100vh`) sous un en-tête de 60 px ;
· un **numéro de section** peint en vert, en ambre ou en rouge : ce sont des états (§E.54).

> **L'ADMIN GARDE LE MÊME CADRE ; SEUL LE CONTENU DE SON MENU DIFFÈRE.** Décision de Youssef,
> **appliquée le 21/09/2026** : barre latérale de 248 px en `--sk-bandeau`, barre supérieure — il
> n'en avait **aucune** —, et le même modèle de défilement.
> Sa dette est payée avec : **574 occurrences** de jetons `--color-*` qui n'étaient **définis nulle
> part** et retombaient en silence sur des valeurs en dur. Le back-office ne suivait **aucune palette
> d'écosystème**. Détail et correspondance en **§C.15** ([architecture](docs/architecture.md)).

> **UN JETON QUI NE RÉSOUT NULLE PART NE SE VOIT PAS.** `var(--truc)` non défini prend sa valeur de
> secours, **sans erreur ni style manquant** — famille de §E.48. Le contrôle vérifie donc la
> **définition** de chaque propriété lue, jamais un préfixe de nom (§E.34) : un jeton inventé demain
> est attrapé sans qu'on l'ajoute à une liste. **48 occurrences restent, hors admin, gelées
> nommément** dans six fichiers ; le compte ne peut que descendre.
> Deux exemptions déclarées : les `--font-*` (posées par `next/font` dans une feuille générée au
> build) et celles qu'un composant pose **sur sa propre racine** et relit dans son `<style>`.

**Gardé par [`diag-coquille-unique`](scripts/diag-coquille-unique.mjs)** — 10 mutations,
10 détections. Il s'ancre sur le **comportement**, pas sur un nom (§E.34) : ce qui est refusé, c'est
un layout qui rend `children` nus, et plus en amont qu'un layout de cadre **consulte le chemin**.

**ET LA PARITÉ EXPERT EST GARDÉE À PART** — [`diag-parite-expert`](scripts/diag-parite-expert.mjs),
7 mutations, 7 détections. Décision de Youssef : *« l'espace CDI prend EXACTEMENT l'ergonomie de
l'espace freelance — parité intégrale, pas un rapprochement. »* Le contrôle vérifie **14 écrans
jumeaux** : même inventaire, même cadre, mêmes primitives partagées, même traitement du texte tenu,
mêmes clés de comportement.
> ⚠️ **Il ne dit PAS que les deux écrans se ressemblent à l'œil** — deux pages peuvent monter les
> mêmes composants et disposer leurs blocs autrement. Ce qu'il garde, c'est qu'aucune des deux voies
> ne **perde** ce que l'autre a : la forme exacte que prend une dérive de parité (§E.20).

**D.15 — UNE NOTE APPARTIENT AUX TEXTES QUI L'ONT PRODUITE. La clé porte le CONTENU.**
Le brouillon de notation (`matching_notes_partielles`) était indexé par `(publication_id,
profile_id)` + le modèle : **trois identités, aucun contenu**. Un profil modifié retrouvait « sa »
note — celle calculée sur le profil d'avant — pendant les **24 h** de vie du brouillon, **sans que
rien ne lève**. Le report de 60 minutes ne fermait pas cette fenêtre : **il la rétrécissait**.

Arbitré par Youssef le 22/09/2026, entre deux sorties **qui n'ont pas la même nature** :

| Sortie | Ce qu'elle vaut |
|---|---|
| **solder** le brouillon en fin de run | une **DISCIPLINE** — elle dépend de la fin du run, et un run qui meurt à mi-chemin laisse des notes périmées : le cas même où le brouillon sert |
| **cléer sur le contenu** | **JUSTE PAR CONSTRUCTION** — profil modifié ⇒ autre empreinte ⇒ autres notes ; profil inchangé ⇒ ses notes. Rien à attendre, aucun ordre à respecter |

**La seconde. Une garde qui est une CLÉ ne dépend d'aucune discipline (§E.31).**
Colonne `empreinte`, `not null` **et sans défaut** : une ligne sans empreinte n'est pas déconseillée,
elle est **impossible**. Calcul dans [lib/matching/empreinte.ts](lib/matching/empreinte.ts) — module
**pur**, exécuté tel quel par son contrôle (§E.33).

> ⚠️ **L'ORDRE EST CANONIQUE — ANNONCE D'ABORD — ET JAMAIS CELUI DE L'APPEL.** Les deux sens
> interrogent le reranker à l'envers l'un de l'autre. Hacher dans l'ordre de l'appel donnerait **deux
> empreintes pour le même couple de textes** et supprimerait le **partage entre les deux sens**, qui
> est délibéré — une régression de coût décidée par accident, en écrivant un correctif de justesse.
> Ce partage suppose que la note est **symétrique**, ce qu'un reranker ne garantit pas : la
> supposition **préexiste**, elle est conservée à l'identique et **nommée pour être arbitrable**
> (§E.38), pas tranchée au passage.

**Le délai de relance a changé de raison, donc de valeur : 60 → 10 minutes.** Il ne porte plus la
justesse, il ne garde que l'**anti-rafale** — et cette raison-là, **fausse quand elle était écrite**
(la reprise par identité rendait un second run presque gratuit), **est devenue vraie** avec
l'empreinte : dix modifications font dix empreintes neuves, donc dix runs réellement payants.
Les cinquante minutes retirées payaient la justesse, que la clé donne gratuitement, et coûtaient à
l'expert une heure d'invisibilité. **Dix minutes est une PROPOSITION argumentée, pas une mesure** :
rien dans le dépôt ne dit la durée d'une séance d'édition. Elle se change en une ligne ; la justesse,
elle, ne dépend plus de ce nombre.

**Gardé par [`diag-empreinte-des-notes`](scripts/diag-empreinte-des-notes.mjs)** — 8 mutations,
8 détections. Détail et mesure : **§E.58**.


**D.16 — RELIER N'EST PAS ENCAISSER. La synchronisation du catalogue n'exige QU'UNE CLÉ.**
Synchroniser crée chez Stripe un `Product` et un `Price` par offre vendable. **Ça ne fait payer
personne** : aucune session de paiement, aucun droit accordé, aucune carte touchée.

Exiger `ENABLE_BILLING` pour relier créait une **dépendance circulaire de fait** : pour ouvrir
l'encaissement il faut les identifiants de prix, et pour les obtenir il fallait ouvrir
l'encaissement. **C'est ce qui a laissé le catalogue non relié** — et un premier abonnement réel
serait sorti « prix hors catalogue », un paiement encaissé que rien ne sait rattacher à une offre.

| Ce qui exige **une clé valide** | Ce qui exige **EN PLUS `ENABLE_BILLING`** |
|---|---|
| `/api/admin/synchroniser-catalogue` (derrière `requireAdmin`) | le checkout, le portail, le changement d'offre |
| la synchro déclenchée par la **création** et la **modification** d'une offre | l'**APPLICATION** des événements du webhook |

> ⛔ **UNE OFFRE NE SE RELIE JAMAIS À LA MAIN.** Créer une offre payante la relie
> **dans la même action** ; modifier son prix, sa devise, son nom ou sa mise en vente
> aussi. Si Stripe refuse, l'action admin **refuse avec la raison nommée** (`stripe_sync_failed`),
> et la création **supprime l'offre qu'elle venait d'écrire** : une offre n'existe jamais à moitié,
> payante et non reliée.
> **Le bouton « Relier à Stripe » est un RATTRAPAGE**, et l'écran le dit : les offres créées quand
> aucune clé n'était présente, et le passage en production. Plus jamais au quotidien.
>
> **Et l'oubli du passage en live est gardé par la SUPERVISION** : une offre payante non reliée
> **dans le mode de la clé en usage** remonte en **BLOQUANT** (`catalogue_non_relie`), avec son lien
> vers `/admin/facturation`. « Je ne sais pas » (clé absente, lecture en panne) est un problème
> **distinct**, en attention — jamais un « tout va bien » (§E.22).

`resolveCatalogueKey()` et `resolveBillingKey()` — [lib/billing/config.ts](lib/billing/config.ts) —
et deux fabriques, [`getStripeCatalogue()`](lib/billing/stripe.ts) / `getStripe()`. **Une seule
implémentation des règles de clé** : la seconde délègue à la première puis ajoute l'interrupteur,
dans cet ordre (`billing_disabled` sort AVANT tout examen de clé, c'est ce motif que l'écran peint
en gris comme un état normal). Les trois contrôles restent entiers, **cohérence clé/environnement
comprise, dans les deux sens**.

> ⚠️ **LA CONSÉQUENCE SUR L'ÉDITION D'UNE OFFRE EST VOULUE ET ELLE COÛTE.** `catalogue-guard`
> conditionnait sa synchro à `ENABLE_BILLING` ; c'est désormais « une clé valide ». Sur un
> environnement qui porte une clé, **modifier un prix pousse vers Stripe, et un échec de Stripe
> REFUSE la modification**. C'est la garantie même du module : sans elle, un catalogue relié
> divergerait dès la première correction de tarif, en silence, et la divergence ne se verrait
> qu'au premier paiement. Sans clé, rien n'est tenté et le back-office reste libre.

**D.17 — TEST ET PRODUCTION SONT DEUX CATALOGUES. Le mode est dans la CLÉ.**
Un `price_...` créé avec `sk_test_` **n'existe pas** en mode live. Une seule colonne par période
rendait donc le passage en production **faux en silence**, et rien ne pouvait le voir : une colonne
qui porte un identifiant ne dit pas dans quel mode il a été créé.

Table `packages_stripe`, clé primaire **(package_id, mode)** — migration `catalogue_stripe_par_mode`.
**Et ses trois gardes d'unicité ont dû être reposées** par `index_packages_stripe` : les noms annoncés
par la première étaient déjà pris, `if not exists` a sauté les créations sans rien dire, et le
`drop column` a emporté les anciens — `packages_stripe` est resté **sans aucune garde** (§E.60).
Les trois colonnes `packages.stripe_*` sont **supprimées** : deux sources pour la même chose, dont
une sans mode, est ce qu'on ferme. **La migration REFUSE de tourner** si un identifiant y existait
encore, en nommant les offres — on ne supprime pas une colonne en *croyant* qu'elle est vide.

| Forme | Comment elle se trompe |
|---|---|
| deux jeux de colonnes (`..._test` / `..._live`) | un lecteur qui oublie le suffixe **compile, tourne, et lit l'autre mode**. En silence (§E.1 : la colonne est une chaîne). |
| **une table clée (package_id, mode)** | un lecteur qui oublie le mode obtient **deux lignes** : il doit trancher, donc savoir. **§E.31** — la garde est une clé. |

**D'OÙ VIENT LE MODE, ET CE N'EST PAS LA MÊME ORIGINE PARTOUT** — deux fonctions distinctes alors
qu'elles calculent la même chose, parce que les confondre est la faute :
· une action de **catalogue** agit avec une clé → `modeDeLaCle(handle.live)` ;
· le **webhook** ne choisit pas → `modeDeLEvenement(event.livemode)`. Lire le mode de sa clé
supposerait que l'endpoint et la clé sont accordés — **c'est précisément ce qui casse quand on
croise les deux tableaux de bord Stripe**.
`resolvePackageByPrice` exige donc un `mode`, **sans valeur par défaut** : un défaut rouvrirait la
porte en silence.

> **L'écran des écarts dit ce qui est relié DANS LE MODE COURANT, et ce qui ne l'est pas dans
> l'autre** ([lib/stripe-exploitation/catalogue-relie.ts](lib/stripe-exploitation/catalogue-relie.ts)).
> Trois états par offre, et jamais deux : `reliee`, `a_relier`, **`rien_a_relier`**.
>
> **CE QUI DÉCIDE EST LE PRIX, JAMAIS LE NOM NI LE STATUT** — une seule implémentation,
> [lib/billing/vendabilite.ts](lib/billing/vendabilite.ts), module **pur** exécuté par le contrôle.
> Une offre **gratuite n'a rien à relier, que son prix soit `NULL` ou `0`** : un `Price` récurrent
> à 0,00 € n'encaisse rien et apparaîtrait pourtant comme une offre réelle chez Stripe.
> `is_default` **a disparu du critère** et rien n'a changé : la contrainte
> `packages_default_must_be_free` fait que le prix l'écartait déjà — le garder faisait croire que le
> STATUT décide. Aujourd'hui `Free` et `Collaboration` sont donc écartées **parce qu'elles sont
> gratuites**, pas parce qu'elles s'appellent ainsi ; et une offre payante qu'on rendrait gratuite
> demain sortirait de la vente **toute seule**.
>
> ⚠️ **Un tarif ILLISIBLE a sa propre raison.** `Number('abc')` vaut `NaN`, et `NaN > 0` est faux :
> confondu avec zéro, un tarif corrompu sortirait **silencieusement** de la vente. L'écran le
> distingue — c'est une donnée à corriger, pas une offre gratuite.

**Gardé par [`diag-relier-nest-pas-encaisser`](scripts/diag-relier-nest-pas-encaisser.mjs)** —
14 mutations, 14 détections. Il **découvre** les routes qui écrivent une offre au lieu de les
lister, et n'exige la liaison que de celles qui touchent à ce que Stripe connaît — une route
ajoutée demain est donc couverte sans qu'on l'inscrive nulle part (§E.34). Il **exécute** les clés d'idempotence (§E.33) pour prouver qu'un second
clic ne crée pas de doublon chez Stripe : un doublon ne se verrait pas dans notre base et fausserait
l'écran des écarts.


**D.18 — LA GRATUITÉ SE DIT, ELLE NE SE DÉDUIT PAS. Une case, et la base la garde.**
La règle était « prix nul ou zéro ⇒ gratuite ». **Exacte, et implicite** — l'intention n'était écrite
nulle part. Conséquence, et elle se paie en argent : **une offre payante saisie à 0 par erreur
sortait de la vente EN SILENCE.** Aucun refus, aucune alerte : elle cessait d'être reliée, et le
premier client qui voulait y souscrire ne pouvait plus. Dans l'autre sens, rien n'empêchait une offre
déclarée gratuite de porter un prix.

**`packages.is_free` est une INTENTION DÉCLARÉE** — migration `offre_gratuite_explicite`. Une case à
cocher dans `/admin/packages`, à la création **et** à la modification : cochée, les champs de prix
sont désactivés et valent zéro ; décochée, un prix strictement positif est **obligatoire**.

**LA RÈGLE EST EN BASE, DANS LES DEUX SENS** — `packages_gratuite_coherente` :

| | |
|---|---|
| `is_free` | ⇒ prix mensuel **et** annuel nuls |
| `not is_free` | ⇒ **au moins un** prix strictement positif |

Une offre payante à 0 et une offre gratuite avec un prix deviennent **impossibles à écrire**, quel
que soit le chemin — l'écran, une route, un script, une main dans le tableau de bord Supabase.
**Une garde qui est une contrainte ne dépend d'aucune discipline (§E.31).**
`packages_default_must_be_free` **devient un cas de celle-ci** : `is_default ⇒ is_free`. Même
garantie, exprimée une seule fois ; le nom est **conservé**, il est cité ailleurs (§E.16).

> **L'écran et la route ne gardent RIEN de plus — ils EXPLIQUENT.** La contrainte rendrait une erreur
> Postgres, que la route traduirait en 500 « db_error », lequel n'apprend rien. Le contrôle de
> cohérence des routes rend un **400 nommé** (`free_with_price`, `paid_without_price`) ; le retirer ne
> rouvrirait aucun trou, il rendrait le refus incompréhensible.
> ⚠️ **Côté modification, il porte sur l'ÉTAT FINAL, pas sur le corps reçu** : une modification est
> partielle, et cocher « gratuite » sans toucher au prix est un corps valide **et** contradictoire
> avec la ligne en base. On compose l'existant écrasé par le corps, et c'est lui qu'on vérifie.

**`vendabilite.ts` LIT LA CASE, PLUS LE PRIX.** Il ne porte même plus le prix dans son type d'entrée :
la déduction ne peut pas revenir par distraction. Deux critères disparaissent avec elle —
`is_default`, qui n'a jamais rien décidé (la contrainte l'impliquait déjà), et `tarif_illisible`, qui
n'existait que parce qu'on lisait un nombre arrivé en chaîne.

**UNE OFFRE GRATUITE NE PASSE JAMAIS PAR STRIPE — ni synchro, ni paiement.**
La synchronisation la refusait déjà. **Le paiement avait un trou réel, et il est fermé** : une offre
payante **reliée**, puis passée en gratuite, garde sa ligne dans `packages_stripe` ; la liaison
rendait donc un prix, et le checkout s'ouvrait **au prix d'avant** sur une offre déclarée gratuite.
Le refus est désormais **en tête de `resolveSellablePrice`, avant toute lecture de liaison**.

**Gardé par [`diag-relier-nest-pas-encaisser`](scripts/diag-relier-nest-pas-encaisser.mjs)** —
**18 mutations, 18 détections**. Il exécute la règle (§E.33), vérifie que le module **ne lit aucun
prix**, que le refus d'achat précède la lecture de liaison, et que la contrainte porte **les deux
sens**.


**D.19 — UNE CANDIDATURE EXISTE AVEC SA NOTE ET SON RÉSUMÉ, OU ELLE N'EXISTE PAS.**
Arbitré par Youssef le 23/09/2026, et cette décision **REMPLACE** la précédente, qui disait
l'inverse en toutes lettres (« RIEN NE BLOQUE UNE CANDIDATURE », en tête de
`20260907200000_pannes_de_redaction.sql`) : *« une candidature avec sa note et son résumé, ou pas de
candidature. Une candidature nue chez un client, c'est amateur. On ne la livre pas. »*

**L'ORDRE EST LE CORRECTIF, TOUT LE RESTE EN DÉCOULE.** Le jugement est **appelé avant l'écriture**
et **attendu dans la requête** ([lib/candidatures/depot.ts](lib/candidatures/depot.ts)). Il aboutit →
la candidature est écrite **avec** sa note et son résumé, en une opération. Il échoue → **rien n'est
écrit**.

| Ce qui est refusé | Pourquoi |
|---|---|
| **un filtre à l'affichage** | **17 fichiers** lisent `candidatures` (mesuré le 23/09/2026). Il suffirait d'en oublier un. La garantie est que **l'objet incomplet n'existe pas**, pas qu'on le cache. |
| **un rejeu automatique** | Refusé par Youssef : « ça tournerait en boucle et ça coûterait ». |
| **prévenir l'expert** | « L'expert ne paie pas une panne qui ne le concerne pas, et on ne lui montre pas nos coulisses. » Aucun message d'erreur, aucun bouton « réessayer ». |

**LA BASE REFUSE** — `candidatures_complete_ou_inexistante`, contrainte **validée**, pas
discipline (§E.31). Elle porte une **borne de date** plutôt qu'un `NOT VALID`, et ce n'est pas un
détail : une contrainte `NOT VALID` est **quand même vérifiée sur tout UPDATE**, elle aurait donc
rendu **IMMUABLES** les 4 candidatures de juin 2026 (§E.64).

> ⚠️ **CE QUE ÇA COÛTE, ET C'EST ASSUMÉ.** L'écran affiche « votre candidature a été envoyée » alors
> que rien n'a été écrit — un tampon de succès sur un travail qui n'a pas eu lieu, la forme exacte
> de §E.27. Youssef a nommé cette conséquence lui-même, et c'est **précisément** pourquoi l'écran
> `/admin/depots-en-echec` est **BLOQUANT en supervision tant qu'il n'est pas vide**. Le tampon est
> tenable parce qu'il n'est **jamais silencieux côté plateforme**. Sans cet écran, ce serait un
> défaut ; avec lui, c'est un arbitrage.

**CE QUI N'ABOUTIT PAS SE VOIT, ET SE REJOUE À LA MAIN.** Table `candidature_depots`, une ligne
par couple (annonce, expert), **écrite AVANT l'appel au modèle** — cet appel dure jusqu'à 30 s dans
la requête, et c'est exactement là qu'une fonction se fait tuer (§E.63). L'écran
`/admin/depots-en-echec` montre les échecs **et** les dépôts **interrompus** (état DÉRIVÉ de
l'heure, jamais stocké), filtrables par cause, date et écosystème, avec un bouton **RELANCER** qui
appelle **la même fonction** que le dépôt d'un expert — pas une copie (§E.20).

**D.10 — TOUTE NOTE DU PRODUIT EST SUR 0-10. Il n'y a pas de seconde échelle.**
Les filtres de pertinence vivaient en **0-1**, les notes de jugement en **0-10**, et rien ne le disait
à l'écran : **« 1 » signifiait *parfait* d'un côté et *médiocre* de l'autre**, sur la même page.
Le reranker produit du 0-1 — c'est sa nature, on n'y touche pas : sa sortie est multipliée par 10
**au seul point où un score entre dans le système**, la frontière avec le fournisseur
([lib/matching/rerank.ts](lib/matching/rerank.ts)).
**Aucune autre conversion n'existe**, et c'est gardé par
[scripts/diag-echelle-des-notes.mjs](scripts/diag-echelle-des-notes.mjs). Convertir à l'affichage
laisserait deux représentations ; convertir à la comparaison la mettrait sur **quatre** sites, et en
oublier un transformerait `score < 7` en `score < 0.7` — tout passe, ou rien ne passe, **en silence**.
Détail et raisons complets : **§P3.0** dans [docs/produit.md](docs/produit.md).

---

### M1 ter — La fusion de `feat/s1-ux-profil`, et les deux écrans partagés

Le 17/09/2026, `feat/s1-ux-profil` a été fusionné. **Deux worktrees avaient travaillé sur LES MÊMES
ÉCRANS d'organisation sans se croiser** — `feat/s2` sur le logo (déjà sur le tronc), `feat/s1` sur le
pays du siège et le motif de mise en revue. **Les deux sont justes ; aucun ne remplace l'autre.**

**Cinq conflits, dont trois sur du code.** Pour chacun, la question posée n'a pas été « quel côté
garder » mais « que fait chaque côté, et comment les deux coexistent ».

| Fichier | Ce que chaque côté faisait | L'union |
|---|---|---|
| `app/api/me/organisation/route.ts` | `logo_url` est **préexistant** : S2 l'a **retiré** de la whitelist (c'était une saisie d'URL, §E.17) ; S1 ne l'a pas touché et a **ajouté** `country` | le **retrait** de S2 **et** l'ajout de S1 — vérifié sur la base `392dd07` avant de trancher |
| `app/api/admin/get-org/[id]/route.ts` | un import chacun, plus un validateur de motif chez S1 | purement additif : les deux |
| `dashboard/entreprise/organisation/page.tsx` | S2 monte `OrgLogoUpload` ; S1 monte `CountrySelect` et charge le référentiel | les deux composants, et le champ `logo_url` reste **hors** du formulaire |
| `CLAUDE.md` | les deux avaient mis à jour le **nombre de migrations** — 63 pour le tronc, 64 pour S1 | **65**, mesuré après fusion : aucun des deux n'était bon, et choisir l'un aurait réintroduit le défaut que cette phrase raconte |
| `docs/produit.md` | deux paragraphes **au même endroit, sur des sujets différents** | les deux, dans l'ordre du parcours — le motif de revue prolonge l'étape 2, le logo ouvre l'étape 2 bis |

**Seconde collision de numéros de section, résolue comme la première.** `feat/s1` portait un §E.13, un
§E.14 et un §E.17 — les trois déjà pris par le tronc, et **en double dans son propre fichier** (sa
fusion précédente les avait empilés après §E.9 sans renuméroter). Ils deviennent **§E.19**, **§E.20**
et **§E.21**, et ils sont **replacés** dans §E, avant le fourre-tout §E.9.

**198 lignes ajoutées par `feat/s1` à la mémoire, toutes présentes** — sauf le paragraphe du nombre
de migrations, remesuré ci-dessus. Vérifié par script, pas supposé.

**Les `messages/*.json` sont l'union EXACTE** : 3154 à la base, +26 côté tronc, +37 côté `feat/s1`,
**3217** après fusion, parité exacte sur les quatre langues. **Cinq suppressions délibérées** sont
propagées — deux du logo (S2 remplace la saisie d'URL par un téléversement), trois de la saisie de
téléphone (S1 unifie les trois parcours). Une suppression voulue n'est pas une perte, et c'est
vérifié comme telle.

**Défaut vu pendant la fusion, traité dans la fusion.** Les deux migrations de `feat/s1` portaient un
suffixe **`1xxxxx`** — la plage que §G.2 déclare fausse, et **la même infraction que celle du tronc**.
Elles n'étaient appliquées nulle part : elles ont été renumérotées dans la plage de S1
(`20260917200000`, `20260917210000`), exactement comme `912d437` l'avait fait avant application.
Toutes les références passent par le **suffixe** (§G.3), donc rien ne casse. Le cliquet de
`diag-migration-donnees` les avait dénoncées — c'est sa première prise.


### M1 quater — La fusion du module Stripe d’exploitation (20/09/2026), et la collision QUI N’A PAS FAIT DE CONFLIT

Le 20/09/2026, `feat/s1-ux-profil` a été fusionné une seconde fois : il portait le **module
Stripe d’exploitation** — `/admin/facturation`, `/admin/facturation/ecarts`, **une seule** route
API pour les trois surfaces, un cron de vérification nocturne, `lib/stripe-exploitation/*`, et une
migration `2xxxxx`. **Fichiers neufs uniquement** : aucune route de `app/api/billing/` ni de
`app/api/stripe/` n’a été touchée, et la fusion le confirme — **aucun conflit de code**.

**DEUX COLLISIONS DE NUMÉROS, ET LA SECONDE EST LA PLUS INSTRUCTIVE.**

| Où | Ce qui est entré en collision | Résolution |
|---|---|---|
| `CLAUDE.md` | les deux côtés ont écrit un **§E.39** | git a levé un **CONFLIT** : celui du tronc garde son numéro (il est **cité** par §E.38 ③), celui de S1 devient **§E.44** |
| `docs/architecture.md` | les deux côtés ont écrit un **§C.10** | **git n'a rien signalé** — insertions à des endroits différents, fusion automatique réussie, et **deux sections du même numéro** dans le fichier |

> ⚠️ **UNE COLLISION QUI NE PRODUIT PAS DE CONFLIT EST PIRE QU'UNE QUI EN PRODUIT.** Un conflit
> arrête la fusion et exige une décision. Celle-ci a produit un fichier **valide, cohérent à la
> lecture, et faux à la citation** : deux §C.10, dont un cité deux fois — `architecture.md:65` et
> `produit.md:628`. Rien dans git, rien dans `tsc`, rien dans `next build`. Elle a été trouvée en
> **recomptant les sections des deux côtés après la fusion**, pas en lisant le rapport de merge.
> *Vérifier une fusion, ce n’est pas relire ses conflits : c’est recompter ce que les deux côtés
> ont ajouté.*

**Même convention que M1 bis et M1 ter : CELUI QUI EST DÉJÀ CITÉ GARDE SON NUMÉRO.** Le §C.10 de
S1 (module Stripe) est cité deux fois → il garde `C.10`. Celui du tronc (les trois écrivains des
listes de profil) n’est cité nulle part → il devient **`C.11`**. Et les deux sont **replacées** :
la fusion automatique laissait l'ordre `C.1-6, C.10, C.8, C.10, C.9` ; il est rendu croissant.
**Vérifié par script — 897 lignes avant, 897 après**, et aucune ligne altérée hors des deux
en-têtes renumérotées.

**Les quatre `messages/*.json` se sont fusionnés seuls, et la fusion est l’UNION EXACTE** :
**3341** à la base, **+1** côté tronc, **+119** côté S1, **3461** après fusion, parité stricte sur
les quatre langues — **zéro clé manquante, zéro clé en trop**. Et **aucune suppression délibérée
d’aucun côté** : vérifié en confrontant chaque côté à la base, pas supposé (c’est le piège que
M1 bis avait dû trancher à la main).

**CE QUE S1 RENVOIE AU TRONC, ET QUI N’EST PAS TRAITÉ DANS LA FUSION** — quatre points, aucun
bloquant, ordonnés avec les quatorze défauts nommés du gel 4.1d :
① `stripe_event_claim` — un processus mort **entre la réclamation et la clôture** laisse la ligne
   en `received`, et la garde `where status = 'failed'` refuse alors **tous** les réessais de
   Stripe, définitivement. S1 le **signale à l’écran** et n’y touche pas : c’est un arbitrage
   d’**argent**, pas de code. Proposition rendue à l’architecte, décision non prise seul.
② `lib/billing/events.ts` doit **exporter** `STATUTS_OUVRANTS` et la liste des six types du
   `switch` — S1 les a recopiés (jumeaux assumés, §E.20) et son contrôle échoue s’ils divergent.
③ Deux commentaires **faux** dans `app/api/stripe/webhook/route.ts` — « la seule route sans
   `requireAuth` » (elles sont **18 sur 128**, §M1 n°3) et « zéro cron » (**4 routes, 9 tâches**) —
   le second **répété** dans `20260901000000_stripe_fondations.sql`.
④ L’en-tête de `lib/billing/stripe.ts` : `getStripe()` a maintenant **quatre** appelants.

## E. Les pièges vérifiés

> **LES PIÈGES VIVENT DANS [docs/pieges.md](docs/pieges.md) — un fichier, une section par piège.**
> Ils ont été **sortis d'ici le 20/09/2026** : ce fichier avait atteint **190k caractères**, au-delà
> des **150k** que Claude Code charge, et **la mémoire arrivait tronquée sans dire quelle section
> manquait**. C'est le piège que le découpage en trois fichiers avait fermé, reformé en dix jours
> par les §E eux-mêmes. Un contrôle garde désormais le budget de ce fichier (**100k**).
>
> **Avant d'écrire un diagnostic, lisez au moins** : §E.3 (CRLF), §E.7 (les commentaires),
> §E.8 (ancrer sur le bloc), §E.22 (la classe source), §E.33 (le banc s'éprouve), §E.34 (jamais
> sur un nom), §E.38 (ce qui ne se balaie pas se déclare). Un `§E.n` cité dans le code désigne
> une section de `docs/pieges.md`.

| § | Le piège |
|---|---|
| [E.1](docs/pieges.md#e1) | Les clients Supabase ne sont pas typés. Une colonne supprimée casse au runtime, en silence. |
| [E.2](docs/pieges.md#e2) | `tsc` et `next build` ne sont pas interchangeables. |
| [E.3](docs/pieges.md#e3) | Les fins de ligne CRLF cassent tout motif qui traverse un saut de ligne. |
| [E.4](docs/pieges.md#e4) | Des scripts de diagnostic ÉCRIVENT en base. |
| [E.5](docs/pieges.md#e5) | Le couperet de Vercel tue tout travail d'après-réponse hors d'un `after()`. |
| [E.6](docs/pieges.md#e6) | Les cycles RLS produisent une récursion `42P17`. |
| [E.7](docs/pieges.md#e7) | Un contrôle qui lit un COMMENTAIRE reste vert quand la règle disparaît. |
| [E.8](docs/pieges.md#e8) | Un contrôle qui teste une présence ET une absence séparément passe sur une écriture qui satisfait les deux. |
| [E.13](docs/pieges.md#e13) | Un tarif écrit à côté d'un modèle diverge du modèle, et personne ne le voit. |
| [E.10](docs/pieges.md#e10) | UNE VALEUR POSÉE À LA MAIN EN BASE NE SURVIT PAS À UNE RECONSTRUCTION, ET PERSONNE NE LE SAIT. |
| [E.11](docs/pieges.md#e11) | Trois replis différents pour une même absence de configuration, dont un qui invente. |
| [E.12](docs/pieges.md#e12) | Une migration de DONNÉES n'est validée par rien, et son seul usage est une base que personne n'a sous la main. |
| [E.14](docs/pieges.md#e14) | Rien ne dit QUELS diagnostics un lot doit rejouer, alors on les choisit de mémoire. |
| [E.15](docs/pieges.md#e15) | Un composant CLIENT qui applique une règle serveur la fige dans le bundle. |
| [E.16](docs/pieges.md#e16) | Une mémoire fausse ne se voit pas : rien ne dit depuis quand une ligne n'a pas été vérifiée. |
| [E.17](docs/pieges.md#e17) | Une URL saisie par un utilisateur et servie telle quelle à `<img src>` est un mouchard offert. |
| [E.18](docs/pieges.md#e18) | Une SECONDE clé étrangère entre deux tables casse TOUS les embeds PostgREST entre elles. |
| [E.19](docs/pieges.md#e19) | UNE API ASYNCHRONE QUI REND UN IDENTIFIANT DE DEMANDE NE DIT PAS QUE LE MESSAGE EST PARTI. |
| [E.20](docs/pieges.md#e20) | UN CORRECTIF APPLIQUÉ À UN PARCOURS ET NON RÉTROPORTÉ À SON JUMEAU SE LIT COMME CORRIGÉ ALORS QU'IL EST VIVANT. |
| [E.21](docs/pieges.md#e21) | UN CHAMP QUE LE FORMULAIRE NE DEMANDE PAS REÇOIT UNE VALEUR EN DUR — ET CETTE VALEUR CHOISIT UN COMPORTEMENT AILLEURS. |
| [E.22](docs/pieges.md#e22) | UNE ERREUR TECHNIQUE CONVERTIE EN REFUS MÉTIER : LE REFUS EST JUSTE, LE MOTIF MENT. |
| [E.23](docs/pieges.md#e23) | LE COMPTE FANTÔME : `auth.users` créé, `public.users` absent, et AUCUNE ERREUR. |
| [E.24](docs/pieges.md#e24) | UN CHIFFRE JUSTE SOUS UNE ÉTIQUETTE FAUSSE. Distinct de §E.16, et plus retors. |
| [E.25](docs/pieges.md#e25) | PLUSIEURS MAINS, AUCUNE CONVENTION : LE PROPRIÉTAIRE NE SAIT PLUS LIRE SON PRODUIT. |
| [E.26](docs/pieges.md#e26) | UN ÉCRAN QUI AFFICHE TOUT CE QUI EXISTE EN BASE DEVIENT ILLISIBLE — ET C'EST UNE INSTRUCTION D'ARCHITECTE QUI L'A PRODUIT, PAS UN DÉFAUT DE CODE. |
| [E.27](docs/pieges.md#e27) | QUAND LA VALEUR NEUTRE EST RÉÉCRITE OU ESTAMPILLÉE, LA PANNE CESSE DE MENTIR : ELLE DEVIENT LA VÉRITÉ. |
| [E.28](docs/pieges.md#e28) | CE QUE 45 EMPLACEMENTS OUVERTS UN PAR UN ONT APPRIS (lot 4.1b). |
| [E.29](docs/pieges.md#e29) | UN COMMENTAIRE VRAI D'UN CAS COUVRE UN CAS VOISIN OÙ IL EST FAUX. |
| [E.30](docs/pieges.md#e30) | UN TYPE DÉCLARÉ SANS CHAMP D'ERREUR REND L'ÉCHEC IMPENSABLE. |
| [E.31](docs/pieges.md#e31) | UNE GARDE QUI EST UNE CONTRAINTE DE SCHÉMA NE DÉPEND D'AUCUNE DISCIPLINE. |
| [E.32](docs/pieges.md#e32) | UNE DESTINATION QUI N'EXISTE PAS NE LÈVE RIEN : ELLE REND UN 404. |
| [E.33](docs/pieges.md#e33) | UN POINT DE COMPARAISON MAL CHOISI DÉPLACE LA FAUTE. |
| [E.34](docs/pieges.md#e34) | UN CONTRÔLE QUI S'ANCRE SUR UN NOM ROUGIT AU PREMIER RENOMMAGE ET VERDIT AU PREMIER DÉPLACEMENT. |
| [E.35](docs/pieges.md#e35) | SÉPARER LE RÉGLAGE ET LA MESURE FAIT TOMBER LA MESURE. |
| [E.36](docs/pieges.md#e36) | DEUX GARDES QUI TOMBENT SUR LA MÊME PANNE N'EN FONT QU'UNE. |
| [E.37](docs/pieges.md#e37) | UNE GARDE PEUT NE PAS S'OUVRIR : ELLE PEUT CHOISIR LE MAUVAIS ÉTAT. |
| [E.38](docs/pieges.md#e38) | CE QUI NE SE BALAIE PAS SE DÉCLARE. Trois dettes nommées, plutôt que trois contrôles verts. |
| [E.39](docs/pieges.md#e39) | LA GARDE TESTE `X`, L'ACTION CONSOMME `f(X)` : §E.36 À L'INTÉRIEUR D'UNE SEULE FONCTION. |
| [E.40](docs/pieges.md#e40) | UNE FENÊTRE DE VOISINAGE MESURE LA DISTANCE AU TRAITEMENT, PAS SON ABSENCE. |
| [E.41](docs/pieges.md#e41) | LES TROIS PHRASES DU LOT 4.1d. Chacune tient parce qu'elle a un cas MESURÉ derrière. |
| [E.42](docs/pieges.md#e42) | LA CLASSE VOISINE : UNE LECTURE EN ÉCHEC REND UN VERDICT MÉTIER, ET LE STATUT HTTP LE REND DÉFINITIF. |
| [E.43](docs/pieges.md#e43) | UNE RÉTROGRADATION NE SE DÉCIDE PAS SUR UN ÉTAT QU'ON N'A PAS LU. |
| [E.44](docs/pieges.md#e44) | UN CONSTAT PÉRISSABLE NE SE PERSISTE PAS : IL SE REJOUE. UN ÉVÉNEMENT DATÉ, SI. |
| [E.45](docs/pieges.md#e45) | UNE COLLISION QUI NE PRODUIT PAS DE CONFLIT EST PIRE QU'UNE QUI EN PRODUIT. |
| [E.46](docs/pieges.md#e46) | UNE REPRISE MANUELLE NE S'AUTORISE QUE SI « REJOUER » EST INOFFENSIF — ET ÇA SE MESURE. |
| [E.47](docs/pieges.md#e47) | UNE RÈGLE JUSTE, APPLIQUÉE À UNE SEULE SURFACE, SE LIT COMME APPLIQUÉE PARTOUT. |
| [E.48](docs/pieges.md#e48) | UNE VARIABLE CSS NE RÉSOUT PAS DANS UN ATTRIBUT SVG. Elle ne peint RIEN, et rien ne le dit. |
| [E.49](docs/pieges.md#e49) | UNE PROPRIÉTÉ PERSONNALISÉE EST SUBSTITUÉE LÀ OÙ ELLE EST DÉCLARÉE, PAS LÀ OÙ ELLE EST LUE. |
| [E.50](docs/pieges.md#e50) | UN SUFFIXE D'OPACITÉ COLLÉ À UNE COULEUR CESSE DE MARCHER LE JOUR OÙ LA COULEUR DEVIENT UN JETON. |
| [E.51](docs/pieges.md#e51) | UN ÉCRAN QUI SIMULE UNE ANALYSE QUI N'A PAS LIEU FINIT PAR ANNONCER UN RÉSULTAT QU'IL N'A PAS. |
| [E.52](docs/pieges.md#e52) | UN SIGNAL BLOQUANT QU'AUCUNE ACTION NE PEUT ÉTEINDRE APPREND À ÊTRE IGNORÉ. |
| [E.53](docs/pieges.md#e53) | UNE EXCEPTION OUVERTE POUR UNE PAGE DEVIENT UN ENDROIT OÙ D'AUTRES TOMBENT. |
| [E.54](docs/pieges.md#e54) | UNE COULEUR D'ÉTAT POSÉE SUR UN ÉLÉMENT DÉCORATIF DIT QUELQUE CHOSE. ELLE MENT. |
| [E.55](docs/pieges.md#e55) | DEUX PHRASES VRAIES, L'UNE SOUS L'AUTRE, PEUVENT SE LIRE COMME UNE CONTRADICTION. |
| [E.56](docs/pieges.md#e56) | UN LOT QUI CONVERTIT UNE SYNTAXE HÉRITE D'UNE SÉMANTIQUE QUI N'EXISTAIT PAS AVANT LUI. « J'avais vérifié le contrôle, pas l'écran. » |
| [E.57](docs/pieges.md#e57) | L'OUTIL QUI LANCE LES CONTRÔLES N'AVAIT JAMAIS TOURNÉ — 219 COMMITS. Un outil de vérification se vérifie d'abord lui-même. |
| [E.58](docs/pieges.md#e58) | UN CACHE CLÉ SUR L'IDENTITÉ SERT UNE VALEUR CALCULÉE SUR UN CONTENU QUI N'EXISTE PLUS. |
| [E.59](docs/pieges.md#e59) | UN CORRECTIF DE JUSTESSE QUI CHANGE SILENCIEUSEMENT UN COÛT. Les secondes et l'argent n'ont pas de compilateur. |
| [E.60](docs/pieges.md#e60) | `IF NOT EXISTS` SUR UN NOM D'INDEX DÉJÀ PRIS : UNE CRÉATION SAUTÉE EN SILENCE. Une migration qui « réussit » n'a rien prouvé. |
| [E.61](docs/pieges.md#e61) | UN CONTRÔLE DONT LA COUVERTURE EST UNE LISTE TENUE À LA MAIN NE PROTÈGE QUE CE QU'ON A PENSÉ À LUI DONNER. |
| [E.62](docs/pieges.md#e62) | UN DÉFAUT PEUT PROTÉGER QUELQUE CHOSE. LE RÉPARER NE DOIT PAS ROUVRIR CE QU'IL FERMAIT. |
| [E.63](docs/pieges.md#e63) | UN RÉSULTAT POSÉ SUR UN SUPPORT QUI EXPIRE EST UN RÉSULTAT QU'ON PERDRA. |
| [E.64](docs/pieges.md#e64) | `NOT VALID` NE DISPENSE QUE L'INSERTION : IL REND IMMUABLES LES LIGNES QU'IL TOLÈRE. |
| [E.9](docs/pieges.md#e9) | Autres pièges nommés dans le dépôt, à connaître. |

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

> ⚠️ **ET LA RÈGLE A ÉTÉ ENFREINTE PAR LE TRONC LUI-MÊME, QUATRE FOIS.**
> `20260916100000_tarifs_ia`, `…110000_depense_ia_par_acteur`, `…120000_durees_reglables` et
> `…130000_duree_invitation` portent un suffixe **`1xxxxx`** — précisément la plage que le
> paragraphe ci-dessus déclare **fausse et corrigée**. Écrites les 16 et 17 septembre 2026, relues
> plusieurs fois, et personne ne l'a vu : **rien ne pouvait le voir.**
>
> **Aucune collision n'en a résulté** — `1xxxxx` n'est attribuée à aucun worktree, et l'ordre
> chronologique tient. Mais la plage existe *pour* éviter la collision, et celle-ci a déjà coûté un
> renumérotage en urgence.
>
> **Les quatre sont APPLIQUÉES en base — MESURÉ le 18/09/2026.** Ce paragraphe disait « trois des
> quatre », et c'était vrai à sa date : la quatrième était alors **renommable**, et le gel ne disait
> pas laquelle. C'était la seule ligne gelée du dépôt sans raison individuelle (§G.8).
> **La fenêtre est refermée** : au moment de cette mesure le disque portait **65** migrations — il en
> compte **66** depuis `echelle_des_notes` (19/09/2026) —, et la requête sur
> `supabase_migrations.schema_migrations` — celle qui est en tête du gel dans
> [scripts/diag-migration-donnees.mjs](scripts/diag-migration-donnees.mjs) — a rendu **quatre
> lignes**. Le gel est **définitif**.
> ⚠️ La mesure vient d'une **lecture humaine sur la base**, pas du dépôt : aucun contrôle ne peut la
> refaire tout seul (§E.12). Les renommer ferait diverger
> `supabase_migrations.schema_migrations` du disque, donc **rejouer des migrations déjà passées**.
> On ne corrige pas le passé : **on l'inscrit, et on ferme l'avenir.**
>
> **La parade — un CLIQUET**, dans [scripts/diag-migration-donnees.mjs](scripts/diag-migration-donnees.mjs),
> même forme que `diag-colonnes-supprimees` : les quatre sont **gelées nommément**, le compte ne peut
> que **descendre**, et toute **nouvelle** migration hors des plages attribuées fait rougir. Éprouvé
> par mutation, dans les deux sens : une migration en `4xxxxx` est refusée, une gelée renommée dans
> la bonne plage est signalée comme sortie du gel.

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

**G.5 bis — La règle de maintenance est GARDÉE PAR DEUX CONTRÔLES, qui ne disent pas la même chose.**

**La TRACE** — [scripts/diag-memoire-a-jour.mjs](scripts/diag-memoire-a-jour.mjs), qui lit git et
rien d'autre. Sur les **ajouts** seulement (une migration, une route `app/api/**/route.ts`, un
script de `scripts/`), il vérifie **commit par commit** que **l'un des trois fichiers de mémoire** a
été touché dans le même commit, et **nomme** le fichier ajouté et la section où l'écrire.
Échappatoire assumée et tracée : `[memoire:n/a]` dans le message de commit. Trois codes de sortie :
`0` vert · `1` manquement · `2` n'a pas tourné.
`--base=<ref>` dit ce qu'une plage — donc ce que trois worktrees — a oublié ; `--sections` vérifie
qu'aucune réécriture n'a perdu un chapitre, **sur les trois fichiers**.
> ⚠️ **Il force la TRACE, pas la VÉRITÉ.** Son vert dit seulement qu'un fichier a été touché, jamais
> que ce qui y est écrit est juste. Un contrôle qui promettrait la justesse serait pire qu'absent :
> on cesserait de relire.

**LE CONTENU** — [scripts/diag-memoire-exacte.mjs](scripts/diag-memoire-exacte.mjs), né de la
relecture du 16/09/2026 (§M1, §E.16). Il vérifie ce qu'une machine peut vérifier — les liens, les
écrans **dans les deux sens**, les tables **dans les deux sens**, le nombre de migrations — et il
**dit ce qu'il ne vérifie pas**. Il a payé son écriture le jour même : le découpage en trois
fichiers a cassé **55 liens** relatifs, et il les a tous nommés avant le commit.
> ⚠️ **Lui non plus ne dit pas si la PROSE est juste.** Les dix-huit écarts de §M1 étaient pour
> moitié des phrases, et aucune machine ne les aurait trouvées. Ce qui les a trouvées, c'est une
> relecture contre le code — il n'y a pas de raccourci.

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

**G.8 — UN CLIQUET FIGE UN INVENTAIRE, IL NE LE JUGE PAS — et tous les gels ne se valent pas.**
Née du lot 1.3 : trois lignes avaient été gelées **sans être ouvertes**, au motif qu'elles
« ressemblaient » aux autres. Elles ne leur ressemblaient pas — l'une écrivait en base, sous les yeux
de l'administrateur, un motif faux (§E.22 ⑦).

**La règle, et elle vaut pour tous les cliquets du dépôt : porter une ligne dans un gel sans l'avoir
lue, c'est déclarer légitime ce qu'on n'a pas regardé.**

**Le critère qui dit lesquels sont dangereux** — il n'était écrit nulle part, et il sépare deux
choses qui ont la même forme :

| Ce que le gel contient | Ce qu'une ligne y signifie | Ce qu'une ligne non jugée coûte |
|---|---|---|
| **des EXEMPTIONS** — `diag-colonnes-supprimees.DETTE`, `diag-echec-silencieux.GEL`, `diag-migration-donnees.GEL`, `diag-lot7-securite.EXCEPTIONS`, `diag-pays-organisation.EXCEPTIONS_FR` | « ce défaut-là est toléré » | **un défaut endormi**, déclaré sain par écrit |
| **un ÉTAT MESURÉ** — `diag-embeds-ambigus.GEL_AMBIGUES` (les paires ambiguës), `diag-ecosystem-scope.INVENTORY` (le mode de chaque route) | « voici ce qui est, au moment du gel » | rien : le contrôle continue de vérifier **chaque** ligne |

Un gel d'exemptions **exige une raison par entrée** — `diag-lire-comparer-ecrire` l'écrit déjà :
*« Chaque entrée porterait sa raison — une liste sans raisons devient un tampon qu'on remplit sans
lire. »* Un gel d'état mesuré n'en a pas besoin, et lui en demander une est du bruit.

**Corollaire, et c'est le vrai piège** : un **recensement** qui ne fige rien et **n'échoue jamais**
n'est pas un cliquet — c'est une carte. `diag-erreurs-avalees` **en était une** : 142 emplacements
sur 68 fichiers, aucun jugé, aucun gelé, et `app/` + `lib/` seulement. Une carte ne ferme aucune
porte, et **personne ne sait depuis quand elle n'a pas été relue**.

**ELLE EST DEVENUE UN CLIQUET, ET LE PARCOURS COMPLET VAUT D'ÊTRE LU.** Les lots 4.1b, 4.1c et 4.1d
ont ouvert ses emplacements un par un. Au 20/09/2026 : **91 mesurés, 91 jugés, 0 à juger**, sur
`app/` + `lib/` **et** `components/`.

> **ET « JUGÉ » NE VEUT PAS DIRE « LÉGITIME ». IL VEUT DIRE *LU*.**
> C'est la distinction que le lot 4.1d a dû introduire, parce qu'elle manquait et que le mot avait
> commencé à dériver : tant que le gel ne contenait que des emplacements sains, « jugé » s'était mis
> à vouloir dire **acquitté**. Trente-sept emplacements ont été ouverts ; **quinze mentaient**, et
> ils ont été portés dans le gel avec leur mécanisme, leur conséquence et leur **rang** — plutôt que
> laissés en `A_JUGER` (ce qui aurait dit « pas encore regardés », et c'était faux) ou corrigés sans
> arbitrage (ce qui aurait élargi le lot tout seul, la faute inverse de celle qu'on ferme).
>
> **LES QUINZE SONT FERMÉS — 20/09/2026.** Le rang 1 (`profile:671`, une lecture en panne qui
> **écrivait en base**) d’abord et seul ; les quatorze autres ensuite, groupés par correctif, dans
> l'ordre rendu à l'architecte et validé par lui. Onze fichiers ont quitté ce gel avec eux : au
> **20/09/2026, 62 emplacements mesurés, 62 jugés, 0 à juger, et plus aucun défaut nommé.**
>
> **La convention reste écrite alors qu'elle ne sert plus, et c'est délibéré.** Le glissement de
> sens qui a produit §G.8 — « jugé » devenu « acquitté » — se reforme précisément quand le gel
> redevient propre. Le jour où un défaut nommé y reviendra, la règle doit déjà être là : **chaque
> raison commence par LÉGITIME ou par DÉFAUT NOMMÉ, et le contrôle les compte à voix haute.**

**G.9 — UN TEXTE DE MÉMOIRE NE S’ÉCRIT JAMAIS PAR UNE CHAÎNE SHELL. Outil d’écriture, toujours.**
Le 20/09/2026, un paragraphe de `docs/pieges.md` a été écrit par `node -e "…"` entre guillemets
doubles : chaque `` `identifiant` `` du texte a été **exécuté comme une commande** par bash, remplacé
par sa sortie — rien — et le script a imprimé `ok`. Le commit est parti mutilé ; il a été vu en
relisant `git show`, pas la sortie (§E.33 ⑤). **Aucun contrôle ne le voit** : `diag-memoire-exacte`
vérifie des liens et des numéros, pas des phrases. La règle est donc de **méthode**, pas d’outil :
un texte destiné à la mémoire — et tout texte qui porte des backticks, un dollar, des guillemets —
passe par un fichier écrit avec l’outil d’écriture, que l’on exécute ensuite. Le shell a une
grammaire, elle s’applique **avant** le programme, et le programme ne peut pas savoir ce qu’il n’a
pas reçu.

> **Et le programme a la sienne, payée le même jour en écrivant CE paragraphe.** Le texte de
> remplacement de `String.prototype.replace` interprète `$&`, `$1`, `` $` `` et `$'` ; la première
> version de cette règle contenait « des `` `$` `` », soit `` $` `` — « le texte AVANT la
> correspondance » — et **tout le début de CLAUDE.md a été réinséré** (740 lignes, deux fois chaque
> section). Vu par `diag-memoire-exacte` (numéro de section en double, budget crevé), pas à l’œil.
> **Un remplacement textuel passe par une fonction** — `s.replace(a, () => b)` — jamais par une
> chaîne : la fonction n’a pas de grammaire.

---

## Les trois autres fichiers de la mémoire

Ce fichier est chargé **à chaque démarrage de session**. Il ne porte donc que ce qu'un worktree doit
avoir sous les yeux **avant d'écrire une ligne** : les décisions déjà arbitrées, les pièges qui
coûtent cher, et les règles de travail. Le reste vit à côté, et se lit quand on en a besoin :

| Fichier | Ce qu'il contient | Quand l'ouvrir |
|---|---|---|
| **[docs/produit.md](docs/produit.md)** | **§P1 à §P4** — les six parcours de bout en bout, les écrans qui existent, les règles métier chiffrées avec leur origine, et ce qui est volontairement inactif. | *Je reprends le projet, ou j'y reviens après des mois.* Se lit **sans** le code. |
| **[docs/architecture.md](docs/architecture.md)** | **§A, §B, §C, §F, §H** — ce qu'est Skilloria, le modèle de données et son histoire, les chaînes fonctionnelles, la classe de défaut « lire puis écrire », et la dette ouverte. | *Je vais toucher au code et je veux savoir où je mets les pieds.* Se lit **avec** le code. |
| **[docs/pieges.md](docs/pieges.md)** | **§E** — les pièges vérifiés, un par section : le cas mesuré, la parade, le contrôle et ce qu'il ne vérifie pas. | *Je vais écrire un diagnostic, un contrôle, ou toucher à une garde.* L'index ci-dessus dit lesquels lire d'abord. |

> **La règle de maintenance vaut pour les QUATRE fichiers**, à l'identique. Une migration → §B
> (*architecture*) · une décision produit → §D (*ici*) · un piège → §E (*pieges*) · un écran → §P2
> (*produit*). Se tromper de
> fichier n'est pas grave ; ne rien écrire l'est.
>
> **Deux contrôles les gardent, et ils ne disent pas la même chose :**
> [`diag-memoire-a-jour`](scripts/diag-memoire-a-jour.mjs) force la **trace** — qu'un des trois ait
> été touché dans le même commit ; [`diag-memoire-exacte`](scripts/diag-memoire-exacte.mjs) vérifie
> une partie du **contenu** (liens, écrans dans les deux sens, tables, nombre de migrations).
> **Aucun des deux ne promet que la prose est juste** (§E.16).

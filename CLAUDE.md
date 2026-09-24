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
> · **CLAUDE.md** *(ici)* — règle de maintenance, conventions, **§M0**, **§D** décisions figées,
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

## M0. Les énoncés PÉRIMÉS des sections anglaises — **déplacés**

Les sections anglaises de ce fichier portent des marqueurs **⚠️ PÉRIMÉ — voir §M0**. Ce que le code
dit *réellement*, énoncé par énoncé, vit en **§M** de
[docs/architecture.md](docs/architecture.md), aux côtés de §M1 et des trois récits de fusion.

**Rien n'a été supprimé, et les marqueurs restent en place** : un marqueur qui pointe vers une
section absente serait pire qu'aucun marqueur — le lecteur saurait qu'on lui cache quelque chose
sans savoir quoi. Ce qui est parti est le **tableau** ; ce qui reste est **l'avertissement**.

**Pourquoi le déplacement.** Ce fichier est chargé à **chaque session** et tient dans **100 000
caractères** (§G.5 bis). Un correctif d'énoncé se lit **le jour où l'on doute d'une phrase**, pas
avant d'écrire une ligne.

## M1. La relecture du 16 septembre 2026 — **déplacée**

Les **18 écarts** trouvés en relisant ce fichier ligne à ligne contre le code — et ce que chacun dit
sur la façon dont on se trompe — vivent désormais en **§M** de
[docs/architecture.md](docs/architecture.md), aux côtés de M1 bis, ter et quater : c'est là que se
tient l'histoire de cette mémoire.

**Pourquoi le déplacement.** Ce fichier est chargé à **chaque session** et tient dans **100 000
caractères**. Une relecture passée n'a pas à être sous les yeux avant d'écrire une ligne ; elle se
lit le jour où l'on doute d'une affirmation. La règle qui en sort, elle, reste ici : **une mémoire
fausse ne se voit pas** — §E.16, et les deux contrôles de §G.5 bis.

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

**D.20 — « ÉLIGIBLE » S'ÉCRIT UNE FOIS. LES SUSPENDUS SONT EXCLUS PARTOUT, SANS EXCEPTION.**
Le moteur a deux sens, et chacun jugeait de son côté. **Trois conditions manquaient côté expert** —
compte **suspendu**, en **suppression**, **anonymisé** — et elles n'étaient même pas *chargeables* :
le `select` ne demandait pas les colonnes. Les deux fichiers affirmaient l'inverse en toutes lettres
(§E.7). Atteignable par les **deux chemins sans session** — le cron de relance et l'approbation par
un administrateur : un expert suspendu était noté (dépense réelle) **et notifié**.

**La règle est une LISTE DE DONNÉES, pas une fonction** — [lib/matching/eligibilite.ts](lib/matching/eligibilite.ts),
module **pur**. Les deux sens n'ont pas la même forme et ne peuvent pas l'avoir : l'un filtre
cinquante mille lignes en SQL, l'autre juge une ligne chargée. Une « fonction partagée » aurait donc
été deux fonctions, c'est-à-dire le jumeau qui vient de diverger (§E.20). Chaque condition porte
donc **les deux formes**, et les deux sens plient la **même** liste.
· le type des raisons est **dérivé** de la liste ; · les **colonnes** du `select` aussi — un test sur
une colonne non chargée lit `undefined` et conclut (§E.1) ; · l'opérateur `neq_ou_null` existe
parce qu'en SQL `colonne <> 'x'` **écarte** un NULL que le test en mémoire **garde**.

**Gardé par [`diag-eligibilite-unique`](scripts/diag-eligibilite-unique.mjs)** — il **exécute les
deux formes** sur trente lignes et exige le même verdict. Détail : **§C.17**
([architecture](docs/architecture.md)).

**D.21 — « OCCUPÉ » FERME AUSSI LE DÉPÔT. Le SERVEUR refuse, pas seulement l'écran.**
*« Je ne reçois rien, je ne vois rien, JE NE POSTULE PAS »* (Youssef, 23/09/2026). Les deux premiers
tiers tenaient ; le troisième non — un match posé **avant** qu'il ne se déclare occupé restait
cliquable, et le serveur acceptait.

**Le dépôt lit la règle ENTIÈRE** (§D.20), pas seulement la disponibilité — parce que §D.19 a rendu
le jugement de Claude **obligatoire** au dépôt : un expert dont le **consentement IA** a été retiré
après la création du match aurait vu son profil partir chez le fournisseur. La garde est posée
**avant toute dépense** et rend une issue **distincte** d'un refus de garde : elle porte sur LUI, et
il peut y remédier.

**L'écran ferme le bouton AVANT le clic, avec sa raison** — pas grisé, **remplacé** (§D.1) — et
l'aptitude vient du **serveur** : la recopier dans l'UI la figerait dans le bundle (§E.15). Parité
CDI **structurelle** : les deux voies montent le même composant.

> ⚠️ **Un TROISIÈME écrivain de la règle a été trouvé en faisant ce point** : `lib/missions/feed.ts`
> posait sa propre expression sous un commentaire disant « UN SEUL endroit lit ces colonnes ».
> Le contrôle de §D.20 ne balayait que `lib/matching/` — il ne pouvait pas le voir (§E.61).
> `DashboardShell` en était un quatrième, pour sa pastille.

**Gardé par [`diag-occupe-ferme-le-depot`](scripts/diag-occupe-ferme-le-depot.mjs)**.

**D.22 — AU PLUS UNE RECHERCHE PAR EXPERT. Le second ATTEND, et rien n'a « échoué ».**
Rien n'empêchait deux recherches simultanées sur le **même** expert : un double clic, ou une bascule
de disponibilité pendant qu'un cron de relance tourne — le même vivier noté deux fois, et **payé**
deux fois. Le mécanisme existait (le bail des tâches de fond ferme exactement ce chevauchement) mais
il était clé sur un **nom de tâche**.

**Le bail devient GÉNÉRIQUE : une portée, une clé** ([lib/bail.ts](lib/bail.ts), table `baux`).
Deux portées — `cron` et `matching_expert` — et **une seule** implémentation : une seconde aurait
été un **jumeau de verrou**, celui qui ne sert que sous concurrence, donc dont l'écart ne se
découvre jamais (§E.20). Les deux fonctions de cron deviennent des **enveloppes** ; leurs cinq
routes n'ont pas une ligne à changer.

**LE FAUX MESSAGE D'ÉCHEC DISPARAÎT.** Le second clic consommait un jeton du plafond horaire et
répondait « Trop de recherches lancées coup sur coup » — un message d'**échec** pour quelque chose
qui n'a pas échoué. Le chemin direct **attend** désormais que le bail se libère **avant** de
consommer le plafond. Si l'attente expire, l'issue est `trop_long` : *« la recherche se poursuit,
vos missions apparaîtront ici »* — qui est vrai.

> ⚠️ **AUCUN CINQUIÈME ÉTAT D'ÉCRAN.** §D.13 ferme l'union à quatre, et « une recherche est en
> cours » serait exactement la branche « on ne sait pas encore » qu'elle interdit — celle qui peut
> rester affichée indéfiniment.

> ⚠️ **ATTENDRE DEMANDE UN BUDGET, ET SEUL CELUI QUI RÉPOND À UN ÉCRAN EN A UN.** Le moteur prend
> le bail ou **passe son tour** ; l'attente vit chez l'appelant direct, dérivée de son propre budget
> de réponse. Une option « attendre N ms » sur le moteur aurait été un réglage que personne ne
> remplit (§D.11), et deux attentes se seraient disputé le même temps.

**Gardé par [`diag-recherche-doublee`](scripts/diag-recherche-doublee.mjs)**.

**D.23 — CHAQUE TEXTE DANS LA LANGUE DE CELUI QUI LE LIT. Écrit une fois, conservé.**
Le jugement au dépôt produit **deux** textes pour **deux** lecteurs — l'explication pour l'EXPERT,
le résumé pour l'ORGANISATION. Ils recevaient **une** seule langue, et elle valait `'fr'` **en
dur** : un expert allemand lisait son explication en français, une organisation espagnole recevait
un résumé qu'elle ne pouvait pas lire. Le type ne portait qu'un champ `locale` — il n'y avait même
pas de place pour la seconde.

| Texte | Lu par | Sa langue vient de |
|---|---|---|
| `reason` | l'expert | `users.locale` de **son** compte |
| `pitch_org` | l'organisation | son **porte-parole** — le membre admin **actif** le plus **ancien** |

**Une organisation n'a pas de langue : elle a des MEMBRES.** La règle existait déjà — c'est celle de
l'e-mail d'approbation — mais elle vivait dans une requête, au milieu d'une route, sous un
commentaire. Elle est écrite une fois
([lib/organisations/porte-parole.ts](lib/organisations/porte-parole.ts)), et le module partage le
**critère**, pas la projection : les trois autres lecteurs ont besoin d'un e-mail ou d'un prénom en
plus, et leur imposer une seconde requête pour une langue qu'ils lisent déjà serait absurde. Ils
sont **déclarés** dans le contrôle, et leur nombre ne peut que descendre (§G.8).

**ÉCRIT UNE FOIS, CONSERVÉ.** La langue de chaque texte est stockée **avec lui** — sans quoi rien ne
dirait plus tard dans laquelle il est (§E.24). Rien ne régénère : si l'un change de langue, il relit
le texte d'origine. **Assumé.**

> ⚠️ **LE PROMPT PRÉVIENT QUE LES DEUX LANGUES PEUVENT DIFFÉRER.** Sans cette phrase, un modèle qui
> trouve la consigne étrange **harmonise** — et le défaut revient, en silence.

**Gardé par [`diag-langue-du-jugement`](scripts/diag-langue-du-jugement.mjs)**.

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

**D.24 — LE COMPTEUR COMPTE CE QU'ON PAIE. L'UNITÉ EST CELLE DU FOURNISSEUR, ET ON LA LIT.**
Le reranker était compté **au DOCUMENT** — `unites: lot.length` × un prix au document — alors que
Cohere facture **à la RECHERCHE**. Mesuré le 23/09/2026 : `rerank_batch_size = 200` et
`usd_par_unite = 0,000002`, soit **0,0004 $** au compteur contre **0,002 $** à la facture.

> ⚠️ **CE N'ÉTAIT PAS UNE ERREUR DE VALEUR, C'ÉTAIT UNE ERREUR D'UNITÉ** — et c'est ce qui la
> rendait insaisissable. Le facteur d'écart **dépend d'un réglage** : environ 10 sur des lots
> pleins, plus de 60 sur des lots d'une quinzaine. Aucune correction de chiffre ne l'aurait fermée ;
> un administrateur qui déplaçait la taille des lots déplaçait le compteur sans le savoir.

**Et les recherches WEB des deux vérificateurs n'étaient comptées NULLE PART.** L'outil natif
`web_search_20250305` se facture à la recherche **en plus** des jetons du même appel ; seuls les
jetons l'étaient.

| Ce qui compte | D'où vient le nombre |
|---|---|
| les **jetons** | `usage.input_tokens` / `output_tokens` |
| les **recherches web** | `usage.server_tool_use.web_search_requests` — **jamais** `max_uses`, qui est un PLAFOND, pas une mesure |
| les **recherches** du reranker | `meta.billed_units.search_units`, rendu par le fournisseur |

**ON LIT, ON N'ESTIME PAS.** Quand le fournisseur ne dit rien, la consommation porte
`source: 'plancher'` et vaut le **minimum structurel** — un appel abouti a été facturé au moins une
unité. Ce n'est pas une estimation, c'est une **borne, et elle est déclarée** : sans cette étiquette,
une valeur lue et une valeur bornée se liraient pareil (§E.24).

**UNE SEULE FABRIQUE POUR LA FORME « JETONS »** — `consommationJetons()`
([lib/ai-consommation.ts](lib/ai-consommation.ts)). **Sept** sites construisaient l'objet à la main ;
n'en corriger que les deux qui cherchent aurait laissé **cinq jumeaux** (§E.20) — le jour où l'un des
cinq active la recherche, sa dépense redevient muette, **en silence**, et un appel qui cherche a
exactement la même tête qu'un appel qui ne cherche pas. Elle lit l'`usage` de façon **structurelle** :
typer `server_tool_use` lierait le compteur à une version du SDK, et un `?? 0` sur un champ absent
compile très bien tout en ne comptant jamais rien (§E.1).

**UN COÛT PARTIEL EST UN COÛT FAUX.** Un appel qui a cherché sans que la grille porte un prix de
recherche rend **`null`**, pas le prix de ses seuls jetons : l'appelant a déjà le chemin « tarif
inconnu », et un montant incomplet se lirait comme complet.

**TROIS FORMES EN BASE, ET LA CONTRAINTE LES TIENT** — `ai_model_tarifs_forme_check`, migration
`tarif_par_recherche` : jetons · par document (historique, conservée pour que les lignes déjà
écrites restent recalculables) · par recherche. Une et une seule, jamais deux, jamais aucune.
`usd_par_recherche_web` **n'est pas une forme mais un SUPPLÉMENT** : seule la forme jetons peut le
porter — ailleurs, ce serait un prix que rien ne peut consommer, c'est-à-dire un réglage mort qui a
l'air vivant parce qu'il est chiffré (§D.11).
La contrainte est posée **VALIDÉE** (les données sont corrigées avant), et sa postcondition
l'**ÉPROUVE** par **quatre sondes** en sous-transaction — dont une qui vérifie que la troisième forme
est **acceptée** : sans elle, une contrainte qui refuse tout passerait les trois sondes de refus
(§E.34). Lire `pg_constraint` n'aurait prouvé qu'un nom pris.

> **Les deux prix sont des RELEVÉS DE GRILLE, pas des mesures de facture** — 0,002 $ la recherche
> (Cohere, relevé par Youssef le 23/09/2026) et 0,01 $ la recherche web (Anthropic). Ils vivent en
> base et se corrigent depuis `/admin/tarifs-ia`, sans déploiement (§D.7). Ce qui est **mesuré**,
> c'est l'unité ; ce qui est **saisi**, c'est le prix.

**Gardé par [`diag-compteur-ce-quon-paie`](scripts/diag-compteur-ce-quon-paie.mjs)** — il **découvre**
les points de dépense au lieu de les lister (§E.61) et **exécute** le module pur (§E.33).
⚠️ Il ne repose **pas** la question « la dépense est-elle enregistrée et le plafond consulté » :
c'est celle de [`diag-depense-ia`](scripts/diag-depense-ia.mjs), et deux gardes sur la même panne
n'en font qu'une (§E.36). Un appel peut être **parfaitement enregistré et parfaitement faux** — le
reranker l'était, et l'autre contrôle le voyait vert.

**D.25 — UN PLAFOND PAR COMPTE. LE GLOBAL DEVIENT LE DERNIER GARDE-FOU.**
Il n'existait qu'UN plafond : le global, par fournisseur. Une seule organisation pouvait donc
consommer le budget de tout l'écosystème, et ce qui s'arrêtait alors s'arrêtait **pour tout le
monde**. Les seuils par acteur existaient — mais ils **ALERTENT**, ils n'ont jamais arrêté une
dépense (§D.9).

> ⚠️ **CE QU'UN PLAFOND DE COMPTE ARRÊTE, ET C'EST LA MOITIÉ QUI COMPTE.** Il arrête ce que la
> **PLATEFORME** dépense d'elle-même pour ce compte. Il n'arrête **RIEN** de ce que la personne
> vient de demander. Décision de Youssef : *« une organisation au plafond PUBLIE QUAND MÊME — elle
> a payé — mais le classement ne part pas. Un expert au plafond garde son compte utilisable. »*

| | Ce qui s'arrête | Ce qui continue |
|---|---|---|
| **organisation au plafond** | le **classement** de ses annonces | elle publie, elle demande ses pitchs, ses annonces passent la garde de qualité |
| **expert au plafond** | ses **recherches automatiques** | il postule, son CV s'analyse, sa vérification aboutit |
| **plafond GLOBAL** | **TOUT** — c'est le dernier garde-fou, et il parle d'un budget qui n'existe plus | — |

**LA CLASSE D'UNE ACTION EST UNE DONNÉE, PAS DEUX `if` BIEN PLACÉS** —
[lib/ai-plafonds.ts](lib/ai-plafonds.ts), `CLASSE_DES_ACTIONS`. `automatique` : la plateforme la
déclenche seule, en boucle, sans que personne ne l'attende sur un écran — c'est là que part l'argent
d'un compte qui dérape. `deliberee` : quelqu'un vient de faire un geste et attend son résultat ; la
bloquer ne protège pas l'argent, elle **casse le geste**, et de façon invisible.
**L'exhaustivité tient par le TYPE** (`satisfies Record<ActionIA, ClasseAction>`) : une huitième
action sans classe **ne compile pas**. Sans ça, elle tomberait par distraction du côté qui ne bloque
jamais — un plafond qu'on ajoute et qui ne plafonne rien.

> ⚠️ **ET `candidature_assessment` EST DÉLIBÉRÉE PARCE QUE §D.19 L'EXIGE.** « Une candidature avec
> sa note et son résumé, ou pas de candidature » : bloquer le jugement, c'est empêcher l'expert de
> postuler, et un compte qui ne peut plus postuler n'est pas « utilisable ». L'abus par répétition
> est fermé ailleurs, et par le bon outil — le plafond horaire de relance (§D.7).

**L'ORDRE EST LE PLUS SPÉCIFIQUE D'ABORD** : le plafond de l'acteur, puis le global. Inversé, un
compte qui dérape serait arrêté par un motif qui dit « la plateforme est à court » — et on
chercherait ailleurs. **L'acteur et l'action sont OBLIGATOIRES** dans `budgetDisponible`, sans
défaut : c'est le compilateur qui a nommé les **sept** points de dépense, un à un. Et chacun
interroge le plafond **de l'acteur qu'il impute** (§E.39) — une garde qui teste X pendant que la
dépense est imputée à Y protège le mauvais compte, et **les deux appels réussissent**.

**L'ALERTE RESTE SOUS LE PLAFOND, ET LA BASE LE TIENT** — `ai_spend_alerte_sous_plafond`. Au-dessus,
elle ne se déclencherait **jamais** : le plafond arrête la dépense avant qu'elle n'y arrive. Ce serait
un réglage qu'on peut saisir, qui s'affiche, et qui ne peut rien produire (§D.11). La route rend un
**400 nommé** plutôt qu'un 500 de contrainte, et elle juge l'**ÉTAT FINAL** — un corps qui ne change
que l'alerte est valide en lui-même et peut contredire le plafond déjà en base (même forme que §D.18).

**LA FENÊTRE MENSUELLE DEVIENT UN MÉCANISME.** Trois fonctions recopiaient
`date_trunc('month', now() at time zone 'utc')` sous un commentaire disant « AU CARACTÈRE PRÈS ».
C'est une **discipline** : le jour où l'une dérive, les totaux se décalent de quelques heures en fin
de mois et **la somme cesse de boucler** — l'écran cesse d'être croyable sans afficher la moindre
erreur. `ai_spend_debut_du_mois()` est désormais la source unique, lue par les **quatre** fonctions
(§E.31).

**CE QUI REMONTE, ET À QUEL NIVEAU.** Un compte au plafond remonte en **ATTENTION**, avec le lien
vers `/admin/consommation`. C'est un arbitrage : un compte au plafond est le fonctionnement
**normal** d'une règle qu'on a posée ; en faire un bloquant le ferait sonner chaque fin de mois, et
un signal bloquant qu'on voit tous les mois **apprend à être ignoré** (§E.52), y compris les fois où
il compte. Le décompte porte sur **TOUS** les acteurs, jamais sur la liste des dix plus gros : un
chiffre juste tant qu'il y en a moins de dix est faux le jour où le signal sert (§E.24).

**ET L'ÉCRAN EXISTE, PARCE QU'UN PLAFOND QU'ON NE VOIT PAS SE RELÈVE AU JUGÉ.**
`/admin/consommation` — ce que chaque compte a coûté, son plafond, son état, **et sur quoi**. La
supervision dit **combien** de comptes sont arrêtés ; cet écran dit **lesquels**, à combien, et sur
quoi. Les deux
états viennent de la **base** : les recalculer dans le navigateur ferait une seconde règle sur une
seconde fenêtre mensuelle (§E.15, §E.20). Ce qui n'est pas détaillé est **dit** — le reste agrégé et
compté, le non-imputable — parce que cacher la troisième famille donnerait un total plus propre et
faux.

> ⚠️ **LA VENTILATION PAR ACTION N'EST PAS UN ORNEMENT, C'EST CE QUI PERMET DE DÉCIDER.** Un compte
> à 24 $ sur un plafond de 25 $ appelle une décision, et on ne la prend pas sans savoir si ces 24 $
> sont cent classements légitimes ou une boucle d'analyses de CV. La donnée existait depuis le
> premier jour — `ai_spend_events` porte l'acteur **et** l'action sur chaque ligne ; il manquait la
> lecture qui les croise. `ai_spend_par_acteur_et_action` retient **les mêmes comptes** que la liste
> (même classement **total**, même fenêtre), et sa postcondition **EXÉCUTE les deux** pour vérifier
> que leurs totaux bouclent et qu'aucun compte n'est d'un côté sans être de l'autre.
> Le détail est **replié par défaut** : cinquante comptes × sept actions font 350 lignes, et un
> écran qui montre tout ce qui existe cesse d'être lu (§E.26).

> **Les deux valeurs — 25 $ par organisation, 5 $ par expert — sont des PROPOSITIONS**, à réviser sur
> un mois de données réelles, comme les alertes le disent déjà d'elles-mêmes. Elles vivent en base et
> se règlent dans `/admin/matching` (§D.7). L'écart avec l'alerte (10 $ / 2 $) est délibéré : **on
> regarde avant de bloquer**.

**Gardé par [`diag-plafond-par-acteur`](scripts/diag-plafond-par-acteur.mjs)** — il **exécute** la
règle (§E.33), **découvre** les appelants au lieu de les lister, et vérifie que la garde et la
dépense portent le **même acteur**. Il ne repose pas la question « la dépense est-elle enregistrée
et le plafond global consulté » : c'est `diag-depense-ia` (§E.36).

> ⚠️ **ET IL GARDE AUSSI L'ÉCRAN DE §D.19, QUI N'AVAIT AUCUNE ASSERTION.** `/admin/depots-en-echec`
> avait été livré et vérifié **existant** ; son **bouton RELANCER** et ses **trois filtres** ne
> l'étaient pas. « L'écran existe » et « l'écran fait ce qu'on attendait » sont deux affirmations
> différentes, et **seule la seconde se garde**. Le contrôle exige désormais que le rejeu appelle
> **la même fonction** que le dépôt d'un expert (découverte, pas listée), qu'il ne rebâtisse **rien**
> du dépôt, et que chacun des trois filtres soit **envoyé par l'écran ET honoré par le serveur** —
> un filtre que le serveur ignore rend une liste qui **a l'air** filtrée, ce qui est pire qu'aucun
> filtre : on croit avoir regardé.

---

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
| [E.65](docs/pieges.md#e65) | DÉPLACER UN TRAITEMENT DÉPLACE LES GARDES QUI EN DÉPENDENT. On relit CHAQUE garde traversée, pas seulement celle qu'on vise. |
| [E.66](docs/pieges.md#e66) | UN `import type` EST EFFACÉ. Le transformer en import de valeur rend un banc MUET, pas rouge. |
| [E.67](docs/pieges.md#e67) | UNE POSTCONDITION QUI COMPARE UNE CHAÎNE RENDUE PAR POSTGRES PARIE SUR UN FORMAT — et jamais exécutée, elle arrête un déploiement sur un faux négatif. |
| [E.68](docs/pieges.md#e68) | UN JOURNAL BEST-EFFORT MENT DÉJÀ : sept traces d'audit sur des réglages d'argent n'ont jamais existé. La parade est le TYPE, pas la consigne. |
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

> ⚠️ **LA RÈGLE A ÉTÉ ENFREINTE PAR LE TRONC LUI-MÊME, QUATRE FOIS** — quatre migrations en
> `1xxxxx`, la plage que ce paragraphe déclare fausse. **Aucune collision n'en est résultée**, les
> quatre sont **appliquées** (mesuré le 18/09/2026), et le gel est **définitif** : on ne corrige pas
> le passé, on l'inscrit et on ferme l'avenir. Le récit complet — la mesure, pourquoi renommer
> ferait rejouer des migrations déjà passées, et la forme du cliquet — vit en **§M** de
> [docs/architecture.md](docs/architecture.md).
>
> **La parade, elle, est ici et elle tourne** : un CLIQUET dans
> [scripts/diag-migration-donnees.mjs](scripts/diag-migration-donnees.mjs) gèle les quatre
> nommément, le compte ne peut que **descendre**, et toute **nouvelle** migration hors des plages
> attribuées fait rougir. Éprouvé par mutation dans les deux sens.

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

**G.4 bis — UNE MIGRATION SE REJOUE SUR UNE BASE JETABLE AVANT TOUT `db push`.**
Le 24/09/2026, un `db push` sur staging s'est arrêté sur une **postcondition fausse** : elle
annonçait absente une fonction que la migration venait de créer. **Six migrations n'avaient jamais
tourné sur une base.** Une postcondition jamais exécutée est une **affirmation**, pas une preuve
(§E.67), et elle est pire qu'absente : elle accuse le code au lieu d'elle-même.

`npx supabase db reset --local` rejoue les 87 migrations depuis zéro. Il suffit — Docker en
marche, `pg_cron` et `pg_net` présents dans l'image `major_version = 17`, et **aucun `seed.sql`**
à prévoir : tarifs, plafonds et réglages sont **semés par des migrations**.
> ⚠️ **UNE BASE VIERGE NE REJOUE PAS LES CAS DE DONNÉES.** Les postconditions qui comparent des
> totaux, comptent des lignes antérieures ou tolèrent un passé daté passent **trivialement** sur du
> vide. Le reset prouve le **DDL et la logique** ; pas ce qui dépend des lignes de staging.

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

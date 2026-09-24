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
> · **CLAUDE.md** *(ici)* — règle de maintenance, conventions, **§M0**, **§D** l'index des décisions figées,
>   **§G** règles entre worktrees, et l'**index** des pièges.
> · **[docs/pieges.md](docs/pieges.md)** — **§E** : les pièges vérifiés, un par section, avec leur
>   cas mesuré et leur contrôle. Sorti d'ici le 20/09/2026 quand ce fichier a dépassé la limite.
> · **[docs/produit.md](docs/produit.md)** — **§P1 à §P4** : les parcours, les écrans, les règles
>   métier chiffrées, ce qui est volontairement inactif.
> · **[docs/architecture.md](docs/architecture.md)** — **§A, §B, §C, §D, §F, §H** : le modèle de données
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

Un worktree ne les rouvre pas sans arbitrage. **Une ligne par décision ici ; le DÉTAIL — le cas
mesuré, les arguments, le contrôle qui la garde — vit en §D de
[docs/architecture.md](docs/architecture.md)**, déplacé le 24/09/2026 pour ramener ce fichier sous
80 000 caractères sans renégocier le budget à chaque lot. **Une décision nouvelle s'ajoute aux deux
endroits, dans le même commit** : sa ligne ici, son détail là-bas.

- **D.1** — **Le lancement est gratuit et rien n'encaisse.** Deux verrous, tous deux au serveur : la clé Stripe scopée par environnement (`sk_test_` en prod et `sk_live_` hors prod refusés) et `ENABLE_BILLING === 'true'`. Aucune variable `NEXT_PUBLIC_`, aucun bouton désactivé sur un mur, mur fermé par ignorance. → [détail](docs/architecture.md#d1)
- **D.2** — **Les SMS de notification sont coupés AU DISPATCHER** (`CANAUX_OUVERTS = ['email']`, un seul point, fermé par défaut) ; les OTP Vonage Verify sont intacts. Rouvrir `sms` réactive une dépense sortante : opt-in d'abord. → [détail](docs/architecture.md#d2)
- **D.3** — **Un expert appartient à un écosystème à vie ; une organisation voit tous les actifs ; l'admin tout ; tout autre type = REFUS** (`ecosystemAccessScope()`). Le filtre est posé DANS la recherche par identifiant (404, jamais 403) ; `x-subdomain` est falsifiable, la garde recroise `users.domain_id`. → [détail](docs/architecture.md#d3)
- **D.4** — **Le nom de l'expert s'affiche abrégé, au serveur** (`Youssef Cherif → YCH`, `toUpperCase()` jamais `toLocaleUpperCase()`) ; e-mail, téléphone, LinkedIn et CV ne sortent JAMAIS vers une organisation, `reveal_contact` vaut `false` toujours. → [détail](docs/architecture.md#d4)
- **D.5** — **Le dévoilement se referme à l'archivage de la candidature** (l'état de vie prime sur le statut), sauf `selected`, actif sans limite. Le motif d'archivage est indifférent ; on ferme le chemin d'accès, pas la trace. → [détail](docs/architecture.md#d5)
- **D.6** — **Aucun score de PERTINENCE chiffré à l'expert** — seul le palier `strong`/`normal` sort ; **la note de CANDIDATURE `N/10`, oui, et c'est voulu** : les deux grandeurs ne disent pas la même chose. → [détail](docs/architecture.md#d6)
- **D.7** — **Le commerce se pilote depuis le back-office, rien en dur** ; `lib/entitlements.ts` ne porte que des codes ; **un réglage règle quelque chose, ou il le dit** ; seed `ON CONFLICT DO NOTHING`. Exception assumée : le plafond anti-abus de relance (20/h/expert) reste dans le code. → [détail](docs/architecture.md#d7)
- **D.8** — **L'organisation PERSONNELLE d'un expert n'a PAS de logo** : ce serait une seconde image de la même personne SANS la gate de dévoilement (`reveal_photo`). Décision de Youssef ; rouvrir suppose de trancher ce point d'abord. → [détail](docs/architecture.md#d8)
- **D.9** — **LE MOT « SEUIL » EST INTERDIT** : **PLAFOND** bloque · **ALERTE** signale · **FILTRE** trie · **NOTE** juge — à l'écran, dans la doc, dans tout code neuf. L'exception est nommée : les **colonnes existantes** (`feed_threshold`, `notify_threshold`, `confidence_threshold`, `auto_approve_threshold`, `seuil_mensuel_usd`) y échappent encore, parce qu'une colonne se lit par son nom dans une chaîne et qu'un renommage casse au **runtime**, en silence (§E.1) — leur renommage est un lot à part. → [détail](docs/architecture.md#d9)
- **D.10** — **Toute note du produit est sur 0-10, il n'y a pas de seconde échelle** : le reranker (0-1) est converti au SEUL point où un score entre dans le système (`lib/matching/rerank.ts`). Détail : §P3.0 (produit). → [détail](docs/architecture.md#d10)
- **D.11** — **Un écran de réglage ne montre que ce qui se décide** : un réglage mort, inerte ou technique se documente (architecture §B.2 ⑨), il ne s'affiche pas avec un champ et un bouton « Enregistrer » — un champ qui ne règle rien finit par être rempli. → [détail](docs/architecture.md#d11)
- **D.12** — **Aucune couleur littérale dans un composant** : jetons `--sk-*` depuis `lib/palette.ts`, posés au serveur ; huit rôles réglables par écosystème, vert/ambre/rouge non réglables ; garde de contraste au serveur (7 paires, ≥ 4,5) ; `--sk-faint` ne porte jamais d'information ; les e-mails portent des littéraux RÉSOLUS depuis la palette. Le gel du cliquet est vide depuis le 21/09/2026. → [détail](docs/architecture.md#d12)
- **D.13** — **Un écran ne simule jamais un travail** : quatre issues de recherche fermées (`trouvees` · `aucune` · `ineligible` · `echec`), la réponse connue au clic se dit au clic, ce qui se lance s'attend (aucun chronomètre), « aucune mission » ne s'écrit que sur une recherche achevée. Report anti-rafale 10 min sur `/api/profile` seulement, plafond horaire partout. → [détail](docs/architecture.md#d13)
- **D.14** — **Une seule coquille (`DashboardShell`) pour les 66 pages connectées, admin compris**, montée par les sub-layouts ; en-tête et barre latérale en `--sk-bandeau` ; un jeton qui ne résout nulle part se voit (définition vérifiée, pas un préfixe). **Parité intégrale CDI/freelance** sur 14 écrans jumeaux. → [détail](docs/architecture.md#d14)
- **D.15** — **Une note appartient aux textes qui l'ont produite** : `matching_notes_partielles.empreinte` (contenu, ordre canonique annonce d'abord, `not null` sans défaut) — une garde qui est une clé ne dépend d'aucune discipline. Le délai de relance passe à 10 min (anti-rafale seulement). → [détail](docs/architecture.md#d15)
- **D.16** — **Relier n'est pas encaisser** : la synchronisation du catalogue Stripe n'exige qu'une clé valide ; l'encaissement exige en plus `ENABLE_BILLING`. Une offre se relie DANS la même action (création, modification), jamais à la main ; le bouton « Relier » est un rattrapage ; l'oubli du passage en live est BLOQUANT en supervision. → [détail](docs/architecture.md#d16)
- **D.17** — **Test et production sont deux catalogues** : `packages_stripe` clée `(package_id, mode)` ; le mode vient de la clé pour le catalogue, de l'événement pour le webhook, jamais d'un défaut. Ce qui décide de la vente est le prix (puis la case, §D.18), jamais le nom ni le statut. → [détail](docs/architecture.md#d17)
- **D.18** — **La gratuité se dit, elle ne se déduit pas** : `packages.is_free`, et la contrainte `packages_gratuite_coherente` tient les deux sens en base ; les routes rendent un 400 nommé sur l'ÉTAT FINAL ; une offre gratuite ne passe jamais par Stripe, ni synchro ni paiement. → [détail](docs/architecture.md#d18)
- **D.19** — **Une candidature existe avec sa note et son résumé, ou elle n'existe pas** : jugement AVANT l'écriture, attendu dans la requête ; contrainte validée en base (borne de date, pas `NOT VALID`) ; pas de filtre à l'affichage, pas de rejeu automatique, l'expert n'est pas prévenu ; `candidature_depots` écrit avant l'appel au modèle et `/admin/depots-en-echec` BLOQUANT tant qu'il n'est pas vide. → [détail](docs/architecture.md#d19)
- **D.20** — **« Éligible » s'écrit une fois** (`lib/matching/eligibilite.ts`, une liste de données à deux formes — SQL et mémoire — pliée par les deux sens) ; suspendus, en suppression et anonymisés exclus partout, sans exception. → [détail](docs/architecture.md#d20)
- **D.21** — **« Occupé » ferme aussi le dépôt** : le serveur refuse avec la règle entière (§D.20), avant toute dépense, avec une issue distincte ; l'écran remplace le bouton (jamais grisé) et l'aptitude vient du serveur. → [détail](docs/architecture.md#d21)
- **D.22** — **Au plus une recherche par expert** : bail générique `baux (portee, cle)`, une seule implémentation ; le second ATTEND avant de consommer le plafond, rien n'a « échoué », aucun cinquième état d'écran ; le budget d'attente vit chez l'appelant qui répond à un écran. → [détail](docs/architecture.md#d22)
- **D.23** — **Chaque texte du jugement dans la langue de son lecteur** — `reason` : `users.locale` de l'expert ; `pitch_org` : le porte-parole de l'organisation (`lib/organisations/porte-parole.ts`) — écrit une fois, conservé avec sa langue ; le prompt prévient que les deux langues peuvent différer. → [détail](docs/architecture.md#d23)
- **D.24** — **Le compteur compte ce qu'on paie, dans l'unité du fournisseur** : recherches Cohere (`billed_units.search_units`), recherches web (`web_search_requests`), jetons ; on lit, on n'estime pas (`source: 'plancher'` déclaré) ; un coût partiel rend `null` ; une seule fabrique `consommationJetons()` ; trois formes de tarif tenues par contrainte. → [détail](docs/architecture.md#d24)
- **D.25** — **Un plafond par compte, le global en dernier garde-fou** (`CLASSE_DES_ACTIONS` : il n'arrête que l'AUTOMATIQUE, jamais le geste — `candidature_assessment` est délibérée à cause de §D.19) ; l'acteur et l'action sont obligatoires ; l'alerte reste sous le plafond, tenu en base ; `ai_spend_debut_du_mois()` source unique ; `/admin/consommation` avec ventilation par action. 25 $ / 5 $ sont des propositions. → [détail](docs/architecture.md#d25)

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

`npx supabase db reset --local` rejoue les 88 migrations depuis zéro. Il suffit — Docker en
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
| **[docs/architecture.md](docs/architecture.md)** | **§A, §B, §C, §D, §F, §H** — ce qu'est Skilloria, le modèle de données et son histoire, les chaînes fonctionnelles, **le détail des décisions figées**, la classe de défaut « lire puis écrire », et la dette ouverte. | *Je vais toucher au code et je veux savoir où je mets les pieds.* Se lit **avec** le code. |
| **[docs/pieges.md](docs/pieges.md)** | **§E** — les pièges vérifiés, un par section : le cas mesuré, la parade, le contrôle et ce qu'il ne vérifie pas. | *Je vais écrire un diagnostic, un contrôle, ou toucher à une garde.* L'index ci-dessus dit lesquels lire d'abord. |

> **La règle de maintenance vaut pour les QUATRE fichiers**, à l'identique. Une migration → §B
> (*architecture*) · une décision produit → §D (*sa ligne ici, son détail dans architecture*) · un piège → §E (*pieges*) · un écran → §P2
> (*produit*). Se tromper de
> fichier n'est pas grave ; ne rien écrire l'est.
>
> **Deux contrôles les gardent, et ils ne disent pas la même chose :**
> [`diag-memoire-a-jour`](scripts/diag-memoire-a-jour.mjs) force la **trace** — qu'un des trois ait
> été touché dans le même commit ; [`diag-memoire-exacte`](scripts/diag-memoire-exacte.mjs) vérifie
> une partie du **contenu** (liens, écrans dans les deux sens, tables, nombre de migrations).
> **Aucun des deux ne promet que la prose est juste** (§E.16).

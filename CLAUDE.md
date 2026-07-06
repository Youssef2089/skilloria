# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> **Next.js 16 warning (from AGENTS.md):** this is not the Next.js in your training data. APIs, conventions and file structure differ. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. Notable already-observed differences: middleware lives in `proxy.ts` (not `middleware.ts`) and exports a `proxy()` function; `params`/`headers()`/`cookies()` are async and must be awaited.

## Project

Skilloria is a **multi-tenant, multilingual talent marketplace** (French-first) built on Next.js 16 (App Router, React 19) + Supabase (Postgres/Auth/Storage) + Anthropic Claude for AI. It connects organisations with certified ecosystem experts (currently the "microsoft" tenant). Deployed on Vercel.

## Commands

```bash
npm run dev        # dev server (localhost:3000 — proxy.ts simulates the "microsoft" subdomain locally)
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
1. `proxy.ts` extracts the subdomain from the `host` header and injects it as the `x-subdomain` request header (also injects `x-pathname` for the dashboard role guard). Locally it hardcodes `microsoft`.
2. Server components read `x-subdomain` via `getDomainConfig()` ([lib/get-domain-config.ts](lib/get-domain-config.ts)), which loads the `domains` + `domain_configs` rows and returns a `DomainConfig` (branding, colors, ecosystem labels, featured products). Falls back to `defaultDomainConfig` ([lib/domain-config.ts](lib/domain-config.ts)) on any error.
3. The root layout ([app/[locale]/layout.tsx](app/[locale]/layout.tsx)) wraps the tree in `<DomainProvider>`; client code reads it via `useDomain()` ([context/DomainContext.tsx](context/DomainContext.tsx)).
4. Every authenticated request re-checks that the user's `domain_id` matches `x-subdomain` (`domain_mismatch` → 403). Tenant isolation is enforced on the server, not just in the URL.

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
- **Matching** ([lib/matching/](lib/matching/)): bidirectional — publication→experts (`runMatchingForPublication`) and expert→publications (`runMatchingForExpert`), sharing `shared.ts` + a **reconcile** engine (`reconcile.ts`) that upserts matches idempotently, preserving `dismissed`/engaged candidatures and only notifying on *fresh* inserts above a threshold. Eligibility scope: same domain, correct user_type, CV parsed, visible, AI consent given, verification approved, not in DND.
- **Verification** ([lib/verification/](lib/verification/)): company verification where **AI is the systematic decider**, not a fallback. Sirene/Companies House provide data; Claude compares field-by-field and produces a confidence score vs a per-country threshold from `verification_providers`. Never auto-*rejects* (business rule) — below threshold → `pending_admin_review`.
- **CV parsing**: `/api/profile/upload-cv` parses PDFs with Claude Haiku (SHA-256 cached, rate-limited 3/24h, RGPD consent required). Model IDs in use: `claude-haiku-4-5-*` (parsing/matching), `claude-sonnet-4-6` (heavier reasoning). Guarded by `ENABLE_AI_CV_PARSING` kill-switch → 503 `ai_disabled`.

### API route conventions
Routes live in `app/api/**/route.ts`. Typical header: `export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'`. They return plain `Response` objects with JSON bodies of shape `{ error, code? }` on failure. Auth guards throw `AuthError` (has `.toResponse()`). See [docs/api.md](docs/api.md) for the profile/CV endpoint contracts and [app/api/me/candidatures/route.ts](app/api/me/candidatures/route.ts) as a reference implementation. Cron endpoints under `app/api/cron/` are protected by `CRON_SECRET`.

### Supabase clients
- **Browser (anon key)**: `lib/supabase.ts` — for the client-side auth session only.
- **Server (service-role key)**: instantiated per-module (`getSupabaseAdmin()` pattern repeated in auth-guard, translations, get-domain-config) with `persistSession: false`. RLS is re-granted by an `ensure_rls` event trigger, so **security is enforced in guard code**, not by relying on a REVOKE holding.

## Environment variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY`, `ENABLE_AI_CV_PARSING`, `RESEND_API_KEY` / `RESEND_FROM_EMAIL` (transactional email via Resend, templates in [lib/emails/](lib/emails/)), `SIRENE_API_TOKEN`, `VONAGE_API_KEY` / `VONAGE_API_SECRET` (phone OTP), `PHONE_OTP_HMAC_SECRET`, `REAUTH_HMAC_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_SITE_URL`. Secrets/`.env*` files are blocked from reads — do not attempt to open them.

## Project conventions
- **UX bar is high** (Stripe/Linear/Vercel level): sticky banners, inline validation errors, focus highlights, deliberate loading/empty states on every page.
- Code comments are in **French** and often reference internal work-lot labels (e.g. "11F", "Lot 2a", "C2", "S3"). Match the existing comment density and language of the file you edit.
- Path alias `@/*` → project root (see [tsconfig.json](tsconfig.json)).

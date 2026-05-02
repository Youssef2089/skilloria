# Skilloria — API Profile & CV (Bloc 2)

Tous les endpoints sont protégés par **`requireAuth`** et nécessitent les headers :

| Header | Valeur | Obligatoire |
|---|---|---|
| `Authorization` | `Bearer <supabase_access_token>` | Oui |
| `x-subdomain` | slug du domaine (`microsoft`, `salesforce`, …) | Oui (fallback `microsoft`) |
| `x-session-token` | `users.last_session_token` (si défini) | Conditionnel |
| `Content-Type` | `application/json` sauf upload-cv (multipart) | Oui |

Erreurs JSON : `{ error: string, code?: string }`. Statuts transversaux :

- `401 no_token` / `invalid_token` — auth manquante ou invalide
- `403 user_missing` / `session_token_mismatch` / `domain_mismatch`
- `503 ai_disabled` — kill-switch `ENABLE_AI_CV_PARSING=false`

---

## POST `/api/profile/upload-cv`

Upload d'un CV PDF, déclenche le parsing IA (Claude Haiku 4.5). Le call est **synchrone** mais retourne un `jobId` pour unifier avec la V2 mobile (poll via `cv-status`).

**Body** : `multipart/form-data`

| Champ | Type | Contrainte |
|---|---|---|
| `file` | `File` (PDF) | max 5 Mo, MIME `application/pdf` |
| `consent` | `'true'` | obligatoire (consentement RGPD pour parsing IA) |

**Réponses**

- `200 { jobId, status: 'done', data: ParsedCV }`
- `200 { jobId, status: 'done', cached: true, data }` — même hash SHA-256 qu'un CV déjà parsé
- `200 { jobId, status: 'failed', error }` — parsing échoué (profil marqué `failed`)
- `400 consent_missing` / `file_missing` / `file_too_large` / `bad_mime`
- `404 profile_missing`
- `429 rate_limited { reset_at }` — >3 parsings / 24h
- `503 ai_disabled`

**Effets**

- Storage : `cv/{user_id}/{sha256}.pdf` (upsert)
- `profiles` : `cv_file_path`, `cv_hash`, `cv_uploaded_at`, `cv_parsing_status`, `ai_consent_at`, `cv_parsing_count_24h` (incrément), `cv_parsing_reset_at`
- Champs extraits mergés **sans écraser** les valeurs manuelles (COALESCE sur `title`, `summary`, `skills`, `branch_id`, `speciality_id`, etc.)
- `audit_logs` : `action='cv_upload'`, `detail` = `{ status, hash, bytes }` ou `{ status:'failed', error, hash }`

**Forme de `data: ParsedCV`**

```json
{
  "title": "string|null",
  "summary": "string|null",
  "seniority": "junior|confirmed|senior|expert|null",
  "years_experience": "number|null",
  "skills": ["string"],
  "certifications": [{ "name": "string", "issuer": "string|null", "year": "number|null" }],
  "branch_slug": "string|null",
  "speciality_slug": "string|null",
  "languages": ["string"],
  "location": "string|null",
  "tjm_min": "number|null",
  "tjm_max": "number|null",
  "linkedin_url": "string|null"
}
```

---

## GET `/api/profile/cv-status/:jobId`

Retourne l'état du parsing. `jobId` = `profiles.id` du user authentifié.

**Réponses**

- `200 { status: 'idle'|'processing'|'done'|'failed', data?, error? }` — `data` présent uniquement si `status === 'done'`
- `403 not_owner` — jobId appartient à un autre user
- `404 not_found`

---

## PATCH `/api/profile`

Met à jour le profil. Tous les champs sont optionnels.

**Body JSON**

```json
{
  "title": "string|null",
  "summary": "string|null",
  "seniority": "junior|confirmed|senior|expert|null",
  "years_experience": "number|null",
  "skills": ["string"],
  "certifications": [{ "name": "string", "issuer": "string|null", "year": "number|null" }],
  "branch_slug": "string|null",
  "speciality_slug": "string|null",
  "languages": ["string"],
  "location": "string|null",
  "work_modes": ["remote", "onsite", "hybrid"],
  "tjm_min": "number|null",
  "tjm_max": "number|null",
  "availability_date": "YYYY-MM-DD|null",
  "linkedin_url": "string|null",
  "visible": "boolean"
}
```

- `branch_slug` / `speciality_slug` sont résolus en `branch_id` / `speciality_id` scopés au `domain_id` du user.
- Si `visible === true`, validation : `title`, `summary`, `skills (>=3)`, `branch_id`, `speciality_id`, `work_modes (>=1)` doivent être renseignés, sinon `400 incomplete { missing: [...] }`.
- Si tout est OK avec `visible=true` : `users.status` passe à `in_review`.

**Réponses**

- `200 { profile }`
- `400 bad_body` / `no_fields` / `bad_branch` / `bad_speciality` / `incomplete`
- `404 profile_missing`
- `500 db_error`

**Effets** : `audit_logs` `action='profile_update'` avec `detail = { keys: [...] }`.

---

## DELETE `/api/profile/cv` (RGPD)

Supprime le CV du user (Storage + colonnes `cv_*` dans `profiles`).

**Réponses**

- `200 { success: true }`
- `404 profile_missing`
- `500 db_error`

**Effets** : fichier retiré de `cv/{user_id}/{hash}.pdf`, colonnes `cv_file_path/cv_hash/cv_uploaded_at/cv_parsing_status/cv_parsed_at/cv_parsing_error` passées à `NULL`, `audit_logs` `action='cv_delete'` avec `detail = { had_file: boolean }`.

---

## Codes d'erreur transversaux

| HTTP | `code` | Signification |
|---|---|---|
| 401 | `no_token` | Header `Authorization` manquant ou mal formé |
| 401 | `invalid_token` | Token Supabase rejeté |
| 403 | `user_missing` / `user_lookup_failed` | Auth OK mais aucune ligne dans `public.users` |
| 403 | `session_token_mismatch` | `x-session-token ≠ users.last_session_token` |
| 403 | `domain_mismatch` | `x-subdomain` ≠ slug du domaine du user |
| 403 | `org_required` / `org_not_approved` | Route protégée par `requireOrgApproved()` (Lot B5+) |
| 500 | `missing_env` | `SUPABASE_SERVICE_ROLE_KEY` ou URL manquante |
| 500 | `db_error` / `storage_error` / `auth_error` | Erreur Supabase ou serveur |
| 503 | `ai_disabled` | `ENABLE_AI_CV_PARSING !== 'true'` |

---

## POST `/api/auth/register-org`

**Public** (pas de `requireAuth`). Inscription d'un compte **client** (`org_type='entreprise'`) ou **cabinet** (`org_type='cabinet'`) avec création atomique :

1. `auth.users` (Supabase Auth) — déclenche le trigger `handle_new_user` qui crée `public.users` (avec `user_type='client'` ou `'cabinet'` selon `role`)
2. `organizations` (initial `verification_status='pending_provider_check'`)
3. `organization_members` (admin de l'org créée)
4. `organization_domains` (1 seul domaine V1, `package_id=null`)
5. Vérification entreprise via `runVerification()` (Sirene → fallback IA Claude) → update `organizations.verification_status` final.

Si une étape échoue après `createUser`, le user auth est supprimé (`auth.admin.deleteUser`) pour éviter un état incohérent.

**Body JSON** :

| Champ | Type | Contrainte |
|---|---|---|
| `country_code` | string | 2 lettres majuscules ISO-3166 |
| `company_name` | string | 2-200 chars |
| `siren` | string \| null | 9 chiffres (si fourni, requis pour la vérif Sirene FR) |
| `vat_number` | string \| null | ≤ 30 chars |
| `email` | string | RFC simple, ≤ 200 chars |
| `password` | string | 8-200 chars |
| `first_name` | string | 1-100 chars |
| `last_name` | string | 1-100 chars |
| `phone` | string \| null | E.164 (`+[1-9]\d{6,14}`) — vérification OTP séparée |
| `domain_slug` | string | slug du sous-domaine cible (ex. `microsoft`) |
| `org_type` | `'entreprise' \| 'cabinet'` | mappé via trigger sur `users.user_type` |

**Réponses**

- `200 { user_id, organization_id, verification_status, verification_method }` — création OK (status peut être `approved`, `pending_admin_review`, ou `rejected` selon résultat de la vérif)
- `400` codes : `invalid_json`, `invalid_country_code`, `invalid_company_name`, `invalid_email`, `invalid_password`, `invalid_first_name`, `invalid_last_name`, `invalid_domain_slug`, `invalid_org_type`, `invalid_siren`, `invalid_vat_number`, `invalid_phone`, `email_domain_blocked`
- `404 domain_not_found` — `domain_slug` inexistant ou inactif
- `409 email_domain_taken` — un autre `organizations.email_domain` matche déjà
- `409 siren_taken` — un autre `organizations.siren` matche déjà
- `500 missing_env` — Supabase env vars absentes
- `500 create_user_failed` — `auth.admin.createUser` a échoué
- `500 org_insert_failed` / `member_insert_failed` / `org_domain_insert_failed`

**Effets** :
- `audit_logs` : `action='org_register', entity_type='organization', entity_id=<org.id>, detail={ method, status, score, attempts_count }`
- `session_logs` : 1 ligne (IP + user-agent)
- `verification_attempts` : 1 ligne par provider essayé (best-effort)
- Si `verification_status='approved'` automatique : `organizations.verified_at = now()`, `verified_by = NULL` (distinguable de la validation admin qui pose un `verified_by`).

---

## POST `/api/auth/send-phone-otp`

Demande l'envoi d'un code OTP par SMS via **Vonage Verify v2**. **Authentification requise** (`requireAuth`) — le user déclenche la vérification de son propre téléphone.

**Body JSON** :

| Champ | Type | Contrainte |
|---|---|---|
| `phone` | string | E.164 (`+[1-9]\d{6,14}`) |

**Effet** : POST `https://api.nexmo.com/v2/verify` avec `{ brand: 'Skilloria', workflow: [{ channel: 'sms', to: <phone sans +> }] }`. Auth Basic `VONAGE_API_KEY:VONAGE_API_SECRET`.

**Réponses**

- `200 { request_id }` — à réutiliser dans `/api/auth/verify-phone-otp`
- `400 invalid_json` / `invalid_phone` / `vonage_invalid_request`
- `429 rate_limited` — Vonage a refusé le tarif d'envoi
- `500 missing_env` — `VONAGE_API_KEY` ou `VONAGE_API_SECRET` absent
- `502 vonage_error` — provider injoignable ou répond non-OK

---

## POST `/api/auth/verify-phone-otp`

Vérifie le code OTP saisi par le user et flip `users.phone_verified=true` côté BDD. **Authentification requise**.

**Body JSON** :

| Champ | Type | Contrainte |
|---|---|---|
| `request_id` | string | reçu de `send-phone-otp` |
| `code` | string | 4-6 chiffres |
| `phone` | string | E.164 — copié dans `users.phone` côté BDD |

**Effet** : POST `https://api.nexmo.com/v2/verify/{request_id}` body `{ code }`. Si Vonage retourne 200, on update `users SET phone_verified=true, phone=<phone>` puis on log `action='phone_verified'`.

**Réponses**

- `200 { phone_verified: true }`
- `400 invalid_json` / `invalid_input` / `invalid_phone` / `invalid_code`
- `410 expired` — Vonage a retourné 404/410 (OTP périmé ou déjà utilisé)
- `500 missing_env` / `db_error`
- `502 vonage_error`

**Effets** : `audit_logs` `action='phone_verified'`, `entity_type='user'`, `entity_id=<user.id>`, `detail={ phone_e164: <phone> }`.

---

## Helpers serveur

Tous exportés depuis `lib/`. Utilisés par les routes API ; pas exposés au client.

### `requireAuth(request)` — `lib/auth-guard.ts`

Garde principale. Lit `Authorization: Bearer <token>`, valide la session Supabase, charge la ligne `users`, vérifie `last_session_token` et le sous-domaine.

Retour : `{ user, domain, organization, supabaseAdmin }`.

- `user` : `{ id, last_session_token, domain_id, status }`
- `domain` : `{ id, slug }`
- **`organization`** (V1, ajout sprint archi-orga) : `{ id, role_in_org, verification_status }` ou `null` si le user n'a pas de membership active. V1 = 1 user dans 1 org (1ère ligne `organization_members status='active'` par `joined_at ASC` si plusieurs).
- `supabaseAdmin` : client Supabase service-role.

**Backward-compat** : les routes existantes qui font `const { user, domain, supabaseAdmin } = await requireAuth(req)` continuent de fonctionner — `organization` est ignoré silencieusement.

### `requireOrgApproved(authResult)` — `lib/auth-guard.ts`

Helper appelable depuis n'importe quelle route métier qui exige que l'org du user soit déjà approuvée.

Throws `AuthError(403)` :
- `org_required` si `authResult.organization === null`
- `org_not_approved` si `verification_status !== 'approved'`

**Pas appliqué aux routes existantes** (qui ne touchent pas aux orgs). Sera utilisé à partir du Lot B5 sur les routes mission/payment/match/messagerie.

### `logAudit({ supabaseAdmin, user_id, domain_id, action, entity_type?, entity_id?, detail? })` — `lib/audit.ts`

Helper centralisé pour insérer dans `audit_logs`. Best-effort : si l'insert échoue, log un `console.error` mais ne propage jamais (l'audit ne doit pas casser la requête métier).

Schéma : `audit_logs(user_id, domain_id, action, entity_type, entity_id, detail jsonb)`.

### `logSession({ supabaseAdmin, user_id, request, session_token? })` — `lib/session-log.ts`

Insère une ligne dans `session_logs` à chaque login (anti-partage / forensic).

- IP extraite via `x-forwarded-for` (1er segment) avec fallback `x-real-ip`
- User-agent tronqué à 1000 chars
- Best-effort, ne propage pas l'erreur

Appelé par `/api/auth/register-org`. Sera étendu aux flows login Supabase Auth en B3/B5 si besoin.

---

## Pré-requis côté ops

- `.env.local` : `ANTHROPIC_API_KEY`, `ENABLE_AI_CV_PARSING=true`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`
- Variables sprint archi-orga (à ajouter en B2/B3) : `VONAGE_API_KEY`, `VONAGE_API_SECRET`, `SIRENE_API_TOKEN`
- Storage bucket **`cv`** créé (privé, accessible uniquement via service_role)
- Tables attendues : `profiles`, `users`, `domains`, `domain_configs`, `branches`, `specialities`, `audit_logs`
- `audit_logs` : colonne `detail` en `jsonb` (pas `metadata`)

---

## Schema 2026-04 — Sprint archi orga (Phase 2 / Lot B1)

Migration : [`supabase/migrations/20260430120000_archi_orga_b1.sql`](../supabase/migrations/20260430120000_archi_orga_b1.sql) — **idempotente**, à exécuter **manuellement** dans Supabase SQL Editor.

### ENUMs créés

- `organization_role` — `admin | editor | viewer`
- `package_scope` — `organization | user | organization_per_seat`
- `verification_status_enum` — `pending_provider_check | pending_admin_review | approved | rejected | requires_more_info`

> Note : les colonnes `verification_status` / `verification_method` / `role_in_org` / `scope` restent typées `varchar` côté tables (avec `CHECK`) plutôt qu'`USING ENUM`, pour éviter les ALTER COLUMN destructifs ; les ENUMs sont disponibles si on veut les caster plus tard.

### Tables modifiées

**`organizations`** — ajout de `email_domain` (UNIQUE partiel ci-bas), `verification_status`, `verification_method`, `verification_data` (jsonb), `verified_at`, `verified_by` (FK → `users.id`, ON DELETE SET NULL), `verification_notes`. Indexes : `organizations_siren_unique_idx` partiel `WHERE siren IS NOT NULL`, `organizations_email_domain_unique_idx` partiel `WHERE email_domain IS NOT NULL`, `organizations_verification_status_idx`. Les colonnes legacy `user_id` et `domain_id` ne sont **pas** droppées — elles seront retirées dans une future migration `B6_MIGRATION_2` après refacto applicatif.

**`users`** — ajout de `phone_verified` (boolean NOT NULL DEFAULT false).

**`packages`** — ajout de `scope` (varchar NOT NULL DEFAULT `'user'`, CHECK enum), `included_domain_ids` (uuid[]), `max_seats` (int, CHECK > 0).

### Tables créées

| Table | Rôle | Clés |
|---|---|---|
| `organization_members` | Liaison user ↔ org avec `role_in_org` | UNIQUE `(user_id, organization_id)` ; CHECK roles `admin/editor/viewer` ; CHECK status `active/pending/suspended/removed` |
| `organization_invitations` | Tokens d'invitation par email avec validation domaine | `token` UNIQUE ; CHECK status `pending/accepted/expired/revoked` ; expires_at default `now() + 7 days` |
| `organization_domains` | Multi-domaines par org (Microsoft + SAP + …) avec package par domaine | UNIQUE `(organization_id, domain_id)` ; FK → `packages.id` (ON DELETE SET NULL) |
| `verification_providers` | Fournisseurs de vérif entreprise par pays (API officielle / IA / manuel) | UNIQUE `(country_code, provider_name)` ; CHECK type `official_api/ai_web_search/manual_only` ; `confidence_threshold` 0..10 |
| `verification_attempts` | Audit trail de chaque tentative de vérification | INDEX `(organization_id, attempt_at DESC)` ; CHECK result `approved/rejected/inconclusive/error` |
| `blocked_email_domains` | Liste noire de domaines email | UNIQUE `lower(email_domain)` ; INDEX partiel `WHERE active = true` |
| `session_logs` | Logs IP + user-agent à chaque connexion (anti-partage / forensic) | INDEX `(user_id, login_at DESC)` |

### RLS

Activée sur les 7 nouvelles tables. Stratégie :
- `service_role` bypass automatique (les routes API utilisent `supabaseAdmin`).
- `authenticated` :
  - **Lecture** : un membre actif lit son org (members, invitations, domains, verification_attempts admin-only).
  - **Écriture** : un admin actif écrit pour son org (members, invitations, domains).
  - `verification_providers` : lecture authentifiée si `is_active`, écriture admin BO via service_role.
  - `verification_attempts`, `blocked_email_domains`, `session_logs` : écriture **service_role uniquement**.
  - `session_logs` : un user lit ses propres logs.

### Seed initial

`verification_providers` reçoit deux entrées FR : `sirene_insee` (priority 10, official_api) et `claude_web_fallback` (priority 100, ai_web_search). Idempotent via `ON CONFLICT (country_code, provider_name) DO NOTHING`.

### Helper SQL

`public.set_updated_at()` (re-créée via `CREATE OR REPLACE`) — attachée en `BEFORE UPDATE` sur les tables qui ont un `updated_at` créé par cette migration : `organization_members`, `organization_invitations`, `organization_domains`, `verification_providers`, `blocked_email_domains`.

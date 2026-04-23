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
| 500 | `missing_env` | `SUPABASE_SERVICE_ROLE_KEY` ou URL manquante |
| 500 | `db_error` / `storage_error` / `auth_error` | Erreur Supabase ou serveur |
| 503 | `ai_disabled` | `ENABLE_AI_CV_PARSING !== 'true'` |

---

## Pré-requis côté ops

- `.env.local` : `ANTHROPIC_API_KEY`, `ENABLE_AI_CV_PARSING=true`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- Storage bucket **`cv`** créé (privé, accessible uniquement via service_role)
- Tables attendues : `profiles`, `users`, `domains`, `domain_configs`, `branches`, `specialities`, `audit_logs`
- `audit_logs` : colonne `detail` en `jsonb` (pas `metadata`)

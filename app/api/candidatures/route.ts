import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/candidatures — l'expert candidate à une publication MATCHÉE.
 *
 * Body : { publication_id: uuid, cover_message?: string (0-2000) }
 *
 * Garde stricte :
 *  - requireAuth → expert authentifié
 *  - profile expert résolu via profiles.user_id = auth.uid()
 *  - MATCH EXIGÉ : un row matches WHERE publication_id=X AND profile_id=expert
 *    doit exister (sinon 403 forbidden — borrnage curation).
 *    + RLS candidatures_expert_insert exige déjà ce match côté base (défense
 *    en profondeur, cf. migration 20260603160000).
 *  - status FORCÉ à 'received' côté serveur.
 *  - match_id et ai_match_score copiés du match correspondant.
 *  - preview construite côté serveur (whitelist safe-fields).
 *  - UNIQUE (publication_id, profile_id) → re-candidature → PG 23505 → 409.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = {
  publication_id?: unknown
  cover_message?: unknown
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/**
 * Whitelist de construction de `candidatures.preview` — strictement les
 * champs NON-SENSIBLES (cf. migration boucle cœur §4).
 *
 * AUTORISÉS : title, summary, skills, seniority, expert_type, tjm_min/max,
 *   salary_min/max, years_experience, work_modes, languages, country, city,
 *   availability_status, profile_score, branch_id, speciality_id.
 *
 * JAMAIS : phone, email, first_name, last_name, cv_url, cv_file_path,
 *   linkedin_url, address_line, postal_code, photo_url, birth_year, user_id.
 */
function buildPreview(profile: Record<string, unknown>): Record<string, unknown> {
  return {
    title: profile.title ?? null,
    summary: profile.summary ?? null,
    skills: Array.isArray(profile.skills) ? profile.skills : [],
    seniority: profile.seniority ?? null,
    expert_type: profile.expert_type ?? null,
    years_experience: profile.years_experience ?? null,
    years_total_experience: profile.years_total_experience ?? null,
    tjm_min: profile.tjm_min ?? null,
    tjm_max: profile.tjm_max ?? null,
    salary_min: profile.salary_min ?? null,
    salary_max: profile.salary_max ?? null,
    work_modes: Array.isArray(profile.work_modes) ? profile.work_modes : [],
    languages: Array.isArray(profile.languages) ? profile.languages : [],
    country: profile.country ?? null,
    city: profile.city ?? null,
    availability_status: profile.availability_status ?? null,
    availability_date: profile.availability_date ?? null,
    profile_score: profile.profile_score ?? null,
    branch_id: profile.branch_id ?? null,
    speciality_id: profile.speciality_id ?? null,
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }

  const publicationId = asString(body.publication_id)
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid publication_id', code: 'invalid_publication_id' }, 400)
  }
  const coverRaw = asString(body.cover_message)
  if (coverRaw && coverRaw.length > 2000) {
    return json({ error: 'cover_message too long (max 2000)', code: 'invalid_cover_message' }, 400)
  }
  const coverMessage = coverRaw

  // ── Profile expert ──────────────────────────────────────────────────────
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, title, summary, skills, seniority, expert_type, ' +
        'years_experience, years_total_experience, tjm_min, tjm_max, salary_min, salary_max, ' +
        'work_modes, languages, country, city, availability_status, availability_date, ' +
        'profile_score, branch_id, speciality_id',
    )
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (pErr || !profile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }
  const profileRow = profile as unknown as Record<string, unknown> & { id: string; domain_id: string }

  // ── Match requis (borrnage curation) ────────────────────────────────────
  const { data: match, error: mErr } = await auth.supabaseAdmin
    .from('matches')
    .select('id, score, status')
    .eq('publication_id', publicationId)
    .eq('profile_id', profileRow.id)
    .maybeSingle()
  if (mErr) {
    console.error('[candidatures:POST] match query failed', mErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!match) {
    return json({ error: 'No match for this publication', code: 'not_matched' }, 403)
  }
  const matchRow = match as unknown as { id: string; score: number; status: string }

  // ── Vérif publication encore publiée (ne pas candidater sur expirée) ───
  const { data: pub, error: pubErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, status')
    .eq('id', publicationId)
    .maybeSingle()
  if (pubErr || !pub) {
    return json({ error: 'Publication not found', code: 'not_found' }, 404)
  }
  if ((pub as { status: string }).status !== 'published') {
    return json({ error: 'Publication not available', code: 'publication_not_published' }, 409)
  }

  // ── INSERT candidature ─────────────────────────────────────────────────
  const preview = buildPreview(profileRow)
  const { data: inserted, error: insertErr } = await auth.supabaseAdmin
    .from('candidatures')
    .insert({
      publication_id: publicationId,
      profile_id: profileRow.id,
      match_id: matchRow.id,
      domain_id: profileRow.domain_id,
      cover_message: coverMessage,
      ai_match_score: matchRow.score,
      status: 'received',
      preview,
    })
    .select('id, status, created_at')
    .single()

  if (insertErr) {
    // Re-candidature : PG 23505 unique_violation sur (publication_id, profile_id)
    if ((insertErr as { code?: string }).code === '23505') {
      return json({ error: 'Already applied', code: 'already_applied' }, 409)
    }
    console.error('[candidatures:POST] insert failed', insertErr.message)
    return json({ error: 'Insert failed', code: 'db_error' }, 500)
  }
  const row = inserted as unknown as { id: string; status: string; created_at: string }

  // ── Audit best-effort ──────────────────────────────────────────────────
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: profileRow.domain_id,
    action: 'candidature_submitted',
    entity_type: 'candidature',
    entity_id: row.id,
    detail: {
      publication_id: publicationId,
      match_id: matchRow.id,
      ai_match_score: matchRow.score,
      has_cover_message: coverMessage !== null,
    },
  })

  return json(
    {
      id: row.id,
      status: row.status,
      created_at: row.created_at,
    },
    201,
  )
}

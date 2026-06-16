import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/purge-deletions — PURGE RGPD planifiée (mission S3, section 7).
 *
 * Déclenchée quotidiennement par Vercel Cron (cf. vercel.json). Traite les
 * comptes dont deletion_scheduled_at <= now() ET anonymized_at IS NULL.
 *
 * Pour chaque compte échu (idempotent, échec partiel toléré, JAMAIS de
 * fire-and-forget — tout est awaité) :
 *   1. BLOCAGE LOGIN + LIBÉRATION email : admin.updateUserById → email
 *      placeholder unique (libère l'email d'origine) + ban permanent + mot de
 *      passe aléatoire. (JAMAIS auth.admin.deleteUser : messages.sender_id est
 *      ON DELETE CASCADE → l'historique d'interactions DOIT être préservé.)
 *   2. SUPPRESSION fichiers perso : CV (bucket 'cv') + avatar (bucket 'avatars').
 *   3. ANONYMISATION profil : PII vidées, visible=false.
 *   4. ANONYMISATION user : nom vidé, téléphone libéré, email miroir = placeholder,
 *      status='deleted', anonymized_at=now() (posé EN DERNIER → un échec amont
 *      laisse le compte non marqué et il sera repris au prochain run).
 *   Les enregistrements d'interaction (candidatures/conversations/messages)
 *   sont PRÉSERVÉS sous forme désormais anonymisée.
 *
 * Sécurité : protégé par CRON_SECRET (header Authorization: Bearer <secret>,
 * envoyé automatiquement par Vercel Cron ; ?secret= accepté pour un
 * déclenchement manuel de test).
 */

const BATCH_LIMIT = 200
const PERMANENT_BAN = '876000h' // ~100 ans

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase env (URL or SERVICE_ROLE_KEY)')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

type DueUser = {
  id: string
  domain_id: string
  email: string | null
}

async function purgeOne(admin: SupabaseClient, u: DueUser): Promise<void> {
  const uid = u.id
  const placeholderEmail = `deleted+${uid}@deleted.invalid`

  // 1. Bloque le login + libère l'email d'origine (auth = source de vérité).
  //    Si ça échoue, on lève → le compte n'est PAS marqué et sera repris.
  const { error: authErr } = await admin.auth.admin.updateUserById(uid, {
    email: placeholderEmail,
    password: randomUUID() + randomUUID(),
    ban_duration: PERMANENT_BAN,
  })
  if (authErr) {
    throw new Error(`auth_update_failed: ${authErr.message}`)
  }

  // 2. Suppression des fichiers perso (best-effort, ne bloque pas la purge).
  const { data: prof } = await admin
    .from('profiles')
    .select('id, cv_file_path')
    .eq('user_id', uid)
    .maybeSingle()
  if (prof?.cv_file_path) {
    const { error: cvErr } = await admin.storage.from('cv').remove([prof.cv_file_path])
    if (cvErr) console.error('[purge] cv remove failed', { uid, msg: cvErr.message })
  }
  const { error: avErr } = await admin.storage.from('avatars').remove([`${uid}/avatar.jpg`])
  if (avErr) console.error('[purge] avatar remove failed', { uid, msg: avErr.message })

  // 3. Anonymisation du profil (PII vidées, invisible).
  if (prof?.id) {
    const { error: profErr } = await admin
      .from('profiles')
      .update({
        visible: false,
        pre_deletion_visible: null,
        summary: null,
        title: null,
        photo_url: null,
        cv_file_path: null,
        cv_url: null,
        cv_hash: null,
        address_line: null,
        postal_code: null,
        birth_year: null,
        linkedin_url: null,
        phone: null,
        city: null,
        location: null,
        skills: [],
        languages: [],
        certifications: [],
      })
      .eq('id', prof.id)
    if (profErr) throw new Error(`profile_anonymize_failed: ${profErr.message}`)
  }

  // 4. Anonymisation du user (anonymized_at posé EN DERNIER → idempotence).
  const { error: userErr } = await admin
    .from('users')
    .update({
      email: placeholderEmail,
      first_name: null,
      last_name: null,
      phone: null,
      phone_verified: false,
      linkedin_url: null,
      civility: null,
      job_title: null,
      status: 'deleted',
      last_session_token: null,
      anonymized_at: new Date().toISOString(),
    })
    .eq('id', uid)
  if (userErr) throw new Error(`user_anonymize_failed: ${userErr.message}`)

  await logAudit({
    supabaseAdmin: admin,
    user_id: uid,
    domain_id: u.domain_id,
    action: 'account_purged',
    entity_type: 'user',
    entity_id: uid,
    detail: { anonymized: true },
  })
}

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[purge] CRON_SECRET missing')
    return new Response(JSON.stringify({ error: 'Server misconfigured', code: 'missing_env' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return unauthorized()
  }

  const admin = getAdmin()
  const nowIso = new Date().toISOString()

  const { data: dueRaw, error: dueErr } = await admin
    .from('users')
    .select('id, domain_id, email')
    .lte('deletion_scheduled_at', nowIso)
    .is('anonymized_at', null)
    .not('deletion_scheduled_at', 'is', null)
    .limit(BATCH_LIMIT)
  if (dueErr) {
    console.error('[purge] due query failed', dueErr.message)
    return new Response(JSON.stringify({ error: 'Query failed', code: 'db_error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const due = (dueRaw ?? []) as DueUser[]
  let purged = 0
  const failed: { id: string; error: string }[] = []

  for (const u of due) {
    try {
      await purgeOne(admin, u)
      purged += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[purge] account purge failed', { uid: u.id, msg })
      failed.push({ id: u.id, error: msg })
    }
  }

  return new Response(
    JSON.stringify({ ok: true, due: due.length, purged, failed: failed.length, errors: failed }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}

// POST accepté aussi (déclenchement manuel/scripté éventuel).
export async function POST(request: NextRequest): Promise<Response> {
  return handle(request)
}

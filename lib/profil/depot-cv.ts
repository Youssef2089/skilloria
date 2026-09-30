import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { capaciteActive } from '@/lib/interrupteurs'
import { loadCvParsingQuota, QuotaConfigMissing, refuserParQuota } from '@/lib/ai-quotas'
import { checkRateLimit } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'
import { deposerAnalyseCv } from '@/lib/travaux-ia/travail'

/**
 * LE DÉPÔT D'UN CV (ou de l'export PDF d'un profil LinkedIn) — UNE implémentation
 * pour les DEUX voies (§E.20, §D.14) : `POST /api/profile/upload-cv` (freelance) et
 * `POST /api/profile/cdi-upload-cv` (CDI) n'en sont que les portes.
 *
 * ═══ CE QUI A CHANGÉ LE 30/09/2026 (§D.30) ═════════════════════════════════
 *   La route analysait DANS la requête (plafond 60 s) : coupée, le profil restait
 *   « analyse en cours » pour toujours. Désormais elle VÉRIFIE, STOCKE et DÉPOSE —
 *   le profil passe « en cours » et le travail naît dans une transaction — puis
 *   répond aussitôt (202). L'analyse tourne sous l'exécutant des travaux d'IA ;
 *   l'écran suit l'issue par `/api/profile/cv-status/[jobId]`.
 *
 * ═══ LE QUOTA NE COMPTE PLUS QUE LES ANALYSES ABOUTIES (point 5) ════════════
 *   Il est LU ici (on refuse un dépôt qui ne pourrait pas aboutir) et COMPTÉ à
 *   l'écriture de l'analyse, en base. Une erreur de notre côté ne coûte rien à
 *   l'expert. Contre l'abus de dépôts qui échouent, un plafond de dépôts par
 *   heure — une constante nommée, comme le plafond de relance (§D.7).
 */

/** Dépôts par heure et par profil — anti-abus, pas un réglage commercial (même parti que RELANCE_MAX_PAR_HEURE). */
export const DEPOTS_CV_MAX_PAR_HEURE = 10
const MAX_OCTETS = 5 * 1024 * 1024

type Voie = 'expert_freelance' | 'expert_cdi'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

export async function deposerCv(request: NextRequest, voie: Voie): Promise<Response> {
  const tag = voie === 'expert_cdi' ? '[cdi-upload-cv]' : '[upload-cv]'
  let ctx
  try {
    ctx = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error(`${tag} auth error`, err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }
  // LA PIÈCE, À L'ENTRÉE DU GESTE (§D.26) — le travail la garde, ses lignes s'écrivent sous elle.
  const journal = contexteDepuisAuth(ctx)
  const { supabaseAdmin, user } = ctx

  // Convention unique, fail-closed (lib/interrupteurs.ts).
  if (!capaciteActive('ENABLE_AI_CV_PARSING')) {
    return json({ error: 'AI parsing disabled', code: 'ai_disabled' }, 503)
  }

  // ── La voie : chaque porte est réservée à la sienne ──
  {
    const { data: userMeta, error: userMetaErr } = await supabaseAdmin.from('users').select('user_type').eq('id', user.id).maybeSingle()
    // « INTERDIT » EST PIRE QU'« INTROUVABLE » : une lecture en panne rend 503, jamais 403 (§E.42).
    if (userMetaErr) {
      console.error(`${tag} type de compte ILLISIBLE — dépôt refusé temporairement`, { userId: user.id, message: userMetaErr.message })
      return json({ error: 'Could not read the account', code: 'compte_verification_indisponible' }, 503)
    }
    if (!userMeta) return json({ error: 'User not found', code: 'user_missing' }, 404)
    if (userMeta.user_type !== voie) {
      return json({ error: 'This route is reserved for another kind of expert', code: 'wrong_user_type' }, 403)
    }
  }

  // ── Le fichier et le consentement ──
  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error(`${tag} formData parse failed`, err)
    return json({ error: 'Invalid multipart body', code: 'bad_body' }, 400)
  }
  const file = formData.get('file')
  if (formData.get('consent') !== 'true') return json({ error: 'Consent required', code: 'consent_missing' }, 400)
  if (!(file instanceof File)) return json({ error: 'File missing', code: 'file_missing' }, 400)
  if (file.size > MAX_OCTETS) return json({ error: 'File too large (max 5 MB)', code: 'file_too_large' }, 400)
  if (file.type !== 'application/pdf') return json({ error: 'PDF required', code: 'bad_mime' }, 400)
  const buffer = Buffer.from(await file.arrayBuffer())
  const hash = crypto.createHash('sha256').update(buffer).digest('hex')

  // ── Le profil ──
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, cv_hash, cv_parsing_status, cv_parsing_count_24h, cv_parsing_reset_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (profileErr) {
    console.error(`${tag} profil ILLISIBLE — dépôt refusé temporairement`, { userId: user.id, message: profileErr.message })
    return json({ error: 'Could not read the profile', code: 'profil_verification_indisponible' }, 503)
  }
  if (!profile) return json({ error: 'Profile not found', code: 'profile_missing' }, 404)

  // ── Le MÊME document, déjà analysé : rien à refaire, rien à payer ──
  if (profile.cv_hash === hash && profile.cv_parsing_status === 'done') {
    return json({ jobId: profile.id, status: 'done', cached: true })
  }

  // ── Le quota des analyses ABOUTIES, LU (il est compté à l'écriture) ──
  let quota
  try {
    quota = await loadCvParsingQuota(supabaseAdmin)
  } catch (err) {
    if (err instanceof QuotaConfigMissing) {
      console.error(tag, err.message)
      return json({ error: 'Quota not configured', code: err.code }, 503)
    }
    throw err
  }
  const now = new Date()
  const resetAt = profile.cv_parsing_reset_at ? new Date(profile.cv_parsing_reset_at) : null
  const count = profile.cv_parsing_count_24h ?? 0
  if (resetAt !== null && resetAt > now && count >= quota.maxPerWindow) {
    // LE REFUS S'ÉCRIT (§D.26) — par le seul écrivain de `refus_quota_cv`.
    await refuserParQuota(supabaseAdmin, journal, {
      profileId: profile.id,
      quota: 'cv_parsing',
      maxPerWindow: quota.maxPerWindow,
      windowHours: quota.windowHours,
      resetAt: resetAt.toISOString(),
      count,
    })
    return json(
      {
        error: `Rate limit: ${quota.maxPerWindow} parsings / ${quota.windowHours}h`,
        code: 'rate_limited',
        limit: quota.maxPerWindow,
        window_hours: quota.windowHours,
        reset_at: resetAt.toISOString(),
      },
      429,
    )
  }

  // ── L'anti-abus des DÉPÔTS (le quota ne compte plus que les réussites) ──
  if (!(await checkRateLimit(supabaseAdmin, 'depot_cv', profile.id, 3600, DEPOTS_CV_MAX_PAR_HEURE))) {
    return json({ error: 'Too many uploads', code: 'depots_trop_frequents', limit: DEPOTS_CV_MAX_PAR_HEURE }, 429)
  }

  // ── Le stockage privé ──
  const chemin = `${user.id}/${hash}.pdf`
  const { error: storageErr } = await supabaseAdmin.storage.from('cv').upload(chemin, buffer, { contentType: 'application/pdf', upsert: true })
  if (storageErr) {
    console.error(`${tag} storage upload failed`, { userId: user.id, msg: storageErr.message })
    return json({ error: 'Upload failed', code: 'storage_error' }, 500)
  }

  // ── Le dépôt : le profil « en cours » ET le travail, dans une transaction ──
  const depot = await deposerAnalyseCv(supabaseAdmin, journal, { profileId: profile.id, chemin, hash, octets: buffer.length })
  if (!depot.ok) {
    console.error(`${tag} dépôt NON enregistré — le fichier est stocké, le profil inchangé`, { profileId: profile.id, message: depot.message })
    return json({ error: 'Upload not registered', code: 'depot_non_enregistre' }, 500)
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin,
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'cv_upload',
    entity_type: 'profile',
    entity_id: profile.id,
    detail: { status: 'processing', bytes: buffer.length, travail_id: depot.travailId },
  })

  // 202 : accepté, l'analyse suit. `jobId` est l'identifiant du PROFIL, que l'écran sonde.
  return json({ jobId: profile.id, status: 'processing', travail: depot.travailId }, 202)
}

import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * POST /api/profile/cv/reset — REMISE À ZÉRO COMPLÈTE du CV (bug #16).
 *
 * Action destructive et NON contournable (barrière serveur) : efface TOUT ce
 * que le CV avait rempli pour le profil courant, puis repasse le profil en
 * brouillon hors-ligne le temps de re-uploader un nouveau CV.
 *
 * Efface :
 *   - le fichier CV (bucket 'cv') + métadonnées CV + consentement IA
 *   - tous les champs PARSÉS (communs + tjm_* freelance + cdi_* CDI)
 *   - les sous-tables remplies par le parsing (expériences / formations / langues)
 *   - visible=false (un-publish) + verification_status=null + review_reason=null
 *
 * Préserve volontairement :
 *   - photo_url (pas une donnée CV ; re-écrasée si le prochain CV en fournit une)
 *   - cv_parsing_count_24h / cv_parsing_reset_at (compteur anti-abus : pas de
 *     contournement du rate-limit 3/24h via annulation/ré-upload en boucle)
 *   - les préférences saisies à la main non issues du CV (ex. cdi_sectors,
 *     cdi_geo_mobility…) qui ne sont pas remplies par le parsing
 *
 * La route ne distingue pas freelance/CDI : remettre à null une colonne déjà
 * nulle (tjm_* sur un CDI, cdi_* sur un freelance) est un no-op sûr.
 */
export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[cv reset] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  const { supabaseAdmin, user } = auth

  // 1) Récupère le chemin du fichier AVANT de vider les colonnes.
  const { data: profile, error: fetchErr } = await supabaseAdmin
    .from('profiles')
    .select('id, cv_file_path')
    .eq('user_id', user.id)
    .maybeSingle()
  if (fetchErr || !profile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }

  // 2) Supprime le fichier du bucket (best-effort : on n'échoue pas le reset
  //    si le storage rate, mais on log).
  if (profile.cv_file_path) {
    const { error: rmErr } = await supabaseAdmin.storage
      .from('cv')
      .remove([profile.cv_file_path])
    if (rmErr) {
      console.error('[cv reset] storage remove failed', {
        path: profile.cv_file_path,
        msg: rmErr.message,
      })
    }
  }

  // 3) Vide les colonnes (CV + parsées + état). photo_url, cv_parsing_count_24h
  //    et cv_parsing_reset_at NE sont PAS touchés (cf. en-tête).
  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update({
      // Métadonnées CV + consentement
      cv_file_path: null,
      cv_hash: null,
      cv_uploaded_at: null,
      cv_parsing_status: null,
      cv_parsed_at: null,
      cv_parsing_error: null,
      ai_consent_at: null,
      // Champs parsés communs
      title: null,
      summary: null,
      seniority: null,
      years_experience: null,
      skills: null,
      certifications: null,
      branch_id: null,
      speciality_id: null,
      languages: null,
      location: null,
      linkedin_url: null,
      phone: null,
      address_line: null,
      postal_code: null,
      city: null,
      country: null,
      birth_year: null,
      years_total_experience: null,
      work_modes: null,
      // Champs parsés freelance
      tjm_min: null,
      tjm_max: null,
      // Champs parsés CDI
      cdi_status: null,
      cdi_notice_period: null,
      cdi_salary_min: null,
      cdi_salary_max: null,
      cdi_variable_pct: null,
      cdi_career_goals: null,
      cdi_motivations: null,
      // État : un-publish + remise à zéro de la vérification
      visible: false,
      verification_status: null,
      review_reason: null,
    })
    .eq('id', profile.id)
  if (updErr) {
    console.error('[cv reset] profile update failed', updErr)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // 4) Supprime les sous-tables remplies par le parsing.
  for (const table of [
    'profile_experiences',
    'profile_educations',
    'profile_languages',
  ] as const) {
    const { error: delErr } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('profile_id', profile.id)
    if (delErr) {
      console.error(`[cv reset] ${table} delete failed`, delErr)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }

  await logAudit({
    supabaseAdmin,
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'cv_reset',
    entity_type: 'profile',
    entity_id: profile.id,
    detail: { had_file: !!profile.cv_file_path },
  })

  return json({ success: true })
}

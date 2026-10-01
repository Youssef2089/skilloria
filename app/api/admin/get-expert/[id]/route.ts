import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { signAvatarUrl } from '@/lib/avatar'
import { PLAFOND_FICHE_EXPERT, couperEtSignaler, limiteSondee } from '@/lib/plafonds-liste'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-expert/[id] — fiche détaillée d'un profil expert
 * pour la review admin (mirror /api/admin/get-org/[id]).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  const { data: profile, error } = await auth.supabaseAdmin
    .from('profiles')
    .select(
      'id, user_id, domain_id, expert_type, title, summary, seniorities, ' +
        'speciality_ids, speciality_other, ' +
        'years_experience, years_total_experience, languages, skills, certifications, ' +
        'location, mobility, tjm_min, tjm_max, salary_min, salary_max, ' +
        'availability_status, availability_date, work_modes, ' +
        // `cv_file_path`, pas `cv_url` : `cv_url` n'est écrite par AUCUN chemin, la case CV
        // affichait « — » sur tout dossier (recette du 01/10/2026, point 14). Le chemin ne
        // sort pas d'ici : la fiche reçoit `cv_depose`, et le lien se demande au clic
        // (POST /api/admin/lien-cv/[id]).
        'cv_file_path, linkedin_url, visible, ai_consent_at, cv_parsing_status, ' +
        'verification_status, verification_method, verification_score, ' +
        'verification_data, verified_at, verified_by, review_reason, ' +
        'photo_url, country, city, ' +
        'created_at, updated_at, ' +
        // ⚠️ PLUS D'EMBED `specialities(…)` (audit du 30/09/2026, B2) : la clé étrangère
        //    `profiles_speciality_id_fkey` est partie avec la colonne `speciality_id`
        //    (migration profil_annonce_multivalues). PostgREST refusait TOUTE la requête — la fiche
        //    ne s'ouvrait pas, et aucun administrateur ne pouvait approuver ni refuser un expert.
        //    Les libellés se résolvent depuis `speciality_ids`, ci-dessous.
        'branches(id, name, slug), ' +
        'users!profiles_user_id_fkey(id, email, first_name, last_name, locale, user_type, civility, phone, linkedin_url, job_title), ' +
        // D1 : écosystème de l'expert (admin plateforme multi-écosystème).
        'domains(id, name, slug)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[admin:get-expert] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // Charger tables liées (best-effort)
  // ⚠️ C'EST L'ÉCRAN OÙ UN ADMINISTRATEUR APPROUVE OU REFUSE UN EXPERT.
  //    Les trois erreurs n'étaient pas lues : une panne affichait un profil
  //    SANS expérience, SANS formation et SANS langue — et la décision se
  //    prenait là-dessus. Même famille que la vérification par IA, avec un
  //    humain à la place du modèle (§E.22 ⑦).
  const idsSpecialites = ((profile as unknown as { speciality_ids?: string[] | null }).speciality_ids ?? []) as string[]
  const [expRes, eduRes, langRes, spsRes] = await Promise.all([
    // `experience_type` et `client_name` : une mission se lit avec son CLIENT, pas avec un
    // employeur vide (recette du 01/10/2026, point 12).
    auth.supabaseAdmin.from('profile_experiences').select('experience_type, role, employer, client_name, sector, start_date, end_date, is_current, description').eq('profile_id', id).order('start_date', { ascending: false }).limit(limiteSondee(PLAFOND_FICHE_EXPERT.experiences)),
    auth.supabaseAdmin.from('profile_educations').select('school, degree, field, start_year, end_year, location').eq('profile_id', id).order('start_year', { ascending: false }).limit(limiteSondee(PLAFOND_FICHE_EXPERT.educations)),
    auth.supabaseAdmin.from('profile_languages').select('language, level, is_primary').eq('profile_id', id).order('is_primary', { ascending: false }).limit(limiteSondee(PLAFOND_FICHE_EXPERT.languages)),
    idsSpecialites.length > 0
      ? auth.supabaseAdmin.from('specialities').select('id, name, slug').in('id', idsSpecialites)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; slug: string }>, error: null }),
  ])
  // Le commentaire ci-dessus le disait, le code ne le faisait pas : les erreurs sont LUES.
  // Une fiche amputée n'est pas une fiche : 503, jamais une décision sur un dossier incomplet.
  if (expRes.error || eduRes.error || langRes.error || spsRes.error) {
    console.error('[admin:get-expert] tables liées ILLISIBLES — fiche non servie', {
      id,
      experiences: expRes.error?.message ?? null,
      formations: eduRes.error?.message ?? null,
      langues: langRes.error?.message ?? null,
      specialites: spsRes.error?.message ?? null,
    })
    return json({ error: 'Related data unavailable', code: 'fiche_incomplete' }, 503)
  }

  // M3 : photo_url est un chemin storage. Admin voit tout -> URL signée (300s)
  // systématique quand une photo est présente. Seule la VALEUR change.
  const { cv_file_path: cheminCv, ...prof } = profile as unknown as Record<string, unknown> & {
    user_id: string
    photo_url: string | null
    domains?: unknown
    cv_file_path: string | null
  }
  const profDom = Array.isArray(prof.domains) ? prof.domains[0] : prof.domains
  const expert = {
    ...prof,
    // Un fait, pas une adresse : le chemin du fichier reste au serveur.
    cv_depose: typeof cheminCv === 'string' && cheminCv.length > 0,
    photo_url: prof.photo_url ? await signAvatarUrl(auth.supabaseAdmin, prof.user_id) : null,
    // D1 : écosystème exposé à la fiche admin.
    ecosystem: (profDom as { name?: string | null } | null)?.name ?? null,
    // Les spécialités, TOUTES (elles sont multiples depuis profil_annonce_multivalues).
    specialities: (spsRes.data ?? []) as Array<{ id: string; name: string; slug: string }>,
  }

  // L'ÉCRAN OÙ UN ADMINISTRATEUR APPROUVE : trois listes coupées en silence à
  // 20 / 10 / 15 (§E.22 ⑦ avait fermé la PANNE ; la TRONCATURE restait muette).
  // Une ligne-sonde par liste, et la réponse dit laquelle est coupée.
  const exp = couperEtSignaler(expRes.data ?? [], PLAFOND_FICHE_EXPERT.experiences, 'admin/get-expert experiences')
  const edu = couperEtSignaler(eduRes.data ?? [], PLAFOND_FICHE_EXPERT.educations, 'admin/get-expert educations')
  const lang = couperEtSignaler(langRes.data ?? [], PLAFOND_FICHE_EXPERT.languages, 'admin/get-expert languages')
  return json(
    {
      expert,
      experiences: exp.lignes,
      educations: edu.lignes,
      languages_structured: lang.lignes,
      troncature: { experiences: exp.troncature, educations: edu.troncature, languages: lang.troncature },
    },
    200,
  )
}

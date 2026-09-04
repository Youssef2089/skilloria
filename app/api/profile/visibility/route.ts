import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { missingForVisibility, type ProfileVisibilityField } from '@/lib/profile-visibility'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/profile/visibility — « pourquoi mon profil n'est-il pas visible ? »
 *
 * POURQUOI CETTE ROUTE EXISTE
 *   La migration a rendu invisibles des profils déjà publiés : de nouveaux
 *   champs sont devenus nécessaires, et ceux qui ne les avaient pas ont été
 *   masqués. Sans prévenir personne. Ces experts se connectent et ne
 *   comprennent pas ce qui a changé.
 *
 *   La seule réparation possible est de leur dire PRÉCISÉMENT ce qui manque —
 *   pas « votre profil est incomplet ». C'est la règle gelée appliquée à
 *   l'expert lui-même : aucun profil écarté sans une raison nommable et
 *   contestable.
 *
 * POURQUOI AU SERVEUR PLUTÔT QU'À L'ÉCRAN
 *   Le verdict doit être LE MÊME que celui qui refuse la publication. Recalculé
 *   dans chaque accueil, il dériverait, et une bannière finirait par lister des
 *   champs que le serveur n'exige pas — ou par en taire un qu'il exige.
 *   Deux des entrées du prédicat (expériences, langues) vivent d'ailleurs dans
 *   d'autres tables : l'écran ne peut pas les compter sans deux requêtes de
 *   plus.
 *
 * CE QUE LA ROUTE NE DIT PAS
 *   Elle ne prétend pas savoir si le profil a DÉJÀ été visible : rien en base
 *   ne l'enregistre. Elle rend `verification_approved`, un FAIT de la ligne, et
 *   laisse l'écran choisir la formulation. Écrire « votre profil a été masqué »
 *   à quelqu'un qui n'a jamais publié serait un mensonge de plus.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[profile/visibility] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  const { supabaseAdmin, user } = auth

  const { data: userMeta, error: userErr } = await supabaseAdmin
    .from('users')
    .select('user_type')
    .eq('id', user.id)
    .maybeSingle()
  if (userErr) {
    console.error('[profile/visibility] lecture du type de compte en échec', userErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const userType = (userMeta as { user_type?: string } | null)?.user_type ?? null
  if (userType !== 'expert_freelance' && userType !== 'expert_cdi') {
    // Une organisation n'a pas de profil expert : ce n'est pas une erreur,
    // c'est un non-sujet.
    return json({ applicable: false }, 200)
  }

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select(
      'id, visible, title, summary, skills, branch_id, speciality_ids, seniorities, ' +
        'work_zone_ids, availability_status, cdi_status, cv_parsing_status, ai_consent_at, ' +
        'verification_status',
    )
    .eq('user_id', user.id)
    .maybeSingle()

  // DISTINCTION qui a déjà coûté cher ailleurs : une requête en ÉCHEC n'est pas
  // un profil ABSENT. Confondre les deux ferait dire « complétez votre profil »
  // à quelqu'un dont le profil est complet mais illisible à cet instant.
  if (profErr) {
    console.error('[profile/visibility] requête profil en échec', {
      userId: user.id,
      message: profErr.message,
    })
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profile) {
    return json({ applicable: false }, 200)
  }

  const p = profile as unknown as {
    id: string
    visible: boolean | null
    title: string | null
    summary: string | null
    skills: string[] | null
    branch_id: string | null
    speciality_ids: string[] | null
    seniorities: string[] | null
    work_zone_ids: string[] | null
    availability_status: string | null
    cdi_status: string | null
    cv_parsing_status: string | null
    ai_consent_at: string | null
    verification_status: string | null
  }

  // Expériences et langues vivent dans leurs propres tables : deux comptages,
  // en tête seulement.
  const [expRes, langRes] = await Promise.all([
    supabaseAdmin
      .from('profile_experiences')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', p.id),
    supabaseAdmin
      .from('profile_languages')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', p.id),
  ])
  if (expRes.error || langRes.error) {
    console.error('[profile/visibility] comptage expériences/langues en échec', {
      experiences: expRes.error?.message,
      langues: langRes.error?.message,
    })
    // On REFUSE de répondre plutôt que de compter zéro : un zéro emprunté à une
    // panne ferait afficher « il vous manque vos expériences » à quelqu'un qui
    // les a saisies.
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const missing: ProfileVisibilityField[] = missingForVisibility(
    {
      title: p.title,
      summary: p.summary,
      skills: p.skills,
      branch_id: p.branch_id,
      speciality_ids: p.speciality_ids,
      seniorities: p.seniorities,
      work_zone_ids: p.work_zone_ids,
      availability_status: p.availability_status,
      cdi_status: p.cdi_status,
      experiences_count: expRes.count ?? 0,
      languages_count: langRes.count ?? 0,
      cv_parsing_status: p.cv_parsing_status,
      ai_consent_at: p.ai_consent_at,
    },
    userType,
  )

  return json(
    {
      applicable: true,
      visible: p.visible === true,
      missing,
      // FAIT de la ligne, pas une déduction : l'écran s'en sert pour choisir
      // entre « votre profil a été masqué » (il était passé par la
      // vérification, il était donc en ligne) et une formulation neutre.
      verification_approved: p.verification_status === 'approved',
    },
    200,
  )
}

import { missingForVisibility, type ExpertKind } from '@/lib/profile-visibility'
import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
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
 * POST /api/me/account/reactivate — RÉACTIVER pendant la grâce (mission S3,
 * section 7). Restaure le compte : re-actif, re-visible, re-matché.
 *
 * Allowlistée dans auth-guard (accessible MÊME en état « suppression
 * programmée »). Pas de ré-auth (opération restauratrice, l'user est déjà
 * authentifié). Idempotente. Borné à auth.uid().
 */
/** Les colonnes lues pour reevaluer le predicat de visibilite. */
type ProfilPourVisibilite = {
  id: string
  pre_deletion_visible: boolean | null
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
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data: userRow, error: userErr } = await auth.supabaseAdmin
    .from('users')
    .select('deletion_scheduled_at, anonymized_at')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (userErr || !userRow) {
    return json({ error: 'User not found', code: 'user_missing' }, 404)
  }
  // Trop tard : déjà purgé/anonymisé → irréversible.
  if (userRow.anonymized_at) {
    return json({ error: 'Account already anonymized', code: 'already_anonymized' }, 410)
  }
  // Idempotent : pas en cours de suppression → déjà actif.
  if (!userRow.deletion_scheduled_at) {
    return json({ ok: true, reactivated: false }, 200)
  }

  // ── Restauration de la visibilité — LE PRÉDICAT EST ÉVALUÉ, LE REPLI FERME ─
  //
  //  DEUX DÉFAUTS CORRIGÉS ICI, ET ILS VONT DANS LE MÊME SENS.
  //
  //  1. LE SNAPSHOT ÉTAIT RESTAURÉ SANS RIEN VÉRIFIER. `pre_deletion_visible`
  //     dit ce que la personne AVAIT choisi ; il ne dit pas si son profil
  //     remplit ENCORE les conditions de publication. Entre la programmation de
  //     la suppression et la réactivation, la règle a pu changer, ou une donnée
  //     être vidée. On republiait alors un profil incomplet.
  //
  //  2. LE REPLI SUR ÉTAT INCONNU ÉTAIT `true`. Un snapshot absent — profil
  //     créé avant la colonne, écriture perdue — valait « visible ». Sur une
  //     information MANQUANTE, on republiait la personne. C'est l'inverse de la
  //     règle du projet : dans le doute, on ferme.
  //
  //  Désormais : on ne rend la visibilité QUE si la personne l'avait ET que le
  //  profil la mérite encore. Le prédicat est celui de `missingForVisibility`,
  //  jamais une copie — une seconde règle divergerait de la première.
  const { data: profRow, error: profSelErr } = await auth.supabaseAdmin
    .from('profiles')
    .select(
      'id, pre_deletion_visible, title, summary, skills, branch_id, speciality_ids, ' +
        'seniorities, work_zone_ids, availability_status, cdi_status, ' +
        'cv_parsing_status, ai_consent_at',
    )
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (profSelErr) {
    console.error('[account/reactivate] profile select failed', profSelErr.message)
    return json({ error: 'Could not reactivate', code: 'db_error' }, 500)
  }
  if (profRow) {
    const p = profRow as unknown as ProfilPourVisibilite

    // Expériences et langues vivent dans leurs propres tables (même composition
    // que /api/profile/visibility, pour que les deux surfaces disent la même
    // chose).
    const [expRes, langRes] = await Promise.all([
      auth.supabaseAdmin
        .from('profile_experiences')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', p.id),
      auth.supabaseAdmin
        .from('profile_languages')
        .select('id', { count: 'exact', head: true })
        .eq('profile_id', p.id),
    ])
    if (expRes.error || langRes.error) {
      // On REFUSE de compter zéro : un zéro emprunté à une panne fermerait la
      // visibilité de quelqu'un qui a tout saisi.
      console.error('[account/reactivate] comptage expériences/langues en échec', {
        experiences: expRes.error?.message,
        langues: langRes.error?.message,
      })
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }

    const expertKind: ExpertKind =
      auth.user.user_type === 'expert_cdi' ? 'expert_cdi' : 'expert_freelance'
    const manquants = missingForVisibility(
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
      expertKind,
    )

    // REPLI FERMÉ : un snapshot absent ne vaut PAS « visible ».
    const etaitVisible = p.pre_deletion_visible === true
    const restoreVisible = etaitVisible && manquants.length === 0

    const { error: profUpdErr } = await auth.supabaseAdmin
      .from('profiles')
      .update({
        visible: restoreVisible,
        pre_deletion_visible: null,
        deletion_scheduled_at: null,
      })
      .eq('id', p.id)
    if (profUpdErr) {
      // ── UN REFUS QUI DIT CE QUI MANQUE ──────────────────────────────────
      //  La contrainte de base peut refuser la ligne. Rendre `db_error` laissait
      //  l'expert enfermé dans sa période de grâce POUR TOUJOURS, sans qu'aucun
      //  écran ne lui dise pourquoi. On nomme les champs : le client les
      //  traduit depuis `profile_validation.field_errors`, comme partout
      //  ailleurs.
      console.error('[account/reactivate] profile update failed', {
        message: profUpdErr.message,
        manquants,
      })
      return json(
        {
          error: 'Could not restore profile visibility',
          code: 'visibility_blocked',
          missing: manquants,
        },
        409,
      )
    }
  }

  const { error: userUpdErr } = await auth.supabaseAdmin
    .from('users')
    .update({ deletion_scheduled_at: null })
    .eq('id', auth.user.id)
  if (userUpdErr) {
    console.error('[account/reactivate] user update failed', userUpdErr.message)
    return json({ error: 'Could not reactivate', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'account_reactivated',
    entity_type: 'user',
    entity_id: auth.user.id,
  })

  return json({ ok: true, reactivated: true }, 200)
}

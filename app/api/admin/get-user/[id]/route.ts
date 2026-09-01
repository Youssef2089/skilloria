import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
// LA MÊME fonction que les trois routes d'action (user-status,
// user-revoke-session, user-org-role). On ne la réécrit pas, on ne la
// paraphrase pas : l'écran doit masquer EXACTEMENT ce que le serveur refuse.
import {
  refuseAdminActionOnTarget,
  type AdminActionTarget,
} from '@/lib/admin/user-actions-guard'
// Anti-lock-out d'organisation : MÊME prédicat et MÊME compteur que les routes
// de membres. L'avertissement de purge ne se calcule pas autrement qu'ailleurs.
import { countActiveAdmins, wouldRemoveLastAdmin } from '@/lib/org-members'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/get-user/[id] — fiche d'un compte.
 *
 * MÊME POLITIQUE DE DONNÉES QUE LA LISTE (cf. list-users) : identité, accès,
 * rattachement. JAMAIS le numéro de téléphone (seulement `phone_verified`),
 * jamais `last_session_token`, jamais le CV ni les messages.
 *
 * RGPD — CONSULTATION TRACÉE (`user_record_viewed`)
 *   Ouvrir une fiche nominative est un accès à des données personnelles : on
 *   le journalise, avec l'IP et le user-agent de l'administrateur.
 *   La LISTE, elle, n'est pas tracée : une écriture par page de pagination
 *   serait du bruit sans valeur probante, et noierait les accès réels.
 *   La trace est best-effort et n'empêche jamais la lecture — un journal
 *   indisponible ne doit pas rendre le back-office inutilisable.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Ctx = { params: Promise<{ id: string }> }

function pickRel<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function GET(request: NextRequest, ctx: Ctx): Promise<Response> {
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

  const { data: row, error } = await auth.supabaseAdmin
    .from('users')
    .select(
      'id, email, first_name, last_name, civility, job_title, user_type, status, ' +
        'email_verified, phone_verified, is_verified, locale, last_login_at, ' +
        'created_at, updated_at, deletion_scheduled_at, anonymized_at, domain_id, ' +
        'domains(id, name, slug)',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[admin:get-user] lookup failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!row) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  const u = row as unknown as Record<string, unknown>

  /**
   * FAISABILITÉ DES ACTIONS — CALCULÉE PAR LE SERVEUR, JAMAIS DEVINÉE.
   *
   * L'écran affichait « Suspendre » et « Forcer la déconnexion » même quand
   * l'action était structurellement impossible (sa propre fiche, fiche d'un
   * autre administrateur). Le serveur refusait bien, mais l'admin ne
   * l'apprenait qu'après avoir cliqué ET saisi son mot de passe.
   *
   * CE BLOC NE GARDE RIEN. La garde reste entière dans les trois routes
   * d'action, inchangée — un appel forgé se heurte toujours au même refus.
   * Il ne fait que RENDRE LISIBLE la décision, en appelant la même fonction
   * pure : impossible que l'UI et le serveur divergent, puisqu'ils lisent le
   * même verdict.
   *
   * Aucune requête supplémentaire dans le cas courant : la cible est
   * construite depuis la ligne DÉJÀ chargée ci-dessus (mêmes colonnes que
   * `loadAdminActionTarget`), et `refuseAdminActionOnTarget` ne compte les
   * administrateurs que si la cible en est un — ce que l'interdit 2
   * court-circuite avant.
   */
  const actionTarget: AdminActionTarget = {
    id: u.id as string,
    user_type: (u.user_type as string | null) ?? null,
    status: (u.status as string | null) ?? null,
    domain_id: (u.domain_id as string | null) ?? null,
    email: (u.email as string | null) ?? null,
    first_name: (u.first_name as string | null) ?? null,
    last_name: (u.last_name as string | null) ?? null,
  }
  const actionRefusal = await refuseAdminActionOnTarget({
    supabaseAdmin: auth.supabaseAdmin,
    adminUserId: auth.user.id,
    target: actionTarget,
  })

  /**
   * SUPPRESSION DÉFINITIVE — même verdict, plus un refus qui lui est propre.
   *
   * Un compte DÉJÀ anonymisé n'a plus rien à effacer : proposer le bouton
   * mènerait à un 409 après ré-authentification ET saisie de l'adresse. La
   * fiche affiche déjà `anonymized_notice` juste au-dessus ; l'action, elle,
   * disparaît.
   */
  const alreadyAnonymized = !!u.anonymized_at
  const purgeRefusalCode = actionRefusal?.code ?? (alreadyAnonymized ? 'already_anonymized' : null)

  /**
   * AVERTISSEMENT organisation — servi AVANT le clic, pas après.
   *
   * La règle (décision produit) est d'AVERTIR puis d'exiger un acquittement,
   * jamais de bloquer : subordonner un droit RGPD à une structure
   * d'organisation serait inacceptable. Pour que l'avertissement soit lisible
   * au moment de décider, l'écran doit le connaître d'avance — d'où ce calcul
   * ici, et non au moment du refus.
   *
   * Calculé UNIQUEMENT si la purge est possible : un compte qu'on ne peut pas
   * effacer ne paie pas ces requêtes.
   */
  const purgeOrgLockout: { id: string; company_name: string | null }[] = []
  if (purgeRefusalCode === null) {
    const { data: adminMemberships, error: memErr } = await auth.supabaseAdmin
      .from('organization_members')
      .select('organization_id, organizations(id, company_name)')
      .eq('user_id', id)
      .eq('role_in_org', 'admin')
      .eq('status', 'active')
    if (memErr) {
      // Avertissement best-effort : son absence ne doit jamais empêcher
      // d'afficher la fiche. La route de purge re-pose la question de toute
      // façon, et c'est ELLE qui exige l'acquittement.
      console.warn('[admin:get-user] org lockout lookup failed', memErr.message)
    } else {
      for (const row of adminMemberships ?? []) {
        const orgId = (row as { organization_id: string }).organization_id
        const rel = (row as { organizations: unknown }).organizations
        const o = (Array.isArray(rel) ? rel[0] : rel) as
          | { id: string; company_name: string | null }
          | null
        const available = await countActiveAdmins(auth.supabaseAdmin, orgId)
        if (wouldRemoveLastAdmin({ targetIsActiveAdmin: true, activeAdminCount: available })) {
          purgeOrgLockout.push({ id: orgId, company_name: o?.company_name ?? null })
        }
      }
    }
  }

  // Rattachement organisation (membre ACTIF) + profil expert, à plat.
  const [memberRes, profileRes, sessionCountRes] = await Promise.all([
    auth.supabaseAdmin
      .from('organization_members')
      .select('id, organization_id, role_in_org, status, joined_at, organizations(id, company_name, org_type, verification_status)')
      .eq('user_id', id)
      .eq('status', 'active')
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    auth.supabaseAdmin
      .from('profiles')
      .select('id, verification_status, expert_type, title, verified_at')
      .eq('user_id', id)
      .maybeSingle(),
    // « Jamais connecté » ne se déduit pas de last_login_at : la migration
    // 20260709000009 l'a rétro-rempli avec created_at. Seule l'absence de
    // ligne dans session_logs prouve qu'aucune connexion n'a eu lieu.
    auth.supabaseAdmin
      .from('session_logs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', id),
  ])

  const member = memberRes.data as
    | { id: string; organization_id: string; role_in_org: string; organizations: unknown }
    | null
  const org = pickRel(
    member?.organizations as { id: string; company_name: string | null; org_type: string | null; verification_status: string | null } | null,
  )
  const profile = profileRes.data as
    | { id: string; verification_status: string | null; expert_type: string | null; title: string | null; verified_at: string | null }
    | null
  const dom = pickRel(u.domains as { id: string; name: string | null; slug: string | null } | null)

  // Trace RGPD — best-effort, jamais bloquante.
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    // Convention des 51 actions déjà tracées : `domain_id` = domaine de
    // l'ACTEUR (colonne NOT NULL). L'écosystème de la CIBLE, qui peut
    // différer puisque l'admin est plateforme, va dans `detail`.
    domain_id: auth.user.domain_id,
    action: 'user_record_viewed',
    entity_type: 'user',
    entity_id: id,
    detail: { target_domain_id: (u.domain_id as string | null) ?? null },
    request,
  })

  return json({
    user: {
      id: u.id,
      email: u.email,
      first_name: u.first_name,
      last_name: u.last_name,
      civility: u.civility ?? null,
      job_title: u.job_title ?? null,
      user_type: u.user_type,
      status: u.status,
      email_verified: u.email_verified === true,
      // Le NUMÉRO n'est jamais servi (décision produit) — seulement le fait
      // qu'il ait été vérifié. Aucun besoin d'administration ne l'exige.
      phone_verified: u.phone_verified === true,
      is_verified: u.is_verified === true,
      locale: u.locale ?? null,
      last_login_at: u.last_login_at ?? null,
      /** `false` ⇒ « jamais connecté », établi sur session_logs (cf. plus haut). */
      has_ever_logged_in: (sessionCountRes.count ?? 0) > 0,
      created_at: u.created_at,
      deletion_scheduled_at: u.deletion_scheduled_at ?? null,
      anonymized_at: u.anonymized_at ?? null,
      ecosystem: dom ? { id: dom.id, name: dom.name, slug: dom.slug } : null,
    },
    /**
     * Verdict d'administrabilité de CETTE cible pour CET administrateur.
     * `refusal_code` reprend tel quel le code de la garde partagée — le client
     * le traduit, il ne le recalcule pas. `null` = action permise.
     *
     * `target_not_found` ne peut pas apparaître ici : la ligne existe (404
     * renvoyé plus haut sinon).
     */
    actions: {
      can_suspend: actionRefusal === null,
      can_revoke_session: actionRefusal === null,
      refusal_code: actionRefusal?.code ?? null,
      /** Suppression DÉFINITIVE — même garde, plus le cas « déjà anonymisé ». */
      can_purge: purgeRefusalCode === null,
      purge_refusal_code: purgeRefusalCode,
      /**
       * Organisations que la purge laisserait sans administrateur joignable.
       * Vide = aucun avertissement. L'écran l'affiche AVANT le clic ; la route
       * de purge le revalide et exige l'acquittement.
       */
      purge_org_lockout: purgeOrgLockout,
      /**
       * RENVOI D'INVITATION — fenêtre volontairement ÉTROITE, et c'est elle qui
       * fait la sécurité (cf. /api/admin/user-resend-invite) : un administrateur
       * qui ne s'est JAMAIS connecté et dont le compte ne s'en va pas.
       *
       * Cette action N'UTILISE PAS `refuseAdminActionOnTarget` : cette garde
       * interdit d'agir sur un autre administrateur, ce qui refuserait le seul
       * cas qu'on sert. Les deux répondent à des questions différentes — l'une
       * protège d'une action SUBIE, l'autre renvoie un lien vers la boîte mail
       * de l'intéressé sans rien changer à son compte.
       *
       * Le verdict reste SERVEUR : l'écran ne recalcule ni « c'est un admin »
       * ni « il ne s'est jamais connecté ».
       */
      can_resend_invite:
        u.user_type === 'admin' &&
        !u.anonymized_at &&
        !u.deletion_scheduled_at &&
        (sessionCountRes.count ?? 0) === 0,
    },
    organization: member && org
      ? {
          membership_id: member.id,
          id: org.id,
          company_name: org.company_name,
          org_type: org.org_type,
          verification_status: org.verification_status,
          role_in_org: member.role_in_org,
        }
      : null,
    profile: profile
      ? {
          id: profile.id,
          verification_status: profile.verification_status,
          expert_type: profile.expert_type,
          title: profile.title,
          verified_at: profile.verified_at,
        }
      : null,
  })
}

import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/candidatures/[id]/select — l'ORG RETIENT un candidat (lot état
 * 'selected'). C'est l'aboutissement positif d'une candidature.
 *
 *   Mission (publication.type === 'mission')  → "Mission remportée" côté expert.
 *   Offre   (publication.type === 'offre')    → "Poste décroché"    côté expert.
 *
 * Modèle V1 (validation Youssef) :
 *  - Transition UNIQUEMENT depuis 'unlocked' (l'org a déjà accepté l'échange).
 *  - 'selected' est FINAL (pas de retour arrière en V1).
 *  - Côté UI org : bouton "Retenir ce candidat" avec CONFIRMATION explicite
 *    (l'action est irréversible).
 *
 * Garde (service_role) :
 *  - requireAuth + auth.organization?.id présent
 *  - ownership : candidature → publication.organization_id == auth.org.id
 *  - statut courant ∈ ['unlocked'] (idempotent sur 'selected' → 200 already)
 *
 * Effets serveur :
 *  (1) UPDATE candidatures.status='selected' + selected_at=now()
 *      (filtre IN ALLOWED_PREVIOUS_STATUSES : anti-race).
 *  (2) Notif expert (best-effort, n'invalide pas le succès).
 *  (3) Audit best-effort.
 *
 * Conversation : on NE FERME PAS la conversation existante ; les deux parties
 * restent en discussion pour caler les détails (date, contrat, etc.).
 *
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 * ░ NE TOUCHE PAS À : RLS, masquage, gate body.visible, chaîne unlock,    ░░
 * ░ chaîne vérif IA, chaîne messagerie. Le verrou ownership reste pub.   ░░
 * ░ organization_id == auth.organization.id (identique à unlock/reject). ░░
 * ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

// Validation Youssef : on retient UNIQUEMENT après unlock (l'org a déjà
// accepté l'échange et a accès au profil complet). Tout autre statut → 409.
const ALLOWED_PREVIOUS_STATUSES: readonly string[] = ['unlocked']

const NOTIF_TYPE = 'candidature_selected'
const NOTIF_CHANNEL = 'inapp'
const NOTIF_STATUS = 'pending'

const NOTIF_LOCALES = ['fr', 'en', 'es', 'de'] as const
type NotifLocale = (typeof NOTIF_LOCALES)[number]
function normalizeNotifLocale(raw: string | null | undefined): NotifLocale {
  if (raw && (NOTIF_LOCALES as readonly string[]).includes(raw)) return raw as NotifLocale
  return 'fr'
}

// Titres : "Mission remportée" (freelance/mission) vs "Poste décroché"
// (CDI/offre). publication.type est l'unique source de vérité.
const NOTIF_TITLE_MISSION: Record<NotifLocale, string> = {
  fr: 'Mission remportée 🎉',
  en: 'Mission won 🎉',
  es: 'Misión ganada 🎉',
  de: 'Mission gewonnen 🎉',
}
const NOTIF_TITLE_OFFRE: Record<NotifLocale, string> = {
  fr: 'Poste décroché 🎉',
  en: 'Position landed 🎉',
  es: 'Puesto conseguido 🎉',
  de: 'Stelle ergattert 🎉',
}
const NOTIF_BODY_MISSION: Record<NotifLocale, (args: { title: string }) => string> = {
  fr: ({ title }) => `Vous avez été retenu(e) pour la mission « ${title} ». Continuez la conversation pour caler les détails.`,
  en: ({ title }) => `You have been selected for the mission "${title}". Continue the conversation to work out the details.`,
  es: ({ title }) => `Has sido seleccionado/a para la misión «${title}». Continúa la conversación para concretar los detalles.`,
  de: ({ title }) => `Sie wurden für die Mission „${title}" ausgewählt. Setzen Sie das Gespräch fort, um die Details zu klären.`,
}
const NOTIF_BODY_OFFRE: Record<NotifLocale, (args: { title: string }) => string> = {
  fr: ({ title }) => `Vous avez été retenu(e) pour le poste « ${title} ». Continuez la conversation pour caler les détails.`,
  en: ({ title }) => `You have been selected for the position "${title}". Continue the conversation to work out the details.`,
  es: ({ title }) => `Has sido seleccionado/a para el puesto «${title}». Continúa la conversación para concretar los detalles.`,
  de: ({ title }) => `Sie wurden für die Stelle „${title}" ausgewählt. Setzen Sie das Gespräch fort, um die Details zu klären.`,
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  // ── Auth + org ──────────────────────────────────────────────────────────
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const orgId = auth.organization?.id
  if (!orgId) {
    return json({ error: 'No organization', code: 'org_required' }, 403)
  }

  const { id: candidatureId } = await ctx.params
  if (!candidatureId || !UUID_REGEX.test(candidatureId)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }

  // ── Charger candidature + publication (ownership) ──────────────────────
  const { data: cand, error: candErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, publication_id, profile_id, domain_id, status, selected_at, ' +
        'publications!inner(id, organization_id, title, type)',
    )
    .eq('id', candidatureId)
    .maybeSingle()
  if (candErr) {
    console.error('[candidatures/[id]/select:POST] lookup failed', candErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!cand) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  type Joined = {
    id: string
    publication_id: string
    profile_id: string
    domain_id: string
    status: string
    selected_at: string | null
    publications:
      | { id: string; organization_id: string; title: string; type: string }
      | { id: string; organization_id: string; title: string; type: string }[]
  }
  const candRow = cand as unknown as Joined
  const pub = Array.isArray(candRow.publications) ? candRow.publications[0] : candRow.publications
  if (!pub || pub.organization_id !== orgId) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }

  // ── Garde de transition ────────────────────────────────────────────────
  const isAlreadySelected = candRow.status === 'selected'
  if (!isAlreadySelected && !ALLOWED_PREVIOUS_STATUSES.includes(candRow.status)) {
    return json(
      { error: 'Invalid status transition', code: 'invalid_transition', current: candRow.status },
      409,
    )
  }

  // ── UPDATE candidature → selected (idempotent si déjà selected) ────────
  let selectedAtIso: string | null = candRow.selected_at
  let didFlip = false
  if (!isAlreadySelected) {
    const nowIso = new Date().toISOString()
    const { error: updErr } = await auth.supabaseAdmin
      .from('candidatures')
      .update({ status: 'selected', selected_at: nowIso })
      .eq('id', candidatureId)
      .in('status', ALLOWED_PREVIOUS_STATUSES)   // anti-race : re-check transition
    if (updErr) {
      console.error('[candidatures/[id]/select:POST] candidature flip failed', updErr.message)
      return json({ error: 'Candidature update failed', code: 'db_error' }, 500)
    }
    selectedAtIso = nowIso
    didFlip = true
  }

  // ── Notif expert (best-effort) ─────────────────────────────────────────
  //  Notif UNIQUEMENT au flip (didFlip). Re-run sur selected ne renotifie pas.
  if (didFlip) {
    const { data: profileWithUser } = await auth.supabaseAdmin
      .from('profiles')
      .select('id, user_id, users!profiles_user_id_fkey!inner(id, locale, user_type)')
      .eq('id', candRow.profile_id)
      .maybeSingle()
    type ProfUser = {
      id: string
      user_id: string
      users: { id: string; locale: string | null; user_type: string | null } | { id: string; locale: string | null; user_type: string | null }[]
    }
    const pwu = profileWithUser as unknown as ProfUser | null
    if (pwu) {
      const u = Array.isArray(pwu.users) ? pwu.users[0] : pwu.users
      const loc = normalizeNotifLocale(u?.locale ?? null)
      const isMission = pub.type === 'mission'
      const title = isMission ? NOTIF_TITLE_MISSION[loc] : NOTIF_TITLE_OFFRE[loc]
      const body = isMission
        ? NOTIF_BODY_MISSION[loc]({ title: pub.title })
        : NOTIF_BODY_OFFRE[loc]({ title: pub.title })
      // Lien : on pointe sur la page candidatures de l'expert (il y verra
      // le badge "Mission remportée" / "Poste décroché" + accès convo).
      const linkUrl = `${dashboardUrlForUserType(u?.user_type ?? null)}/candidatures`
      const { error: notifErr } = await auth.supabaseAdmin.from('notifications').insert({
        user_id: pwu.user_id,
        domain_id: candRow.domain_id,
        type: NOTIF_TYPE,
        channel: NOTIF_CHANNEL,
        title,
        body,
        link_url: linkUrl,
        status: NOTIF_STATUS,
        entity_id: candidatureId,
      })
      if (notifErr) {
        console.error('[candidatures/[id]/select:POST] notif insert failed', notifErr.message)
      }
    }
  }

  // ── Audit best-effort ──────────────────────────────────────────────────
  if (didFlip) {
    await logAudit({
      supabaseAdmin: auth.supabaseAdmin,
      user_id: auth.user.id,
      domain_id: candRow.domain_id,
      action: 'candidature_selected',
      entity_type: 'candidature',
      entity_id: candidatureId,
      detail: {
        publication_id: candRow.publication_id,
        publication_type: pub.type,
        profile_id: candRow.profile_id,
      },
    })
  }

  return json(
    {
      ok: true,
      already_selected: isAlreadySelected,
      candidature: {
        id: candidatureId,
        status: 'selected',
        selected_at: selectedAtIso,
      },
    },
    200,
  )
}

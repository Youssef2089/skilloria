import { contexteDepuisAuth, parametresJournal } from '@/lib/journal/contexte'
import { STATUT_ARBITRABLE } from '@/lib/verification/types'
import { NextRequest, after } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { dashboardUrlForUserType } from '@/lib/auth-routing'
import { renderExpertWelcomeEmail } from '@/lib/emails/templates'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { sendEmail } from '@/lib/emails/resend'
import { expertSiteOrigin } from '@/lib/emails/domain-url'
import { siteOriginPourRequete } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Matching IA via `after()` (~10-15s) après l'envoi de la response.
export const maxDuration = 60

/**
 * POST /api/admin/approve-expert { profile_id }
 *
 * Mirror /api/admin/approve-org. Décision admin = approve sur profil expert
 * en pending_admin_review.
 *
 * Flow :
 *   1. requireAdmin
 *   2. Vérifier profile existe ET verification_status='pending_admin_review'
 *   3. UPDATE profiles SET verification_status='approved', verified_at=now(),
 *      verified_by=admin_id, review_reason=NULL
 *   4. UPDATE users SET is_verified=true (flag agrégé UI)
 *   5. Notif expert (type 'verification_result', locale users.locale)
 *   6. Audit
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = { profile_id?: unknown; site_url?: unknown }

function siteOriginFromRequest(request: NextRequest, body: Body): string | null {
  // Origine resolue par la source unique (lib/site-url.ts) : corps > en-tete
  // Origin > variable d'environnement. Rend NULL en PRODUCTION si la variable
  // manque — l'appelant N'ENVOIE PAS plutot que d'expedier un lien mort.
  return siteOriginPourRequete({ fourni: body.site_url, origin: request.headers.get('origin') })
}

const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const
function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

const NOTIF_TITLE: Record<string, string> = {
  fr: 'Votre profil est vérifié ✓',
  en: 'Your profile is verified ✓',
  es: 'Tu perfil está verificado ✓',
  de: 'Ihr Profil ist verifiziert ✓',
}
const NOTIF_BODY: Record<string, string> = {
  fr: 'Votre profil est désormais visible des entreprises. Vous apparaissez dans les recommandations IA.',
  en: 'Your profile is now visible to companies. You will appear in AI recommendations.',
  es: 'Tu perfil es ahora visible para las empresas. Aparecerás en las recomendaciones IA.',
  de: 'Ihr Profil ist nun für Unternehmen sichtbar. Sie erscheinen in den KI-Empfehlungen.',
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  // LA PIÈCE, À L'ENTRÉE DU GESTE (§D.26) — elle traverse tout ce qui suit, after() compris.
  const journal = contexteDepuisAuth(auth)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }

  const profileId = typeof body.profile_id === 'string' ? body.profile_id.trim() : ''
  if (!profileId || !UUID_REGEX.test(profileId)) {
    return json({ error: 'Invalid profile_id', code: 'invalid_id' }, 400)
  }

  // Vérifier le profile
  const { data: prof, error: fetchErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, user_id, domain_id, verification_status, users!profiles_user_id_fkey(id, email, first_name, locale, user_type)')
    .eq('id', profileId)
    .maybeSingle()
  if (fetchErr) {
    console.error('[admin:approve-expert] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!prof) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  type ExpertUser = { id: string; email: string | null; first_name: string | null; locale: string | null; user_type: string | null }
  const row = prof as unknown as {
    id: string
    user_id: string
    domain_id: string
    verification_status: string | null
    users: ExpertUser | ExpertUser[] | null
  }
  if (row.verification_status !== STATUT_ARBITRABLE) {
    return json(
      { error: 'Already processed', code: 'already_processed', current_status: row.verification_status },
      409,
    )
  }

  // ── L'ARBITRAGE ET SA LIGNE DE GRAND LIVRE, EN UN SEUL APPEL (§D.26) ────
  //  La transition est rejouée SOUS VERROU : seul `pending_admin_review`
  //  s'arbitre, et deux administrateurs simultanés se sérialisent — le second
  //  lit « déjà traité » et rend `null`. Le motif de refus reste sur la ligne
  //  métier ; la ligne du journal dit qu'il y en a un, pas ce qu'il dit.
  const { data: arbitrage, error: updErr } = await auth.supabaseAdmin.rpc('statuer_sur_expert', {
    ...parametresJournal(journal),
    p_profile_id: profileId,
    p_statut_admis: STATUT_ARBITRABLE,
    p_approuve: true,
    p_motif: null,
  })
  if (updErr) {
    console.error('[admin:approve-expert] update failed', updErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  if (!arbitrage) {
    return json({ error: 'Already processed', code: 'already_processed' }, 409)
  }

  // Notif expert (best-effort)
  const u = Array.isArray(row.users) ? row.users[0] : row.users
  const locale = normalizeLocale(u?.locale ?? null)
  try {
    await auth.supabaseAdmin.from('notifications').insert({
      piece: journal.piece,
      user_id: row.user_id,
      domain_id: row.domain_id,
      type: 'verification_result',
      channel: 'inapp',
      title: NOTIF_TITLE[locale] ?? NOTIF_TITLE.fr,
      body: NOTIF_BODY[locale] ?? NOTIF_BODY.fr,
      link_url: dashboardUrlForUserType(u?.user_type ?? null),
      status: 'pending',
      entity_id: null,
    })
  } catch (err) {
    console.error('[admin:approve-expert] notif insert threw', err)
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'expert_approved',
    entity_type: 'profile',
    entity_id: profileId,
    detail: {},
  })

  // Origin résolu dans le scope du handler (request lisible ici), capturé par
  // la closure after() pour construire le lien CTA de l'email.
  const siteOrigin = siteOriginFromRequest(request, body)

  // ── Travaux post-réponse — déclencheur EXPERT (post-approbation) ────────
  // Non-bloquant POUR L'ADMIN : exécution via `after()` après l'envoi de la
  // response. Un `void promise` serait tué par Vercel — `after()` garantit
  // l'exécution de bout en bout (cf. bug racine fire-and-forget). On y place
  // aussi l'envoi de l'email (awaité, best-effort) pour la même raison.
  // ⚠️ DEUX TRAVAUX, DEUX FONCTIONS — ET LA MISE EN RELATION D'ABORD (audit du 30/09/2026, M6).
  //    L'e-mail et la recherche partageaient UN corps : les `return` de l'e-mail (origine du site
  //    inconnaissable, adresse de l'écosystème inconstructible) sortaient de TOUT le travail
  //    différé — aucune recherche à l'approbation, aucune trace, aucune relance. Un e-mail
  //    impossible annulait le « premier contact avec la plateforme ». La recherche passe
  //    désormais EN PREMIER, et l'e-mail vit dans sa propre fonction : ses sorties ne coupent qu'elle.
  const envoyerBienvenue = async (): Promise<void> => {
    const contactEmail = u?.email ?? null
    if (!contactEmail) {
      console.warn('[admin:approve-expert] no contact email — welcome email skipped', { profileId })
      return
    }
    // Base URL dérivée du domaine de l'EXPERT (slug), pas de l'origin admin.
    let expertSlug: string | null = null
    if (row.domain_id) {
      const { data: dom, error: domErr } = await auth.supabaseAdmin.from('domains').select('slug').eq('id', row.domain_id).maybeSingle()
      if (domErr) {
        console.error('[admin:approve-expert] e-mail ANNULÉ — écosystème de l expert illisible', { profileId, message: domErr.message })
        return
      }
      expertSlug = (dom?.slug as string | null) ?? null
    }
    // ── ORIGINE INCONNAISSABLE ⇒ ON N'ENVOIE PAS ────────────────────────────
    //  Un e-mail parti avec un lien `localhost` est pire qu'un e-mail qui ne part pas.
    if (!siteOrigin) {
      console.error('[admin:approve-expert] e-mail ANNULÉ — origine du site inconnaissable')
      return
    }
    const baseOrigin = expertSiteOrigin({ origin: siteOrigin, slug: expertSlug })
    // L'adresse de SON écosystème, dans l'environnement courant (§E.83) — inconstructible : pas d'envoi.
    if (!baseOrigin) {
      console.error('[admin:approve-expert] e-mail ANNULÉ — adresse de l écosystème inconstructible', { profileId })
      return
    }
    const loginUrl = `${baseOrigin}/${normalizeLocale(u?.locale ?? null)}/connexion`
    // D3 : marque = domaine de l'EXPERT destinataire (row.domain_id).
    const brandName = await resolveEmailBrandName(auth.supabaseAdmin, row.domain_id)
    const rendered = renderExpertWelcomeEmail({
      brandName,
      locale: u?.locale ?? null,
      firstName: (u?.first_name ?? '').trim() || (contactEmail.split('@')[0] ?? ''),
      loginUrl,
    })
    const res = await sendEmail({
      to: contactEmail,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      preheader: rendered.preheader,
      tag: rendered.tag,
    })
    console.log('[admin:approve-expert] email', { profileId, ok: res.ok, code: res.ok ? null : res.code })
  }

  after(async () => {
    // 1. LA MISE EN RELATION — immédiate, et REJOUÉE si elle échoue (lib/matching/mise-en-relation-immediate.ts,
    //    le même chemin que l'auto-approbation : la tentative comptée avant, le solde seulement si le run
    //    a abouti, sinon une échéance posée que le pilote reprend — §C.14).
    try {
      const { lancerMiseEnRelationImmediate } = await import('@/lib/matching/mise-en-relation-immediate')
      const { verdict, acheve } = await lancerMiseEnRelationImmediate(auth.supabaseAdmin, profileId, journal)
      console.log('[admin:approve-expert] matching done', { profileId, status: verdict.status, acheve, proposals: verdict.proposals.length })
    } catch (err) {
      console.error('[admin:approve-expert] matching threw (after)', err)
    }
    // 2. L'e-mail de bienvenue — best-effort : un échec ne défait jamais la décision.
    try {
      await envoyerBienvenue()
    } catch (err) {
      console.error('[admin:approve-expert] welcome email threw (after)', err)
    }
  })

  return json(
    {
      ok: true,
      profile_id: profileId,
      verification_status: 'approved',
      // La date de la décision est celle que la BASE a posée, rendue par la RPC :
      // en fabriquer une ici en ferait une seconde, proche mais fausse (§E.24).
      verified_at: (arbitrage as { verified_at?: string } | null)?.verified_at ?? null,
    },
    200,
  )
}

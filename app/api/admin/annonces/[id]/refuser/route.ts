import { contexteDepuisAuth, parametresJournal } from '@/lib/journal/contexte'
import { NextRequest, after } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { siteOriginPourRequete } from '@/lib/site-url'
import { expertSiteOrigin } from '@/lib/emails/domain-url'
import { chargerDestinataire, envoyerEmailDecision, prevenirDansLaCloche } from '@/lib/validation-annonces/avis'
import { MOTIF_LONGUEUR_MAX } from '@/lib/validation-annonces/motif'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// L'e-mail part dans un `after()`, après la réponse (jamais une promesse lâchée — tuée sur Vercel, §E.5).
export const maxDuration = 30

/**
 * POST /api/admin/annonces/[id]/refuser { motif } — L'ADMINISTRATEUR REFUSE UNE ANNONCE EN REVUE (lot S3).
 *
 * `refuser_annonce()` fait tout en une transaction : `pending_review` → `rejected`, qui et quand, le MOTIF sur la
 * ligne métier, et la ligne `annonce_refusee` du grand livre (sans le motif : texte libre, §D.26). La garde
 * administrateur est tenue en base ; deux décisions simultanées se sérialisent — la seconde lit « déjà tranchée ».
 *
 * Le motif est OBLIGATOIRE et transmis à l'auteur, dans la cloche et par e-mail, dans sa langue.
 * Aucune place active à rendre : une annonce en revue n'en retient pas (la route de publication la rend au verdict).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  // LA PIÈCE, À L'ENTRÉE DU GESTE (§D.26).
  const journal = contexteDepuisAuth(auth)

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }
  let corps: { motif?: unknown; site_url?: unknown }
  try {
    corps = (await request.json()) as { motif?: unknown; site_url?: unknown }
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }
  const motif = typeof corps.motif === 'string' ? corps.motif.trim() : ''
  if (!motif) return json({ error: 'Reason required', code: 'motif_requis' }, 400)
  if (motif.length > MOTIF_LONGUEUR_MAX) {
    return json({ error: 'Reason too long', code: 'motif_trop_long', max: MOTIF_LONGUEUR_MAX }, 400)
  }

  const { data: pub, error: lectureErr } = await auth.supabaseAdmin
    .from('publications')
    .select('id, organization_id, domain_id, created_by, status, type, title')
    .eq('id', id)
    .maybeSingle()
  if (lectureErr) {
    console.error('[admin:annonces/refuser] lecture impossible', lectureErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) return json({ error: 'Not found', code: 'not_found' }, 404)
  if ((pub.status as string) !== 'pending_review') {
    return json({ error: 'Already processed', code: 'already_processed', current_status: pub.status }, 409)
  }

  // ── LE REFUS ET SA LIGNE, EN UN APPEL ─────────────────────────────────────────
  const { data: refus, error: rpcErr } = await auth.supabaseAdmin.rpc('refuser_annonce', {
    ...parametresJournal(journal),
    p_publication_id: id,
    p_motif: motif,
  })
  if (rpcErr) {
    console.error('[admin:annonces/refuser] refus en échec', rpcErr.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  if (!refus) {
    return json({ error: 'Already processed', code: 'already_processed' }, 409)
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'publication_rejected_by_admin',
    entity_type: 'publication',
    entity_id: id,
    // Le motif reste sur la ligne métier : l'audit dit qu'il y en a un, pas ce qu'il dit.
    detail: { type: pub.type, has_reason: true },
  })

  // ── L'AUTEUR, DANS LA CLOCHE — tout de suite, motif compris ─────────────────────
  const lecture = await chargerDestinataire(auth.supabaseAdmin, {
    id,
    title: pub.title as string,
    domain_id: pub.domain_id as string,
    created_by: (pub.created_by as string | null) ?? null,
    organization_id: pub.organization_id as string,
  })
  if (!lecture.ok) console.error('[admin:annonces/refuser] auteur illisible', lecture.raison)
  const destinataire = lecture.ok ? lecture.destinataire : null
  const auteurPrevenu = destinataire
    ? (await prevenirDansLaCloche(auth.supabaseAdmin, destinataire, { piece: journal.piece, publicationId: id, decision: 'refusee', motif })).ecrite
    : false
  const siteOrigin = siteOriginPourRequete({ fourni: corps.site_url, origin: request.headers.get('origin') })
  // Les liens de l'e-mail : l'adresse de l'écosystème de l'ANNONCE, dans l'environnement courant (§E.83) — jamais
  // l'origine brute du back-office. Inconnaissable ou inconstructible : l'e-mail ne part pas (il le journalise).
  const baseDesLiens = destinataire && siteOrigin ? expertSiteOrigin({ origin: siteOrigin, slug: destinataire.slug }) : null

  if (destinataire) {
    after(async () => {
      try {
        await envoyerEmailDecision(auth.supabaseAdmin, destinataire, { decision: 'refusee', motif, base: baseDesLiens, publicationId: id })
      } catch (err) {
        console.error('[admin:annonces/refuser] e-mail threw (after)', err)
      }
    })
  }

  return json({
    ok: true,
    status: 'rejected',
    verified_at: (refus as { verified_at?: string } | null)?.verified_at ?? null,
    auteur_prevenu: auteurPrevenu,
    auteur_introuvable: lecture.ok && !destinataire,
    // L'auteur n'a pas pu être LU : ni la cloche ni l'e-mail ne sont partis — ce n'est pas « personne à prévenir ».
    auteur_illisible: !lecture.ok,
  })
}

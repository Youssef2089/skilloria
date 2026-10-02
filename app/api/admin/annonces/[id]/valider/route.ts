import { contexteDepuisAuth, parametresJournal } from '@/lib/journal/contexte'
import { NextRequest, after } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { getOrgEntitlements } from '@/lib/entitlements'
import { activePublishedOrClause } from '@/lib/publications/expiry'
import { missingForPublish } from '@/lib/publications/publishable'
import { COLONNES_CRITERES_ANNONCE, criteresDeLaLigne } from '@/lib/annonces/criteres'
import { chargerDurees, DUREES_ILLISIBLES_CODE } from '@/lib/durees'
import { runMatchingForPublication } from '@/lib/matching'
import { siteOriginPourRequete } from '@/lib/site-url'
import { expertSiteOrigin } from '@/lib/emails/domain-url'
import { chargerDestinataire, envoyerEmailDecision, prevenirDansLaCloche } from '@/lib/validation-annonces/avis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// La mise en relation et l'e-mail partent dans un `after()`, après la réponse — comme la route de publication.
export const maxDuration = 60

/**
 * POST /api/admin/annonces/[id]/valider — L'ADMINISTRATEUR MET EN LIGNE UNE ANNONCE EN REVUE (lot S3).
 *
 * LE MÊME MÉCANISME QU'UNE PUBLICATION DIRECTE (app/api/publications/[id]/publish), étape par étape :
 *   1. la PLACE ACTIVE est réservée en base (`reserver_place_annonce`, fail-closed) — une annonce validée occupe une
 *      place comme une autre ; plafond atteint : refus NOMMÉ, l'administrateur sait pourquoi ;
 *   2. la mise en ligne ET sa ligne de grand livre, en UN appel : `publier_annonce()`, depuis `pending_review`, sous
 *      la garde administrateur tenue en base — `annonce_publiee` (ou `sous_traitance_publiee`), voie
 *      « administrateur » ; le verdict de la machine est conservé ;
 *   3. l'audit, AVANT tout travail qui peut faire tuer la fonction ;
 *   4. la MISE EN RELATION dans `after()` — `runMatchingForPublication`, la fonction même de la publication directe.
 *
 * CE QUI N'EST PAS REFAIT : le contrôle de qualité (l'administrateur EST la décision) et le COMPTEUR MENSUEL — il a
 * été consommé à la soumission, avant le verdict, et la route de publication ne le rend pas quand l'annonce part en
 * revue : le consommer ici ferait payer deux fois la même annonce.
 *
 * L'AUTEUR EST PRÉVENU dans sa langue : la cloche tout de suite (la réponse dit si elle a pu être écrite), l'e-mail
 * dans `after()`.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const STATUT_EN_REVUE = 'pending_review'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  // LA PIÈCE, À L'ENTRÉE DU GESTE (§D.26) — elle traverse tout ce qui suit, after() compris.
  const journal = contexteDepuisAuth(auth)

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }
  const corps = (await request.json().catch(() => ({}))) as { site_url?: unknown }

  // Les durées pilotent « active » (lib/publications/expiry) : illisibles, on refuse en le nommant (aucun défaut).
  const lectureDurees = await chargerDurees(auth.supabaseAdmin)
  if (!lectureDurees.ok) {
    console.error('[admin:annonces/valider] durées de la place illisibles', lectureDurees.raison)
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
  }

  const { data: pubLue, error: lectureErr } = await auth.supabaseAdmin
    .from('publications')
    // Les critères de l'annonce (§D.39) : le prédicat de la publication les exige, ici comme à la soumission.
    .select(
      'id, organization_id, domain_id, created_by, status, type, title, description, branch_id, work_zone_ids, ' +
        `speciality_ids, speciality_other, ${COLONNES_CRITERES_ANNONCE}`,
    )
    .eq('id', id)
    .maybeSingle()
  // La liste des colonnes est composée : le client non typé ne déduit plus la forme de la ligne (comme /publish).
  const pub = pubLue as unknown as Record<string, unknown> | null
  if (lectureErr) {
    console.error('[admin:annonces/valider] lecture impossible', lectureErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) return json({ error: 'Not found', code: 'not_found' }, 404)
  if ((pub.status as string) !== STATUT_EN_REVUE) {
    return json({ error: 'Already processed', code: 'already_processed', current_status: pub.status }, 409)
  }

  // Le même prédicat que la publication, ENTIER (regroupement, ARRÊT 28) : une annonce en revue peut avoir été
  // soumise avant que la spécialité et le temps de travail soient exigés (§D.39), ou une zone avoir disparu depuis.
  // Elle ne passe pas en ligne : son AUTEUR doit la compléter — le refus nomme les champs, et l'écran le dit (la base
  // le tient aussi depuis la seconde livraison).
  const criteres = criteresDeLaLigne(pub)
  const manquants = missingForPublish({
    title: pub.title as string | null,
    description: pub.description as string | null,
    branch_id: pub.branch_id as string | null,
    speciality_ids: (pub.speciality_ids as string[] | null) ?? [],
    speciality_other: pub.speciality_other as string | null,
    work_zone_ids: (pub.work_zone_ids as string[] | null) ?? [],
    work_modes: criteres.work_modes,
    temps_travail: criteres.temps_travail,
    jours_sur_site: criteres.jours_sur_site,
    jours_teletravail: criteres.jours_teletravail,
  })
  if (manquants.length > 0) {
    return json({ error: 'Publication incomplete', code: 'missing_fields', missing: manquants }, 400)
  }

  // ── ① LA PLACE ACTIVE — la règle de la publication, fail-closed ─────────────────
  const orgId = pub.organization_id as string
  const ents = await getOrgEntitlements(auth.supabaseAdmin, orgId)
  let placeReservee = false
  if (ents.limits.activePublicationsMax !== null) {
    const { data: actives, error: activesErr } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'published')
      .or(activePublishedOrClause({ vieAnnonceJours: lectureDurees.durees.vieAnnonceJours }))
    if (activesErr) {
      console.error('[admin:annonces/valider] annonces actives illisibles — fail-closed', activesErr.message)
      return json({ error: 'Cannot verify active publications', code: 'active_publications_check_failed' }, 503)
    }
    const { data: reserve, error: rpcErr } = await auth.supabaseAdmin.rpc('reserver_place_annonce', {
      p_publication_id: id,
      p_plafond: ents.limits.activePublicationsMax,
      p_ids_actives: (actives ?? []).map((r) => r.id as string),
    })
    if (rpcErr) {
      console.error('[admin:annonces/valider] réservation de place en échec — fail-closed', rpcErr.message)
      return json({ error: 'Cannot verify active publications', code: 'active_publications_check_failed' }, 503)
    }
    if (reserve !== true) {
      return json({ error: 'Active publications limit reached', code: 'active_publications_limit_reached' }, 409)
    }
    placeReservee = true
  }
  const rendreLaPlace = async (pourquoi: string): Promise<void> => {
    if (!placeReservee) return
    const { error } = await auth.supabaseAdmin.rpc('liberer_place_annonce', { p_publication_id: id })
    if (error) console.warn(`[admin:annonces/valider] liberer place (${pourquoi}) failed`, error.message)
  }

  // ── ② LA MISE EN LIGNE ET SA LIGNE, EN UN APPEL — la voie administrateur de publier_annonce() ──
  const { data: miseEnLigne, error: rpcErr } = await auth.supabaseAdmin.rpc('publier_annonce', {
    ...parametresJournal(journal),
    p_publication_id: id,
    p_domain_id: pub.domain_id as string,
    p_organization_id: orgId,
    p_statuts_admis: [STATUT_EN_REVUE],
    p_verdict: 'published',
    // Le verdict de la machine se CONSERVE sur cette voie : la base refuse qu'on le réécrive.
    p_score: null,
    p_method: null,
    p_data: null,
  })
  if (rpcErr) {
    console.error('[admin:annonces/valider] mise en ligne en échec', rpcErr.message)
    await rendreLaPlace('mise en ligne en échec')
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  if (!miseEnLigne) {
    // Un autre administrateur a tranché pendant ce temps : rien n'a été touché, rien n'est journalisé.
    await rendreLaPlace('déjà tranchée')
    return json({ error: 'Already processed', code: 'already_processed' }, 409)
  }

  // ── ③ L'AUDIT — avant tout travail qui peut faire tuer la fonction ─────────────
  await logAudit({
    piece: journal.piece,
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'publication_validated_by_admin',
    entity_type: 'publication',
    entity_id: id,
    detail: { type: pub.type },
  })

  // ── L'AUTEUR, DANS LA CLOCHE — tout de suite, et la réponse dit si c'est fait ──
  const lecture = await chargerDestinataire(auth.supabaseAdmin, {
    id,
    title: pub.title as string,
    domain_id: pub.domain_id as string,
    created_by: (pub.created_by as string | null) ?? null,
    organization_id: orgId,
  })
  if (!lecture.ok) console.error('[admin:annonces/valider] auteur illisible', lecture.raison)
  const destinataire = lecture.ok ? lecture.destinataire : null
  const auteurPrevenu = destinataire
    ? (await prevenirDansLaCloche(auth.supabaseAdmin, destinataire, { piece: journal.piece, publicationId: id, decision: 'validee', motif: null })).ecrite
    : false
  const siteOrigin = siteOriginPourRequete({ fourni: corps.site_url, origin: request.headers.get('origin') })
  // Les liens de l'e-mail : l'adresse de l'écosystème de l'ANNONCE, dans l'environnement courant (§E.83) — jamais
  // l'origine brute du back-office. Inconnaissable ou inconstructible : l'e-mail ne part pas (il le journalise).
  const baseDesLiens = destinataire && siteOrigin ? expertSiteOrigin({ origin: siteOrigin, slug: destinataire.slug }) : null

  // ── ④ APRÈS LA RÉPONSE : la mise en relation d'abord, l'e-mail ensuite (deux travaux, deux try) ──
  //  ⚠️ Un traitement lancé après la réponse est TUÉ s'il n'est pas dans `after()` (§E.5).
  after(async () => {
    try {
      const verdict = await runMatchingForPublication({ supabaseAdmin: auth.supabaseAdmin, publicationId: id, journal })
      console.log('[admin:annonces/valider] matching done', { publicationId: id, status: verdict.status, proposals: verdict.proposals.length })
    } catch (err) {
      console.error('[admin:annonces/valider] matching threw (after)', err)
    }
    if (destinataire) {
      try {
        await envoyerEmailDecision(auth.supabaseAdmin, destinataire, { decision: 'validee', motif: null, base: baseDesLiens, publicationId: id })
      } catch (err) {
        console.error('[admin:annonces/valider] e-mail threw (after)', err)
      }
    }
  })

  return json({
    ok: true,
    status: 'published',
    published_at: (miseEnLigne as { published_at?: string } | null)?.published_at ?? null,
    auteur_prevenu: auteurPrevenu,
    auteur_introuvable: lecture.ok && !destinataire,
    // L'auteur n'a pas pu être LU : ni la cloche ni l'e-mail ne sont partis — ce n'est pas « personne à prévenir ».
    auteur_illisible: !lecture.ok,
  })
}

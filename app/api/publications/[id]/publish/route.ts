import { NextRequest, after } from 'next/server'
import { AuthError, requireAuth, requireOrgRole, type AuthContext } from '@/lib/auth-guard'
import { activeEcosystemId } from '@/lib/ecosystem-scope'
import { logAudit } from '@/lib/audit'
import { runPublicationVerification } from '@/lib/verification/publication-verification'
import type {
  PublicationLocale,
  PublicationQualityInput,
} from '@/lib/verification/ai-publication-quality'
import { runMatching } from '@/lib/matching'
import { getOrgEntitlements, consumeQuota, monthlyPeriodStart } from '@/lib/entitlements'
import { isExpertProfileApproved, PROFILE_NOT_VERIFIED_CODE } from '@/lib/expert-verified-guard'
import { activePublishedOrClause } from '@/lib/publications/expiry'
import { missingForPublish } from '@/lib/publications/publishable'
import { chargerDurees, DUREES_ILLISIBLES_CODE } from '@/lib/durees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Vercel function timeout.
//
// CE QUI EST SYNCHRONE, ET CE QUI NE L'EST PLUS. La vérification IA de
// l'annonce reste dans la requête : son verdict DÉCIDE du statut, donc la
// réponse ne peut pas partir avant elle. Le matching, lui, est passé dans un
// `after()` — il ne décide de rien pour l'appelant, et il faisait attendre
// l'organisation sur la seule route qui publie, alors que la route sœur (PATCH)
// le différait déjà correctement.
//
// L'ORDRE DES ÉCRITURES EST LE VRAI SUJET : quota → publication → AUDIT →
// réponse → matching. L'audit précède désormais tout travail susceptible de
// faire tuer la fonction ; une annonce publiée sans trace d'audit était un trou
// de traçabilité.
export const maxDuration = 60

/**
 * POST /api/publications/[id]/publish — LE GATE IA.
 *
 * Garde : appartenance org active (RLS publications_member_write joue en
 * défense en profondeur). Status courant doit être 'draft' UNIQUEMENT.
 *
 * ⚠️ Anti re-roll IA : on REFUSE de re-publier depuis 'pending_review'.
 * Sinon, sur le même contenu, l'IA pourrait par chance ne PAS reflagger
 * (contact_info / discriminatory / illegal) → publication contournant la
 * revue admin. Le seul chemin de sortie de 'pending_review' = décision
 * admin (lot ultérieur) OU futur flux 'revise' qui repasse par draft +
 * édition + re-gate sur contenu modifié.
 *
 * Transition status='published' UNIQUEMENT côté serveur (la RLS l'interdit
 * au client via le status guard de 20260602130000). Verdict IA stocké
 * directement sur la ligne publications (verification_score / method / data).
 *
 * Pas d'écriture dans verification_attempts (consigne Lot 1a).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const PUBLISHABLE_FROM = ['draft'] as const
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const VALID_LOCALES: readonly PublicationLocale[] = ['fr', 'en', 'es', 'de']

function localeFromRequest(request: NextRequest): PublicationLocale {
  // 1) Header explicite x-locale (posé par secure-fetch côté client si on
  //    veut forcer la langue de scoring IA). Sinon Accept-Language.
  const explicit = request.headers.get('x-locale')?.trim().toLowerCase()
  if (explicit && (VALID_LOCALES as readonly string[]).includes(explicit)) {
    return explicit as PublicationLocale
  }
  const accept = request.headers.get('accept-language') ?? ''
  const first = accept.split(',')[0]?.trim().toLowerCase().slice(0, 2)
  if (first && (VALID_LOCALES as readonly string[]).includes(first)) {
    return first as PublicationLocale
  }
  return 'fr'
}

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  // ── Auth + appartenance org active ──────────────────────────────────────
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── LES DURÉES SONT LUES ICI, PAR LA ROUTE ───────────────────────────────
  //  Aucun défaut dans le code (cf. lib/durees.ts) : illisibles, on REFUSE en
  //  le nommant plutôt que de servir une durée inventée. Même parti pris que
  //  `matching_settings` — un repli codé en dur devient une seconde source de
  //  vérité, et elle prend la main le jour où l'on comprend le moins.
  const lectureDurees = await chargerDurees(auth.supabaseAdmin)
  if (!lectureDurees.ok) {
    console.error('[publications:publish] durées de la place illisibles', lectureDurees.raison)
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
  }
  const durees = lectureDurees.durees
  const orgId = auth.organization?.id
  if (!orgId) {
    return json({ error: 'No organization', code: 'org_required' }, 403)
  }
  // D2 : publier = gestion des annonces → editor+ (viewer refusé).
  try { requireOrgRole(auth, 'editor') } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Id de route ─────────────────────────────────────────────────────────
  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }

  // ── Pré-check ownership + status publishable ────────────────────────────
  const { data: pub, error: fetchErr } = await auth.supabaseAdmin
    .from('publications')
    .select(
      'id, organization_id, status, type, title, description, skills_required, seniorities, work_mode, location_note, work_zone_ids, branch_id, duration, budget_min, budget_max',
    )
    // CLOISONNEMENT — ECRITURE : publier une annonce d'un autre ecosysteme
    // depuis celui-ci consommerait un quota sur des donnees invisibles ici.
    .eq('id', id)
    .eq('domain_id', activeEcosystemId(auth))
    .maybeSingle()

  if (fetchErr) {
    console.error('[publications:publish] fetch failed', fetchErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pub) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  if ((pub.organization_id as string) !== orgId) {
    return json({ error: 'Forbidden', code: 'forbidden' }, 403)
  }
  const currentStatus = pub.status as string
  if (!(PUBLISHABLE_FROM as readonly string[]).includes(currentStatus)) {
    return json(
      { error: 'Cannot publish', code: 'wrong_status', current_status: currentStatus },
      409,
    )
  }

  // ── GARDE DE PUBLIABILITÉ — la barrière est ICI, pas dans l'écran ────────
  //
  // Sans zone de travail, une annonce ne recouperait AUCUN expert : `&&` sur un
  // ensemble vide est toujours faux. Elle serait publiée, facturée, et
  // silencieusement invisible. La contrainte de base l'interdit déjà, mais une
  // contrainte violée rend une erreur Postgres que l'organisation lit « db_error » :
  // un refus sans raison nommable. On refuse donc ici, en NOMMANT les champs.
  //
  // Même prédicat que le formulaire (lib/publications/publishable.ts) : une
  // copie dériverait, et l'écran finirait par contredire le serveur.
  const manquants = missingForPublish({
    title: pub.title as string | null,
    description: pub.description as string | null,
    branch_id: pub.branch_id as string | null,
    work_zone_ids: (pub.work_zone_ids as string[] | null) ?? [],
  })
  if (manquants.length > 0) {
    return json(
      { error: 'Publication incomplete', code: 'missing_fields', missing: manquants },
      400,
    )
  }

  // ── C2 : GARDE profil approuvé, SCOPÉE sous_traitance ────────────────────
  //  Gate final : même si un draft sous_traitance existait, on refuse la
  //  publication tant que l'expert (created_by = lui) n'est pas approved.
  //  Verrou SERVEUR non contournable ; les mission/offre (vraies orgs) passent.
  if ((pub.type as string) === 'sous_traitance'
    && !(await isExpertProfileApproved(auth.supabaseAdmin, auth.user.id))) {
    return json({ error: 'Profile not verified', code: PROFILE_NOT_VERIFIED_CODE }, 403)
  }

  // ── GATE COMMERCE (Lot 2) : plafond de publications actives + quota mensuel ─
  //  Placée AVANT la vérif IA (coûteuse) : on refuse tôt. Ordre des gardes :
  //  1) plafond d'actives (SANS consommation) ; 2) compteur mensuel (consomme).
  //  On ne consomme JAMAIS le compteur mensuel si on refuse sur le plafond actif.
  //
  //  SENS DE L'ÉCHEC, ÉTAGE PAR ÉTAGE — ce n'est pas uniforme, et c'est voulu :
  //   · `getOrgEntitlements` reste FAIL-OPEN (illimité) : une panne du CATALOGUE
  //     ne doit pas transformer toutes les offres en offres bloquées. C'est une
  //     décision assumée et documentée dans lib/entitlements.
  //   · le PLAFOND D'ACTIVES, lui, est désormais FAIL-CLOSED : l'offre est
  //     connue, c'est le décompte qui manque — et un plafond qui s'ouvre quand
  //     la base tousse n'est pas un plafond. Voir juste en dessous.
  const ents = await getOrgEntitlements(auth.supabaseAdmin, orgId)

  // ── LE PLAFOND D'ANNONCES ACTIVES — GARANTI EN BASE, ET FAIL-CLOSED ──────
  //
  //  DEUX DÉFAUTS FERMÉS ENSEMBLE, cf. migration 20260914200000 :
  //
  //  1. LA COURSE. On lisait un compteur, on le comparait, puis on écrivait.
  //     Deux publications simultanées lisaient la même valeur et passaient
  //     toutes les deux : une offre à 3 actives pouvait en porter 4, soit un
  //     droit payant donné gratuitement. La garantie vit désormais dans un
  //     index unique partiel ; `reserver_place_annonce` attribue un NUMÉRO DE
  //     PLACE, et la base en refuse le doublon quel que soit l'ordre d'arrivée.
  //
  //  2. LE FAIL-OPEN. Une erreur de comptage laissait publier. Un plafond
  //     commercial qui s'ouvre quand la base tousse n'est pas un plafond : le
  //     sens est inversé ici, une lecture qui échoue REFUSE.
  //
  //  LA RÈGLE « ACTIF » N'EST PAS RECOPIÉE EN SQL. Elle se dérive à la lecture
  //  (lib/publications/expiry) et n'est pas appelable depuis la base ; une
  //  seconde copie en SQL divergerait un jour et l'une aurait tort en silence.
  //  On passe donc à la base la LISTE des annonces actives, calculée ici avec
  //  `activePublishedOrClause()` — l'unique source. C'est aussi ce qui LIBÈRE
  //  les places : toute annonce numérotée absente de cette liste (clôturée,
  //  archivée, repassée en brouillon, ou EXPIRÉE) rend la sienne.
  //
  //  Placé AVANT la vérif IA (coûteuse) : on refuse tôt. Le compteur mensuel
  //  n'est JAMAIS consommé si on refuse sur le plafond actif.
  let placeReservee = false
  if (ents.limits.activePublicationsMax !== null) {
    const { data: actives, error: activesErr } = await auth.supabaseAdmin
      .from('publications')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'published')
      .or(activePublishedOrClause({ vieAnnonceJours: durees.vieAnnonceJours }))
    if (activesErr) {
      // FAIL-CLOSED. On ne sait pas combien d'annonces sont actives : on ne
      // peut pas savoir s'il reste une place. Refuser en disant « plafond
      // atteint » serait un mensonge — le code est distinct, et le message
      // dit quoi faire.
      console.error('[publications:publish] active list error — fail-closed', activesErr.message)
      return json(
        { error: 'Cannot verify active publications', code: 'active_publications_check_failed' },
        503,
      )
    }

    const { data: reserve, error: rpcErr } = await auth.supabaseAdmin.rpc(
      'reserver_place_annonce',
      {
        p_publication_id: id,
        p_plafond: ents.limits.activePublicationsMax,
        p_ids_actives: (actives ?? []).map((r) => r.id as string),
      },
    )
    if (rpcErr) {
      console.error('[publications:publish] reserve place failed — fail-closed', rpcErr.message)
      return json(
        { error: 'Cannot verify active publications', code: 'active_publications_check_failed' },
        503,
      )
    }
    if (reserve !== true) {
      return json(
        { error: 'Active publications limit reached', code: 'active_publications_limit_reached' },
        402,
      )
    }
    placeReservee = true
  }

  /**
   * Rend la place si l'annonce ne finit pas en ligne. Best-effort : un échec
   * ici SOUS-attribue (une place inutilisée), et la prochaine réservation la
   * reprendra de toute façon. On ne donne jamais plus que le dû.
   */
  const rendreLaPlace = async (pourquoi: string): Promise<void> => {
    if (!placeReservee) return
    const { error } = await auth.supabaseAdmin.rpc('liberer_place_annonce', {
      p_publication_id: id,
    })
    if (error) {
      console.warn(`[publications:publish] liberer place (${pourquoi}) failed`, error.message)
    }
  }

  if (ents.limits.publicationsPerMonth !== null) {
    const allowed = await consumeQuota(
      auth.supabaseAdmin,
      orgId,
      'publications',
      ents.limits.publicationsPerMonth,
      monthlyPeriodStart(),
    )
    if (!allowed) {
      // La place a été réservée juste avant : on la rend, sinon un refus sur le
      // compteur mensuel consommerait une place active sans rien publier.
      await rendreLaPlace('quota mensuel atteint')
      return json({ error: 'Monthly publications quota reached', code: 'quota_publications_reached' }, 402)
    }
  }

  // ── Build input IA depuis la ligne ──────────────────────────────────────
  const aiInput: PublicationQualityInput = {
    // sous_traitance → traité comme 'mission' pour la vérif QUALITÉ (même nature
    // freelance ; le prompt ne juge que titre/description). Le matching, lui,
    // distingue bien sous_traitance (pool experts, cf. userTypeForPublication).
    type: (pub.type === 'offre' ? 'offre' : 'mission') as 'mission' | 'offre',
    title: pub.title as string,
    description: pub.description as string,
    skills_required: (pub.skills_required as string[] | null) ?? [],
    seniorities: (pub.seniorities as string[] | null) ?? [],
    work_mode: (pub.work_mode as string | null) ?? null,
    location_note: (pub.location_note as string | null) ?? null,
    duration: (pub.duration as string | null) ?? null,
    budget_min: (pub.budget_min as number | null) ?? null,
    budget_max: (pub.budget_max as number | null) ?? null,
    locale: localeFromRequest(request),
  }

  // ── Gate IA ─────────────────────────────────────────────────────────────
  let verdict
  try {
    verdict = await runPublicationVerification({
      supabaseAdmin: auth.supabaseAdmin,
      publication_id: id,
      // Déjà vérifié non nul plus haut (403 org_required sinon).
      organization_id: orgId,
      input: aiInput,
    })
  } catch (err) {
    console.error('[publications:publish] verification threw', err)
    await rendreLaPlace('vérification en échec')
    return json({ error: 'Verification failed', code: 'verification_failed' }, 500)
  }

  // Verdict qui ne met PAS en ligne (`pending_review`) : l'annonce n'est pas
  // active, elle ne doit donc pas retenir de place. On la rend AVANT d'écrire
  // le statut — la réservation la reprendrait de toute façon au prochain appel,
  // mais le compte doit être juste tout de suite.
  if (verdict.status !== 'published') {
    await rendreLaPlace(`verdict ${verdict.status}`)
  }

  // ── UPDATE atomique : status + verification_* (+ published_at si OK) ────
  const nowIso = new Date().toISOString()
  const updates: Record<string, unknown> = {
    status: verdict.status,
    verification_score: verdict.score,
    verification_method: verdict.method,
    verification_data: verdict.data,
  }
  if (verdict.status === 'published') {
    // published_at pilote l'expiration (calculée à la lecture : published_at + 30j).
    // On N'ÉCRIT PAS expires_at (décision : règle read-time, pas de valeur stockée
    // — une colonne écrite mais jamais relue serait un piège futur).
    updates.published_at = nowIso
  }

  const { error: updateErr } = await auth.supabaseAdmin
    .from('publications')
    .update(updates)
    // Defense en profondeur — cf. la lecture cloisonnee plus haut.
    .eq('id', id)
    .eq('domain_id', activeEcosystemId(auth))

  if (updateErr) {
    console.error('[publications:publish] update failed', updateErr.message)
    await rendreLaPlace('écriture du statut en échec')
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  // ── Audit — AVANT tout travail qui peut faire tuer la fonction ─────────
  //
  //  L'ORDRE DES ÉCRITURES EST LE SUJET, PAS UN DÉTAIL. Il était :
  //    publication → matching (bloquant) → audit → réponse
  //  Avec `maxDuration = 60`, un run qui dépasse tue la fonction APRÈS la mise
  //  en ligne et APRÈS la consommation du quota, mais AVANT l'audit et AVANT
  //  la réponse. L'organisation voyait alors une erreur réseau sur une annonce
  //  pourtant publiée, avec un quota déjà décompté — et le réflexe naturel est
  //  de republier, donc d'en consommer un second.
  //
  //  L'audit passe donc AVANT : une annonce publiée sans trace d'audit est un
  //  trou de traçabilité, et c'est précisément l'écriture qui doit survivre.
  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action:
      verdict.status === 'published'
        ? 'publication_published'
        : 'publication_submitted_review',
    entity_type: 'publication',
    entity_id: id,
    detail: {
      score: verdict.score,
      flags: verdict.data.flags,
      method: verdict.method,
    },
  })

  // ── Matching IA — APRÈS la réponse, comme dans la route sœur ───────────
  //
  //  ⚠️ PIÈGE VERCEL : un traitement lancé après la réponse est TUÉ s'il n'est
  //     pas enregistré dans `after()`. C'est `after()` + `maxDuration` qui lui
  //     donnent le droit de continuer une fois la réponse partie.
  //
  //  Le PATCH du même dossier le faisait déjà ainsi ; cette route, non. Deux
  //  routes voisines, deux traitements opposés — et c'est celle qui publie qui
  //  faisait attendre l'organisation.
  //
  //  FAIL-SAFE INCHANGÉ : un échec de matching n'impacte JAMAIS la
  //  publication. La ligne reste publiée, et le run demeure rejouable
  //  (il est marqué inachevé, donc repris par le rattrapage).
  if (verdict.status === 'published') {
    after(async () => {
      try {
        const matchingVerdict = await runMatching({
          supabaseAdmin: auth.supabaseAdmin,
          publicationId: id,
        })
        console.log('[publications:publish] matching done', {
          publicationId: id,
          status: matchingVerdict.status,
          proposalsCount: matchingVerdict.proposals.length,
          model: matchingVerdict.model,
        })
      } catch (err) {
        console.error('[publications:publish] matching threw (after)', err)
      }
    })
  }

  return json({ status: verdict.status, score: verdict.score }, 200)
}

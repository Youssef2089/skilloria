import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { identifiantDerive } from '@/lib/admin/identifiant-derive'
import { chargerDurees, estDureeAcceptable, DUREES_ILLISIBLES_CODE } from '@/lib/durees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/durees — LES DEUX DURÉES DU CONTRAT DE LA PLACE.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CE QUE CET ÉCRAN RÈGLE                                                   ║
 * ║                                                                          ║
 * ║   La VIE D'UNE ANNONCE (30 j), la FENÊTRE D'ÉCHANGE (15 j) et la         ║
 * ║   VALIDITÉ D'UNE INVITATION (7 j). Les deux premières sont les           ║
 * ║   promesses que la place fait à ses deux côtés : combien de temps une    ║
 * ║   annonce se voit, et combien de temps on a pour se parler une fois le   ║
 * ║   contact payé. La troisième gouverne l'entrée dans une organisation.    ║
 * ║   Les changer demandait un déploiement — et la troisième vivait EN DUR   ║
 * ║   dans DEUX fichiers, ce qui la condamnait à diverger.                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ L'ASYMÉTRIE — ET ELLE EST LE SUJET DE CETTE ROUTE ══════════════════════
 *
 *   VIE D'UNE ANNONCE : RÉTROACTIVE.
 *     `publications.expires_at` n'est jamais écrit ; l'activité se recalcule à
 *     CHAQUE lecture depuis `published_at + durée`. Passer de 30 à 20 jours
 *     retire donc de la place, immédiatement, des annonces déjà publiées —
 *     sans aucune erreur, sans aucune trace, et pendant que leurs candidatures
 *     continuent d'exister.
 *
 *   FENÊTRE D'ÉCHANGE : NON RÉTROACTIVE.
 *     `conversations.expires_at` EST écrit au déblocage. Les échanges ouverts
 *     gardent leur date ; seuls les déblocages à venir suivent la nouvelle.
 *
 *   VALIDITÉ D'UNE INVITATION : NON RÉTROACTIVE, pour la même raison.
 *     `organization_invitations.expires_at` est écrit à la création et réécrit
 *     au renvoi. Une invitation déjà partie garde la sienne.
 *     D'où l'absence de garde de comptage sur ce champ : il n'y a **rien à
 *     compter**, parce qu'il n'y a rien qui bascule. En poser une laisserait
 *     croire le contraire, et apprendrait à cliquer sans lire.
 *
 *   Ce n'est pas un détail d'implémentation qu'on pourrait revoir : c'est ce
 *   que veut dire « une date écrite » contre « une règle appliquée à la
 *   lecture ». L'écran l'écrit en toutes lettres, parce qu'un administrateur
 *   qui l'ignore prend une décision qu'il croit réversible.
 *
 * ═══ ON COMPTE AVANT D'ÉCRIRE — ET ON NE BLOQUE PAS ═════════════════════════
 *   Une baisse de la vie d'une annonce est précédée d'un comptage : combien
 *   d'annonces VISIBLES aujourd'hui deviendraient expirées, et combien d'entre
 *   elles portent une candidature DÉVOILÉE, c'est-à-dire payée.
 *
 *   La première demande rend ce nombre et REFUSE — code
 *   `retroactivite_non_confirmee`, 409. La seconde, avec
 *   `confirme_retroactivite: true`, passe. C'est une CONFIRMATION, pas un
 *   plafond : rien n'interdit la baisse, on exige seulement qu'elle soit prise
 *   les yeux ouverts. Un refus définitif aurait obligé à modifier la base à la
 *   main — c'est-à-dire exactement le défaut que cet écran ferme (§E.10).
 *
 * ═══ ET CHAQUE CHANGEMENT LAISSE UNE TRACE ══════════════════════════════════
 *   `audit_logs` : qui, quand, depuis quelle adresse, de quelle valeur vers
 *   quelle valeur, et le nombre d'annonces annoncé au moment de la décision.
 *   Le seuil d'auto-approbation est passé de 9 à 8 sans qu'aucune trace ne le
 *   dise (§E.10) ; il a fallu croiser un message de commit et un `updated_at`.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Bascule = { basculent: number; dont_devoilees: number }

/**
 * Combien d'annonces basculeraient. `null` si le comptage est illisible — et
 * `null` n'est PAS zéro : l'écran doit dire « on ne sait pas », jamais
 * « aucune ».
 */
async function compterBascule(
  admin: Awaited<ReturnType<typeof requireAdmin>>['supabaseAdmin'],
  actuel: number,
  nouveau: number,
): Promise<Bascule | null> {
  const { data, error } = await admin.rpc('annonces_basculant_par_duree', {
    p_actuel: actuel,
    p_nouveau: nouveau,
  })
  if (error) {
    console.error('[admin:durees] comptage de bascule en échec', error.message)
    return null
  }
  const lignes = (data ?? []) as Array<{ basculent: number; dont_devoilees: number }>
  const l = lignes[0]
  if (!l) return null
  return { basculent: Number(l.basculent), dont_devoilees: Number(l.dont_devoilees) }
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  const lecture = await chargerDurees(admin)
  if (!lecture.ok) {
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE, raison: lecture.raison }, 503)
  }

  // SIMULATION : l'écran demande « et si je mettais N ? » AVANT de toucher à
  // quoi que ce soit. C'est la même question que celle posée au moment
  // d'écrire, donc le nombre affiché est celui qui sera vérifié.
  const url = new URL(request.url)
  const brut = url.searchParams.get('simuler_vie_annonce')
  let simulation: (Bascule & { jours: number }) | null = null
  if (brut !== null) {
    const n = Number(brut)
    if (!estDureeAcceptable(n)) {
      return json({ error: 'Invalid duration', code: 'invalid_duration' }, 400)
    }
    const b = await compterBascule(admin, lecture.durees.vieAnnonceJours, n)
    if (b) simulation = { jours: n, ...b }
  }

  const { data: ligne } = await admin
    .from('duree_reglages')
    .select('updated_at, updated_by')
    .eq('ligne_unique', true)
    .maybeSingle()
  const meta = ligne as { updated_at?: string | null; updated_by?: string | null } | null

  return json({
    vie_annonce_jours: lecture.durees.vieAnnonceJours,
    fenetre_echange_jours: lecture.durees.fenetreEchangeJours,
    invitation_jours: lecture.durees.invitationJours,
    updated_at: meta?.updated_at ?? null,
    updated_by: meta?.updated_by ?? null,
    simulation,
  })
}

type CorpsPatch = {
  vie_annonce_jours?: unknown
  fenetre_echange_jours?: unknown
  invitation_jours?: unknown
  confirme_retroactivite?: unknown
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  let corps: CorpsPatch
  try {
    corps = (await request.json()) as CorpsPatch
  } catch {
    return json({ error: 'Invalid body', code: 'invalid_body' }, 400)
  }

  const vie = Number(corps.vie_annonce_jours)
  const fenetre = Number(corps.fenetre_echange_jours)
  const invitation = Number(corps.invitation_jours)
  if (!estDureeAcceptable(vie) || !estDureeAcceptable(fenetre) || !estDureeAcceptable(invitation)) {
    // On borne ICI pour rendre une raison lisible, alors que la base rendrait
    // une erreur de contrainte que l'écran afficherait « db_error ».
    return json(
      { error: 'Invalid duration', code: 'invalid_duration', bornes: { min: 1, max: 365 } },
      400,
    )
  }

  const avant = await chargerDurees(admin)
  if (!avant.ok) {
    return json({ error: 'Durations unavailable', code: DUREES_ILLISIBLES_CODE }, 503)
  }

  // ── LA GARDE DE RÉTROACTIVITÉ ────────────────────────────────────────────
  //  Elle ne se déclenche QUE sur une baisse de la vie d'une annonce : c'est
  //  le seul des deux réglages qui rétroagit, et seule une baisse retire
  //  quelque chose. Allonger n'expire personne.
  let bascule: Bascule | null = null
  if (vie < avant.durees.vieAnnonceJours) {
    bascule = await compterBascule(admin, avant.durees.vieAnnonceJours, vie)
    if (!bascule) {
      // On ne sait pas combien basculeraient. On REFUSE de l'écrire à
      // l'aveugle : la confirmation demandée serait alors une confirmation de
      // rien. C'est un refus TEMPORAIRE et nommé, pas un plafond.
      return json(
        { error: 'Impact unknown', code: 'impact_illisible' },
        503,
      )
    }
    if (bascule.basculent > 0 && corps.confirme_retroactivite !== true) {
      // ⚠️ CE N'EST PAS UN BLOCAGE. C'est la première moitié d'un aller-retour :
      //    on rend le nombre, l'écran le montre, l'administrateur confirme, et
      //    la seconde demande passe. Rien n'interdit la baisse.
      return json(
        {
          error: 'Retroactive change requires confirmation',
          code: 'retroactivite_non_confirmee',
          impact: {
            de_jours: avant.durees.vieAnnonceJours,
            a_jours: vie,
            basculent: bascule.basculent,
            dont_devoilees: bascule.dont_devoilees,
          },
        },
        409,
      )
    }
  }

  const { error } = await admin
    .from('duree_reglages')
    .update({
      vie_annonce_jours: vie,
      fenetre_echange_jours: fenetre,
      invitation_jours: invitation,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    })
    .eq('ligne_unique', true)
  if (error) {
    console.error('[admin:durees] écriture en échec', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  // La trace porte le nombre ANNONCÉ AU MOMENT DE LA DÉCISION, pas un nombre
  // recalculé plus tard : c'est ce que l'administrateur avait sous les yeux.
  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'durees_place_updated',
    entity_type: 'duree_reglages',
    // La table n'a qu'une ligne, sans UUID : l'entité est la famille.
    entity_id: identifiantDerive('reglage', 'duree_reglages'),
    request,
    detail: {
      avant: {
        vie_annonce_jours: avant.durees.vieAnnonceJours,
        fenetre_echange_jours: avant.durees.fenetreEchangeJours,
        invitation_jours: avant.durees.invitationJours,
      },
      apres: {
        vie_annonce_jours: vie,
        fenetre_echange_jours: fenetre,
        invitation_jours: invitation,
      },
      retroactivite: bascule
        ? {
            basculent: bascule.basculent,
            dont_devoilees: bascule.dont_devoilees,
            confirmee: corps.confirme_retroactivite === true,
          }
        : null,
    },
  })

  return json({
    vie_annonce_jours: vie,
    fenetre_echange_jours: fenetre,
    invitation_jours: invitation,
    retroactivite_appliquee: bascule ?? null,
  })
}

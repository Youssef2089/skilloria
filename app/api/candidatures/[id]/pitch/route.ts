import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { activeEcosystemId } from '@/lib/ecosystem-scope'
import { redigerPitchOrg, type Langue } from '@/lib/candidatures/ai-assessment'
import { enregistrerPanne } from '@/lib/candidatures/pannes-redaction'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Un appel de modèle, borné à 30 s côté client Anthropic.
export const maxDuration = 60

/**
 * POST /api/candidatures/[id]/pitch — le pitch, RÉDIGÉ À LA DEMANDE.
 *
 * ═══ POURQUOI À LA DEMANDE ════════════════════════════════════════════════
 *   Une annonce peut avoir des milliers de profils recommandés. En rédiger un
 *   pitch pour chacun d'avance coûterait des milliers d'appels dont
 *   l'organisation n'en lirait qu'une poignée. On rédige donc quand une carte
 *   est RÉELLEMENT ouverte — un appel par profil ouvert, pas un de plus.
 *
 * ═══ ET JAMAIS RÉGÉNÉRÉ ═══════════════════════════════════════════════════
 *   Le texte est écrit dans `matches.explanation` et relu ensuite. Deux
 *   raisons, et la seconde compte plus que la première : le coût, bien sûr,
 *   mais surtout qu'un texte changeant entre deux ouvertures ferait douter
 *   l'organisation de ce qu'elle a lu la première fois. Un jugement rendu est
 *   rendu.
 *
 *   Cette route est donc IDEMPOTENTE par construction : appelée dix fois, elle
 *   n'appelle le modèle qu'une seule.
 *
 * ═══ CE QU'ELLE VÉRIFIE AVANT D'ÉCRIRE UN MOT ═════════════════════════════
 *   1. l'organisation appelante possède bien l'annonce ;
 *   2. la candidature appartient à l'ÉCOSYSTÈME ACTIF — le filtre est posé DANS
 *      la recherche par identifiant, jamais après : un lien gardé en favori
 *      donnerait sinon accès depuis un autre écosystème, et la route emprunte
 *      son 404. Jamais 403 : dire « cet objet existe, mais ailleurs » serait
 *      déjà une fuite.
 *
 * ═══ CE QU'ELLE NE FAIT PAS ═══════════════════════════════════════════════
 *   Elle ne rend JAMAIS d'erreur bloquante quand le pitch manque. Plafond
 *   atteint, modèle indisponible, texte non conforme : elle rend `pitch: null`
 *   avec une raison, et la carte s'affiche sans pitch. Un texte d'agrément ne
 *   doit pas empêcher de lire un dossier.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const LANGUES: readonly Langue[] = ['fr', 'en', 'es', 'de']
const langueSure = (v: string | null): Langue =>
  (LANGUES as readonly string[]).includes(v ?? '') ? (v as Langue) : 'fr'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const orgId = auth.organization?.id
  if (!orgId) return json({ error: 'No organization', code: 'org_required' }, 403)

  const { id } = await ctx.params
  if (!id || !UUID.test(id)) return json({ error: 'Not found', code: 'not_found' }, 404)

  // ── La candidature, son annonce, et le profil jugé ───────────────────────
  //  Le filtre d'écosystème est DANS cette recherche.
  const { data: candData, error: candErr } = await auth.supabaseAdmin
    .from('candidatures')
    .select(
      'id, match_id, profile_id, publication_id, domain_id, ' +
        'publications!inner(id, organization_id, type, title, description, skills_required, seniorities)',
    )
    .eq('id', id)
    .eq('domain_id', activeEcosystemId(auth))
    .maybeSingle()

  // Une requête en ÉCHEC n'est pas une candidature ABSENTE : la confondre
  // renverrait un 404 sur une panne, et enverrait chercher un objet supprimé.
  if (candErr) {
    console.error('[pitch] lecture de la candidature en échec', { id, message: candErr.message })
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!candData) return json({ error: 'Not found', code: 'not_found' }, 404)

  const cand = candData as unknown as {
    id: string
    match_id: string | null
    profile_id: string
    publication_id: string
    domain_id: string
    publications:
      | {
          id: string
          organization_id: string
          type: string
          title: string | null
          description: string | null
          skills_required: string[] | null
          seniorities: string[] | null
        }
      | Array<{
          id: string
          organization_id: string
          type: string
          title: string | null
          description: string | null
          skills_required: string[] | null
          seniorities: string[] | null
        }>
      | null
  }
  const pub = Array.isArray(cand.publications) ? cand.publications[0] : cand.publications
  if (!pub) return json({ error: 'Not found', code: 'not_found' }, 404)

  // L'organisation appelante possède-t-elle cette annonce ? Même semantic que
  // l'absence : on ne confirme pas l'existence d'un objet d'autrui.
  if (pub.organization_id !== orgId) return json({ error: 'Not found', code: 'not_found' }, 404)

  // Sans match, il n'y a nulle part où écrire : le pitch vit dans
  // `matches.explanation`, et une candidature sans match n'existe pas dans le
  // flux normal (la garde du dépôt l'exige).
  if (!cand.match_id) {
    return json({ pitch: null, raison: 'aucun match rattaché à cette candidature' }, 200)
  }

  // ── Le pitch existe-t-il déjà ? ──────────────────────────────────────────
  const { data: matchData, error: matchErr } = await auth.supabaseAdmin
    .from('matches')
    .select('id, explanation')
    .eq('id', cand.match_id)
    .maybeSingle()
  if (matchErr) {
    console.error('[pitch] lecture du match en échec', { id, message: matchErr.message })
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const explication = (matchData?.explanation ?? {}) as Record<string, unknown>
  const dejaEcrit = typeof explication.pitch_org === 'string' ? explication.pitch_org : null

  // ── Le profil jugé — rôle et secteur seulement ───────────────────────────
  const { data: profData, error: profErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id, title, summary, skills, seniorities, years_total_experience')
    .eq('id', cand.profile_id)
    .maybeSingle()
  if (profErr) {
    console.error('[pitch] lecture du profil en échec', { id, message: profErr.message })
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profData) return json({ pitch: null, raison: 'profil introuvable' }, 200)
  const prof = profData as unknown as {
    title: string | null
    summary: string | null
    skills: string[] | null
    seniorities: string[] | null
    years_total_experience: number | null
  }

  // Aucune date n'est demandée à la base : ce qu'on ne charge pas ne peut pas
  // partir chez un tiers.
  const { data: expRows } = await auth.supabaseAdmin
    .from('profile_experiences')
    .select('role, sector')
    .eq('profile_id', cand.profile_id)
    .limit(20)

  const locale = langueSure(new URL(request.url).searchParams.get('locale'))

  const resultat = await redigerPitchOrg({
    supabaseAdmin: auth.supabaseAdmin,
    domainId: cand.domain_id,
    matchId: cand.match_id,
    // L organisation qui demande le pitch : deja verifiee proprietaire de
    // l annonce plus haut (404 sinon).
    organizationId: orgId,
    pitchExistant: dejaEcrit,
    entree: {
      locale,
      annonce: {
        type: pub.type,
        title: pub.title ?? '',
        description: pub.description ?? '',
        skills_required: pub.skills_required ?? [],
        seniorities: pub.seniorities ?? [],
      },
      profil: {
        title: prof.title,
        summary: prof.summary,
        skills: Array.isArray(prof.skills) ? prof.skills : [],
        seniorities: Array.isArray(prof.seniorities) ? prof.seniorities : [],
        years_total_experience: prof.years_total_experience,
        experiences: ((expRows ?? []) as Array<{ role: string | null; sector: string | null }>).map(
          (e) => ({ role: e.role, sector: e.sector }),
        ),
      },
    },
  })

  if (!resultat.ok) {
    // Pas d'erreur HTTP : la carte s'affiche sans pitch. Un texte d'agrément ne
    // doit pas empêcher de lire un dossier — et la panne est COMPTÉE avec sa
    // cause, pour que l'absence de résumés se voie.
    console.warn('[pitch] non rédigé', {
      candidature: id,
      cause: resultat.cause,
      raison: resultat.raison,
    })
    await enregistrerPanne(auth.supabaseAdmin, {
      cause: resultat.cause,
      surface: 'pitch',
      domain_id: cand.domain_id,
      entity_id: cand.match_id,
      detail: resultat.raison,
    })
    return json({ pitch: null, raison: resultat.raison }, 200)
  }

  // Déjà écrit : on n'écrit rien, on ne dépense rien.
  if (resultat.deja) return json({ pitch: resultat.pitch, genere: false }, 200)

  const { error: majErr } = await auth.supabaseAdmin
    .from('matches')
    .update({
      explanation: {
        ...explication,
        pitch_org: resultat.pitch,
        pitch_model: 'claude-sonnet-5',
        pitch_at: new Date().toISOString(),
      },
    })
    .eq('id', cand.match_id)
  if (majErr) {
    // Le pitch est rendu quand même : il a été payé, autant qu'il serve. Mais
    // il sera régénéré à la prochaine ouverture, et c'est ce que dit ce
    // journal — un texte payé deux fois sans que personne le sache serait pire.
    console.error('[pitch] NON PERSISTÉ — il sera régénéré, donc repayé', {
      match: cand.match_id,
      message: majErr.message,
    })
  }

  return json({ pitch: resultat.pitch, genere: true }, 200)
}

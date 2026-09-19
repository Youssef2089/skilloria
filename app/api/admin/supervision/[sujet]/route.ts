import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/supervision/[sujet] — LE DÉTAIL, LIGNE PAR LIGNE.
 *
 * ┌─ POURQUOI ──────────────────────────────────────────────────────────────┐
 * │ Un total ne permet d'agir sur rien. « Six mises en relation jamais       │
 * │ tentées » ne dit pas LESQUELLES — et c'est la seule chose qu'on veuille  │
 * │ savoir en le lisant.                                                     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ CE QUE CETTE ROUTE NE REND JAMAIS ═══════════════════════════════════
 *   Aucun contenu produit par un utilisateur au-delà du TITRE d'une annonce :
 *   ni CV, ni message, ni texte de candidature. Et jamais l'identité d'un
 *   expert — §D.4 : e-mail, téléphone et nom ne sortent par aucun chemin
 *   serveur vers une surface qui n'a pas à les connaître. Un écran de
 *   supervision n'en a pas besoin : il lui faut un identifiant et une date.
 *
 * ═══ UN SUJET INCONNU EST UN 404, PAS UNE LISTE VIDE ═════════════════════
 *   Rendre `[]` pour un sujet qui n'existe pas ferait lire « rien à voir »
 *   là où il faut lire « ce n'est pas une question qu'on sait poser » (§E.22).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Les sujets ouvrables. Liste FERMÉE : un sujet inventé se refuse. */
const SUJETS = ['inacheves', 'operations', 'resumes', 'relances'] as const
type Sujet = (typeof SUJETS)[number]

const LIMITE = 100

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ sujet: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Next 16 : `params` est asynchrone et doit être attendu.
  const { sujet: brut } = await ctx.params
  if (!SUJETS.includes(brut as Sujet)) {
    return json({ error: 'Unknown subject', code: 'unknown_subject', sujets: SUJETS }, 404)
  }
  const sujet = brut as Sujet
  const admin = auth.supabaseAdmin

  if (sujet === 'inacheves') {
    // Les annonces publiées dont la mise en relation ne s'est jamais achevée.
    // On rend l'ÉTAT calculé ici, avec la même règle que `matching_runs_inacheves`
    // — la recopier ailleurs ferait diverger l'agrégat et son détail.
    const { data, error } = await admin
      .from('publications')
      .select('id, title, published_at, matching_attempts, matching_attempted_at, domain_id')
      .eq('status', 'published')
      .is('matching_completed_at', null)
      .order('published_at', { ascending: true })
      .limit(LIMITE)
    if (error) {
      console.error('[admin:supervision:inacheves]', error.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    const lignes = (data ?? []).map((p) => {
      const tentatives = Number((p as { matching_attempts: number | null }).matching_attempts ?? 0)
      const tentee = (p as { matching_attempted_at: string | null }).matching_attempted_at
      return {
        ...p,
        etat: tentee === null ? 'jamais_tente' : tentatives >= 5 ? 'abandonne' : 'en_cours',
      }
    })
    return json({ sujet, lignes, limite: LIMITE }, 200)
  }

  if (sujet === 'operations') {
    const { data, error } = await admin.rpc('ai_depense_operations', { p_limite: LIMITE })
    if (error) {
      console.error('[admin:supervision:operations]', error.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    return json({ sujet, lignes: data ?? [], limite: LIMITE }, 200)
  }

  if (sujet === 'resumes') {
    const { data, error } = await admin
      .from('ai_redaction_failures')
      .select('id, cause, surface, entity_id, domain_id, created_at')
      .order('created_at', { ascending: false })
      .limit(LIMITE)
    if (error) {
      console.error('[admin:supervision:resumes]', error.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    return json({ sujet, lignes: data ?? [], limite: LIMITE }, 200)
  }

  // relances — l'expert reste un IDENTIFIANT, jamais un nom (§D.4).
  const { data, error } = await admin
    .from('relance_overruns')
    .select('id, profile_id, origine, created_at')
    .order('created_at', { ascending: false })
    .limit(LIMITE)
  if (error) {
    console.error('[admin:supervision:relances]', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  return json({ sujet, lignes: data ?? [], limite: LIMITE }, 200)
}

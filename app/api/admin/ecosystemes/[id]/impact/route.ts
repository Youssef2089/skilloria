import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/ecosystemes/[id]/impact — CE QUE LA DÉSACTIVATION VA FAIRE.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ON ANNONCE DES VOLUMES RÉELS, PAS UN AVERTISSEMENT GÉNÉRIQUE.            ║
 * ║                                                                          ║
 * ║ « Êtes-vous sûr ? » ne renseigne personne. Ce que l'administrateur doit  ║
 * ║ voir avant de basculer, c'est COMBIEN : combien d'experts y travaillent, ║
 * ║ combien d'annonces sont en ligne, combien de candidatures attendent une  ║
 * ║ réponse. Un compte à zéro et un compte à quatre cents ne se décident     ║
 * ║ pas de la même façon.                                                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ CETTE ROUTE NE DÉSACTIVE RIEN. Elle LIT. La bascule passe par PATCH sur
 *    la route parente. Un « aperçu » qui écrirait serait un piège.
 *
 * CE QUI EST VRAI DE LA DÉSACTIVATION, et que l'écran affiche avec les chiffres :
 *   • les EXPERTS inscrits GARDENT leur accès — ils y sont rattachés à vie, et
 *     leurs missions en cours ne doivent pas devenir inatteignables ;
 *   • les ORGANISATIONS n'y entrent plus : l'écosystème disparaît de leur
 *     sélecteur, et la garde refuse celles qui tenteraient l'adresse ;
 *   • RIEN N'EST SUPPRIMÉ. Annonces, candidatures et messages restent en base,
 *     et réactiver les rend de nouveau visibles.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return json({ error: 'Invalid id', code: 'invalid_id' }, 400)

  const { data: dom, error: domErr } = await auth.supabaseAdmin
    .from('domains')
    .select('id, slug, name, active')
    .eq('id', id)
    .maybeSingle()
  if (domErr) {
    console.error('[admin:ecosysteme-impact] domain read failed', domErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!dom) return json({ error: 'Not found', code: 'not_found' }, 404)

  const admin = auth.supabaseAdmin
  const count = async (table: string): Promise<number | null> => {
    const { count: n, error } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('domain_id', id)
    if (error) {
      // ⚠️ `null`, PAS `0`. Un compteur en panne qui affiche zéro dirait
      //    « il n'y a rien à perdre » au moment précis où on décide de couper.
      //    L'écran montre « — » et le dit.
      console.error(`[admin:ecosysteme-impact] count ${table} failed`, error.message)
      return null
    }
    return n ?? 0
  }

  const countUsers = async (types: string[]): Promise<number | null> => {
    const { count: n, error } = await admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('domain_id', id)
      .in('user_type', types)
    if (error) {
      console.error('[admin:ecosysteme-impact] count users failed', error.message)
      return null
    }
    return n ?? 0
  }

  const countPublished = async (): Promise<number | null> => {
    const { count: n, error } = await admin
      .from('publications')
      .select('id', { count: 'exact', head: true })
      .eq('domain_id', id)
      .eq('status', 'published')
    if (error) {
      console.error('[admin:ecosysteme-impact] count published failed', error.message)
      return null
    }
    return n ?? 0
  }

  const [experts, orgUsers, publications, published, candidatures, conversations, branches, specialities] =
    await Promise.all([
      countUsers(['expert_freelance', 'expert_cdi']),
      countUsers(['client', 'cabinet']),
      count('publications'),
      countPublished(),
      count('candidatures'),
      count('conversations'),
      count('branches'),
      count('specialities'),
    ])

  return json(
    {
      ecosystem: { id: dom.id, slug: dom.slug, name: dom.name, active: dom.active },
      // Ce qui CONTINUE malgré la désactivation.
      keeps_access: { experts },
      // Ce qui CESSE d'être offert.
      loses_access: { organisation_accounts: orgUsers },
      // Ce qui reste EN BASE, intact, et redevient visible à la réactivation.
      preserved: { publications, published, candidatures, conversations },
      taxonomy: { branches, specialities },
    },
    200,
  )
}

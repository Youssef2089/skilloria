import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { FAMILLES_JOURNAL } from '@/lib/journal/lecture'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/admin/journal/conservation — LA CONSERVATION DU GRAND LIVRE, famille par
 * famille (§D.26, phase B 2.7).
 *
 *   GET   → l'ANNONCE : pour chaque famille, sa conservation, son plancher légal,
 *           la date limite et le nombre de lignes qu'un nettoyage effacerait —
 *           ou la RAISON pour laquelle elle ne se nettoie pas. `annoncer_nettoyage_journal`.
 *   PATCH → régler la conservation d'UNE famille ({ famille, mois | null }).
 *           `regler_conservation_journal` : le réglage ET sa ligne `reglage_modifie`.
 *
 * ⚠️ LE PLANCHER LÉGAL NE SE RÈGLE PAS ICI. C'est une obligation, décidée par
 *    Youssef et posée par migration ; tant qu'il est « à arbitrer », la
 *    conservation de la famille ne se règle pas (409 `plancher_a_arbitrer`).
 * ⚠️ Chaque refus a son code, stable ; aucun n'est tu.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const { data, error } = await auth.supabaseAdmin.rpc('annoncer_nettoyage_journal', { p_admin_id: auth.user.id })
  if (error) {
    console.error('[admin:journal/conservation] annonce illisible', error.message)
    return json({ error: 'Retention unreadable', code: 'conservation_illisible' }, 503)
  }
  return json(data, 200)
}

const REFUS: Record<string, number> = {
  famille_inconnue: 400,
  journal_conserve: 400,
  sous_le_plancher: 400,
  plancher_a_arbitrer: 409,
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  // La pièce du geste naît à son entrée, avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)

  let corps: { famille?: unknown; mois?: unknown }
  try {
    corps = (await request.json()) as typeof corps
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const famille = typeof corps.famille === 'string' ? corps.famille : ''
  if (!(FAMILLES_JOURNAL as readonly string[]).includes(famille)) {
    return json({ error: 'Unknown family', code: 'famille_inconnue' }, 400)
  }
  const mois = corps.mois === null ? null : Number(corps.mois)
  if (mois !== null && (!Number.isInteger(mois) || mois < 1 || mois > 1200)) {
    return json({ error: 'Invalid duration', code: 'duree_invalide' }, 400)
  }

  const { data, error } = await auth.supabaseAdmin.rpc('regler_conservation_journal', {
    p_piece: journal.piece,
    p_acteur_id: auth.user.id,
    p_famille: famille,
    p_mois: mois,
  })
  if (error) {
    console.error('[admin:journal/conservation] réglage en échec', error.message)
    return json({ error: 'Setting failed', code: 'reglage_indisponible' }, 503)
  }
  const issue = data as { issue: string; plancher_mois?: number }
  if (issue.issue in REFUS) {
    return json({ error: 'Refused', code: issue.issue, plancher_mois: issue.plancher_mois ?? null }, REFUS[issue.issue])
  }
  return json({ ok: true, inchange: issue.issue === 'inchange' }, 200)
}

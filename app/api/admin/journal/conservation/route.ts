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
 *   PATCH → régler UNE famille : { famille, conservation_mois, plancher_mois }, chacune
 *           un nombre de mois ou `null` (vide). `regler_conservation_journal` : le
 *           réglage ET sa ligne `reglage_modifie` (avant, après, les deux valeurs).
 *
 * ⚠️ TOUT EST PARAMÉTRABLE (décision de Youssef, 28/09/2026) : la conservation ET le
 *    plancher légal se saisissent ici, famille par famille ; ils naissent VIDES, et
 *    une valeur vide interdit le nettoyage de sa famille. Aucune valeur n'est posée
 *    par le code ni par une migration.
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
  // LES PROPOSITIONS (ARRÊT 22) : la durée minimale qu'un texte impose et la durée proposée, par famille — EN BASE
  // (`grand_livre_conservation_proposee`), jamais dans le code. Une lecture en panne se dit : l'écran n'affiche
  // alors aucune proposition plutôt qu'une proposition inventée.
  const { data: propositions, error: propErr } = await auth.supabaseAdmin
    .from('grand_livre_conservation_proposee')
    .select('famille, plancher_mois, conservation_mois')
  if (propErr) console.error('[admin:journal/conservation] propositions illisibles', propErr.message)
  return json({
    ...(data as Record<string, unknown>),
    propositions: propErr ? null : propositions ?? [],
  }, 200)
}

const REFUS: Record<string, number> = {
  famille_inconnue: 400,
  journal_conserve: 400,
  sous_le_plancher: 400,
  plancher_manquant: 400,
}

/** Un nombre de mois (plancher : 0 admis, « aucun plancher ») ou `null` ; autre chose : invalide. */
function mois(v: unknown, minimum: number): number | null | 'invalide' {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= minimum && n <= 1200 ? n : 'invalide'
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

  let corps: { famille?: unknown; conservation_mois?: unknown; plancher_mois?: unknown }
  try {
    corps = (await request.json()) as typeof corps
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const famille = typeof corps.famille === 'string' ? corps.famille : ''
  if (!(FAMILLES_JOURNAL as readonly string[]).includes(famille)) {
    return json({ error: 'Unknown family', code: 'famille_inconnue' }, 400)
  }
  const conservation = mois(corps.conservation_mois, 1)
  const plancher = mois(corps.plancher_mois, 0)
  if (conservation === 'invalide' || plancher === 'invalide') {
    return json({ error: 'Invalid duration', code: 'duree_invalide' }, 400)
  }

  const { data, error } = await auth.supabaseAdmin.rpc('regler_conservation_journal', {
    p_piece: journal.piece,
    p_acteur_id: auth.user.id,
    p_famille: famille,
    p_conservation_mois: conservation,
    p_plancher_mois: plancher,
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

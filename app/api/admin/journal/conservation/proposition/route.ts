import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { FAMILLES_JOURNAL } from '@/lib/journal/lecture'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/journal/conservation/proposition — APPLIQUER LA PROPOSITION d'une famille (ARRÊT 22, §D.33).
 *
 * Corps : { famille }. La durée minimale imposée par un texte et la durée proposée viennent de la base
 * (`grand_livre_conservation_proposee`), jamais de la requête ni du code ; `appliquer_proposition_conservation`
 * les pose par l'écrivain unique du réglage (`regler_conservation_journal`), qui écrit `reglage_modifie` — et
 * n'écrit rien quand la valeur appliquée est déjà celle en place.
 *
 * Refus nommés : famille_inconnue · journal_conserve · sans_proposition · sous_le_plancher · plancher_manquant.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const REFUS: Record<string, number> = {
  famille_inconnue: 400,
  journal_conserve: 400,
  sans_proposition: 400,
  sous_le_plancher: 400,
  plancher_manquant: 400,
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  // La pièce du geste naît à son entrée, avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)

  let corps: { famille?: unknown }
  try {
    corps = (await request.json()) as typeof corps
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const famille = typeof corps.famille === 'string' ? corps.famille : ''
  if (!(FAMILLES_JOURNAL as readonly string[]).includes(famille)) {
    return json({ error: 'Unknown family', code: 'famille_inconnue' }, 400)
  }

  const { data, error } = await auth.supabaseAdmin.rpc('appliquer_proposition_conservation', {
    p_piece: journal.piece,
    p_acteur_id: auth.user.id,
    p_famille: famille,
  })
  if (error) {
    console.error('[admin:journal/conservation/proposition] application en échec', error.message)
    return json({ error: 'Setting failed', code: 'reglage_indisponible' }, 503)
  }
  const issue = data as { issue: string }
  if (issue.issue in REFUS) {
    return json({ error: 'Refused', code: issue.issue }, REFUS[issue.issue])
  }
  return json({ ok: true, inchange: issue.issue === 'inchange' }, 200)
}

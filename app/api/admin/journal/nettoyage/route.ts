import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { contexteDepuisAuth } from '@/lib/journal/contexte'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/journal/nettoyage — LE NETTOYAGE DU GRAND LIVRE (§D.26, phase B 2.7).
 *
 * Le seul chemin de suppression, et il est IRRÉVERSIBLE : ré-authentification
 * exigée (`x-reauth-token`, le mécanisme existant). Le corps porte le TOTAL
 * ANNONCÉ à l'administrateur (`total_annonce`) : `nettoyer_journal()` recalcule
 * et refuse s'il a changé (409 `annonce_perimee`, avec le total actuel) — on
 * n'efface jamais autre chose que ce qui a été montré. Les suppressions et la
 * ligne `journal_nettoye` : une transaction, en base.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail
  // La pièce du geste naît à son entrée, avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)

  let corps: { total_annonce?: unknown }
  try {
    corps = (await request.json()) as typeof corps
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  const total = Number(corps.total_annonce)
  if (!Number.isInteger(total) || total < 0) {
    return json({ error: 'Missing announced total', code: 'annonce_manquante' }, 400)
  }

  const { data, error } = await auth.supabaseAdmin.rpc('nettoyer_journal', {
    p_piece: journal.piece,
    p_acteur_id: auth.user.id,
    p_total_annonce: total,
  })
  if (error) {
    console.error('[admin:journal/nettoyage] nettoyage en échec — rien n’a été effacé', error.message)
    return json({ error: 'Clean-up failed', code: 'nettoyage_indisponible' }, 503)
  }
  const issue = data as { issue: 'nettoye' | 'annonce_perimee' | 'rien_a_nettoyer'; lignes?: number; total?: number }
  if (issue.issue === 'annonce_perimee') {
    return json({ error: 'Announcement is stale', code: 'annonce_perimee', total: issue.total ?? null }, 409)
  }
  return json({ ok: true, issue: issue.issue, lignes: issue.lignes ?? 0 }, 200)
}

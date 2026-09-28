import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { nouvellePiece } from '@/lib/journal/piece'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / POST /api/admin/domaines-adresse — LES DEUX LISTES DE DOMAINES D'ADRESSE (§D.27, décision 6).
 *
 * ═══ CE QU'ELLES RÈGLENT ═══════════════════════════════════════════════════
 *   BLOQUÉS : une organisation ne se préinscrit pas avec une adresse de ce domaine
 *   (`email_domain_blocked`). PUBLICS (gmail.com…) : l'inscription est acceptée, mais
 *   le domaine ne se RÉSERVE pas — plusieurs organisations le partagent. La règle qui
 *   les lit est en base (`inscription_refus`) ; cet écran règle ses DONNÉES, rien de
 *   plus : aucune liste n'est écrite dans le code.
 *
 * ═══ UN GESTE, UNE LIGNE — EN BASE ════════════════════════════════════════
 *   `regler_domaine_adresse()` écrit la liste ET la ligne `reglage_modifie` (sujet : la
 *   ligne de la liste ; la liste ; avant/après actif) dans la même transaction, et
 *   refuse en base un acteur qui n'est pas administrateur actif (AD002). Ajouter un
 *   domaine l'active ; le retirer le DÉSACTIVE (sa raison et son auteur restent) : on
 *   ne supprime pas une décision, on la retire. Les refus ont un nom et n'écrivent rien.
 *
 * Body POST : { liste: 'bloques' | 'publics', domaine, actif: boolean, raison? }
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const ISSUES_REFUSEES = ['liste_inconnue', 'domaine_invalide', 'dans_l_autre_liste', 'domaine_inconnu'] as const
type IssueRefusee = (typeof ISSUES_REFUSEES)[number]

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin
  const colonnes = 'id, email_domain, reason, active, updated_at'
  const [bloques, publics] = await Promise.all([
    admin.from('blocked_email_domains').select(colonnes).order('email_domain'),
    admin.from('public_email_domains').select(colonnes).order('email_domain'),
  ])
  // « Illisible » n'est pas « vide » (§E.22) : une liste vide AFFICHÉE ferait croire qu'aucun domaine n'est bloqué.
  if (bloques.error || publics.error) {
    console.error('[admin:domaines-adresse] lecture en échec', bloques.error?.message ?? publics.error?.message)
    return json({ error: 'Lists unavailable', code: 'listes_illisibles' }, 503)
  }
  return json({ bloques: bloques.data ?? [], publics: publics.data ?? [] })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin
  // LA PIÈCE, À L'ENTRÉE DU GESTE — avant toute écriture (§D.26).
  const piece = nouvellePiece()

  let corps: Record<string, unknown>
  try {
    corps = (await request.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }
  if (typeof corps.actif !== 'boolean') {
    return json({ error: 'Invalid input', code: 'actif_requis' }, 400)
  }
  const liste = typeof corps.liste === 'string' ? corps.liste : ''
  const domaine = typeof corps.domaine === 'string' ? corps.domaine : ''
  const raison = typeof corps.raison === 'string' ? corps.raison.slice(0, 500) : ''

  const { data, error } = await admin.rpc('regler_domaine_adresse', {
    p_piece: piece,
    p_acteur_id: auth.user.id,
    p_ecosysteme_id: auth.domain.id,
    p_liste: liste,
    p_domaine: domaine,
    p_actif: corps.actif,
    p_raison: raison,
  })
  // Une erreur de l'appel est une PANNE, jamais un refus métier (§E.22) : l'administrateur actif est déjà
  // garanti par requireAdmin — AD002 n'est que la seconde barrière, en base.
  if (error) {
    console.error('[admin:domaines-adresse] écriture en échec', error.message)
    return json({ error: 'Setting failed', code: 'reglage_indisponible' }, 503)
  }
  const verdict = (data ?? {}) as { issue?: string; id?: string }
  if ((ISSUES_REFUSEES as readonly string[]).includes(verdict.issue ?? '')) {
    return json({ error: 'Refused', code: verdict.issue as IssueRefusee }, 400)
  }
  if (verdict.issue !== 'regle' && verdict.issue !== 'inchange') {
    // Une issue inconnue n'est pas un succès (§E.30) : rien ne dit ce qui a été écrit.
    console.error('[admin:domaines-adresse] issue inconnue', verdict)
    return json({ error: 'Unexpected result', code: 'db_error' }, 500)
  }
  if (verdict.issue === 'regle' && verdict.id) {
    // Le sous-journal d'audit garde le détail (IP, navigateur) — sous la MÊME pièce.
    await logAudit({
      supabaseAdmin: admin,
      piece,
      user_id: auth.user.id,
      domain_id: auth.domain.id,
      action: 'email_domain_list_updated',
      entity_type: liste === 'bloques' ? 'blocked_email_domains' : 'public_email_domains',
      entity_id: verdict.id,
      request,
      detail: { liste, actif: corps.actif },
    })
  }
  return json({ issue: verdict.issue, id: verdict.id ?? null })
}

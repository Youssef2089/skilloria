import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { ACTIONS_JOURNAL } from '@/lib/journal/actions'
import {
  FAMILLES_JOURNAL,
  ORIGINES_JOURNAL,
  STATUTS_JOURNAL,
  estUuid,
  listeFermee,
  type LigneJournal,
  type PageJournal,
} from '@/lib/journal/lecture'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/journal — une page du grand livre, filtrée (§D.26, phase B 2.6).
 *
 * La lecture est EN BASE : `lire_grand_livre()` (SECURITY DEFINER, bornée à 200
 * lignes, AD002 pour tout autre qu'un administrateur actif). Cette route valide
 * les filtres contre des vocabulaires FERMÉS — une valeur inconnue est refusée
 * nommément (400), jamais ignorée : un filtre qui ne filtre pas rendrait une
 * page juste sous une étiquette fausse (§E.24).
 *
 * Filtres (tous optionnels) : `familles`, `types`, `statuts`, `origines` (listes
 * `a,b`), `acteur`, `ecosysteme` (uuid), `du`, `au` (dates ISO), `limite` (1-200),
 * `curseur` (opaque, rendu par la page précédente).
 *
 * ⚠️ UNE LECTURE EN PANNE SE DIT (503 `journal_illisible`) : une liste vide sur
 *    une panne se lirait « rien ne s'est passé » (§E.22).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Le curseur : (horodatage, id) de la dernière ligne lue, encodé — jamais montré. */
function encoderCurseur(c: { horodatage: string; id: number }): string {
  return Buffer.from(JSON.stringify([c.horodatage, c.id]), 'utf8').toString('base64url')
}
function decoderCurseur(s: string | null): { horodatage: string; id: number } | null | 'illisible' {
  if (!s) return null
  try {
    const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(v) || typeof v[0] !== 'string' || Number.isNaN(Date.parse(v[0])) || !Number.isInteger(v[1])) return 'illisible'
    return { horodatage: v[0], id: v[1] as number }
  } catch {
    return 'illisible'
  }
}

function date(brut: string | null): string | null | 'illisible' {
  if (!brut) return null
  return Number.isNaN(Date.parse(brut)) ? 'illisible' : new Date(brut).toISOString()
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const q = request.nextUrl.searchParams
  const familles = listeFermee(q.get('familles'), FAMILLES_JOURNAL)
  const types = listeFermee(q.get('types'), ACTIONS_JOURNAL)
  const statuts = listeFermee(q.get('statuts'), STATUTS_JOURNAL)
  const origines = listeFermee(q.get('origines'), ORIGINES_JOURNAL)
  if (familles === 'hors_liste' || types === 'hors_liste' || statuts === 'hors_liste' || origines === 'hors_liste') {
    return json({ error: 'Unknown filter value', code: 'filtre_inconnu' }, 400)
  }
  const acteur = q.get('acteur')
  const ecosysteme = q.get('ecosysteme')
  if ((acteur && !estUuid(acteur)) || (ecosysteme && !estUuid(ecosysteme))) {
    return json({ error: 'Invalid identifier', code: 'identifiant_invalide' }, 400)
  }
  const du = date(q.get('du'))
  const au = date(q.get('au'))
  if (du === 'illisible' || au === 'illisible') {
    return json({ error: 'Invalid date', code: 'date_invalide' }, 400)
  }
  const curseur = decoderCurseur(q.get('curseur'))
  if (curseur === 'illisible') {
    return json({ error: 'Invalid cursor', code: 'curseur_invalide' }, 400)
  }
  const limite = Number(q.get('limite') ?? 50)

  const { data, error } = await auth.supabaseAdmin.rpc('lire_grand_livre', {
    p_admin_id: auth.user.id,
    p_familles: familles,
    p_types: types,
    p_acteur_id: acteur,
    p_ecosysteme_id: ecosysteme,
    p_du: du,
    p_au: au,
    p_statuts: statuts,
    p_origines: origines,
    p_limite: Number.isInteger(limite) ? limite : 50,
    p_apres_horodatage: curseur?.horodatage ?? null,
    p_apres_id: curseur?.id ?? null,
  })
  if (error) {
    console.error('[admin:journal] lecture en panne', error.message)
    return json({ error: 'Journal unreadable', code: 'journal_illisible' }, 503)
  }
  const brut = data as { lignes: LigneJournal[]; limite: number; suivant: { horodatage: string; id: number } | null }
  const page: PageJournal = {
    lignes: brut.lignes,
    limite: brut.limite,
    suivant: brut.suivant ? encoderCurseur(brut.suivant) : null,
  }
  return json(page, 200)
}

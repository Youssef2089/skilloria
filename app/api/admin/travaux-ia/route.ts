import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { contexteDepuisAuth, parametresJournal } from '@/lib/journal/contexte'
import { couperEtSignaler, limiteSondee } from '@/lib/plafonds-liste'

/** Ce que l'écran montre au plus ; au-delà, la réponse le DIT (une ligne-sonde, §plafonds-liste). */
const PLAFOND_TRAVAUX = 200

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * LES TRAVAUX D'IA QUI ATTENDENT UN HUMAIN — et le bouton qui les relance (§D.30).
 *
 *   GET  — la liste de `travaux_ia_en_souffrance()` : échoués que rien n'a remplacés,
 *          en retard, bail expiré. La MÊME expression que la supervision : l'écran et
 *          l'alarme ne peuvent pas annoncer deux nombres différents (§E.36).
 *   POST — { travail_id } : relance un travail ÉCHOUÉ. La base redépose (le profil
 *          repasse « en cours »), réveille l'exécutant et écrit `travail_ia_relance`
 *          sous la pièce de ce geste. Un travail qui n'est plus échoué rend 409.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Ligne = {
  id: string
  nature: string
  profile_id: string
  statut: string
  tentatives: number
  max_tentatives: number
  erreur_code: string | null
  cree_at: string
  fin_at: string | null
  prochaine_tentative_at: string
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
  // Le plus RÉCENT d'abord : au-delà du plafond, c'est la queue la plus ancienne qui tombe — et la réponse le dit.
  const { data, error } = await admin.rpc('travaux_ia_en_souffrance').order('cree_at', { ascending: false }).limit(limiteSondee(PLAFOND_TRAVAUX))
  if (error) {
    console.error('[admin/travaux-ia] lecture en panne', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const coupe = couperEtSignaler((data ?? []) as Ligne[], PLAFOND_TRAVAUX, 'admin/travaux-ia')
  const lignes = coupe.lignes

  // L'expert de chaque ligne : lisible par un administrateur, jamais par l'écran d'un autre.
  const ids = [...new Set(lignes.map((l) => l.profile_id))]
  const noms = new Map<string, { titre: string | null; nom: string | null }>()
  if (ids.length > 0) {
    const { data: profs, error: profsErr } = await admin
      .from('profiles')
      .select('id, title, users!profiles_user_id_fkey(first_name, last_name)')
      .in('id', ids)
    if (profsErr) {
      console.error('[admin/travaux-ia] experts illisibles — les lignes sortent sans nom', profsErr.message)
    } else {
      for (const p of (profs ?? []) as unknown as Array<{ id: string; title: string | null; users: { first_name?: string | null; last_name?: string | null } | null }>) {
        const u = Array.isArray(p.users) ? p.users[0] : p.users
        noms.set(p.id, { titre: p.title, nom: [u?.first_name, u?.last_name].filter(Boolean).join(' ') || null })
      }
    }
  }
  return json({
    travaux: lignes.map((l) => ({ ...l, expert: noms.get(l.profile_id) ?? null })),
    troncature: coupe.troncature,
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
  let body: { travail_id?: unknown }
  try {
    body = (await request.json()) as { travail_id?: unknown }
  } catch {
    return json({ error: 'Invalid JSON', code: 'bad_body' }, 400)
  }
  const travailId = typeof body.travail_id === 'string' && UUID.test(body.travail_id) ? body.travail_id : null
  if (!travailId) return json({ error: 'travail_id required', code: 'bad_body' }, 400)

  const journal = contexteDepuisAuth(auth)
  const { data, error } = await auth.supabaseAdmin.rpc('relancer_travail_ia', {
    ...parametresJournal(journal),
    p_travail: travailId,
  })
  if (error) {
    console.error('[admin/travaux-ia] relance en panne', { travailId, message: error.message })
    return json({ error: 'Restart failed', code: 'db_error' }, 500)
  }
  if (typeof data !== 'string') {
    // Plus échoué (déjà relancé, ou remplacé par un nouveau dépôt) : rien à relancer.
    return json({ error: 'Job is not failed anymore', code: 'plus_en_echec' }, 409)
  }
  return json({ ok: true, travail: data })
}

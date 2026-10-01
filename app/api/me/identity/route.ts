import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { clesModifiees } from '@/lib/profil/changements'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { JournalError } from '@/lib/journal/journaliser'
import { identiteModifiee } from '@/lib/comptes/journal-compte'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Body = { first_name?: unknown; last_name?: unknown }

const NAME_MAX = 80

/**
 * PATCH /api/me/identity — modifier prénom + nom (mission S3, section 1).
 *
 * Ré-auth EXIGÉE (header x-reauth-token). Le nom N'EST PAS un input de la
 * vérification IA expert (cf. lib/verification/ai-expert-verification.ts) :
 * l'édition est autorisée et journalisée, sans re-review (reco V1).
 * Borné à auth.uid() (l'expert n'agit que sur SON compte).
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail
  // La pièce du geste naît à son entrée, avant toute écriture (§D.26).
  const journal = contexteDepuisAuth(auth)

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const first_name = typeof body.first_name === 'string' ? body.first_name.trim() : ''
  const last_name = typeof body.last_name === 'string' ? body.last_name.trim() : ''

  if (first_name.length < 1 || first_name.length > NAME_MAX) {
    return json({ error: 'Invalid first_name', code: 'invalid_first_name' }, 400)
  }
  if (last_name.length < 1 || last_name.length > NAME_MAX) {
    return json({ error: 'Invalid last_name', code: 'invalid_last_name' }, 400)
  }

  // CE QUI CHANGE VRAIMENT (décision de Youssef, 01/10/2026, ARRÊT 22) : « Nom modifié » s'écrivait à chaque
  // enregistrement, même identique. Le nom est relu ; les champs qui ne changent pas ne s'écrivent pas, et un
  // enregistrement sans changement ne touche à rien. Une relecture en panne compte les deux comme modifiés.
  const { data: actuel, error: actuelErr } = await auth.supabaseAdmin
    .from('users')
    .select('first_name, last_name')
    .eq('id', auth.user.id)
    .maybeSingle()
  const champs: Array<'first_name' | 'last_name'> = actuelErr || !actuel
    ? ['first_name', 'last_name']
    : (clesModifiees({ first_name, last_name }, actuel as Record<string, unknown>) as Array<'first_name' | 'last_name'>)
  if (champs.length === 0) {
    return json({ ok: true, first_name, last_name, inchange: true }, 200)
  }

  const { error: updErr } = await auth.supabaseAdmin
    .from('users')
    .update({ first_name, last_name })
    .eq('id', auth.user.id)
  if (updErr) {
    console.error('[me/identity] users update failed', updErr.message)
    return json({ error: 'Could not update identity', code: 'db_error' }, 500)
  }

  // Le grand livre (§D.26, phase B) : les NOMS des champs, jamais les valeurs.
  try {
    await identiteModifiee(auth.supabaseAdmin, journal, { userId: auth.user.id, champs })
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    console.error('[me/identity] grand livre en échec après écriture', { userId: auth.user.id, message: err.message })
    return json({ error: 'Journal failed', code: 'journal_error' }, 500)
  }

  await logAudit({
    piece: journal.piece,
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'identity_updated',
    entity_type: 'user',
    entity_id: auth.user.id,
    // Les VALEURS ne vont pas au journal (données personnelles — elles y
    // survivaient à la purge du compte) : seulement quels champs ont changé.
    detail: { champs_modifies: champs },
  })

  return json({ ok: true, first_name, last_name }, 200)
}

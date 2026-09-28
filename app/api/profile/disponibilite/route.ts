import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { JournalError } from '@/lib/journal/journaliser'
import { disponibiliteBasculee } from '@/lib/profil/journal-profil'
import { CHAMPS_DE_BASCULE, type ChampDeBascule, type VoieExpert } from '@/lib/profil/bascule-disponibilite'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/profile/disponibilite — LA BASCULE DE DISPONIBILITÉ, UN GESTE SERVEUR (lot T.4, 28/09/2026).
 *
 * POURQUOI CETTE ROUTE EXISTE
 *   Les tableaux de bord freelance et CDI écrivaient `profiles` depuis le navigateur (politique
 *   `profiles_self_update`) : quatre bascules sans pièce ni ligne au grand livre — la dernière porte
 *   latérale (§D.26). Elles passent ici ; la porte se ferme (portes_laterales_fermees).
 *
 * POURQUOI PAS `PATCH /api/profile`
 *   Il fait bien plus que basculer : garde de complétude, nettoyage des recommandations d'un profil
 *   non approuvé, relance programmée à +10 min. Y brancher la bascule aurait changé ce que vit
 *   l'expert (et doublé la recherche que l'écran lance déjà). Même écrivain, geste plus étroit.
 *
 * CE QU'ELLE FAIT, ET RIEN D'AUTRE
 *   · un seul champ, de la VOIE du compte (`CHAMPS_DE_BASCULE`), une valeur admise en base ;
 *   · COMPARER PUIS POSER : l'écriture porte `champ = ancien` — une bascule concurrente rend
 *     `conflit` (409) au lieu d'écrire un « avant » faux ; une valeur déjà là rend `inchange`,
 *     sans ligne ;
 *   · une ligne touchée, exactement — sinon 500 `ecriture_sans_effet` (§E.74) ;
 *   · puis `disponibilite_basculee`, SOUS LA PIÈCE DU GESTE — écrivain unique (lib/profil/journal-profil.ts),
 *     journal après écriture (§C.21) : un refus du journal rend `journal_error`, la bascule est faite.
 *   La recherche de missions n'est PAS lancée ici : l'écran la lance, comme avant (§D.13).
 *
 * LES CODES — `bad_body` · `champ_non_admis` · `valeur_invalide` · `not_expert` · `profile_missing`
 *   · `conflit` · `ecriture_sans_effet` · `db_error` · `journal_error`.
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
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[profile/disponibilite] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }
  // LA PIÈCE, À L'ENTRÉE DU GESTE (§D.26).
  const journal = contexteDepuisAuth(auth)
  const { supabaseAdmin, user } = auth

  let body: { champ?: unknown; valeur?: unknown }
  try {
    body = (await request.json()) as { champ?: unknown; valeur?: unknown }
  } catch {
    return json({ error: 'Invalid JSON', code: 'bad_body' }, 400)
  }

  const { data: compte, error: compteErr } = await supabaseAdmin
    .from('users')
    .select('user_type')
    .eq('id', user.id)
    .maybeSingle()
  if (compteErr) {
    console.error('[profile/disponibilite] lecture du type de compte en échec', compteErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  const voie = (compte as { user_type?: string } | null)?.user_type
  if (voie !== 'expert_freelance' && voie !== 'expert_cdi') {
    return json({ error: 'Not an expert', code: 'not_expert' }, 403)
  }

  const admis = CHAMPS_DE_BASCULE[voie as VoieExpert] as Record<string, readonly (string | boolean)[]>
  const champ = typeof body.champ === 'string' ? body.champ : ''
  if (!Object.prototype.hasOwnProperty.call(admis, champ)) {
    return json({ error: 'Field not allowed for this account', code: 'champ_non_admis' }, 400)
  }
  const valeur = body.valeur
  if ((typeof valeur !== 'string' && typeof valeur !== 'boolean') || !admis[champ].includes(valeur)) {
    return json({ error: 'Invalid value', code: 'valeur_invalide' }, 400)
  }

  const { data: profil, error: profilErr } = await supabaseAdmin
    .from('profiles')
    .select(`id, ${champ}`)
    .eq('user_id', user.id)
    .maybeSingle()
  // Une lecture en ÉCHEC n'est pas un profil ABSENT (§E.42).
  if (profilErr) {
    console.error('[profile/disponibilite] lecture du profil en échec', { userId: user.id, message: profilErr.message })
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!profil) return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  const p = profil as unknown as Record<string, unknown> & { id: string }
  const ancien = (p[champ] ?? null) as string | boolean | null

  if (ancien === valeur) {
    return json({ issue: 'inchange', valeur }, 200)
  }

  // COMPARER PUIS POSER — l'écriture n'aboutit que si le champ vaut encore ce qu'on a lu.
  let ecriture = supabaseAdmin.from('profiles').update({ [champ]: valeur }).eq('id', p.id)
  ecriture = ancien === null ? ecriture.is(champ, null) : ecriture.eq(champ, ancien)
  const { data: touchees, error: majErr } = await ecriture.select('id')
  if (majErr) {
    console.error('[profile/disponibilite] écriture en échec', { profileId: p.id, champ, message: majErr.message })
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  const n = (touchees ?? []).length
  if (n === 0) {
    // Le profil existe (lu ci-dessus) : zéro ligne veut dire que le champ a changé entre la lecture
    // et l'écriture. L'écran revient en arrière et relit — pas d'« avant » inventé.
    return json({ error: 'Changed concurrently', code: 'conflit' }, 409)
  }
  if (n !== 1) {
    console.error('[profile/disponibilite] écriture sans l’effet attendu', { profileId: p.id, champ, lignes: n })
    return json({ error: 'Unexpected write', code: 'ecriture_sans_effet' }, 500)
  }

  try {
    await disponibiliteBasculee(supabaseAdmin, journal, {
      profileId: p.id,
      champ: champ as ChampDeBascule,
      de: ancien,
      vers: valeur,
    })
  } catch (err) {
    if (!(err instanceof JournalError)) throw err
    console.error('[profile/disponibilite] grand livre en échec après écriture', { profileId: p.id, message: err.message })
    return json({ error: 'Journal failed', code: 'journal_error', valeur }, 500)
  }

  return json({ issue: 'basculee', valeur }, 200)
}

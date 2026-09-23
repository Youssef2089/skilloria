import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { deposerCandidature, REFUS_DEPOT, type CodeRefus } from '@/lib/candidatures/depot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// ⚠️ LE JUGEMENT EST DEVENU SYNCHRONE, ET CE PLAFOND EN DÉPEND.
//    L'appel au modèle attend jusqu'à 30 s (TIMEOUT_MS,
//    lib/candidatures/ai-assessment.ts) ; les gardes, l'insertion, le
//    dévoilement et la cloche encadrent cet appel. 60 s laisse la marge sans
//    permettre à une requête de s'éterniser.
//    Il sert AUSSI au `after()` du dispatch e-mail : sans plafond explicite,
//    les envois lancés après la réponse n'ont pas le temps de s'exécuter sur
//    Vercel (§E.5).
export const maxDuration = 60

/**
 * POST /api/candidatures — l'expert candidate à une publication MATCHÉE.
 *
 * Body : { publication_id: uuid, cover_message?: string (0-2000) }
 *
 * ┌─ CETTE ROUTE NE DÉCIDE PLUS RIEN ──────────────────────────────────────┐
 * │ Elle authentifie, elle valide le corps, elle résout le profil de        │
 * │ l'appelant — et elle délègue à `deposerCandidature`                     │
 * │ (lib/candidatures/depot.ts), qui porte les gardes, le jugement,         │
 * │ l'écriture, le dévoilement inclus, la cloche et l'audit.                │
 * │                                                                          │
 * │ POURQUOI : le bouton RELANCER du back-office doit rejouer EXACTEMENT ce │
 * │ chemin. Tant que le chemin vivait dans la route, le rejeu aurait été une │
 * │ copie — et une copie de chemin de rattrapage est le pire des jumeaux     │
 * │ (§E.20) : elle ne sert que le jour où le chemin normal a déjà échoué,    │
 * │ donc son écart ne se découvre jamais avant.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ UNE CANDIDATURE N'EXISTE QUE COMPLÈTE. Si le jugement n'aboutit pas,
 *    RIEN n'est écrit et cette route répond **202** — l'expert lit le même
 *    message de succès, par décision (il ne paie pas une panne qui ne le
 *    concerne pas), et la ligne part sur `/admin/depots-en-echec`, qui est
 *    BLOQUANT en supervision tant qu'il n'est pas vide. Le raisonnement
 *    complet, et ce qu'il coûte, sont en tête de lib/candidatures/depot.ts.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Body = {
  publication_id?: unknown
  cover_message?: unknown
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

/** Les phrases de refus. Le client ne lit que le `code` ; elles servent aux journaux. */
const MESSAGE_REFUS: Record<CodeRefus, string> = {
  durees_illisibles: 'Durations unavailable',
  profile_missing: 'Profile not found',
  profil_verification_indisponible: 'Could not read the profile',
  not_matched: 'No match for this publication',
  db_error: 'Query failed',
  objet_verification_indisponible: 'Could not read the publication',
  not_found: 'Publication not found',
  publication_not_published: 'Publication not available',
  type_not_candidatable: 'Type not candidatable',
  cannot_apply_own_need: 'Cannot apply to your own need',
  already_applied: 'Already applied',
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // ── Body ────────────────────────────────────────────────────────────────
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_json' }, 400)
  }

  const publicationId = asString(body.publication_id)
  if (!publicationId || !UUID_REGEX.test(publicationId)) {
    return json({ error: 'Invalid publication_id', code: 'invalid_publication_id' }, 400)
  }
  const coverRaw = asString(body.cover_message)
  if (coverRaw && coverRaw.length > 2000) {
    return json({ error: 'cover_message too long (max 2000)', code: 'invalid_cover_message' }, 400)
  }

  // ── Le profil de L'APPELANT ─────────────────────────────────────────────
  //  Résolu ici, et ici seulement : c'est la seule chose que le dépôt ne peut
  //  pas déduire tout seul, puisqu'une relance d'administrateur lui donnera
  //  directement l'identifiant du profil concerné.
  const { data: profile, error: pErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  // Une lecture de `profiles` en panne n'est pas un profil absent (§E.42) :
  // 503 qui se réessaie, jamais le 404 qui se croit.
  if (pErr) {
    console.error('[candidatures] profil ILLISIBLE', { userId: auth.user.id, message: pErr.message })
    return json(
      { error: 'Could not read the profile', code: 'profil_verification_indisponible' },
      503,
    )
  }
  if (!profile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }

  const issue = await deposerCandidature({
    supabaseAdmin: auth.supabaseAdmin,
    profileId: (profile as { id: string }).id,
    publicationId,
    coverMessage: coverRaw,
    origine: 'expert',
  })

  switch (issue.issue) {
    case 'deposee':
      return json(
        { id: issue.candidatureId, status: issue.status, created_at: issue.createdAt },
        201,
      )

    case 'refusee':
      return json({ error: MESSAGE_REFUS[issue.code], code: issue.code }, REFUS_DEPOT[issue.code])

    case 'sans_jugement':
      // ⚠️ DEUX CENT DEUX, ET PAS DEUX CENT UN. Rien n'a été créé : répondre
      //    201 serait faux au niveau du protocole, et un lecteur d'API ne
      //    pourrait plus distinguer un dépôt d'un non-dépôt.
      //    L'ÉCRAN, LUI, AFFICHE LE MÊME SUCCÈS — c'est la décision, et son
      //    prix est payé par l'écran bloquant du back-office.
      return json({ id: null, code: 'depot_non_enregistre' }, 202)
  }
}

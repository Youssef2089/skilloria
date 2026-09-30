import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { MESSAGE_PAR_CODE } from '@/lib/profil/refus-depot-cv'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * GET /api/profile/cv-status/[jobId] — OÙ EN EST L'ANALYSE DU CV (`jobId` = le profil).
 *
 * Depuis le 30/09/2026 (§D.30), l'analyse est un TRAVAIL : l'écran sonde ici jusqu'à
 * l'issue. Ce que la réponse dit, et que l'écran traduit :
 *   · `status` : `processing` tant que le travail vit, puis `done` ou `failed` ;
 *   · `code` : la cause NOMMÉE d'un échec (jamais le texte technique) — celle que
 *     l'exécutant ou le repli en base ont posée ; un texte libre ancien devient
 *     `cv_parsing_failed` ;
 *   · `reprise` : l'analyse a échoué de notre côté et va être REJOUÉE (tentative n
 *     sur m) — l'écran patiente et le dit, au lieu d'annoncer un échec ;
 *   · `ecarts` : ce que la dernière analyse aboutie a ramené ou écarté (§E.88).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[cv-status] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  const { jobId } = await context.params
  const { supabaseAdmin, user } = auth

  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, user_id, cv_parsing_status, cv_parsing_error')
    .eq('id', jobId)
    .maybeSingle()

  // Le suivi est INTERROGE EN BOUCLE par l'ecran : une panne en 503, l'ecran continue
  // de sonder — ce qui est exactement ce qu il faut faire sur une panne (§E.42).
  if (profErr) {
    console.error('[cv-status] suivi ILLISIBLE', { jobId, message: profErr.message })
    return json({ error: 'Could not read the job', code: 'objet_verification_indisponible' }, 503)
  }
  if (!profile) return json({ error: 'Job not found', code: 'not_found' }, 404)
  if (profile.user_id !== user.id) return json({ error: 'Forbidden', code: 'not_owner' }, 403)

  // Le DERNIER travail d'analyse de ce profil : sa reprise en cours, ou ses écarts.
  const { data: travail, error: travailErr } = await supabaseAdmin
    .from('travaux_ia')
    .select('statut, tentatives, max_tentatives, erreur_code, resultat')
    .eq('profile_id', profile.id)
    .eq('nature', 'analyse_cv')
    .order('cree_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (travailErr) {
    console.error('[cv-status] travail ILLISIBLE — le statut du profil reste la référence', { jobId, message: travailErr.message })
  }
  const t = (travail ?? null) as {
    statut?: string
    tentatives?: number
    max_tentatives?: number
    erreur_code?: string | null
    resultat?: { ecarts?: unknown[] } | null
  } | null

  const statut = profile.cv_parsing_status ?? 'idle'
  const brut = (profile.cv_parsing_error ?? '').trim()
  // Un code NOMMÉ (posé par l'exécutant ou le repli) se rend tel quel ; un texte libre d'avant, jamais.
  const code = statut === 'failed' ? (brut in MESSAGE_PAR_CODE ? brut : 'cv_parsing_failed') : undefined

  return json({
    status: statut,
    code,
    reprise:
      statut === 'processing' && t?.statut === 'en_attente' && t.erreur_code
        ? { code: t.erreur_code, tentative: t.tentatives ?? 0, sur: t.max_tentatives ?? 0 }
        : undefined,
    ecarts: statut === 'done' && t?.statut === 'reussi' && Array.isArray(t.resultat?.ecarts) ? t.resultat!.ecarts : [],
  })
}

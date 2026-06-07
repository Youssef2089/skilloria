import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { isSectionKey } from '@/lib/section-visits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/me/section-visit  body: { section }
 *
 * Marque la section comme "vue" par l'utilisateur courant — upsert
 * `user_section_visits (user_id, section, last_visited_at = now())`. Mécanique
 * unique (Lot global C2) qui pilote :
 *   - `GET /api/me/badges` → count d'items créés/màj DEPUIS last_visited_at.
 *   - La pill "Nouveau" sur les cartes (calculée client-side contre le
 *     last_visited_at retourné au mount des listings).
 *
 * Garde (service_role) : requireAuth. RLS sera également posée côté DB
 * (self-only via auth.uid() = user_id) — defense-in-depth.
 *
 * 200 idempotent. Erreur DB → 500 mais NON-BLOQUANT côté UI : ne pas
 * interrompre le rendu de la page parce qu'une visite n'a pas été marquée.
 *
 * Sections acceptées : voir `SECTION_KEYS` dans lib/section-visits.ts.
 *  Une section inconnue → 400 invalid_section (typo client = bug détecté tôt).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON', code: 'invalid_body' }, 400)
  }
  const section = (body as { section?: unknown } | null)?.section
  if (!isSectionKey(section)) {
    return json({ error: 'Invalid section', code: 'invalid_section' }, 400)
  }

  // Upsert atomique via la conflict target (user_id, section).
  const nowIso = new Date().toISOString()
  const { error } = await auth.supabaseAdmin
    .from('user_section_visits')
    .upsert(
      { user_id: auth.user.id, section, last_visited_at: nowIso },
      { onConflict: 'user_id,section' },
    )
  if (error) {
    console.error('[me/section-visit:POST] upsert failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }
  return json({ ok: true, last_visited_at: nowIso }, 200)
}

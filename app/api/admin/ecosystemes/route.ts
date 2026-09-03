import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { isValidEcosystemSlug } from '@/lib/ecosystem-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/admin/ecosystemes — LE PARC D'ÉCOSYSTÈMES.
 *
 * GET  → liste + volumes + état de préparation.
 * POST → crée un écosystème (ligne `domains` + sa ligne `domain_configs`).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CRÉER UN ÉCOSYSTÈME NE SUFFIT PAS À LE RENDRE ATTEIGNABLE.               ║
 * ║                                                                          ║
 * ║ Il manque toujours DEUX choses que cet écran ne peut pas faire :         ║
 * ║   1. le sous-domaine, à déclarer chez l'hébergeur (+ DNS) ;              ║
 * ║   2. au moins une BRANCHE, sans quoi personne ne peut s'y inscrire ni    ║
 * ║      y publier — le formulaire de profil et celui d'annonce demandent    ║
 * ║      tous deux une branche.                                              ║
 * ║                                                                          ║
 * ║ D'où `ready` dans la réponse, et d'où le fait que la création RÉUSSIT    ║
 * ║ quand même : refuser tant que la taxonomie n'existe pas obligerait à     ║
 * ║ créer des branches sur un écosystème qui n'existe pas encore. On crée,   ║
 * ║ et on DIT ce qui manque. Un écran qui cache le travail restant fait      ║
 * ║ croire que c'est fini.                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Garde admin per-route via requireAdmin. service_role, AUCUN filtre domaine :
 * un administrateur est PLATEFORME (D1).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Compte par écosystème, en UNE lecture agrégée en mémoire. */
async function countByDomain(
  admin: Awaited<ReturnType<typeof requireAdmin>>['supabaseAdmin'],
  table: string,
  ids: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (ids.length === 0) return out
  const { data, error } = await admin.from(table).select('domain_id').in('domain_id', ids)
  if (error) {
    // Best-effort : un compteur en panne ne doit pas priver l'admin de la liste.
    // Il vaut mieux une colonne vide qu'un écran vide — mais on le journalise,
    // parce qu'un zéro silencieux se lirait comme « rien à perdre ».
    console.error(`[admin:ecosystemes] count ${table} failed`, error.message)
    return out
  }
  for (const r of (data ?? []) as { domain_id: string }[]) {
    out.set(r.domain_id, (out.get(r.domain_id) ?? 0) + 1)
  }
  return out
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data, error } = await auth.supabaseAdmin
    .from('domains')
    .select(
      'id, slug, name, tagline, description, active, launch_date, created_at, ' +
        'domain_configs(id, primary_color, secondary_color, logo_url)',
    )
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  if (error) {
    console.error('[admin:ecosystemes] list failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const rows = (data ?? []) as unknown as {
    id: string
    slug: string
    name: string
    tagline: string | null
    description: string | null
    active: boolean
    launch_date: string | null
    created_at: string | null
    domain_configs:
      | { id: string; primary_color: string; secondary_color: string; logo_url: string | null }
      | { id: string; primary_color: string; secondary_color: string; logo_url: string | null }[]
      | null
  }[]
  const ids = rows.map((r) => r.id)

  const [branches, specialities, experts, publications] = await Promise.all([
    countByDomain(auth.supabaseAdmin, 'branches', ids),
    countByDomain(auth.supabaseAdmin, 'specialities', ids),
    countByDomain(auth.supabaseAdmin, 'users', ids),
    countByDomain(auth.supabaseAdmin, 'publications', ids),
  ])

  const ecosystems = rows.map((r) => {
    const cfg = Array.isArray(r.domain_configs) ? r.domain_configs[0] : r.domain_configs
    const nbBranches = branches.get(r.id) ?? 0
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      tagline: r.tagline,
      active: r.active,
      launch_date: r.launch_date,
      created_at: r.created_at,
      has_config: !!cfg,
      primary_color: cfg?.primary_color ?? null,
      secondary_color: cfg?.secondary_color ?? null,
      logo_url: cfg?.logo_url ?? null,
      counts: {
        branches: nbBranches,
        specialities: specialities.get(r.id) ?? 0,
        users: experts.get(r.id) ?? 0,
        publications: publications.get(r.id) ?? 0,
      },
      // « NON PRÊT » — sans branche, ni inscription ni annonce ne sont
      // possibles. L'écosystème existe, il ne sert à rien encore.
      ready: nbBranches > 0,
    }
  })

  return json({ ecosystems }, 200)
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    slug?: unknown
    tagline?: unknown
    description?: unknown
    primary_color?: unknown
    secondary_color?: unknown
  } | null
  if (!body) return json({ error: 'Invalid body', code: 'invalid_body' }, 400)

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  if (!name) return json({ error: 'Name required', code: 'name_required' }, 400)

  // LE SLUG EST UN SOUS-DOMAINE. Il est validé par la MÊME fonction que le
  // sélecteur et l'écran de refus : accepter ici une valeur que la construction
  // d'URL refusera ensuite créerait un écosystème inatteignable, sans erreur.
  if (!isValidEcosystemSlug(slug)) {
    return json({ error: 'Invalid slug', code: 'invalid_slug' }, 400)
  }

  const HEX = /^#[0-9a-fA-F]{6}$/
  const primary = typeof body.primary_color === 'string' && HEX.test(body.primary_color)
    ? body.primary_color
    : '#0078D4'
  const secondary = typeof body.secondary_color === 'string' && HEX.test(body.secondary_color)
    ? body.secondary_color
    : '#005A9E'

  // ── L'écosystème naît DÉSACTIVÉ ────────────────────────────────────────────
  // Il lui manque son sous-domaine et sa taxonomie : l'ouvrir aux organisations
  // dès la création leur proposerait une destination vide. L'admin l'active
  // quand il est prêt, et l'écran lui dit ce qui reste à faire.
  const { data: created, error: insErr } = await auth.supabaseAdmin
    .from('domains')
    .insert({
      name,
      slug,
      tagline: typeof body.tagline === 'string' ? body.tagline.trim() || null : null,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      active: false,
    })
    .select('id, slug, name')
    .single()
  if (insErr) {
    if (insErr.code === '23505') {
      return json({ error: 'Slug already used', code: 'slug_taken' }, 409)
    }
    console.error('[admin:ecosystemes] insert failed', insErr.message)
    return json({ error: 'Insert failed', code: 'db_error' }, 500)
  }

  // La ligne de configuration est créée DANS LA FOULÉE (relation 1-1). Sans
  // elle, getDomainConfig sert un écosystème sans couleurs ni vocabulaire.
  const { error: cfgErr } = await auth.supabaseAdmin.from('domain_configs').insert({
    domain_id: created.id,
    primary_color: primary,
    secondary_color: secondary,
  })
  if (cfgErr) {
    console.error('[admin:ecosystemes] config insert failed', cfgErr.message)
    // On NE supprime PAS l'écosystème : la ligne de config est réparable depuis
    // l'écran de détail, alors qu'une suppression perdrait le slug réservé.
    // On le DIT au lieu de renvoyer un succès trompeur.
    return json(
      { ok: true, id: created.id, slug: created.slug, config_failed: true },
      201,
    )
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'ecosystem_created',
    entity_type: 'domain',
    entity_id: created.id,
    detail: { slug: created.slug, name: created.name },
    request,
  })

  return json({ ok: true, id: created.id, slug: created.slug, config_failed: false }, 201)
}

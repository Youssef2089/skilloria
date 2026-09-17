import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import {
  BUCKET_ECOSYSTEME,
  LOGO_TAILLE_MAX_OCTETS,
  LOGO_TYPES_ACCEPTES,
  ecosystemeFaviconStoragePath,
  ecosystemeLogoStoragePath,
  urlPubliqueEcosysteme,
  verifierFichierLogo,
} from '@/lib/org-logo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * /api/admin/ecosystemes/[id]/visuel?kind=logo|favicon
 *
 *   POST   → téléverse le visuel d'un écosystème (admin PLATEFORME).
 *   DELETE → le retire.
 *
 * ┌─ LE MÊME DÉFAUT QUE LE LOGO D'ORGANISATION, EN PLUS LARGE ──────────────┐
 * │ `domain_configs.logo_url` / `favicon_url` étaient des saisies d'URL     │
 * │ libres, servies telles quelles à `<img src>` dans la Navbar, le Footer, │
 * │ les pages légales et contact — donc à TOUT VISITEUR, y compris non      │
 * │ connecté, et sans CSP dans le dépôt.                                    │
 * │                                                                          │
 * │ Le modèle de menace diffère de celui du logo d'organisation : ici seul  │
 * │ un administrateur PLATEFORME écrit, c'est-à-dire nous. Le résultat pour │
 * │ le visiteur, lui, est identique — son navigateur appelle un tiers. D'où │
 * │ le même correctif.                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * BUCKET PUBLIC, à dessein (cf. `BUCKET_ECOSYSTEME`) : ces images vivent sur
 * des pages publiques et cachées, où une URL signée de 300 s serait morte.
 * Ce qui ferme le mouchard n'est pas la confidentialité du bucket, c'est que
 * l'adresse est DÉRIVÉE de `domain_id` au lieu d'être saisie.
 *
 * Aucune policy d'écriture n'existe sur ce bucket : seul le service-role écrit,
 * et il n'est atteignable que par cette route, derrière `requireAdmin`.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type RouteContext = { params: Promise<{ id: string }> }

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Les deux visuels, et RIEN d'autre : le `kind` vient de l'URL, donc du client. */
const VISUELS = {
  logo: { colonne: 'logo_url', chemin: ecosystemeLogoStoragePath },
  favicon: { colonne: 'favicon_url', chemin: ecosystemeFaviconStoragePath },
} as const
type Visuel = keyof typeof VISUELS

function lireVisuel(request: NextRequest): Visuel | null {
  const brut = new URL(request.url).searchParams.get('kind')
  return brut === 'logo' || brut === 'favicon' ? brut : null
}

export async function POST(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }
  const kind = lireVisuel(request)
  if (!kind) return json({ error: 'Invalid kind', code: 'invalid_kind' }, 400)
  const { colonne, chemin: cheminDe } = VISUELS[kind]

  // La ligne de configuration doit exister : c'est elle qui porte le drapeau.
  const { data: cfgRow } = await auth.supabaseAdmin
    .from('domain_configs')
    .select('id')
    .eq('domain_id', id)
    .maybeSingle()
  const configId = (cfgRow as { id: string } | null)?.id ?? null
  if (!configId) return json({ error: 'Missing config row', code: 'config_missing' }, 409)

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (err) {
    console.error('[admin:ecosysteme/visuel] formData illisible', err)
    return json({ error: 'Invalid form body', code: 'invalid_body' }, 400)
  }

  const file = formData.get('file')
  if (!file || typeof file === 'string') {
    return json({ error: 'File required', code: 'logo_absent' }, 400)
  }

  // MÊME fonction de vérification que le logo d'organisation — la signature
  // binaire, pas le type déclaré. Une seconde implémentation finirait par
  // diverger de la première, et c'est la plus laxiste qui ferait loi.
  const octets = new Uint8Array(await file.arrayBuffer())
  const verdict = verifierFichierLogo(octets, file.type)
  if (!verdict.ok) {
    return json(
      {
        error: verdict.code,
        code: verdict.code,
        limites: { taille_max_octets: LOGO_TAILLE_MAX_OCTETS, types: LOGO_TYPES_ACCEPTES },
      },
      400,
    )
  }

  const chemin = cheminDe(id)
  const { error: storageErr } = await auth.supabaseAdmin.storage
    .from(BUCKET_ECOSYSTEME)
    .upload(chemin, octets, { contentType: verdict.type, upsert: true })
  if (storageErr) {
    console.error('[admin:ecosysteme/visuel] dépôt impossible', {
      domainId: id,
      kind,
      msg: storageErr.message,
    })
    return json({ error: 'Storage unavailable', code: 'logo_stockage_indisponible' }, 503)
  }

  const { error: dbErr } = await auth.supabaseAdmin
    .from('domain_configs')
    .update({ [colonne]: chemin })
    .eq('id', configId)
  if (dbErr) {
    console.error('[admin:ecosysteme/visuel] drapeau non posé', { domainId: id, msg: dbErr.message })
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'ecosystem_visual_updated',
    entity_type: 'domain_configs',
    entity_id: configId,
    detail: { kind, type: verdict.type, octets: octets.length },
  })

  return json(
    { url: urlPubliqueEcosysteme(auth.supabaseAdmin, chemin, chemin), kind },
    200,
  )
}

export async function DELETE(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'invalid_id' }, 400)
  }
  const kind = lireVisuel(request)
  if (!kind) return json({ error: 'Invalid kind', code: 'invalid_kind' }, 400)
  const { colonne, chemin: cheminDe } = VISUELS[kind]

  const { data: cfgRow } = await auth.supabaseAdmin
    .from('domain_configs')
    .select('id')
    .eq('domain_id', id)
    .maybeSingle()
  const configId = (cfgRow as { id: string } | null)?.id ?? null
  if (!configId) return json({ error: 'Missing config row', code: 'config_missing' }, 409)

  // Le fichier d'abord, le drapeau ensuite — même ordre que le logo d'org :
  // un drapeau retiré avant un fichier qui résiste laisserait un objet que plus
  // rien ne désigne. L'inverse ne laisse qu'un drapeau sans fichier, et l'écran
  // affiche alors l'état vide.
  const { error: rmErr } = await auth.supabaseAdmin.storage
    .from(BUCKET_ECOSYSTEME)
    .remove([cheminDe(id)])
  if (rmErr) {
    console.error('[admin:ecosysteme/visuel] suppression impossible', {
      domainId: id,
      kind,
      msg: rmErr.message,
    })
    return json({ error: 'Storage unavailable', code: 'logo_stockage_indisponible' }, 503)
  }

  const { error: dbErr } = await auth.supabaseAdmin
    .from('domain_configs')
    .update({ [colonne]: null })
    .eq('id', configId)
  if (dbErr) {
    console.error('[admin:ecosysteme/visuel] drapeau non retiré', { domainId: id, msg: dbErr.message })
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'ecosystem_visual_removed',
    entity_type: 'domain_configs',
    entity_id: configId,
    detail: { kind },
  })

  return json({ url: null, kind }, 200)
}

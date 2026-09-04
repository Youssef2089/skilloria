import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /api/admin/ecosystemes/[id] — DÉTAIL ET ÉDITION D'UN ÉCOSYSTÈME.
 *
 * GET   → domains + domain_configs + traductions EN/ES/DE.
 * PATCH → met à jour l'un ou l'autre, et les traductions.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LE FRANÇAIS EST LA COLONNE. LES TROIS AUTRES SONT DES LIGNES.            ║
 * ║                                                                          ║
 * ║ Même modèle que la taxonomie (cf. admin/update-branch) : le FR vit dans  ║
 * ║ la colonne de la table, EN/ES/DE dans `public.translations`, résolus par ║
 * ║ `tBDD` avec repli FR automatique. Une chaîne VIDE pour une langue        ║
 * ║ SUPPRIME sa traduction — elle ne l'écrase pas par du vide, ce qui        ║
 * ║ afficherait un libellé blanc au lieu de retomber sur le français.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ LE SLUG N'EST PAS MODIFIABLE ICI. C'est un sous-domaine : il est déclaré
 *    chez l'hébergeur, il est dans le DNS, il est en favori chez des gens, et
 *    il apparaît dans les liens des e-mails déjà envoyés. Le renommer depuis un
 *    formulaire rendrait l'écosystème injoignable sans que rien ne l'annonce.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const LOCALES = ['en', 'es', 'de'] as const

/** Champs traduisibles, par table. Source unique : le GET et le PATCH l'utilisent. */
export const TRANSLATABLE = {
  domains: ['name', 'ecosystem_name', 'tagline'],
  domain_configs: [
    'ecosystem_expert_label',
    'ecosystem_community_label',
    'ecosystem_speciality_label',
    'ecosystem_domain_search_label',
  ],
} as const

const HEX = /^#[0-9a-fA-F]{6}$/

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return json({ error: 'Invalid id', code: 'invalid_id' }, 400)

  const { data, error } = await auth.supabaseAdmin
    .from('domains')
    .select('id, slug, name, tagline, description, active, launch_date, domain_configs(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('[admin:ecosysteme] read failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!data) return json({ error: 'Not found', code: 'not_found' }, 404)

  const row = data as unknown as Record<string, unknown> & {
    domain_configs: Record<string, unknown> | Record<string, unknown>[] | null
  }
  const cfg = (Array.isArray(row.domain_configs) ? row.domain_configs[0] : row.domain_configs) ?? null

  // Traductions des DEUX tables en une lecture.
  const rowIds = [id, ...(cfg?.id ? [cfg.id as string] : [])]
  const { data: trRows } = await auth.supabaseAdmin
    .from('translations')
    .select('table_name, row_id, field, locale, value')
    .in('table_name', ['domains', 'domain_configs'])
    .in('row_id', rowIds)

  const translations: Record<string, Record<string, string>> = {}
  for (const t of (trRows ?? []) as {
    table_name: string
    field: string
    locale: string
    value: string
  }[]) {
    const key = `${t.table_name}.${t.field}`
    ;(translations[key] ??= {})[t.locale] = t.value
  }

  // Sans branche, l'écosystème n'accepte ni inscription ni annonce.
  const { count: branches } = await auth.supabaseAdmin
    .from('branches')
    .select('id', { count: 'exact', head: true })
    .eq('domain_id', id)

  return json(
    {
      ecosystem: {
        id: row.id,
        slug: row.slug,
        name: row.name,
        tagline: row.tagline,
        description: row.description,
        active: row.active,
        launch_date: row.launch_date,
      },
      config: cfg,
      translations,
      translatable: TRANSLATABLE,
      branches_count: branches ?? 0,
      ready: (branches ?? 0) > 0,
    },
    200,
  )
}

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return json({ error: 'Invalid id', code: 'invalid_id' }, 400)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return json({ error: 'Invalid body', code: 'invalid_body' }, 400)
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  // ⚠️ `slug` est volontairement ABSENT de cette liste — cf. l'en-tête.
  const domainUpdates: Record<string, unknown> = {}
  for (const k of ['name', 'tagline', 'description'] as const) {
    if (has(k)) {
      const v = body[k]
      if (typeof v !== 'string') continue
      domainUpdates[k] = k === 'name' ? v.trim() : v.trim() || null
    }
  }
  if (has('active') && typeof body.active === 'boolean') domainUpdates.active = body.active
  if (has('launch_date')) {
    const v = body.launch_date
    domainUpdates.launch_date = typeof v === 'string' && v.trim() ? v.trim() : null
  }
  if (domainUpdates.name === '') {
    return json({ error: 'Name required', code: 'name_required' }, 400)
  }

  const configUpdates: Record<string, unknown> = {}
  for (const k of ['primary_color', 'secondary_color'] as const) {
    if (has(k) && typeof body[k] === 'string' && HEX.test(body[k] as string)) {
      configUpdates[k] = body[k]
    }
  }
  for (const k of ['logo_url', 'favicon_url'] as const) {
    if (has(k)) {
      const v = body[k]
      configUpdates[k] = typeof v === 'string' && v.trim() ? v.trim() : null
    }
  }
  for (const k of TRANSLATABLE.domain_configs) {
    if (has(k) && typeof body[k] === 'string' && (body[k] as string).trim()) {
      configUpdates[k] = (body[k] as string).trim().slice(0, 100)
    }
  }
  if (has('tags') && Array.isArray(body.tags)) {
    configUpdates.tags = (body.tags as unknown[])
      .filter((t): t is string => typeof t === 'string' && !!t.trim())
      .map((t) => t.trim().slice(0, 60))
  }

  // ── Écritures ──────────────────────────────────────────────────────────────
  if (Object.keys(domainUpdates).length > 0) {
    const { error } = await auth.supabaseAdmin.from('domains').update(domainUpdates).eq('id', id)
    if (error) {
      console.error('[admin:ecosysteme] domain update failed', error.message)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }

  let configId: string | null = null
  if (Object.keys(configUpdates).length > 0 || has('translations')) {
    const { data: cfgRow } = await auth.supabaseAdmin
      .from('domain_configs')
      .select('id')
      .eq('domain_id', id)
      .maybeSingle()
    configId = (cfgRow as { id: string } | null)?.id ?? null
  }
  if (Object.keys(configUpdates).length > 0) {
    if (!configId) {
      return json({ error: 'Missing config row', code: 'config_missing' }, 409)
    }
    const { error } = await auth.supabaseAdmin
      .from('domain_configs')
      .update(configUpdates)
      .eq('id', configId)
    if (error) {
      console.error('[admin:ecosysteme] config update failed', error.message)
      return json({ error: 'Update failed', code: 'db_error' }, 500)
    }
  }

  // ── Traductions : upsert (valeur) ou SUPPRESSION (vide) ───────────────────
  // Reçues sous la forme { "domains.name": { en, es, de }, ... }.
  const now = new Date().toISOString()
  const toUpsert: {
    table_name: string
    row_id: string
    field: string
    locale: string
    value: string
    updated_at: string
  }[] = []
  const toDelete: { table_name: string; row_id: string; field: string; locale: string }[] = []

  if (has('translations') && body.translations && typeof body.translations === 'object') {
    for (const [key, byLocale] of Object.entries(body.translations as Record<string, unknown>)) {
      const [table, field] = key.split('.')
      const allowed =
        (table === 'domains' && (TRANSLATABLE.domains as readonly string[]).includes(field)) ||
        (table === 'domain_configs' &&
          (TRANSLATABLE.domain_configs as readonly string[]).includes(field))
      // Champ non déclaré traduisible → IGNORÉ. Sans ce filtre, le corps de la
      // requête choisirait lui-même quelles colonnes de quelle table peuplent
      // `translations` : une table de traduction ouverte à l'écriture libre.
      if (!allowed) continue
      const rowId = table === 'domains' ? id : configId
      if (!rowId) continue
      if (!byLocale || typeof byLocale !== 'object') continue
      for (const loc of LOCALES) {
        const v = (byLocale as Record<string, unknown>)[loc]
        if (typeof v !== 'string') continue
        if (v.trim()) {
          toUpsert.push({
            table_name: table,
            row_id: rowId,
            field,
            locale: loc,
            value: v.trim(),
            updated_at: now,
          })
        } else {
          toDelete.push({ table_name: table, row_id: rowId, field, locale: loc })
        }
      }
    }
  }

  if (toUpsert.length > 0) {
    const { error } = await auth.supabaseAdmin
      .from('translations')
      .upsert(toUpsert, { onConflict: 'table_name,row_id,field,locale' })
    if (error) console.error('[admin:ecosysteme] translations upsert failed', error.message)
  }
  for (const d of toDelete) {
    const { error } = await auth.supabaseAdmin
      .from('translations')
      .delete()
      .eq('table_name', d.table_name)
      .eq('row_id', d.row_id)
      .eq('field', d.field)
      .eq('locale', d.locale)
    if (error) console.error('[admin:ecosysteme] translation delete failed', error.message)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    // L'ACTIVATION EST UNE DÉCISION, pas une modification parmi d'autres : elle
    // ouvre ou ferme l'écosystème aux organisations. Elle mérite son propre
    // verbe dans le journal, sans quoi elle se noierait dans « mis à jour ».
    action: has('active')
      ? body.active === true
        ? 'ecosystem_activated'
        : 'ecosystem_deactivated'
      : 'ecosystem_updated',
    entity_type: 'domain',
    entity_id: id,
    detail: {
      domain_fields: Object.keys(domainUpdates),
      config_fields: Object.keys(configUpdates),
      translations_set: toUpsert.map((t) => `${t.table_name}.${t.field}.${t.locale}`),
      translations_cleared: toDelete.map((t) => `${t.table_name}.${t.field}.${t.locale}`),
    },
    request,
  })

  return json({ ok: true }, 200)
}

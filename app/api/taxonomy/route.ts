// app/api/taxonomy/route.ts
// Retourne les branches + spécialités traduites selon la locale demandée.
// GET /api/taxonomy?locale=fr&domain_id=...

import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { resolveSubdomainFromHost } from '@/lib/subdomain'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const locale = normalizeLocale(url.searchParams.get('locale'))
  let domainId = url.searchParams.get('domain_id')

  try {
    const supabase = getSupabaseAdmin()

    // D5 : le domain_id est facultatif. Les surfaces authentifiées le fournissent
    // (profil, publication) ; la page publique d'inscription ne le connaît pas et
    // ne DOIT PAS deviner d'identifiant de domaine (checklist #20). On le résout
    // donc SERVEUR, à partir du sous-domaine de la requête.
    //
    // ⚠️ Le proxy N'INJECTE PAS x-subdomain sur /api (son matcher exclut `api`).
    // On lit donc directement l'en-tête Host — présent sur toute requête, y
    // compris pré-authentification — via le même résolveur que le proxy
    // (localhost → "microsoft" en dev, sinon 1er label ; multi-écosystème :
    // sap.skilloria.io → taxonomie SAP). x-subdomain reste lu en priorité au cas
    // où un appelant l'aurait déjà posé.
    if (!domainId) {
      const subdomain =
        req.headers.get('x-subdomain') ||
        resolveSubdomainFromHost(req.headers.get('host') ?? req.headers.get('x-forwarded-host'))
      const { data: dom } = await supabase
        .from('domains')
        .select('id')
        .eq('slug', subdomain)
        .eq('active', true)
        .maybeSingle()
      domainId = dom?.id ?? null
    }

    if (!domainId) {
      return json({ error: 'domain_id required', code: 'missing_domain_id' }, 400)
    }
    const [{ data: brs, error: brsErr }, { data: sps, error: spsErr }, translations] =
      await Promise.all([
        supabase
          .from('branches')
          .select('id, name, slug, sort_order')
          .eq('domain_id', domainId)
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('specialities')
          .select('id, name, slug, branch_id, sort_order')
          .eq('domain_id', domainId)
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        loadTranslations(locale),
      ])

    if (brsErr || spsErr) {
      console.error('[taxonomy]', brsErr?.message, spsErr?.message)
      return json({ error: 'Failed to load taxonomy', code: 'db_error' }, 500)
    }

    const branches = (brs ?? []).map(b => ({
      id: b.id,
      slug: b.slug,
      name: tBDD(translations, 'branches', b.id, 'name', b.name),
    }))

    const specialities = (sps ?? []).map(s => ({
      id: s.id,
      slug: s.slug,
      branch_id: s.branch_id,
      name: tBDD(translations, 'specialities', s.id, 'name', s.name),
    }))

    return json({ locale, branches, specialities })
  } catch (err) {
    console.error('[taxonomy] exception:', err)
    return json({ error: 'Internal error', code: 'internal' }, 500)
  }
}

// app/api/taxonomy/route.ts
// Retourne les branches + spécialités traduites selon la locale demandée.
// GET /api/taxonomy?locale=fr&domain_id=...

import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'
import { ecosystemeDeLaRequete } from '@/lib/inscription/ecosysteme'

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
    // donc SERVEUR, depuis l'HÔTE de la requête — par la même fonction que les
    // routes d'inscription (checklist 2 : l'écosystème réellement résolu). Plus
    // `x-subdomain` : il est posé par l'appelant, pas par l'hôte.
    //
    // ⚠️ LA PANNE DIT SA CAUSE, AU SERVEUR (§E.83). Le 29/09/2026, sur une Preview
    //    Vercel, cette route rendait 400 `missing_domain_id` : l'hôte
    //    `<déploiement>.vercel.app` ne portait aucun écosystème, et rien, nulle
    //    part, ne le disait — l'écran affichait « impossible de charger », sans
    //    cause. Chaque échec a désormais un CODE, et sa cause part aux journaux :
    //    ecosysteme_non_configure (DEV_DOMAIN_SLUG absente sur un hôte qui n'a pas
    //    d'écosystème) · ecosysteme_non_resolu (hôte non résolvable) ·
    //    ecosysteme_inconnu (aucun écosystème ACTIF sous ce slug) ·
    //    ecosysteme_indisponible (la lecture a échoué). L'écran reste traduit.
    if (!domainId) {
      const hote = req.headers.get('host') ?? req.headers.get('x-forwarded-host')
      const ecosysteme = ecosystemeDeLaRequete(req)
      if (!ecosysteme.ok) {
        const code = ecosysteme.raison === 'configuration' ? 'ecosysteme_non_configure' : 'ecosysteme_non_resolu'
        console.error('[taxonomy] écosystème de la requête non résolu', { code, hote })
        return json({ error: 'Could not resolve the ecosystem', code }, ecosysteme.raison === 'configuration' ? 500 : 400)
      }
      const { data: dom, error: domErr } = await supabase
        .from('domains')
        .select('id')
        .eq('slug', ecosysteme.slug)
        .eq('active', true)
        .maybeSingle()
      // Ne pas savoir n'est pas « inconnu » (§E.22 ③) : une lecture en panne rend 503.
      if (domErr) {
        console.error('[taxonomy] résolution de l’écosystème en panne', { code: 'ecosysteme_indisponible', slug: ecosysteme.slug, message: domErr.message })
        return json({ error: 'Could not resolve the ecosystem', code: 'ecosysteme_indisponible' }, 503)
      }
      if (!dom) {
        console.error('[taxonomy] aucun écosystème actif sous ce slug', { code: 'ecosysteme_inconnu', slug: ecosysteme.slug, hote })
        return json({ error: 'Unknown ecosystem', code: 'ecosysteme_inconnu' }, 404)
      }
      domainId = dom.id as string
    }
    const [
      { data: brs, error: brsErr },
      { data: sps, error: spsErr },
      { data: wzs, error: wzsErr },
      translations,
    ] = await Promise.all([
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
        // ZONES DE TRAVAIL — PAS de filtre domain_id, et ce n'est pas un oubli :
        // la géographie n'appartient à aucun écosystème. Une branche « Dynamics
        // 365 » n'existe que dans l'écosystème qui la déclare ; la France existe
        // pour tout le monde. Même posture que `countries`, qui n'a pas de
        // domain_id non plus.
        supabase
          .from('work_zones')
          .select('id, parent_id, kind, code, country_code, name, slug, sort_order')
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true }),
        loadTranslations(locale),
      ])

    if (brsErr || spsErr || wzsErr) {
      console.error('[taxonomy] référentiel illisible', { code: 'db_error', branches: brsErr?.message, specialites: spsErr?.message, zones: wzsErr?.message })
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

    // Les libellés partent DÉJÀ traduits, comme branches et spécialités : le
    // FR est le repli automatique de tBDD, en/es/de viennent de `translations`.
    // L'écran n'a donc aucune règle de langue à porter — il affiche `name`.
    const work_zones = (wzs ?? []).map(z => ({
      id: z.id,
      parent_id: z.parent_id,
      kind: z.kind,
      code: z.code,
      country_code: z.country_code,
      slug: z.slug,
      name: tBDD(translations, 'work_zones', z.id, 'name', z.name),
    }))

    return json({ locale, branches, specialities, work_zones })
  } catch (err) {
    console.error('[taxonomy] exception', { code: 'internal', message: err instanceof Error ? err.message : String(err) })
    return json({ error: 'Internal error', code: 'internal' }, 500)
  }
}

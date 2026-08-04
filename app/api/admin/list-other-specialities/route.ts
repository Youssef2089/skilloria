import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/list-other-specialities (D7)
 *
 * Spécialités HORS RÉFÉRENTIEL : valeurs libres saisies via « Autre »
 * (profiles.speciality_other + publications.speciality_other). On agrège par
 * (écosystème, valeur), on fusionne profils + publications, et on trie par
 * fréquence DÉCROISSANTE — les plus fréquentes sont prioritaires à intégrer au
 * référentiel. Chaque item porte son écosystème (domains.name) pour situer la
 * saisie. service_role. AUCUN filtre domaine.
 *
 * NB : les colonnes profiles.speciality_other / publications.speciality_other
 * sont ajoutées par la migration D7 (référencées ici comme convenu).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Agrégat en mémoire : clé = `${domain_id}||${valeur}`.
  const agg = new Map<string, { value: string; domain_id: string | null; count: number }>()
  const bump = (rawValue: string | null, domainId: string | null) => {
    const value = (rawValue ?? '').trim()
    if (!value) return
    const key = `${domainId ?? ''}||${value.toLowerCase()}`
    const cur = agg.get(key)
    if (cur) cur.count += 1
    else agg.set(key, { value, domain_id: domainId, count: 1 })
  }

  const { data: profs, error: pfErr } = await auth.supabaseAdmin
    .from('profiles')
    .select('speciality_other, domain_id')
    .not('speciality_other', 'is', null)
  if (pfErr) {
    console.error('[admin:list-other-specialities] profiles query failed', pfErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  for (const p of (profs ?? []) as { speciality_other: string | null; domain_id: string | null }[]) {
    bump(p.speciality_other, p.domain_id)
  }

  const { data: pubs, error: pbErr } = await auth.supabaseAdmin
    .from('publications')
    .select('speciality_other, domain_id')
    .not('speciality_other', 'is', null)
  if (pbErr) {
    console.error('[admin:list-other-specialities] publications query failed', pbErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  for (const p of (pubs ?? []) as { speciality_other: string | null; domain_id: string | null }[]) {
    bump(p.speciality_other, p.domain_id)
  }

  // Noms d'écosystème pour les domaines concernés.
  const domainName = new Map<string, string>()
  const domainIds = [...new Set([...agg.values()].map((v) => v.domain_id).filter((d): d is string => !!d))]
  if (domainIds.length > 0) {
    const { data: doms } = await auth.supabaseAdmin
      .from('domains')
      .select('id, name')
      .in('id', domainIds)
    for (const d of (doms ?? []) as { id: string; name: string }[]) {
      domainName.set(d.id, d.name)
    }
  }

  const items = [...agg.values()]
    .map((v) => ({
      value: v.value,
      count: v.count,
      domain_name: v.domain_id ? domainName.get(v.domain_id) ?? null : null,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

  return json({ items }, 200)
}

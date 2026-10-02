import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { raisonsDuVerdict, voieDeMiseEnLigne } from '@/lib/validation-annonces/raisons'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/annonces?status=pending|validated|rejected|all — LA FILE DE VALIDATION DES ANNONCES (lot S3).
 * GET /api/admin/annonces?counts=1                              — les compteurs exacts des quatre onglets.
 *
 * Sur le modèle exact de /api/admin/list-experts. Une seule table : les annonces des organisations (client, cabinet,
 * ESN) et les besoins de sous-traitance des experts sont TOUS des `publications` — la parité est par construction.
 *
 * LES ONGLETS — ce qu'ils comptent, et pourquoi :
 *   · pending   → `status = 'pending_review'` : ce que la vérification automatique n'a pas mis en ligne. C'est la file.
 *   · validated → `published_at` non nul : toute annonce qui a été EN LIGNE, par la vérification automatique ou par un
 *                 administrateur (la ligne dit la voie). Une annonce clôturée ou expirée l'a été : elle reste « validée ».
 *   · rejected  → `status = 'rejected'` : refusée par un administrateur, motif sur la ligne.
 *   · all       → les trois réunis : tout ce qui est passé par la validation. Un BROUILLON jamais soumis n'y est pas
 *                 (il n'a rien à valider) — le même parti pris que « Tous » chez les experts (statut de vérification non nul).
 *
 * ADMINISTRATION PLATEFORME : un administrateur voit tous les écosystèmes (§D.3) ; chaque ligne porte le sien.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const FILTRES = ['pending', 'validated', 'rejected', 'all'] as const
type Filtre = (typeof FILTRES)[number]

/** Le filtre « tout ce qui est passé par la validation » — un seul énoncé, pour la liste ET son compteur. */
const PASSEES_PAR_LA_VALIDATION = 'status.in.(pending_review,rejected),published_at.not.is.null'

/**
 * Plafond de lignes servies — le même que la liste des experts, et pas muet : la réponse porte `total` et
 * `truncated`, l'écran l'annonce (la leçon de MAX_ORGS sur /admin/collaboration).
 */
const LIST_LIMIT = 500

type Ligne = {
  id: string
  type: string
  title: string
  status: string
  verification_score: number | null
  verification_data: unknown
  verified_by: string | null
  verified_at: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  soumise_le: string | null
  organizations: { company_name: string | null; org_type: string | null } | Array<{ company_name: string | null; org_type: string | null }> | null
  domains: { name: string | null } | Array<{ name: string | null }> | null
  auteur: { first_name: string | null; last_name: string | null; email: string | null } | Array<{ first_name: string | null; last_name: string | null; email: string | null }> | null
}

const un = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const url = new URL(request.url)

  // ── LES COMPTEURS — même sémantique que les onglets ci-dessous, comptes exacts sans plafond ──
  if (url.searchParams.get('counts') === '1') {
    const base = () => auth.supabaseAdmin.from('publications').select('id', { count: 'exact', head: true })
    const [pending, validated, rejected, all] = await Promise.all([
      base().eq('status', 'pending_review'),
      base().not('published_at', 'is', null),
      base().eq('status', 'rejected'),
      base().or(PASSEES_PAR_LA_VALIDATION),
    ])
    const erreur = pending.error || validated.error || rejected.error || all.error
    if (erreur) {
      console.error('[admin:annonces] compteurs illisibles', erreur.message)
      return json({ error: 'Query failed', code: 'db_error' }, 500)
    }
    return json({
      counts: {
        pending: pending.count ?? 0,
        validated: validated.count ?? 0,
        rejected: rejected.count ?? 0,
        all: all.count ?? 0,
      },
    })
  }

  const brut = url.searchParams.get('status') ?? 'pending'
  const filtre: Filtre = (FILTRES as readonly string[]).includes(brut) ? (brut as Filtre) : 'pending'

  let query = auth.supabaseAdmin
    .from('publications')
    .select(
      'id, type, title, status, verification_score, verification_data, verified_by, verified_at, published_at, created_at, updated_at, soumise_le, ' +
        'organizations(company_name, org_type), domains(name), ' +
        // DEUX clés étrangères vers `users` (created_by, verified_by) : l'embed NOMME la sienne (§E.18).
        'auteur:users!publications_created_by_fkey(first_name, last_name, email)',
      { count: 'exact' },
    )

  if (filtre === 'pending') {
    query = query.eq('status', 'pending_review').order('updated_at', { ascending: false })
  } else if (filtre === 'validated') {
    query = query.not('published_at', 'is', null).order('published_at', { ascending: false })
  } else if (filtre === 'rejected') {
    query = query.eq('status', 'rejected').order('verified_at', { ascending: false, nullsFirst: false })
  } else {
    query = query.or(PASSEES_PAR_LA_VALIDATION).order('updated_at', { ascending: false })
  }

  const { data, error, count } = await query.limit(LIST_LIMIT)
  if (error) {
    console.error('[admin:annonces] liste illisible', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const annonces = ((data ?? []) as unknown as Ligne[]).map((r) => {
    const org = un(r.organizations)
    const auteur = un(r.auteur)
    const nomAuteur = [auteur?.first_name, auteur?.last_name].filter(Boolean).join(' ').trim()
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      status: r.status,
      // UNE ANNONCE JAMAIS JUGÉE N'A PAS « 0/10 » (relecture de l'ARRÊT 28, point 7) : la même lecture que la fiche
      // (`raisonsDuVerdict`, §E.114) — une vérification qui n'a pas jugé écrit note 0 sans signalement.
      ...(() => { const r2 = raisonsDuVerdict(r.verification_data, r.verification_score); return { note: r2.note, non_jugee: r2.non_aboutie } })(),
      voie: voieDeMiseEnLigne(r),
      organisation: org?.company_name ?? null,
      org_type: org?.org_type ?? null,
      auteur: nomAuteur || auteur?.email || null,
      ecosysteme: un(r.domains)?.name ?? null,
      // La date qui compte pour l'onglet : la soumission, la mise en ligne, le refus.
      // En attente : la SOUMISSION (`soumise_le`, relecture de l'ARRÊT 28, point 8), jamais updated_at.
      date: r.status === 'rejected' ? (r.verified_at ?? r.updated_at)
        : r.status === 'pending_review' ? r.soumise_le
        : (r.published_at ?? r.updated_at),
    }
  })

  const total = count ?? annonces.length
  return json({ annonces, total, truncated: total > annonces.length, limit: LIST_LIMIT })
}

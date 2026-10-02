import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { routing, type Locale } from '@/i18n/routing'
import { loadTranslations } from '@/lib/translations'
import {
  buildPublicationSynthesis,
  loadReferentielLabels,
  PUBLICATION_SYNTHESIS_SELECT,
} from '@/lib/publication-synthesis'
import { raisonsDuVerdict, SIGNALEMENTS_CONNUS, voieDeMiseEnLigne } from '@/lib/validation-annonces/raisons'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/annonces/[id]?locale=fr — LA FICHE D'UNE ANNONCE À VALIDER (lot S3).
 *
 * Trois choses, et l'écran n'a rien à deviner :
 *   1. LE CONTENU, mis en forme par les fonctions COMMUNES (`buildPublicationSynthesis`, `loadReferentielLabels`) —
 *      celles des cartes, du détail mission et de la messagerie : un champ ajouté à l'annonce apparaît ici sans
 *      qu'on y touche (§E.20) ;
 *   2. LE VERDICT de la vérification automatique, en CODES CONNUS (`raisonsDuVerdict`) que l'écran traduit — jamais
 *      un code brut ;
 *   3. L'AUTEUR et son ORGANISATION — client, cabinet, ESN, ou l'organisation personnelle d'un expert (sous-traitance).
 * Et la décision passée, s'il y en a une : qui a tranché, quand, et le motif d'un refus.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

type Personne = { first_name: string | null; last_name: string | null; email: string | null; user_type?: string | null }
type Ligne = Record<string, unknown> & {
  id: string
  type: string
  title: string
  description: string | null
  skills_required: string[] | null
  speciality_other: string | null
  status: string
  verification_score: number | null
  verification_data: unknown
  verified_by: string | null
  verified_at: string | null
  review_reason: string | null
  published_at: string | null
  created_at: string
  updated_at: string
  soumise_le: string | null
  branches: { id: string; name: string } | Array<{ id: string; name: string }> | null
  organizations: { company_name: string | null; org_type: string | null } | Array<{ company_name: string | null; org_type: string | null }> | null
  domains: { name: string | null } | Array<{ name: string | null }> | null
  auteur: Personne | Personne[] | null
  decideur: Personne | Personne[] | null
}

const un = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
const nom = (p: Personne | null): string | null =>
  p ? ([p.first_name, p.last_name].filter(Boolean).join(' ').trim() || p.email || null) : null

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: RouteContext): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { id } = await ctx.params
  if (!id || !UUID_REGEX.test(id)) {
    return json({ error: 'Invalid id', code: 'not_found' }, 404)
  }
  const brute = new URL(request.url).searchParams.get('locale')
  const locale: Locale = (routing.locales as readonly string[]).includes(brute ?? '') ? (brute as Locale) : routing.defaultLocale

  const [pubRes, translations] = await Promise.all([
    auth.supabaseAdmin
      .from('publications')
      .select(
        `${PUBLICATION_SYNTHESIS_SELECT}, description, skills_required, speciality_other, status, ` +
          'verification_score, verification_data, verified_by, verified_at, review_reason, published_at, created_at, updated_at, soumise_le, ' +
          'branches(id, name), organizations(company_name, org_type), domains(name), ' +
          // DEUX clés étrangères vers `users` : chaque embed nomme la sienne (§E.18).
          'auteur:users!publications_created_by_fkey(first_name, last_name, email, user_type), ' +
          'decideur:users!publications_verified_by_fkey(first_name, last_name, email)',
      )
      .eq('id', id)
      .maybeSingle(),
    loadTranslations(locale),
  ])
  if (pubRes.error) {
    console.error('[admin:annonces/[id]] lecture impossible', pubRes.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!pubRes.data) {
    return json({ error: 'Not found', code: 'not_found' }, 404)
  }
  const pub = pubRes.data as unknown as Ligne

  const labels = await loadReferentielLabels(
    auth.supabaseAdmin as unknown as Parameters<typeof loadReferentielLabels>[0],
    translations,
    [pub as { speciality_ids?: string[] | null; work_zone_ids?: string[] | null }],
    locale,
  )
  const synthese = buildPublicationSynthesis(
    pub as unknown as Parameters<typeof buildPublicationSynthesis>[0],
    translations,
    labels,
  )
  const org = un(pub.organizations)
  const auteur = un(pub.auteur)

  return json({
    annonce: {
      id: pub.id,
      status: pub.status,
      synthese,
      description: pub.description ?? '',
      skills_required: pub.skills_required ?? [],
      speciality_other: pub.speciality_other ?? null,
      created_at: pub.created_at,
      updated_at: pub.updated_at,
      // La date de SOUMISSION par l'auteur (relecture de l'ARRÊT 28, point 8) — pas updated_at, la dernière écriture.
      soumise_le: pub.soumise_le,
      published_at: pub.published_at,
      voie: voieDeMiseEnLigne(pub),
      ecosysteme: un(pub.domains)?.name ?? null,
    },
    verdict: raisonsDuVerdict(pub.verification_data, pub.verification_score),
    signalements_connus: SIGNALEMENTS_CONNUS,
    decision: {
      par: nom(un(pub.decideur)),
      le: pub.verified_at,
      motif: pub.review_reason,
    },
    auteur: { nom: nom(auteur), email: auteur?.email ?? null, user_type: auteur?.user_type ?? null },
    organisation: { nom: org?.company_name ?? null, org_type: org?.org_type ?? null },
  })
}

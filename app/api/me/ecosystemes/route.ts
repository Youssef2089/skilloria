import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'
import { ecosystemAccessScope } from '@/lib/ecosystem-scope'
import { loadTranslations, tBDD } from '@/lib/translations'
import { routing, type Locale } from '@/i18n/routing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/me/ecosystemes?locale=fr
 *
 * Les écosystèmes VERS LESQUELS CE COMPTE PEUT BASCULER.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LA LISTE EST FILTRÉE PAR LA MÊME RÈGLE QUE LA GARDE.                     ║
 * ║                                                                          ║
 * ║ Ce n'est pas « la liste des écosystèmes actifs » : c'est la liste de ce  ║
 * ║ que L'APPELANT peut atteindre. Un expert n'y trouve que le sien.         ║
 * ║                                                                          ║
 * ║ La distinction n'est pas cosmétique. Servir la liste complète à tout le  ║
 * ║ monde ferait afficher au sélecteur des destinations que la garde refuse  ║
 * ║ ensuite : on proposerait une porte pour la fermer au nez. Une UI qui     ║
 * ║ propose ce que le serveur interdit est une UI qui ment.                  ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Contrat : `{ ecosystems: [{ id, slug, name, color }], current }`.
 * NOM, SLUG, COULEUR — RIEN D'AUTRE. Pas de compte d'annonces, pas de date de
 * lancement, pas de description : un sélecteur n'en a pas besoin, et tout champ
 * servi « au cas où » finit lu par quelqu'un.
 *
 * Le nom passe par `tBDD` (table `translations`) : les libellés d'écosystème
 * sont des valeurs de base, traduites comme le reste de la taxonomie.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function normalizeLocale(raw: string | null): Locale {
  return (routing.locales as readonly string[]).includes(raw ?? '')
    ? (raw as Locale)
    : routing.defaultLocale
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Même source que la garde : aucune seconde règle, aucun risque de divergence.
  const scope = ecosystemAccessScope(auth.user.user_type)
  if (scope === null) {
    // Injoignable en pratique — requireAuth a déjà refusé. On ne s'en remet pas
    // pour autant à cette certitude : la liste échoue plutôt que de tout servir.
    return json({ error: 'Unknown user type', code: 'unknown_user_type' }, 403)
  }

  const locale = normalizeLocale(new URL(request.url).searchParams.get('locale'))

  let query = auth.supabaseAdmin
    .from('domains')
    .select('id, slug, name, domain_configs(primary_color)')
    .order('name', { ascending: true })
  // Les ORGANISATIONS ne voient que les écosystèmes offerts. Un expert, lui,
  // garde le sien même désactivé — le filtrer ici lui servirait une liste vide
  // où ne figurerait même pas l'écosystème qu'il est en train de regarder.
  if (scope !== 'own') query = query.eq('active', true)

  // EXPERT : son écosystème, à vie. Le sélecteur n'aura donc qu'une entrée, et
  // le composant ne s'affichera pas — plutôt que d'afficher une liste d'un seul
  // élément, qui suggère un choix qui n'existe pas.
  if (scope === 'own') query = query.eq('id', auth.user.domain_id)

  const { data, error } = await query
  if (error) {
    console.error('[me/ecosystemes] query failed', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const rows = (data ?? []) as {
    id: string
    slug: string
    name: string
    domain_configs: { primary_color: string } | { primary_color: string }[] | null
  }[]

  const translations = await loadTranslations(locale)

  const ecosystems = rows.map((r) => {
    const cfg = Array.isArray(r.domain_configs) ? r.domain_configs[0] : r.domain_configs
    return {
      id: r.id,
      slug: r.slug,
      name: tBDD(translations, 'domains', r.id, 'name', r.name),
      color: cfg?.primary_color ?? null,
    }
  })

  // `current` est l'écosystème ACTIF (le sous-domaine), pas celui du compte :
  // c'est lui que le sélecteur doit cocher.
  return json({ ecosystems, current: auth.domain.slug }, 200)
}

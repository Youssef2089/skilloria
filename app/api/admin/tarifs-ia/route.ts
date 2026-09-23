import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'
import { jugerForme } from '@/lib/ai-tarifs/forme'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/tarifs-ia — LA GRILLE TARIFAIRE DES MODÈLES.
 *
 * ┌─ POURQUOI CETTE ROUTE EXISTE ───────────────────────────────────────────┐
 * │ La grille vivait en base — bien — mais AUCUN écran ne l'exposait.        │
 * │ Changer un prix exigeait d'écrire une migration et de déployer. Un       │
 * │ réglage qui ne se règle pas n'est pas un réglage (§D.7), et celui-ci     │
 * │ gouverne un chiffre d'ARGENT.                                            │
 * │                                                                          │
 * │ CE QUE CETTE ABSENCE A COÛTÉ, DEUX FOIS (§E.13) :                        │
 * │   · le code appliquait 3/15 à TOUS les modèles — les prix de Sonnet 4.6. │
 * │     `claude-sonnet-5` coûte 2/10 : la dépense était SURÉVALUÉE DE 50 %   │
 * │     sur le seul point que le plafond comptait ;                          │
 * │   · `claude-haiku-4-5` coûte 1/5 : la même grille l'aurait surévalué     │
 * │     d'un FACTEUR 3.                                                      │
 * │ Un tarif faux ne casse rien. Il rend un nombre plausible, et on le croit  │
 * │ parce qu'il est affiché.                                                 │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ LE PRIX EST SAISI, LES UNITÉS SONT MESURÉES ═════════════════════════
 *   Aucun fournisseur n'est interrogé pour le PRIX : la grille est saisie à la
 *   main, et la route rend `updated_at` pour que l'écran dise depuis quand un
 *   prix n'a pas été confronté à celui du fournisseur.
 *
 *   ⚠️ MAIS LES UNITÉS, ELLES, NE SONT PLUS ESTIMÉES (§D.24). Le reranker
 *      renvoie le nombre d'unités de recherche facturées, Claude renvoie ses
 *      jetons et ses recherches web : on les LIT. La dépense n'est donc plus
 *      « reconstituée » de bout en bout — elle est « unités mesurées × prix
 *      saisi ». C'est la moitié qui reste saisie que cet écran gouverne.
 *
 * ═══ LES BORNES SONT CELLES DE LA BASE ═══════════════════════════════════
 *   `ai_model_tarifs_forme_check` : UNE forme parmi TROIS — par jetons, par
 *   document (historique), ou par recherche —, jamais deux, jamais aucune. Une
 *   ligne à moitié remplie produirait un coût NUL silencieux : le défaut exact
 *   que cette table existe pour fermer. On revalide ici parce qu'un refus de
 *   base remonterait en 500 illisible.
 *
 *   ET `usd_par_recherche_web` N'EST PAS UNE FORME, c'est un SUPPLÉMENT : il
 *   s'ajoute aux jetons du même appel, et seule la forme JETONS peut le porter.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Borne haute VOLONTAIREMENT large : c'est un garde-fou contre la faute de
 * frappe (un prix à 10 000 $), pas une politique. La politique, c'est le
 * fournisseur qui la fixe.
 */
const PRIX_MAX = 10_000

type LigneTarif = {
  model: string
  provider: string
  usd_par_1m_entree: number | string | null
  usd_par_1m_sortie: number | string | null
  usd_par_unite: number | string | null
  usd_par_recherche: number | string | null
  usd_par_recherche_web: number | string | null
  source: string | null
  updated_at: string
}

const nombreOuNull = (v: number | string | null): number | null =>
  v == null ? null : Number(v)

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const { data, error } = await auth.supabaseAdmin
    .from('ai_model_tarifs')
    // Un seul tenant : concaténée, la chaîne perd son type littéral et
    // supabase-js ne sait plus quelles colonnes reviennent (§E.1).
    .select('model, provider, usd_par_1m_entree, usd_par_1m_sortie, usd_par_unite, usd_par_recherche, usd_par_recherche_web, source, updated_at')
    .order('provider', { ascending: true })
    .order('model', { ascending: true })

  // Une erreur de LECTURE n'est pas « la grille est vide » (§E.22). Rendre un
  // tableau vide ferait croire qu'aucun tarif n'est posé — et inviterait à en
  // ressaisir par-dessus ceux qui existent.
  if (error) {
    console.error('[admin:tarifs-ia] lecture en échec', error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const lignes = (data ?? []) as LigneTarif[]
  return json(
    {
      tarifs: lignes.map((l) => ({
        model: l.model,
        provider: l.provider,
        usd_par_1m_entree: nombreOuNull(l.usd_par_1m_entree),
        usd_par_1m_sortie: nombreOuNull(l.usd_par_1m_sortie),
        usd_par_unite: nombreOuNull(l.usd_par_unite),
        usd_par_recherche: nombreOuNull(l.usd_par_recherche),
        usd_par_recherche_web: nombreOuNull(l.usd_par_recherche_web),
        source: l.source,
        updated_at: l.updated_at,
      })),
      /** Le plus ancien « vérifié le » de la grille — cf. l'encadré ci-dessus. */
      plus_ancienne_modification:
        lignes.length > 0
          ? lignes.reduce((a, l) => (l.updated_at < a ? l.updated_at : a), lignes[0].updated_at)
          : null,
      bornes: { prix_max: PRIX_MAX },
    },
    200,
  )
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: {
    model?: unknown
    usd_par_1m_entree?: unknown
    usd_par_1m_sortie?: unknown
    usd_par_unite?: unknown
    usd_par_recherche?: unknown
    usd_par_recherche_web?: unknown
    source?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const model = typeof body.model === 'string' ? body.model.trim() : ''
  if (!model) return json({ error: 'Missing model', code: 'invalid_model' }, 400)

  /** Un prix : positif, fini, sous la borne de frappe. `null` = absent. */
  const prix = (v: unknown): number | null | 'invalide' => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n) || n < 0 || n > PRIX_MAX) return 'invalide'
    return n
  }

  const entree = prix(body.usd_par_1m_entree)
  const sortie = prix(body.usd_par_1m_sortie)
  const unite = prix(body.usd_par_unite)
  const recherche = prix(body.usd_par_recherche)
  const rechercheWeb = prix(body.usd_par_recherche_web)
  if (
    entree === 'invalide' ||
    sortie === 'invalide' ||
    unite === 'invalide' ||
    recherche === 'invalide' ||
    rechercheWeb === 'invalide'
  ) {
    return json({ error: `Prix hors [0, ${PRIX_MAX}]`, code: 'invalid_price' }, 400)
  }

  // LA FORME, revalidée ici. La base la refuserait de toute façon — mais en
  // rendant un 500 que personne ne sait lire. Un refus doit dire CE QUI BLOQUE
  // et CE QU'ON PEUT FAIRE.
  //
  // ⚠️ LA RÈGLE N'EST PAS ÉCRITE ICI : elle vit dans un module PUR que son
  //    contrôle EXÉCUTE ([lib/ai-tarifs/forme.ts]). L'écran lit le même, et
  //    la base tient la même — trois écritures feraient trois occasions de
  //    diverger, et celle qui diverge en dernier aurait l'air d'être la bonne.
  const verdict = jugerForme({ entree, sortie, unite, recherche, rechercheWeb })
  if (!verdict.ok) {
    return json(
      {
        error:
          verdict.code === 'invalid_web_search_price'
            ? 'Le prix d\'une recherche web s\'ajoute aux JETONS d\'un appel : il ne se pose que sur un tarif par jetons'
            : 'Un tarif se donne par JETONS (entrée + sortie), par DOCUMENT, ou par RECHERCHE — une seule forme, jamais deux, jamais aucune',
        code: verdict.code,
      },
      400,
    )
  }

  // L'ANCIENNE valeur est lue AVANT l'écriture : une trace qui ne dit pas d'où
  // vient un prix ne permet pas de rattacher une facture à la saisie qui l'a
  // produite. C'est un chiffre d'argent — la trace est la moitié du travail.
  const { data: avantRow, error: lectureErr } = await auth.supabaseAdmin
    .from('ai_model_tarifs')
    .select('model, usd_par_1m_entree, usd_par_1m_sortie, usd_par_unite, usd_par_recherche, usd_par_recherche_web, source')
    .eq('model', model)
    .maybeSingle()
  if (lectureErr) {
    console.error('[admin:tarifs-ia] lecture avant écriture en échec', lectureErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!avantRow) {
    // On ne CRÉE pas une ligne ici : un modèle inconnu de la grille est un
    // modèle que le code n'appelle pas. L'ajouter à l'aveugle poserait un prix
    // que rien ne consomme — un réglage mort de plus.
    return json({ error: 'Unknown model', code: 'unknown_model' }, 404)
  }

  const maintenant = new Date().toISOString()
  const { error } = await auth.supabaseAdmin
    .from('ai_model_tarifs')
    .update({
      usd_par_1m_entree: entree,
      usd_par_1m_sortie: sortie,
      usd_par_unite: unite,
      usd_par_recherche: recherche,
      usd_par_recherche_web: rechercheWeb,
      ...(typeof body.source === 'string' && body.source.trim() !== ''
        ? { source: body.source.trim().slice(0, 300) }
        : {}),
      updated_at: maintenant,
      updated_by: auth.user.id,
    })
    .eq('model', model)
  if (error) {
    console.error('[admin:tarifs-ia] update failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'ai_tarif_updated',
    entity_type: 'ai_model_tarif',
    entity_id: null,
    detail: {
      model,
      avant: {
        usd_par_1m_entree: nombreOuNull(avantRow.usd_par_1m_entree as number | string | null),
        usd_par_1m_sortie: nombreOuNull(avantRow.usd_par_1m_sortie as number | string | null),
        usd_par_unite: nombreOuNull(avantRow.usd_par_unite as number | string | null),
        usd_par_recherche: nombreOuNull(avantRow.usd_par_recherche as number | string | null),
        usd_par_recherche_web: nombreOuNull(
          avantRow.usd_par_recherche_web as number | string | null,
        ),
      },
      apres: {
        usd_par_1m_entree: entree,
        usd_par_1m_sortie: sortie,
        usd_par_unite: unite,
        usd_par_recherche: recherche,
        usd_par_recherche_web: rechercheWeb,
      },
    },
  })

  return json({ ok: true, model, updated_at: maintenant }, 200)
}

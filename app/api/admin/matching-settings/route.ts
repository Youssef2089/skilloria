import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { logAudit } from '@/lib/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET / PATCH /api/admin/matching-settings — CE QUI SE DÉCIDE, ET RIEN D'AUTRE.
 *
 * ┌─ CE QUI A ÉTÉ RETIRÉ D'ICI, ET POURQUOI ────────────────────────────────┐
 * │ Cette route servait DIX lectures : réglages, distribution, dépense,      │
 * │ couverture, pannes de rédaction, dépassements de relance, runs           │
 * │ inachevés, dépense par acteur… L'écran qu'elle alimentait mélangeait le  │
 * │ RÉGLAGE et la SUPERVISION, et devant cette page on ne savait plus lequel │
 * │ des deux on était censé faire.                                           │
 * │ La supervision vit désormais sur `/api/admin/supervision`. Ici ne reste  │
 * │ que ce qu'on DÉCIDE — plus la distribution, qui n'est pas de la          │
 * │ supervision mais l'outil sans lequel régler un filtre est un tirage au   │
 * │ sort.                                                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ LE CHANGEMENT DE MODÈLE NE SE FAIT PLUS SEUL ════════════════════════
 *   Changer de reranker change l'ÉCHELLE : les deux filtres deviennent faux, et
 *   les notes anciennes ne sont plus comparables aux nouvelles. L'écran le
 *   disait — en gris, sous le champ. Une phrase en gris ne protège de rien.
 *
 *   La route EXIGE désormais que le même appel repose les deux filtres. Le
 *   garde-fou n'est plus une phrase, c'est une CONDITION : on ne peut pas
 *   changer de modèle sans avoir été obligé de redécider ce qu'on filtre.
 *
 * ═══ CE QUE LA ROUTE REFUSE, ET POURQUOI ELLE LE DIT ═════════════════════
 *   Un filtre de notification SOUS celui du flux : on notifierait un expert
 *   pour une annonce qu'il ne verrait pas en se connectant. La base porte la
 *   même contrainte ; on refuse ici pour rendre une RAISON lisible plutôt
 *   qu'une erreur Postgres.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** Un nombre fini dans des bornes. `null` si ce n'en est pas un. */
function nombreDansBornes(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

export async function GET(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const admin = auth.supabaseAdmin

  const [reglagesRes, domainesRes, depenseRes, seuilsActeurRes, modelesRes] =
    await Promise.all([
      admin
        .from('matching_settings')
        .select('domain_id, feed_threshold, notify_threshold, notify_enabled, rerank_model, rerank_batch_size, updated_at'),
      admin.from('domains').select('id, slug, name'),
      admin.rpc('ai_spend_status'),
      admin.from('ai_spend_seuils_acteur').select('acteur, seuil_mensuel_usd'),
      // LES MODÈLES PROPOSABLES SONT CEUX QUI ONT UN TARIF. Un modèle sans
      // tarif journaliserait sa dépense à ZÉRO, et le plafond cesserait de la
      // compter — en silence (§E.13). On ne peut donc pas en choisir un.
      admin.from('ai_model_tarifs').select('model').eq('provider', 'rerank').order('model'),
    ])

  if (reglagesRes.error) {
    console.error('[admin:matching-settings] lecture des réglages en échec', reglagesRes.error.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const domaines = new Map(
    ((domainesRes.data ?? []) as Array<{ id: string; slug: string; name: string | null }>).map((d) => [
      d.id,
      { slug: d.slug, name: d.name },
    ]),
  )

  // ── LA RÉPARTITION, ÉCOSYSTÈME PAR ÉCOSYSTÈME ─────────────────────────────
  //  Les filtres se règlent PAR écosystème. Montrer à côté d'eux la répartition
  //  de tous les autres ferait régler sur une courbe qui n'est pas la sienne —
  //  et ce serait pire que de ne rien montrer, parce qu'on aurait cru savoir.
  //  C'est §E.24 : un chiffre juste sous une étiquette fausse.
  const lignes = (reglagesRes.data ?? []) as Array<Record<string, unknown>>
  const repartitions = await Promise.all(
    lignes.map((r) =>
      admin.rpc('matching_threshold_health', { p_domain_id: r.domain_id as string }),
    ),
  )

  return json(
    {
      reglages: lignes.map((r, i) => ({
        ...r,
        domaine: domaines.get(r.domain_id as string) ?? null,
        // `null` plutôt qu'un tableau vide : vide se lirait « aucune exécution »,
        // `null` se lit « je n'ai pas pu regarder » (§E.22). L'écran ne dit pas
        // la même phrase dans les deux cas.
        distribution: repartitions[i]?.error ? null : (repartitions[i]?.data ?? []),
      })),
      depense: depenseRes.error ? null : (depenseRes.data ?? []),
      seuils_acteur: seuilsActeurRes.error
        ? null
        : Object.fromEntries(
            ((seuilsActeurRes.data ?? []) as Array<{ acteur: string; seuil_mensuel_usd: number | string }>).map(
              (r) => [r.acteur, Number(r.seuil_mensuel_usd)],
            ),
          ),
      modeles: modelesRes.error
        ? null
        : ((modelesRes.data ?? []) as Array<{ model: string }>).map((m) => m.model),
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
  const admin = auth.supabaseAdmin

  let body: {
    domain_id?: unknown
    feed_threshold?: unknown
    notify_threshold?: unknown
    notify_enabled?: unknown
    rerank_model?: unknown
    rerank_batch_size?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const domainId = typeof body.domain_id === 'string' && UUID.test(body.domain_id) ? body.domain_id : null
  if (!domainId) return json({ error: 'Invalid domain', code: 'bad_domain' }, 400)

  // On lit l'existant pour valider l'ORDRE des deux filtres même quand un seul
  // est envoyé. Sans cela, régler le flux seul pourrait le faire passer
  // au-dessus du filtre de notification sans qu'aucune garde ne le voie.
  const { data: actuel, error: lectureErr } = await admin
    .from('matching_settings')
    .select('feed_threshold, notify_threshold, rerank_model')
    .eq('domain_id', domainId)
    .maybeSingle()
  if (lectureErr) {
    console.error('[admin:matching-settings] lecture en échec', lectureErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!actuel) return json({ error: 'Unknown domain', code: 'bad_domain' }, 404)

  const patch: Record<string, unknown> = {}

  if ('feed_threshold' in body) {
    // ÉCHELLE 0-10, la seule du produit. La base porte la même borne ; on la
    // revérifie ici parce qu'une contrainte relâchée ne produirait aucune
    // erreur — juste un filtre qui écarte tout le monde, ou personne.
    const v = nombreDansBornes(body.feed_threshold, 0, 10)
    if (v == null) return json({ error: 'filtre du flux hors [0,10]', code: 'bad_filter' }, 400)
    patch.feed_threshold = v
  }
  if ('notify_threshold' in body) {
    const v = nombreDansBornes(body.notify_threshold, 0, 10)
    if (v == null) return json({ error: 'filtre de notification hors [0,10]', code: 'bad_filter' }, 400)
    patch.notify_threshold = v
  }
  if ('rerank_batch_size' in body) {
    const v = nombreDansBornes(body.rerank_batch_size, 1, 1000)
    if (v == null) return json({ error: 'rerank_batch_size hors [1,1000]', code: 'bad_batch' }, 400)
    patch.rerank_batch_size = Math.round(v)
  }
  if ('notify_enabled' in body) {
    patch.notify_enabled = body.notify_enabled === true
  }

  // ── LE CHANGEMENT DE MODÈLE ────────────────────────────────────────────
  //  Il change l'ÉCHELLE des notes. Les deux filtres en vigueur deviennent
  //  donc faux — pas « approximatifs » : faux, parce que le nouveau modèle ne
  //  distribue pas ses notes comme l'ancien.
  //
  //  On EXIGE que le même appel repose les deux filtres. Le garde-fou cesse
  //  d'être une phrase en gris sous un champ : c'est une condition, et on ne
  //  peut pas la lire de travers.
  if ('rerank_model' in body) {
    const modele = typeof body.rerank_model === 'string' ? body.rerank_model.trim() : ''
    if (!modele) return json({ error: 'Invalid model', code: 'bad_model' }, 400)

    if (modele !== actuel.rerank_model) {
      // Le modèle doit avoir un TARIF, sinon sa dépense se journaliserait à
      // zéro et le plafond cesserait de la compter, sans rien dire (§E.13).
      const { data: tarif, error: tarifErr } = await admin
        .from('ai_model_tarifs')
        .select('model')
        .eq('model', modele)
        .eq('provider', 'rerank')
        .maybeSingle()
      if (tarifErr) {
        console.error('[admin:matching-settings] lecture du tarif en échec', tarifErr.message)
        return json({ error: 'Query failed', code: 'db_error' }, 500)
      }
      if (!tarif) {
        return json(
          { error: 'Model has no price in the grid', code: 'model_without_price' },
          400,
        )
      }

      if (!('feed_threshold' in body) || !('notify_threshold' in body)) {
        return json(
          {
            error: 'Changing the model requires setting both filters in the same request',
            code: 'model_requires_filters',
          },
          400,
        )
      }
      patch.rerank_model = modele
    }
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'No editable field', code: 'invalid_json' }, 400)
  }

  const feedFinal = (patch.feed_threshold as number | undefined) ?? Number(actuel.feed_threshold)
  const notifyFinal = (patch.notify_threshold as number | undefined) ?? Number(actuel.notify_threshold)
  if (notifyFinal < feedFinal) {
    return json(
      {
        error: 'Notification filter below feed filter',
        code: 'notify_below_feed',
      },
      400,
    )
  }

  const { error } = await admin
    .from('matching_settings')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: auth.user.id })
    .eq('domain_id', domainId)
  if (error) {
    console.error('[admin:matching-settings] update failed', error.message)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: admin,
    user_id: auth.user.id,
    domain_id: auth.domain.id,
    action: 'matching_settings_updated',
    entity_type: 'matching_settings',
    entity_id: domainId,
    detail: {
      ecosysteme: domainId,
      avant: {
        feed_threshold: Number(actuel.feed_threshold),
        notify_threshold: Number(actuel.notify_threshold),
        rerank_model: actuel.rerank_model,
      },
      apres: patch,
    },
  })

  return json({ ok: true, domain_id: domainId, ...patch }, 200)
}

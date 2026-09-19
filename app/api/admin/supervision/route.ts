import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { classerProblemes, type SourcesSupervision } from '@/lib/supervision/problemes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/supervision — CE QUI S'OBSERVE, SÉPARÉ DE CE QUI SE DÉCIDE.
 *
 * ┌─ POURQUOI CETTE ROUTE EXISTE ───────────────────────────────────────────┐
 * │ `/admin/matching` mélangeait RÉGLAGE et SUPERVISION. Devant cette page,  │
 * │ on ne savait plus ce qu'on était censé faire : décider, ou constater.    │
 * │ Les deux se séparent ici — et la supervision gagne au passage ce qui lui │
 * │ manquait : un HISTORIQUE, une RÉPARTITION PAR ACTION, et un détail       │
 * │ qu'on puisse ouvrir.                                                     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ LA GRAVITÉ EST CALCULÉE AU SERVEUR, ET C'EST LE POINT ═══════════════
 *   L'écran d'avant peignait en rouge des paragraphes d'EXPLICATION — donc on
 *   apprenait à ignorer le rouge — pendant que SIX mises en relation jamais
 *   tentées depuis trois mois s'affichaient dans le même gris que quatre
 *   « tout va bien ». On est passé devant sans les voir.
 *
 *   Décider ce qui est grave est une RÈGLE MÉTIER. Elle vit donc dans
 *   `lib/supervision/problemes.ts`, au serveur, éprouvable sans navigateur —
 *   et non dans une couleur choisie au milieu du JSX.
 *
 * ═══ CHAQUE LECTURE EST INDÉPENDANTE, ET UNE PANNE SE DIT ════════════════
 *   Une lecture en échec rend `null`, jamais `[]` (§E.22) : vide se lirait
 *   « aucun problème », `null` se lit « je n'ai pas pu regarder ». Les deux
 *   n'appellent pas la même réaction, et la seconde est la plus dangereuse à
 *   confondre avec la première.
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
  const admin = auth.supabaseAdmin

  const url = new URL(request.url)
  const moisDemandes = Math.max(1, Math.min(24, Number(url.searchParams.get('mois') ?? 6) || 6))

  const [
    distributionRes,
    couvertureRes,
    pannesRes,
    relancesRes,
    inachevesRes,
    depenseRes,
    historiqueRes,
    operationsRes,
    tarifsRes,
    parActeurRes,
    seuilsActeurRes,
  ] = await Promise.all([
    admin.rpc('matching_threshold_health'),
    admin.rpc('matching_coverage_health'),
    admin.rpc('redaction_failure_health'),
    admin.rpc('relance_overrun_health'),
    admin.rpc('matching_runs_inacheves'),
    admin.rpc('ai_spend_status'),
    admin.rpc('ai_depense_par_mois', { p_mois: moisDemandes }),
    admin.rpc('ai_depense_operations', { p_limite: 10 }),
    admin.from('ai_model_tarifs').select('model, updated_at'),
    // ⚠️ LA DÉPENSE PAR ACTEUR REVIENT ICI, ET ELLE AVAIT DISPARU.
    //    Elle vivait sur `/admin/matching`. En séparant le RÉGLAGE de la
    //    MESURE (§D.11), l'écran de réglage a gardé ses seuils d'alerte — qui
    //    ont un champ — et a perdu la dépense qu'ils surveillent, qui n'en a
    //    pas. **Un réglage sans sa mesure se règle à l'aveugle.**
    //    Mesuré : c'est la SEULE mesure que la refonte ait perdue.
    admin.rpc('ai_spend_par_acteur', { p_limite: 10 }),
    // Les seuils d'ALERTE (§D.9 : une alerte SIGNALE, elle ne bloque pas). Ils
    // se règlent ailleurs ; ils se LISENT ici, parce que l'alerte se déduit en
    // comparant à la dépense — et qu'un état « en dépassement » écrit quelque
    // part serait faux la seconde suivante.
    admin.from('ai_spend_seuils_acteur').select('acteur, seuil_mensuel_usd'),
  ])

  /** `null` = « je n'ai pas pu regarder ». Jamais `[]`, qui dit « rien à voir ». */
  const ouNull = <T,>(res: { error: unknown; data: T | null }): T | null =>
    res.error ? null : ((res.data ?? []) as T)

  const tarifs = tarifsRes.error
    ? null
    : ((tarifsRes.data ?? []) as Array<{ model: string; updated_at: string }>)

  const sources: SourcesSupervision = {
    inacheves: ouNull(inachevesRes),
    couverture: ouNull(couvertureRes),
    pannes: ouNull(pannesRes),
    relances: ouNull(relancesRes),
    depense: ouNull(depenseRes),
    distribution: ouNull(distributionRes),
    tarifPlusAncien:
      tarifs === null
        ? null
        : tarifs.length === 0
          ? null
          : tarifs.reduce((a, l) => (l.updated_at < a ? l.updated_at : a), tarifs[0].updated_at),
  }

  return json(
    {
      // CE QUI NE VA PAS, EN PREMIER ET DÉJÀ TRIÉ. L'écran n'a plus qu'à le
      // rendre : il ne décide pas de ce qui est grave.
      problemes: classerProblemes(sources),
      distribution: sources.distribution,
      couverture: sources.couverture,
      pannes: sources.pannes,
      relances: sources.relances,
      inacheves: sources.inacheves,
      depense: sources.depense,
      historique: ouNull(historiqueRes),
      par_acteur: ouNull(parActeurRes),
      seuils_acteur: ouNull(seuilsActeurRes),
      operations: ouNull(operationsRes),
      tarif_plus_ancien: sources.tarifPlusAncien,
      mois: moisDemandes,
    },
    200,
  )
}

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * CE QU'UNE BRANCHE PORTE ENCORE — LU UNE SEULE FOIS, POUR LES DEUX SURFACES.
 *
 * ┌─ DEUX GARDES QUI TOMBENT SUR LA MÊME PANNE N'EN FONT QU'UNE ────────────┐
 * │ `/admin/get-branch` comptait les usages pour les MONTRER, et             │
 * │ `/admin/delete-branch` les recomptait pour AUTORISER. Aucune des six     │
 * │ lectures ne récupérait son erreur, et les deux retombaient sur           │
 * │ `count ?? 0`.                                                            │
 * │                                                                          │
 * │ Une seule panne rendait donc les DEUX aveugles : l'écran affichait       │
 * │ « 0 usage », l'administrateur supprimait en croyant décider en           │
 * │ connaissance de cause, et la barrière `in_use` ne se levait pas parce    │
 * │ qu'elle lisait le même zéro. **L'humain croyait décider, la machine      │
 * │ croyait qu'il avait décidé.**                                            │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ ET LE SCHÉMA NE RATTRAPE QU'UN TIERS ═══════════════════════════════
 *   · `profiles.branch_id`       → RESTRICT   ✅ la base refuse
 *   · `profile_alerts.branch_id` → RESTRICT   ✅ la base refuse
 *   · `publications.branch_id`   → **SET NULL**  ❌ les annonces perdent leur
 *     branche, en silence
 *   · `specialities.branch_id`   → **CASCADE**   ❌ les spécialités sont
 *     SUPPRIMÉES avec elle
 *   Une branche sans profil mais avec des spécialités était donc effaçable par
 *   une simple panne de lecture, et ses spécialités partaient avec — sur le
 *   référentiel du produit, sans retour possible.
 *
 * ═══ LA RÈGLE ÉTAIT DÉJÀ ÉCRITE DANS LE DÉPÔT, DEUX FICHIERS PLUS LOIN ═══
 *   `app/api/admin/ecosystemes/[id]/impact/route.ts` rend `null` sur exactement
 *   ce motif, et son commentaire dit pourquoi : « un compteur en panne qui
 *   affiche zéro dirait *il n'y a rien à perdre* au moment précis où on décide
 *   de couper ». **Une règle écrite à un endroit ne protège pas son voisin**
 *   (§E.28 ③, troisième occurrence).
 *
 * ═══ LA PARADE : UN SEUL TYPE, DEUX CONSOMMATEURS, DEUX RÉPONSES ════════
 *   Le discriminant s'appelle `etat` et `'indisponible'` y veut dire la même
 *   chose que dans `lib/lecture/liste.ts`, `etatRepartition()` et
 *   `expertProfileGate` : *la lecture a échoué, on ne sait pas*.
 *   Les trois compteurs n'existent QUE dans la branche `'disponible'` : il n'y
 *   a aucun moyen d'écrire `count ?? 0`.
 *
 *   **Si l'on ne peut pas savoir, l'écran le DIT et la barrière REFUSE.**
 *   Jamais l'inverse, et jamais l'un sans l'autre — c'est tout l'objet de ce
 *   module partagé : les deux surfaces ne peuvent plus diverger, parce
 *   qu'elles ne lisent plus séparément.
 */
export type UsageBranche =
  /** La lecture a ÉCHOUÉ. On ne sait pas ce que la branche porte. */
  | { etat: 'indisponible' }
  /** La lecture a RÉUSSI. Les trois comptes sont des FAITS, zéro compris. */
  | {
      etat: 'disponible'
      profils: number
      publications: number
      specialites: number
    }

/**
 * Les trois comptes, en parallèle, avec leurs erreurs RÉCUPÉRÉES.
 *
 * ⚠️ UNE SEULE ERREUR SUFFIT À RENDRE `'indisponible'`. Rendre deux comptes sur
 *    trois serait pire que rien : la somme aurait l'air d'un fait et n'en
 *    serait pas un — et c'est précisément sur ce genre de total qu'on décide de
 *    supprimer.
 */
export async function usageDeLaBranche(
  admin: SupabaseClient,
  branchId: string,
): Promise<UsageBranche> {
  const [profilsRes, publicationsRes, specialitesRes] = await Promise.all([
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('branch_id', branchId),
    admin.from('publications').select('id', { count: 'exact', head: true }).eq('branch_id', branchId),
    admin.from('specialities').select('id', { count: 'exact', head: true }).eq('branch_id', branchId),
  ])

  if (profilsRes.error || publicationsRes.error || specialitesRes.error) {
    console.error('[admin] usage de branche ILLISIBLE — aucun verdict', {
      branchId,
      profils: profilsRes.error?.message ?? null,
      publications: publicationsRes.error?.message ?? null,
      specialites: specialitesRes.error?.message ?? null,
    })
    return { etat: 'indisponible' }
  }

  return {
    etat: 'disponible',
    profils: profilsRes.count ?? 0,
    publications: publicationsRes.count ?? 0,
    specialites: specialitesRes.count ?? 0,
  }
}

/**
 * La branche est-elle référencée ? `null` = on ne sait pas.
 *
 * Écrit ici plutôt que chez chaque appelant : le prédicat qui MONTRE et celui
 * qui AUTORISE doivent être le même, sinon ils divergent — et ils avaient
 * divergé au point de tomber ensemble.
 */
export function brancheReferencee(usage: UsageBranche): boolean | null {
  if (usage.etat === 'indisponible') return null
  return usage.profils > 0 || usage.publications > 0 || usage.specialites > 0
}

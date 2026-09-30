// lib/profil/cause-echec-modele.ts
//
// POURQUOI UN APPEL AU MODÈLE A ÉCHOUÉ — et donc s'il se REJOUE (§D.30).
//
// ⚠️ MODULE PUR, sans import : `diag-parcours-expert` l'exécute sur des erreurs
//    fabriquées. L'exécutant des travaux d'IA s'en sert pour décider : une panne de
//    NOTRE côté ou du fournisseur se rejoue (et ne coûte rien à l'expert) ; un
//    document refusé ou une réponse illisible ne se rejouent pas — rejouer
//    produirait la même issue, payée une fois de plus.

export type CauseEchecModele =
  /** Réseau, délai, 429, 5xx, surcharge : ça passe en réessayant plus tard. */
  | 'modele_indisponible'
  /** La clé du fournisseur manque : une configuration, pas un document. */
  | 'configuration'
  /** Le fournisseur refuse le document (400 : trop lourd, illisible, protégé). */
  | 'document_refuse'
  /** Le modèle a répondu sans rendre ce qu'on attendait. */
  | 'reponse_illisible'

export const CAUSES_REJOUABLES: readonly CauseEchecModele[] = ['modele_indisponible']

export function causeEchecModele(err: unknown): CauseEchecModele {
  const statut =
    typeof err === 'object' && err !== null && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : null
  if (statut === 401 || statut === 403) return 'configuration'
  if (statut === 408 || statut === 409 || statut === 429 || (statut !== null && statut >= 500)) return 'modele_indisponible'
  if (statut === 400 || statut === 413 || statut === 422) return 'document_refuse'
  const msg = err instanceof Error ? err.message : String(err)
  if (/api[_ ]?key|not configured|authentication/i.test(msg)) return 'configuration'
  if (/network|fetch|timeout|timed out|abort|ECONN|EAI|socket|overloaded/i.test(msg)) return 'modele_indisponible'
  return 'reponse_illisible'
}

export const estRejouable = (c: CauseEchecModele): boolean => CAUSES_REJOUABLES.includes(c)

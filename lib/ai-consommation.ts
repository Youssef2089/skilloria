/**
 * lib/ai-consommation.ts — CE QU'UN APPEL A CONSOMMÉ, ET CE QU'IL COÛTE.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ CE MODULE N'A AUCUN IMPORT, ET C'EST LA RAISON D'ÊTRE DU FICHIER.        ║
 * ║                                                                          ║
 * ║ Cinq points de dépense sur sept n'enregistraient RIEN et ne consultaient ║
 * ║ JAMAIS le plafond. Les brancher demandait que les fonctions qui appellent ║
 * ║ le modèle rendent ce qu'elles ont consommé — sans devenir impures.        ║
 * ║                                                                          ║
 * ║ `parseCV`, `runExpertCoherenceCheck`, `verifyAiPublicationQuality` et     ║
 * ║ `verifyAiCoherence` sont des fonctions PURES : pas de client Supabase,   ║
 * ║ pas d'écriture. Leur donner un client pour enregistrer une dépense les    ║
 * ║ rendrait impures, intestables, et impossibles à exécuter depuis un        ║
 * ║ diagnostic. Elles RENDENT donc leur consommation ; l'APPELANT, qui a le   ║
 * ║ client et les identifiants, l'enregistre.                                ║
 * ║                                                                          ║
 * ║ Ce type doit donc être importable par elles SANS rien traîner. Même      ║
 * ║ parti pris que lib/expert-name-code.ts, et pour la même raison.          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 */

/**
 * Ce qu'un appel a consommé, tel que le fournisseur le compte.
 *
 * ⚠️ LES UNITÉS SONT BRUTES, JAMAIS CONVERTIES. C'est ce qui rend le coût
 *    RECALCULABLE quand la grille tarifaire change : un coût figé sur
 *    l'ancienne grille serait faux pour toujours, des jetons bruts ne le sont
 *    jamais.
 */
export type ConsommationIA =
  /** Claude : des jetons, comptés par l'API dans `response.usage`. */
  | { forme: 'jetons'; model: string; entree: number; sortie: number }
  /** Cohere : des documents notés. */
  | { forme: 'unites'; model: string; unites: number }

/** La grille tarifaire d'UN modèle, telle qu'elle vit en base. */
export type TarifModele = {
  model: string
  usd_par_1m_entree: number | null
  usd_par_1m_sortie: number | null
  usd_par_unite: number | null
}

/**
 * Le coût d'une consommation, ou `null` quand le tarif est INCONNU.
 *
 * `null` — et jamais zéro déguisé en coût — pour que l'appelant soit OBLIGÉ de
 * traiter le cas. Un zéro silencieux ferait dériver le plafond sans que rien ne
 * le dise, ce qui est exactement le défaut qu'on ferme ici.
 *
 * ⚠️ CE QUI N'EST PAS COMPTÉ, ET IL FAUT LE DIRE : les jetons de CACHE
 *    (`cache_creation_input_tokens`, `cache_read_input_tokens`) sont facturés à
 *    des taux différents et ne sont pas modélisés. Aucun appel du dépôt
 *    n'utilise le cache aujourd'hui ; le jour où l'un le fera, son coût sera
 *    SOUS-ESTIMÉ. Les unités brutes restent enregistrées, donc recalculables.
 */
export function coutUsd(c: ConsommationIA, tarif: TarifModele | null): number | null {
  if (!tarif) return null

  if (c.forme === 'jetons') {
    if (tarif.usd_par_1m_entree == null || tarif.usd_par_1m_sortie == null) return null
    return (
      (Math.max(0, c.entree) / 1_000_000) * tarif.usd_par_1m_entree +
      (Math.max(0, c.sortie) / 1_000_000) * tarif.usd_par_1m_sortie
    )
  }

  if (tarif.usd_par_unite == null) return null
  return Math.max(0, c.unites) * tarif.usd_par_unite
}

/** Le nombre d'unités brutes à journaliser, quelle que soit la forme. */
export function unitesBrutes(c: ConsommationIA): number {
  return c.forme === 'jetons' ? Math.max(0, c.entree) + Math.max(0, c.sortie) : Math.max(0, c.unites)
}

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
  /**
   * Claude : des jetons, comptés par l'API dans `response.usage`.
   *
   * `recherches_web` : le MÊME appel peut avoir fait des recherches web
   * (outil natif `web_search`), facturées À LA RECHERCHE en plus des jetons.
   * Elles n'étaient comptées NULLE PART — le compteur ne voyait que les jetons
   * d'un appel qui avait aussi payé ses recherches (§D.24).
   * Absent = l'appel n'en a pas fait. Zéro et absent disent la même chose ici,
   * et c'est le seul cas du module où ils peuvent.
   */
  | { forme: 'jetons'; model: string; entree: number; sortie: number; recherches_web?: number }
  /**
   * Cohere : des RECHERCHES, pas des documents.
   *
   * ┌─ LE DÉFAUT QUE CETTE FORME REMPLACE ────────────────────────────────┐
   * │ Le reranker était compté AU DOCUMENT — `unites: lot.length` — alors  │
   * │ qu'il est facturé À LA RECHERCHE. Mesuré le 23/09/2026 : un lot de   │
   * │ 200 documents était compté 200 × 0,000002 $ = 0,0004 $, là où le     │
   * │ fournisseur facture 0,002 $ par unité de recherche.                  │
   * │                                                                      │
   * │ L'ÉCART DÉPEND DE LA TAILLE DU LOT, et c'est ce qui le rend           │
   * │ insaisissable : il vaut ~10 pour des lots pleins, et dépasse 60 pour  │
   * │ des lots d'une quinzaine. Un facteur qui bouge avec un RÉGLAGE n'est  │
   * │ pas une erreur de valeur — c'est une erreur d'UNITÉ.                  │
   * └──────────────────────────────────────────────────────────────────────┘
   *
   * ⚠️ `recherches` N'EST PAS ESTIMÉ : le fournisseur le RENVOIE. Quand il ne
   *    le renvoie pas, `source` vaut `'plancher'` et la valeur est le MINIMUM
   *    structurel — un appel coûte au moins une unité. Ce n'est pas une
   *    estimation, c'est une borne, et elle est déclarée.
   */
  | {
      forme: 'recherches'
      model: string
      recherches: number
      /** D'où vient le nombre. Jamais deviné : lu, ou borné. */
      source: 'fournisseur' | 'plancher'
    }
  /**
   * Des documents notés.
   *
   * ⚠️ CONSERVÉE POUR L'HISTORIQUE, PLUS PRODUITE PAR AUCUN APPEL. Les lignes
   *    déjà écrites portent cette forme, et leurs unités brutes doivent rester
   *    recalculables. La retirer rendrait illisible tout ce qui précède le
   *    23/09/2026.
   */
  | { forme: 'unites'; model: string; unites: number }

/** La grille tarifaire d'UN modèle, telle qu'elle vit en base. */
export type TarifModele = {
  model: string
  usd_par_1m_entree: number | null
  usd_par_1m_sortie: number | null
  /** Par DOCUMENT noté. Historique : plus aucun appel ne produit cette forme. */
  usd_par_unite: number | null
  /** Par RECHERCHE — l'unité que Cohere facture réellement (§D.24). */
  usd_par_recherche: number | null
  /** Par recherche WEB, en plus des jetons du même appel (outil natif Claude). */
  usd_par_recherche_web: number | null
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
    const jetons =
      (Math.max(0, c.entree) / 1_000_000) * tarif.usd_par_1m_entree +
      (Math.max(0, c.sortie) / 1_000_000) * tarif.usd_par_1m_sortie

    const recherches = Math.max(0, c.recherches_web ?? 0)
    if (recherches === 0) return jetons
    // ⚠️ UN APPEL QUI A CHERCHÉ SANS TARIF DE RECHERCHE N'A PAS DE COÛT
    //    CONNU — et le dire vaut mieux que de rendre le prix des seuls jetons.
    //    Un coût partiel est un coût FAUX, et il se lirait comme complet
    //    (§E.24). L'appelant a déjà le chemin « TARIF INCONNU » ; on l'emprunte.
    if (tarif.usd_par_recherche_web == null) return null
    return jetons + recherches * tarif.usd_par_recherche_web
  }

  if (c.forme === 'recherches') {
    if (tarif.usd_par_recherche == null) return null
    return Math.max(0, c.recherches) * tarif.usd_par_recherche
  }

  if (tarif.usd_par_unite == null) return null
  return Math.max(0, c.unites) * tarif.usd_par_unite
}

/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LE SEUL CHEMIN VERS LA FORME « JETONS ». Sept appels le prennent.        ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ┌─ POURQUOI UNE FONCTION, ET PAS SEPT OBJETS LITTÉRAUX ───────────────────┐
 * │ Sept sites construisaient `{ forme: 'jetons', entree, sortie }` à la      │
 * │ main. Deux d'entre eux faisaient AUSSI des recherches web, facturées à   │
 * │ la recherche en plus des jetons — et ne les comptaient pas.              │
 * │                                                                          │
 * │ Corriger ces deux-là aurait laissé cinq jumeaux (§E.20) : le jour où     │
 * │ l'un des cinq active l'outil de recherche, sa dépense redevient muette,  │
 * │ EN SILENCE, et rien ne peut le voir — un appel qui cherche a exactement  │
 * │ la même tête qu'un appel qui ne cherche pas.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ ELLE LIT L'`usage` DE FAÇON STRUCTURELLE, et c'est délibéré. Le champ
 *    `server_tool_use` n'existe pas dans toutes les versions du SDK ; le typer
 *    lierait le compteur à une version, et un `?? 0` sur un champ qui n'existe
 *    pas se compile très bien tout en ne comptant jamais rien (§E.1).
 *
 * @param model  le modèle RÉELLEMENT utilisé — jamais celui qu'on visait : un
 *               repli n'a pas le même prix.
 * @param usage  le bloc `usage` de la réponse, tel qu'il arrive.
 */
export function consommationJetons(model: string, usage: unknown): ConsommationIA {
  const u = (usage ?? {}) as Record<string, unknown>
  const outil = (u.server_tool_use ?? {}) as Record<string, unknown>
  const recherches = nombreOuZero(outil.web_search_requests)
  return {
    forme: 'jetons',
    model,
    entree: nombreOuZero(u.input_tokens),
    sortie: nombreOuZero(u.output_tokens),
    // Absent quand il n'y en a pas eu : une clé `recherches_web: 0` sur toutes
    // les lignes ferait croire que la question se pose partout, et noierait les
    // rares lignes où elle se pose vraiment.
    ...(recherches > 0 ? { recherches_web: recherches } : {}),
  }
}

/** Un compteur négatif, absent ou illisible vaut zéro. Jamais `NaN` : il traverse. */
function nombreOuZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/**
 * Le nombre d'unités BRUTES à journaliser, quelle que soit la forme.
 *
 * ⚠️ « BRUTES » VEUT DIRE : TELLES QUE LE FOURNISSEUR LES COMPTE. Pour des
 *    jetons c'est leur somme ; pour des recherches c'est leur nombre. Les
 *    mélanger dans une même colonne est assumé — la colonne ne dit pas « des
 *    jetons », elle dit « ce qui a été consommé » —, et `context.forme` dit
 *    laquelle, ligne par ligne, pour que rien ne se lise à l'envers (§E.24).
 */
export function unitesBrutes(c: ConsommationIA): number {
  if (c.forme === 'jetons') {
    // Les recherches web N'ENTRENT PAS dans ce total : ce sont deux unités
    // différentes, et les additionner ferait un nombre qui ne compte rien.
    // Elles voyagent dans le contexte de la ligne.
    return Math.max(0, c.entree) + Math.max(0, c.sortie)
  }
  if (c.forme === 'recherches') return Math.max(0, c.recherches)
  return Math.max(0, c.unites)
}

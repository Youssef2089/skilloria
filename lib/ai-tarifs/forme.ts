// lib/ai-tarifs/forme.ts
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ LA FORME D'UN TARIF — une et une seule, jamais deux, jamais aucune.      ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ POURQUOI UN MODULE, ET PAS DEUX CONDITIONS BIEN ÉCRITES ───────────────┐
// │ La règle vivait à trois endroits : la contrainte de base, la validation  │
// │ de la route, et l'écran — qui inférait « par jetons » de l'ABSENCE d'un  │
// │ prix par document. Avec deux formes, cette inférence par la négative     │
// │ était juste. Avec trois, elle ne prouve plus rien : un tarif par         │
// │ recherche s'affichait comme un tarif par jetons, deux champs vides et un │
// │ bouton qui refuse d'enregistrer (§E.37).                                 │
// │                                                                          │
// │ Trois écritures d'une même règle font trois occasions de diverger, et    │
// │ celle qui diverge en dernier a l'air d'être la bonne (§E.20).            │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ⚠️ MODULE PUR — AUCUN IMPORT. Son contrôle l'EXÉCUTE (§E.33) plutôt que de
//    lire son texte : une assertion qui cherche un nom de variable verdit au
//    premier renommage et ne dit rien de ce que la règle fait (§E.34). C'est
//    exactement ce qui est arrivé à la première version de ce contrôle — une
//    mutation l'a montré, et c'est ce module qui en est sorti.
//
// ⚠️ ET IL EST LU PAR UN COMPOSANT CLIENT, DÉLIBÉRÉMENT. Ce n'est pas §E.15 :
//    ce que l'écran en fait est de la PRÉSENTATION — quels champs montrer —,
//    et la décision qui engage, elle, reste au serveur puis en base. Le
//    partager évite que l'écran et la route ne répondent différemment à la
//    même question, ce qui est la seule chose qu'un utilisateur puisse voir.
//
// LA BASE TIENT LA MÊME RÈGLE — `ai_model_tarifs_forme_check`, migration
// `tarif_par_recherche`. C'est elle la garantie (§E.31) ; ce module ne la
// remplace pas, il l'EXPLIQUE : sans lui, un refus de contrainte remonterait
// en 500 « db_error », qui n'apprend rien à personne.

/** Les trois formes de tarif. Une ligne en porte exactement une. */
export type FormeTarif = 'jetons' | 'unite' | 'recherche'

/** Des prix tels qu'ils arrivent : saisis, ou lus sur une ligne. */
export type PrixTarif = {
  entree: number | null
  sortie: number | null
  /** Par DOCUMENT noté. Historique : plus aucun appel ne produit cette forme. */
  unite: number | null
  recherche: number | null
  /** Le SUPPLÉMENT de recherche web. Pas une forme — cf. `jugerForme`. */
  rechercheWeb: number | null
}

export type VerdictForme =
  | { ok: true; forme: FormeTarif }
  /** Zéro ou deux formes : le coût dépendrait de l'ordre de lecture. */
  | { ok: false; code: 'invalid_shape' }
  /** Un supplément de recherche web posé ailleurs que sur la forme jetons. */
  | { ok: false; code: 'invalid_web_search_price' }

/**
 * LE JUGEMENT, pour une SAISIE — celui qui refuse.
 *
 * ⚠️ `rechercheWeb` N'EST PAS UNE FORME, C'EST UN SUPPLÉMENT : il s'ajoute aux
 *    jetons du même appel, et seul un modèle facturé aux jetons peut chercher.
 *    Le poser ailleurs écrirait un prix que RIEN ne peut consommer — un réglage
 *    mort (§D.11), et pire : un réglage mort qui a l'air vivant parce qu'il est
 *    chiffré.
 */
export function jugerForme(p: PrixTarif): VerdictForme {
  const parJetons = p.entree !== null && p.sortie !== null && p.unite === null && p.recherche === null
  const parUnite = p.unite !== null && p.entree === null && p.sortie === null && p.recherche === null
  const parRecherche =
    p.recherche !== null && p.entree === null && p.sortie === null && p.unite === null

  if (!parJetons && !parUnite && !parRecherche) return { ok: false, code: 'invalid_shape' }
  if (p.rechercheWeb !== null && !parJetons) {
    return { ok: false, code: 'invalid_web_search_price' }
  }
  return { ok: true, forme: parJetons ? 'jetons' : parUnite ? 'unite' : 'recherche' }
}

/**
 * LA FORME D'UNE LIGNE EXISTANTE — celle qui ne refuse pas.
 *
 * Une ligne en base a déjà passé la contrainte : elle porte exactement une
 * forme. On la LIT, dans un ordre qui n'a aucune importance pour cette
 * raison-là — et le repli sur `jetons` ne se produit donc que sur une ligne
 * que la base refuserait d'écrire.
 *
 * ⚠️ ELLE NE S'INFÈRE PAS PAR LA NÉGATIVE. C'est tout le point : avec deux
 *    formes, l'absence de l'une prouvait la présence de l'autre ; avec trois,
 *    elle ne prouve plus rien.
 */
export function formeDeLigne(p: Pick<PrixTarif, 'unite' | 'recherche'>): FormeTarif {
  if (p.recherche != null) return 'recherche'
  if (p.unite != null) return 'unite'
  return 'jetons'
}

/**
 * Les champs de prix OBLIGATOIRES d'une forme — ce qu'un écran doit demander,
 * et ce qu'un enregistrement doit porter.
 *
 * Le supplément de recherche web n'y figure JAMAIS : vide est une réponse
 * valide, elle dit « ce modèle ne cherche pas ». L'exiger rendrait
 * impossible d'enregistrer un modèle ordinaire.
 */
export function champsRequis(forme: FormeTarif): readonly (keyof PrixTarif)[] {
  if (forme === 'jetons') return ['entree', 'sortie']
  if (forme === 'unite') return ['unite']
  return ['recherche']
}

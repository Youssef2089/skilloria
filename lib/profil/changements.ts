/**
 * lib/profil/changements.ts — CE QUI A VRAIMENT CHANGÉ (décision de Youssef, 01/10/2026, ARRÊT 22).
 *
 * « Profil modifié », « Nom modifié », « Fiche d'organisation modifiée », « Annonce modifiée »… s'écrivaient à chaque
 * enregistrement, MÊME SANS CHANGEMENT : un écran qui renvoie tout son formulaire listait tous ses champs. Ce module
 * compare la valeur ENVOYÉE à la valeur LUE avant l'écriture, et ne garde que ce qui diffère.
 *
 * LE DOUTE PENCHE VERS « MODIFIÉ » : deux valeurs que la comparaison ne sait pas rapprocher sont dites différentes —
 * au pire une ligne de trop, JAMAIS une modification tue. Règles :
 *   · `undefined`, `null` et la chaîne vide (après rognage) sont une même absence ;
 *   · deux CHAÎNES se comparent telles quelles (rognées) : « 01000 » n'est pas « 1000 », « 0612345678 » n'est pas
 *     « 612345678 » (relecture indépendante du 01/10/2026 : la conversion en nombre de toute chaîne de chiffres taisait
 *     un code postal ou un téléphone modifié) ;
 *   · un NOMBRE et une chaîne ne sont égaux que si la chaîne est exactement l'écriture du nombre (500 et « 500 ») —
 *     une colonne numérique relue face à la valeur envoyée en texte ;
 *   · un tableau se compare DANS SON ORDRE ; un objet, clé par clé.
 *
 * Module PUR, sans import : `diag-ce-qui-change` l'exécute tel quel.
 */

const absent = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** Deux valeurs sont-elles la même ? (les règles ci-dessus, récursivement) */
export function memeValeur(a: unknown, b: unknown): boolean {
  if (absent(a) || absent(b)) return absent(a) && absent(b)
  if (typeof a === 'string' && typeof b === 'string') return a.trim() === b.trim()
  if (typeof a === 'number' && typeof b === 'string') return String(a) === b.trim()
  if (typeof a === 'string' && typeof b === 'number') return a.trim() === String(b)
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => memeValeur(x, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const oa = a as Record<string, unknown>
    const ob = b as Record<string, unknown>
    return [...new Set([...Object.keys(oa), ...Object.keys(ob)])].every((k) => memeValeur(oa[k], ob[k]))
  }
  return a === b
}

/** Les clés de `envoye` dont la valeur diffère de `lu` (une clé absente de `lu` est une valeur absente). */
export function clesModifiees(envoye: Record<string, unknown>, lu: Record<string, unknown> | null): string[] {
  if (!lu) return Object.keys(envoye)
  return Object.keys(envoye).filter((k) => !memeValeur(envoye[k], lu[k]))
}

/**
 * Une liste (expériences, formations, langues) a-t-elle changé ? Chaque ligne est réduite aux clés que l'écran ENVOIE
 * (les colonnes techniques — identifiant, dates d'écriture, rang — ne comptent pas).
 *   · `ordonnee` (les EXPÉRIENCES : `sort_order`, l'ordre que les organisations voient) : la liste lue, triée par son
 *     rang, se compare ligne à ligne à la liste envoyée — un réordonnancement EST une modification (décision de Youssef,
 *     01/10/2026) ;
 *   · sinon (formations, langues : la base ne garde aucun ordre) : un ENSEMBLE de lignes.
 */
export function listeModifiee(
  lues: Array<Record<string, unknown>>,
  envoyees: Array<Record<string, unknown>>,
  ordonnee = false,
): boolean {
  if (lues.length !== envoyees.length) return true
  const cles = [...new Set(envoyees.flatMap((l) => Object.keys(l)))]
  const reduite = (l: Record<string, unknown>) => Object.fromEntries(cles.map((k) => [k, l[k]]))
  if (ordonnee) {
    const triees = [...lues].sort((x, y) => Number(x.sort_order ?? 0) - Number(y.sort_order ?? 0))
    return triees.some((l, i) => !memeValeur(reduite(l), reduite(envoyees[i])))
  }
  const restantes = lues.map(reduite)
  for (const e of envoyees.map(reduite)) {
    const i = restantes.findIndex((l) => memeValeur(l, e))
    if (i < 0) return true
    restantes.splice(i, 1)
  }
  return false
}

/**
 * Le regroupement par SÉANCE : un enregistrement qui ne touche que des champs déjà écrits par la ligne précédente
 * de la même séance n'en écrit pas une autre. `precedente` : les champs et blocs de la dernière ligne récente.
 */
export function dejaDitDansLaSeance(
  maintenant: { champs: string[]; blocs: string[] },
  precedente: { champs: string[]; blocs: string[] } | null,
): boolean {
  if (!precedente) return false
  return maintenant.champs.every((c) => precedente.champs.includes(c)) && maintenant.blocs.every((b) => precedente.blocs.includes(b))
}

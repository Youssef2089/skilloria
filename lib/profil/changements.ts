/**
 * lib/profil/changements.ts — CE QUI A VRAIMENT CHANGÉ (décision de Youssef, 01/10/2026, ARRÊT 22).
 *
 * « Profil modifié », « Nom modifié », « Fiche d'organisation modifiée », « Annonce modifiée »… s'écrivaient à chaque
 * enregistrement, MÊME SANS CHANGEMENT : un écran qui renvoie tout son formulaire listait tous ses champs. Ce module
 * compare la valeur ENVOYÉE à la valeur LUE avant l'écriture, et ne garde que ce qui diffère.
 *
 * LE DOUTE PENCHE VERS « MODIFIÉ » : deux valeurs que la normalisation ne sait pas rapprocher sont dites différentes —
 * au pire une ligne de trop, jamais une modification tue. Normalisé : `undefined`, `null` et la chaîne vide (après
 * rognage) sont une même absence ; un nombre et sa forme texte sont égaux ; un objet se compare clé par clé.
 *
 * Module PUR, sans import : le contrôle l'exécute tel quel.
 */

function normaliser(v: unknown): unknown {
  if (v === undefined || v === null) return null
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t)
    return t !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(t) ? n : t
  }
  if (Array.isArray(v)) return v.map(normaliser)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const sortie: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) {
      const n = normaliser(o[k])
      if (n !== null) sortie[k] = n
    }
    return sortie
  }
  return v
}

/** Deux valeurs sont-elles la même, une fois normalisées ? */
export function memeValeur(a: unknown, b: unknown): boolean {
  return JSON.stringify(normaliser(a)) === JSON.stringify(normaliser(b))
}

/** Les clés de `envoye` dont la valeur diffère de `lu` (une clé absente de `lu` est une valeur absente). */
export function clesModifiees(envoye: Record<string, unknown>, lu: Record<string, unknown> | null): string[] {
  if (!lu) return Object.keys(envoye)
  return Object.keys(envoye).filter((k) => !memeValeur(envoye[k], lu[k]))
}

/**
 * Une liste (expériences, formations, langues) a-t-elle changé ? Comparée comme un ENSEMBLE de lignes (un simple
 * réordonnancement n'est pas une modification), chaque ligne réduite aux clés que l'écran ENVOIE — les colonnes
 * techniques de la table (identifiant, dates d'écriture) ne comptent pas.
 */
export function listeModifiee(lues: Array<Record<string, unknown>>, envoyees: Array<Record<string, unknown>>): boolean {
  if (lues.length !== envoyees.length) return true
  const cles = [...new Set(envoyees.flatMap((l) => Object.keys(l)))]
  const forme = (l: Record<string, unknown>) =>
    JSON.stringify(normaliser(Object.fromEntries(cles.map((k) => [k, l[k]]))))
  const a = lues.map(forme).sort()
  const b = envoyees.map(forme).sort()
  return a.some((x, i) => x !== b[i])
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

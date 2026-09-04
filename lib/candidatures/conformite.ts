/**
 * CONFORMITÉ DES TEXTES PRODUITS PAR LE MODÈLE — et rien d'autre.
 *
 * POURQUOI CE FICHIER EST SÉPARÉ, ET SANS AUCUNE DÉPENDANCE
 *   Ces quatre fonctions sont les seules barrières entre un texte rédigé par un
 *   modèle et une organisation qui n'a pas encore payé pour voir l'identité du
 *   candidat. Elles doivent pouvoir être ÉPROUVÉES à l'exécution, sur des cas
 *   écrits, sans démarrer un client HTTP ni lire une clé d'API.
 *
 *   Tant qu'elles vivaient à côté de l'appel au modèle, le diagnostic ne pouvait
 *   pas les importer : le module tirait le SDK et le compteur de dépense avec
 *   lui. Un garde-fou qu'on ne peut pas éprouver n'est qu'une intention.
 *
 * CE QU'ELLES DÉFENDENT
 *   `pitch_org` est lu AVANT le déverrouillage payant : c'est le seul texte qui
 *   traverse le masquage. Un nom d'école, une année de diplôme, et le masquage
 *   est contourné — sans erreur, sans changement d'écran, sans que personne le
 *   sache.
 */

/**
 * Une année, 1900–2099. Sert DEUX FOIS, et c'est voulu : à expurger ce qui
 * entre, et à refuser ce qui sort.
 *
 * POURQUOI L'ANNÉE PLUTÔT QUE « TOUT NOMBRE » : « 12 personnes », « 300
 * serveurs » sont des faits utiles au jugement. Une année, elle, n'apporte rien
 * qu'une durée relative ne dise mieux — et c'est à la fois une donnée
 * identifiante et un discriminant d'âge.
 */
const ANNEE_SOURCE = '\\b(19|20)\\d{2}\\b'

/** Retire les années d'un texte libre sans le vider de son sens. */
export function expurgerAnnees(texte: string): string {
  return texte
    .replace(new RegExp(ANNEE_SOURCE, 'g'), '…')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Un texte contient-il une année ? Un texte produit qui en contient est REFUSÉ. */
export function contientUneAnnee(texte: string): boolean {
  return new RegExp(ANNEE_SOURCE).test(texte)
}

/**
 * Lecture STRICTE d'une note.
 *
 * `null` = le modèle n'a rien noté. L'appelant en fait un ÉCHEC, jamais une
 * valeur de repli : un 0 fabriqué serait un verdict que personne n'a rendu.
 */
export function lireNote(valeur: unknown): number | null {
  let brut: number
  if (typeof valeur === 'number') brut = valeur
  else if (typeof valeur === 'string' && valeur.trim().length > 0) brut = Number(valeur)
  else return null
  if (!Number.isFinite(brut)) return null
  return Math.max(0, Math.min(10, Math.round(brut)))
}

/** Bornes de rédaction : deux phrases, et un texte qui tient dans une carte. */
export const MAX_CARACTERES_TEXTE = 400

/** Un texte vide n'est pas un texte : mieux vaut se taire que rendre du vide. */
export function lireTexte(valeur: unknown, maxCaracteres = MAX_CARACTERES_TEXTE): string | null {
  if (typeof valeur !== 'string') return null
  const t = valeur.replace(/\s+/g, ' ').trim()
  if (t.length === 0) return null
  return t.length > maxCaracteres ? `${t.slice(0, maxCaracteres).trimEnd()}…` : t
}

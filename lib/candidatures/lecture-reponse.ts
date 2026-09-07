/**
 * LECTURE STRICTE DE LA RÉPONSE DU MODÈLE — et rien d'autre.
 *
 * ═══ OÙ VIT LA CONFORMITÉ, DEPUIS CE LOT ══════════════════════════════════
 *   DANS LE PROMPT DE RÉDACTION, et nulle part ailleurs. Ce fichier ne filtre
 *   plus rien de ce que le modèle écrit.
 *
 *   Il portait une barrière « année » : les années étaient expurgées du
 *   document ENVOYÉ, et un texte produit qui en contenait était refusé.
 *   L'intention était juste — une année de diplôme est une donnée identifiante
 *   autant qu'un discriminant d'âge — mais le contrôle était trop large, et son
 *   effet le plus grave n'était pas le refus.
 *
 *   SUR UNE PLACE DE MARCHÉ MICROSOFT, LES PRODUITS PORTENT DES ANNÉES.
 *   SQL Server 2019, Dynamics AX 2012, SharePoint 2016, Visual Studio 2022.
 *   L'expurgation d'entrée transformait « Expert Dynamics AX 2012 et SQL Server
 *   2019 » en « Expert Dynamics AX … et SQL Server … » : le modèle recevait un
 *   document amputé de sa précision technique AVANT même d'écrire. On effaçait
 *   la compétence en croyant protéger l'âge — et précisément sur les profils les
 *   plus pointus, ceux qui valent le déverrouillage.
 *
 *   La règle est donc redevenue une CONSIGNE, écrite en toutes lettres dans le
 *   prompt : ce qui est interdit, ce qui est explicitement autorisé (les noms de
 *   produits versionnés), et ce qui est exigé (des durées relatives).
 *
 * ═══ CE QUI RESTE ICI, ET POURQUOI CE N'EST PAS LA MÊME CHOSE ═════════════
 *   Deux lecteurs, pas deux filtres. Ils ne jugent PAS le contenu du texte : ils
 *   vérifient que le modèle a bien répondu quelque chose d'exploitable.
 *
 *     `lireNote`  — une note absente rend `null`, jamais 0. Un 0 fabriqué serait
 *                   un verdict que personne n'a rendu, et il pèserait sur le
 *                   dévoilement inclus, qui départage à la note.
 *     `lireTexte` — une chaîne vide rend `null`, jamais "". Mieux vaut se taire
 *                   que rendre du vide, et un texte trop long est borné à ce que
 *                   la carte peut afficher.
 *
 *   Ils restent sans AUCUNE dépendance : c'est ce qui les rend éprouvables à
 *   l'exécution, hors de tout client HTTP. Un lecteur qu'on ne peut pas
 *   éprouver n'est qu'une intention.
 */

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

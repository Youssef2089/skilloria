/**
 * lib/matching/lecture-paginee.ts — LIRE TOUT, ET SAVOIR QU'ON A TOUT LU.
 *
 * ═══ LE DÉFAUT QU'ON FERME, ET C'ÉTAIT UNE RÉGRESSION ═════════════════════
 *   La pagination du vivier enchaînait des `.range()` sur une requête SANS
 *   `.order()`. PostgreSQL ne garantit AUCUN ordre stable entre deux requêtes :
 *   entre la page 1 et la page 2, le planificateur peut rendre les lignes dans
 *   un ordre différent. Certaines apparaissent alors DEUX FOIS, d'autres
 *   JAMAIS — et un expert disparaît du vivier sans erreur ni trace.
 *
 *   Le plafond invisible qu'on venait de supprimer revenait donc par la porte
 *   de sa propre correction.
 *
 * ═══ ET LA GARDE NE LE VOYAIT PAS ═════════════════════════════════════════
 *   La confrontation « lu vs attendu » comparait des LIGNES. Quand les doublons
 *   comblent exactement le compte — ce qui est le cas ordinaire, puisque chaque
 *   ligne vue deux fois remplace une ligne jamais vue — `lignes.length` égale
 *   `attendu` et aucune divergence n'est détectée. Le dédoublonnage en aval les
 *   absorbait ensuite en silence.
 *
 *   Une garde qui compte la mauvaise chose est pire qu'une absence de garde :
 *   elle rassure.
 *
 * ═══ LES DEUX RÈGLES, ET AUCUNE N'EST LAISSÉE À L'APPELANT ════════════════
 *   1. UN ORDRE TOTAL ET STABLE. Ce module applique lui-même un tri final sur
 *      une colonne UNIQUE. Trier sur une colonne non unique ne suffit pas : à
 *      valeurs égales, l'ordre reste indéterminé, et le défaut revient sur les
 *      ex æquo. C'est pourquoi la colonne de départage est un paramètre
 *      OBLIGATOIRE et non une option qu'on peut oublier.
 *   2. ON COMPTE CE QUI COMPTE. La confrontation porte sur le nombre
 *      d'ENTITÉS DISTINCTES lues, pas sur le nombre de lignes.
 */

/** Une page de lecture. Assez grande pour peu d'allers-retours, assez petite pour ne rien tronquer. */
export const TAILLE_PAGE = 1000

export type LectureComplete<T> = {
  /** Les lignes, dédoublonnées sur `identite`. */
  lignes: T[]
  /** Ce que la base annonce, ou `null` si le comptage n'a rien rendu. */
  attendu: number | null
  /** Entités distinctes réellement lues — c'est CE nombre qu'on confronte. */
  distincts: number
  /** Lignes rendues deux fois par la pagination. Non nul ⇒ l'ordre n'est pas total. */
  doublons: number
  erreur?: string
}

type Requete = {
  order: (colonne: string, options: { ascending: boolean }) => Requete
  range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
}

/**
 * Lit TOUTES les lignes d'une requête, page par page, jusqu'à épuisement.
 *
 * `construire` doit rendre la requête SANS `range` ni tri de départage : le tri
 * final est appliqué ici, pour qu'aucun appelant ne puisse l'omettre. Un tri
 * métier posé par l'appelant (une date décroissante, par exemple) est conservé —
 * le départage unique s'ajoute APRÈS lui, et ne le contredit donc jamais.
 */
export async function lireToutesLesLignes<T>(args: {
  construire: (options?: { count?: 'exact'; head?: boolean }) => PromiseLike<{
    data: unknown[] | null
    error: { message: string } | null
    count?: number | null
  }>
  /** Colonne UNIQUE de départage. Sans elle, la pagination n'est pas stable. */
  departageUnique: string
  /** Identité d'une ligne — sert au dédoublonnage ET au décompte des distincts. */
  identite: (ligne: T) => string
  contexte: string
}): Promise<LectureComplete<T>> {
  const { construire, departageUnique, identite, contexte } = args

  const comptage = await construire({ count: 'exact', head: true })
  if (comptage.error) {
    return { lignes: [], attendu: null, distincts: 0, doublons: 0, erreur: `${contexte} : ${comptage.error.message}` }
  }
  const attendu = typeof comptage.count === 'number' ? comptage.count : null

  const vues = new Set<string>()
  const lignes: T[] = []
  let doublons = 0

  for (let debut = 0; ; debut += TAILLE_PAGE) {
    // LE TRI EST POSÉ ICI, PAS CHEZ L'APPELANT. Une pagination sans ordre total
    // rend des lignes deux fois et en oublie d'autres, sans lever la moindre
    // erreur.
    const q = (construire() as unknown as Requete).order(departageUnique, { ascending: true })
    const { data, error } = await q.range(debut, debut + TAILLE_PAGE - 1)
    if (error) {
      return { lignes, attendu, distincts: vues.size, doublons, erreur: `${contexte} : ${error.message}` }
    }
    const page = (data ?? []) as T[]
    for (const l of page) {
      const cle = identite(l)
      if (vues.has(cle)) {
        doublons++
        continue
      }
      vues.add(cle)
      lignes.push(l)
    }
    // Une page incomplète est la fin : il n'y a rien après.
    if (page.length < TAILLE_PAGE) break
    // Garde-fou de boucle : on ne tourne jamais au-delà de ce qui est annoncé.
    if (attendu !== null && debut + TAILLE_PAGE >= attendu) break
  }

  return { lignes, attendu, distincts: vues.size, doublons }
}

/**
 * La lecture a-t-elle couvert tout le périmètre ?
 *
 * ON COMPARE LES DISTINCTS, JAMAIS LES LIGNES. C'est tout l'objet du correctif :
 * des doublons qui comblent le compte rendaient l'ancienne comparaison
 * silencieuse au moment précis où elle devait parler.
 */
export function lectureIncomplete<T>(l: LectureComplete<T>): boolean {
  return l.attendu !== null && l.distincts !== l.attendu
}

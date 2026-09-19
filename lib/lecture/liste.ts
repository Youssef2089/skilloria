/**
 * UNE LISTE QU'ON N'A PAS PU LIRE N'EST PAS UNE LISTE VIDE.
 *
 * ┌─ LA FORME QUI MANQUAIT À §E.22, ET ELLE EST PIRE QUE LES NEUF ──────────┐
 * │ Les neuf cas du lot 1.3 s'arrêtaient tous à une LECTURE : un refus, un   │
 * │ message, un compteur. Aucun ne finissait sur une ÉCRITURE.               │
 * │                                                                          │
 * │ Les deux écrans de validation de profil chargeaient expériences,         │
 * │ formations et langues par `(res.data ?? [])`. Une lecture en panne       │
 * │ rendait donc un FORMULAIRE VIDE — et le formulaire, enregistré, part en  │
 * │ `PATCH /api/profile` avec `experiences: []`, que la route applique par   │
 * │ un `delete().eq('profile_id', …)`.                                       │
 * │                                                                          │
 * │ L'expert lisait « Brouillon enregistré » à la seconde exacte où sa       │
 * │ carrière entière était effacée. LA PANNE NE MENTAIT PLUS : ELLE DEVENAIT │
 * │ LA VÉRITÉ.                                                               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ MÊME VOCABULAIRE QUE `etatRepartition` — PAS UN QUATRIÈME DIALECTE ═══
 *   Le discriminant s'appelle `etat`, et `'indisponible'` y veut dire la même
 *   chose qu'ailleurs : **la lecture a échoué, on ne sait pas**. C'est déjà le
 *   mot de `lib/matching/etat-repartition.ts` et celui de `expertProfileGate`.
 *   Une classe de défaut se ferme par un TYPE qui traverse les couches ; trois
 *   noms pour la même idée rouvriraient la confusion qu'ils ferment.
 *
 *   Deux états suffisent ici, là où la répartition en demandait trois : pour
 *   une liste, « lue et vide » est un état parfaitement représentable
 *   (`{ etat: 'disponible', lignes: [] }`). La répartition avait besoin d'un
 *   troisième état parce que son SQL ne savait pas les distinguer.
 *
 * ═══ CE QUE LE TYPE FORCE, ET QUE LA VIGILANCE NE FORÇAIT PAS ════════════
 *   `lignes` n'existe QUE dans la branche `'disponible'`. Il n'y a donc aucun
 *   moyen d'écrire `(res.data ?? [])` : le compilateur exige d'avoir répondu à
 *   l'autre branche avant de pouvoir toucher aux lignes.
 */

/** Ce que rend une requête Supabase : `data` peut être nul, `error` aussi. */
export type ResultatSupabase<T> = { data: T[] | null; error: unknown }

export type ListeLue<T> =
  /** La lecture a ÉCHOUÉ. On ne sait pas ce qu'il y a. C'est un PROBLÈME. */
  | { etat: 'indisponible' }
  /** La lecture a RÉUSSI. `lignes` peut être vide — et le vide est alors un FAIT. */
  | { etat: 'disponible'; lignes: T[] }

/**
 * Convertit un résultat Supabase en état nommé.
 *
 * ⚠️ `error` NON NUL ⇒ `indisponible`, même si `data` porte des lignes.
 *    PostgREST peut rendre les deux ; une réponse partielle n'est pas une
 *    réponse, et la traiter comme telle est exactement le défaut fermé ici.
 */
export function listeLue<T>(res: ResultatSupabase<T>): ListeLue<T> {
  if (res.error) return { etat: 'indisponible' }
  return { etat: 'disponible', lignes: res.data ?? [] }
}

/**
 * Les lignes, ou un repli EXPLICITE pour un affichage qui ne décide de rien.
 *
 * ⚠️ N'UTILISER QUE LÀ OÙ LA VALEUR NE PART PAS EN ÉCRITURE, et où l'écran
 *    annonce la panne par ailleurs. Ce helper existe pour que le repli soit
 *    ÉCRIT et cherchable (`lignesOuVide`), et non caché dans un `?? []` que
 *    personne ne relit. Un `grep` sur son nom donne la liste exacte des
 *    endroits où l'on a accepté de ne pas savoir.
 */
export function lignesOuVide<T>(lue: ListeLue<T>): T[] {
  return lue.etat === 'disponible' ? lue.lignes : []
}

/**
 * LES CLÉS DE LISTE QUE `PATCH /api/profile` SAIT REMPLACER.
 *
 * Liste BORNÉE et partagée entre le client et la route — même parti pris que
 * `SUJETS` dans `lib/jugement/sujets.ts` : les valeurs possibles sont closes,
 * et la borne est IDENTIQUE des deux côtés. Une clé ajoutée d'un seul côté
 * serait silencieusement ignorée par l'autre.
 */
export const LISTES_DE_PROFIL = ['experiences', 'educations', 'languages_structured'] as const
export type ListeDeProfil = (typeof LISTES_DE_PROFIL)[number]

export function estListeDeProfil(v: unknown): v is ListeDeProfil {
  return typeof v === 'string' && (LISTES_DE_PROFIL as readonly string[]).includes(v)
}

import type { SupabaseClient } from '@supabase/supabase-js'
// lib/taxonomie/specialite-autre.ts
//
// « AUTRE » EST UNE SEULE NOTION — À L'INSCRIPTION, À LA VALIDATION, DANS UNE ANNONCE ET EN BASE
// (recette staging du 01/10/2026, point 1).
//
// LE DÉFAUT : l'écran de validation montrait DEUX boutons « Autre ». L'un était l'option de
// l'écran, « Autre (préciser) », qui range sa précision dans `speciality_other` ; l'autre était
// une LIGNE du référentiel — la spécialité « Autre » semée dans la branche Business
// Applications (`parametrage_de_production`), servie par /api/taxonomy comme n'importe quelle
// spécialité, sans champ de précision. Deux notions, deux comportements, et le même mot.
//
// LA RÈGLE :
//   · « Autre » n'est JAMAIS une ligne du référentiel : la migration
//     `specialite_autre_hors_referentiel` retire les lignes existantes et une contrainte refuse
//     qu'une spécialité active s'appelle « Autre » (le refus porte le code
//     `specialite_autre_reservee` dans l'administration) ;
//   · « Autre » est cette option d'écran, et elle seule — une sentinelle, ici, que les quatre
//     écrans importent au lieu d'en recopier une chacun (§E.20) ;
//   · en base, « Autre » est `speciality_other` : une précision non vide.

/** La valeur de l'option « Autre (préciser) » dans une liste de spécialités. Jamais un identifiant. */
export const SPECIALITY_OTHER = '__other__'

/** Le nom de la contrainte qui refuse une spécialité active « Autre » (migration specialite_autre_hors_referentiel). */
export const CONTRAINTE_AUTRE = 'specialities_autre_hors_referentiel'

/**
 * Le refus de la base est-il CELUI-LÀ ? Une écriture refusée par la contrainte « Autre » se
 * rend sous `specialite_autre_reservee` (400), jamais sous `db_error` (500) : ce n'est pas une
 * panne, c'est une règle, et l'administrateur peut la lire.
 */
export function estRefusAutre(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!err && err.code === '23514' && typeof err.message === 'string' && err.message.includes(CONTRAINTE_AUTRE)
}

/**
 * CE NOM (OU CETTE TRADUCTION) EST-IL « AUTRE » ? — la base le DIT (`est_specialite_autre`, une seule définition, en
 * quatre langues) ; l'administration le DEMANDE AVANT d'écrire un nom, un slug ou une traduction (relecture du
 * 01/10/2026, point 11 : une traduction « Other » ou « Otra » passait, et les deux « Autre » revenaient dans cette
 * langue ; les traductions s'écrivaient APRÈS la spécialité et leur refus n'était que journalisé). Une lecture en panne
 * n'est pas un « non » (§E.22) : elle se dit.
 */
export async function contientAutre(
  admin: SupabaseClient,
  noms: Array<string | null | undefined>,
  slug?: string | null,
): Promise<'autre' | 'non' | 'illisible'> {
  const aDemander = [...noms.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => ({ nom: n, slug: null as string | null })),
    ...(slug ? [{ nom: null as string | null, slug }] : [])]
  for (const q of aDemander) {
    const { data, error } = await admin.rpc('est_specialite_autre', { p_nom: q.nom, p_slug: q.slug })
    if (error) {
      console.error('[taxonomie] est_specialite_autre illisible', error.message)
      return 'illisible'
    }
    if (data === true) return 'autre'
  }
  return 'non'
}

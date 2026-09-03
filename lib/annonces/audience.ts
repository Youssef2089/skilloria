import type { AnnonceType } from '@/types/annonce'

/**
 * QUI UNE ANNONCE VISE — le catalogue des types d'annonce et leur public.
 *
 * POURQUOI CE FICHIER EXISTE, ET POURQUOI IL N'EST PAS DANS lib/matching
 *   Le moteur de mise en relation n'a pas à connaître le catalogue des types
 *   d'annonce. Il a besoin d'UNE réponse — « quel type d'expert cette annonce
 *   vise-t-elle ? » — pas de la liste des types ni de leurs particularités.
 *
 *   Tant que la connaissance vivait dans le moteur, chaque ajout de type
 *   d'annonce obligeait à rouvrir le moteur, et le nom d'un type se retrouvait
 *   dispersé dans des fichiers qui n'avaient aucune raison de le porter. C'est
 *   exactement ce qui rendait un moteur illisible : il savait trop de choses.
 *
 *   Une seule écriture, plusieurs lecteurs. Un type d'annonce ajouté se déclare
 *   ICI, et nulle part ailleurs.
 */

export type ExpertKind = 'expert_freelance' | 'expert_cdi'

/**
 * Le public NATIF de chaque type d'annonce.
 *
 * `sous_traitance` vise des freelances : c'est du travail freelance proposé
 * entre pairs, pas un contrat salarié. Ce n'est donc PAS un croisement de type
 * — c'est un type freelance à part entière, et le confondre avec un croisement
 * ferait demander un consentement d'ouverture à des gens qui n'ont rien à
 * ouvrir.
 */
const PUBLIC_NATIF: Readonly<Record<AnnonceType, ExpertKind>> = {
  mission: 'expert_freelance',
  sous_traitance: 'expert_freelance',
  offre: 'expert_cdi',
}

const TOUS_LES_TYPES = Object.keys(PUBLIC_NATIF) as AnnonceType[]

/**
 * Ce texte est-il un type d'annonce connu ?
 *
 * Vit ICI et nulle part ailleurs : une liste de types recopiée dans un lecteur
 * finit toujours par oublier le type ajouté ensuite, et le lecteur retombe
 * silencieusement sur une valeur par défaut.
 */
export function estTypeAnnonce(v: string | null | undefined): v is AnnonceType {
  return !!v && Object.prototype.hasOwnProperty.call(PUBLIC_NATIF, v)
}

/** Le type d'expert visé nativement par une annonce. */
export function expertKindForAnnonce(type: AnnonceType): ExpertKind {
  return PUBLIC_NATIF[type] ?? 'expert_freelance'
}

/** Les types d'annonce qui visent nativement un type d'expert. */
export function nativeAnnonceTypesFor(kind: ExpertKind): AnnonceType[] {
  return TOUS_LES_TYPES.filter((t) => PUBLIC_NATIF[t] === kind)
}

/**
 * Les types qu'un expert doit voir : les siens, plus ceux de l'autre public
 * s'il a EXPLICITEMENT ouvert.
 *
 * L'ouverture croisée est déclarée par l'expert lui-même (open_to_cdi /
 * open_to_freelance). C'est un critère déclaré, donc un filtre légitime.
 */
export function annonceTypesForExpert(kind: ExpertKind, ouvertureCroisee: boolean): AnnonceType[] {
  if (!ouvertureCroisee) return nativeAnnonceTypesFor(kind)
  return [...TOUS_LES_TYPES]
}

/** Cette annonce sort-elle du public natif de cet expert ? */
export function isCrossAudience(type: AnnonceType, kind: ExpertKind): boolean {
  return expertKindForAnnonce(type) !== kind
}

/**
 * Une annonce peut-elle viser son propre auteur ?
 *
 * Un expert qui publie un besoin de sous-traitance ne doit pas se retrouver
 * dans son propre vivier. Ce n'est pas une règle de moteur : c'est une propriété
 * du type d'annonce — seuls les types qu'un expert peut publier lui-même sont
 * concernés — et elle se déclare donc ici.
 */
export function peutViserSonAuteur(type: AnnonceType): boolean {
  return type !== 'sous_traitance'
}

/**
 * L'unité de budget d'un type d'annonce : un salaire annuel ou un tarif
 * journalier. Vit ici pour la même raison que le reste — c'est une propriété du
 * type, pas du lecteur.
 */
export function budgetUnitForAnnonce(type: AnnonceType): 'day' | 'year' {
  return expertKindForAnnonce(type) === 'expert_cdi' ? 'year' : 'day'
}

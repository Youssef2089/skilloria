/**
 * CE QUE LE RERANKER LIT — la requête et les documents.
 *
 * Un reranker compare un TEXTE de requête à des TEXTES de documents. Ce fichier
 * est le seul endroit qui décide ce que ces textes contiennent : c'est donc lui
 * qui décide, en pratique, sur quoi la pertinence est jugée.
 *
 * TROIS RÈGLES, ET ELLES SONT DES DÉCISIONS PRODUIT
 *
 *  1. AUCUNE DONNÉE NOMINATIVE. Ni nom, ni e-mail, ni téléphone, ni adresse, ni
 *     employeur. Le texte part chez un tiers : ce qui n'a pas à sortir ne sort
 *     pas. Ce n'est pas une précaution, c'est la frontière.
 *
 *  2. AUCUN CRITÈRE DÉJÀ FILTRÉ EN SQL. Branche, spécialités, séniorités, zones
 *     et disponibilité ont déjà écarté qui devait l'être, sur des faits
 *     déclarés. Les réécrire dans le texte reviendrait à les faire juger une
 *     seconde fois, en pertinence cette fois — et un expert pourrait être
 *     déclassé sur un critère qu'il remplit pourtant. Le reranker juge ce que
 *     les filtres ne savent pas juger : le FOND.
 *
 *  3. UNE LONGUEUR BORNÉE, ET LA COUPE SE VOIT. Un document tronqué au milieu
 *     d'une phrase donne un score plus bas sans que personne ne sache pourquoi.
 *     On coupe donc sur des unités entières (une compétence, une expérience),
 *     jamais au caractère près, et le résumé — le texte que l'expert a écrit
 *     pour être lu — n'est jamais tronqué : ses bornes 200–800 sont justement
 *     là pour qu'il tienne.
 */

const MAX_COMPETENCES = 25
const MAX_EXPERIENCES = 6
const MAX_CARACTERES_EXPERIENCE = 300

/** Ce que le reranker reçoit pour un expert. Volontairement plat et non nominatif. */
export type ExpertDocumentInput = {
  title: string | null
  summary: string | null
  skills: readonly string[] | null
  certifications_count: number
  years_total_experience: number | null
  /** Rôles et descriptions, sans employeur ni client. */
  experiences: ReadonlyArray<{ role: string | null; sector: string | null; description: string | null }>
}

/** Ce que le reranker reçoit pour une annonce. */
export type AnnonceQueryInput = {
  title: string | null
  description: string | null
  skills_required: readonly string[] | null
}

const propre = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim()

/** Coupe sur une unité entière, et signale la coupe plutôt que de la cacher. */
function borner(texte: string, max: number): string {
  const t = propre(texte)
  if (t.length <= max) return t
  const coupe = t.slice(0, max)
  const dernierEspace = coupe.lastIndexOf(' ')
  return `${(dernierEspace > max * 0.6 ? coupe.slice(0, dernierEspace) : coupe).trimEnd()}…`
}

/**
 * Le document d'un expert.
 *
 * Le résumé vient EN PREMIER : c'est le texte que l'expert a écrit pour être
 * lu, et c'est celui dont les bornes 200–800 lui ont été annoncées. Le mettre
 * ailleurs ferait mentir la consigne affichée dans le formulaire.
 */
export function buildExpertDocument(p: ExpertDocumentInput): string {
  const morceaux: string[] = []

  const titre = propre(p.title)
  if (titre) morceaux.push(titre)

  const resume = propre(p.summary)
  if (resume) morceaux.push(resume)

  const competences = (p.skills ?? []).map(propre).filter(Boolean).slice(0, MAX_COMPETENCES)
  if (competences.length > 0) morceaux.push(`Compétences : ${competences.join(', ')}.`)

  if (p.years_total_experience != null && p.years_total_experience > 0) {
    morceaux.push(`Expérience totale : ${p.years_total_experience} an(s).`)
  }
  if (p.certifications_count > 0) {
    morceaux.push(`Certifications : ${p.certifications_count}.`)
  }

  const experiences = p.experiences
    .map((e) => {
      const role = propre(e.role)
      const secteur = propre(e.sector)
      const description = borner(propre(e.description), MAX_CARACTERES_EXPERIENCE)
      // L'EMPLOYEUR N'Y EST PAS, et ce n'est pas un oubli : c'est une donnée
      // nominative d'un tiers, et elle ne dit rien de ce que la personne sait
      // faire.
      const entete = [role, secteur].filter(Boolean).join(' — ')
      return [entete, description].filter(Boolean).join(' : ')
    })
    .filter(Boolean)
    .slice(0, MAX_EXPERIENCES)
  if (experiences.length > 0) morceaux.push(`Parcours : ${experiences.join(' | ')}`)

  return morceaux.join('\n')
}

/**
 * La requête d'une annonce.
 *
 * Ni budget, ni durée, ni mode de travail, ni zone : ce sont des critères de
 * compatibilité, pas de fond, et les faire peser sur un score de pertinence
 * déclasserait un expert compétent pour un tarif — un jugement que rien
 * n'autorise ici.
 */
export function buildAnnonceQuery(a: AnnonceQueryInput): string {
  const morceaux: string[] = []
  const titre = propre(a.title)
  if (titre) morceaux.push(titre)
  const description = propre(a.description)
  if (description) morceaux.push(description)
  const competences = (a.skills_required ?? []).map(propre).filter(Boolean).slice(0, MAX_COMPETENCES)
  if (competences.length > 0) morceaux.push(`Compétences attendues : ${competences.join(', ')}.`)
  return morceaux.join('\n')
}

/** Un document vide ne peut pas être noté : le dire vaut mieux que rendre 0. */
export const documentUtilisable = (texte: string): boolean => propre(texte).length >= 20

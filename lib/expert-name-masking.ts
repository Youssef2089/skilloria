import type { Locale } from '@/i18n/routing'
import fr from '@/messages/fr.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import de from '@/messages/de.json'
// Calcul PUR du code, isolé dans un module SANS AUCUN IMPORT pour être
// exécutable tel quel par scripts/diag-expert-name-masking.mjs. Ce fichier-ci
// n'ajoute que ce qui dépend de l'extérieur : les libellés de repli traduits.
import { expertNameCode } from '@/lib/expert-name-code'

/**
 * lib/expert-name-masking.ts — masquage de l'identité expert pour l'ORG.
 *
 * Règle métier : côté entreprise, l'expert est affiché sous forme d'un CODE de
 * trois lettres majuscules — PREMIÈRE LETTRE DU PRÉNOM + DEUX PREMIÈRES
 * LETTRES DU NOM, sans espace ni point.
 *
 *   "Youssef Cherif"   → "YCH"
 *   "Sonia Idrissi"    → "SID"
 *   "Jean-Pierre D'Amico" → "JDA"   (séparateurs sautés, jamais comptés)
 *   "Youssef O"        → "YO"       (jusqu'à 2 lettres, on ne complète pas)
 *   "Youssef" (sans nom) → "YOU"    (cf. asymétrie ci-dessous)
 *   "Cherif" (sans prénom) → "CH"
 *   "" / null          → repli traduit ("Expert", "Experto", …)
 *
 * ASYMÉTRIE VOULUE entre prénom manquant et nom manquant :
 *   - nom absent    → 3 lettres du PRÉNOM. Un code d'une seule lettre n'est pas
 *     un identifiant, et l'ancienne règle divulguait ici le prénom ENTIER : la
 *     nouvelle resserre.
 *   - prénom absent → 2 lettres du NOM seulement. Le patronyme est la partie
 *     identifiante : on n'en donne JAMAIS plus de deux lettres, quel que soit
 *     le cas de figure.
 *
 * Helper UNIQUE, appelé côté serveur AVANT envoi au client. Le navigateur de
 * l'entreprise ne doit JAMAIS recevoir le nom complet de l'expert. Le format
 * « code de trois majuscules » est un signal de pseudonymisation : il ne peut
 * pas être confondu avec un vrai nom, contrairement à l'ancienne forme
 * « Prénom + lettre » qui ressemblait à une identité tronquée.
 *
 * Ne pas appeler côté EXPERT (self) ni côté ADMIN (modération). Ces deux vues
 * passent par des routes/SELECT distincts et voient les vrais noms.
 */

// ── Libellés de repli, TRADUITS ─────────────────────────────────────────────
// Ils étaient en dur en français et servis tels quels à une organisation en
// anglais, espagnol ou allemand. Motif repris de lib/notifications/inapp-labels.ts :
// lecture directe des JSON, car on est hors arbre React (pas de next-intl runtime).
type MaskingLabels = { fallback: string; deleted: string; unavailable: string }
const MESSAGES: Record<Locale, { expert_masking: MaskingLabels }> = {
  fr: fr as unknown as { expert_masking: MaskingLabels },
  en: en as unknown as { expert_masking: MaskingLabels },
  es: es as unknown as { expert_masking: MaskingLabels },
  de: de as unknown as { expert_masking: MaskingLabels },
}

function labelsFor(locale: string | null | undefined): MaskingLabels {
  const l: Locale =
    locale === 'fr' || locale === 'en' || locale === 'es' || locale === 'de' ? locale : 'fr'
  return MESSAGES[l].expert_masking
}

/**
 * État du cycle de vie suppression de l'expert (mission S3). Quand il est
 * fourni et non-actif, le nom est REMPLACÉ par un libellé côté ORG :
 *   - anonymized_at posé (purgé)         → « Utilisateur supprimé »
 *   - deletion_scheduled_at posé (grâce) → « Interlocuteur indisponible »
 * Sinon comportement inchangé (code à trois lettres). Garde-fou C : ces
 * libellés vivent UNIQUEMENT ici, jamais dans les pages org.
 */
export type ExpertAccountState = {
  deletion_scheduled_at?: string | null
  anonymized_at?: string | null
}

export function maskExpertNameForOrg(
  first_name: string | null | undefined,
  last_name: string | null | undefined,
  state?: ExpertAccountState | null,
  /** Langue du LECTEUR (le membre de l'organisation), pour les libellés de
   *  repli. Absente ⇒ français, le défaut du projet. */
  locale?: string | null,
): string {
  const labels = labelsFor(locale)

  if (state?.anonymized_at) return labels.deleted
  if (state?.deletion_scheduled_at) return labels.unavailable

  // `null` = ni le prénom ni le nom ne contient une lettre exploitable. On ne
  // sert JAMAIS de chaîne vide : une pastille vide est un défaut visible.
  return expertNameCode(first_name, last_name) ?? labels.fallback
}

/**
 * `true` si `maskExpertNameForOrg` renverrait un code masqué plutôt qu'une
 * identité lisible. SERVI PAR LE SERVEUR aux surfaces qui affichent une
 * pastille d'avatar : sans ce drapeau, le client devrait deviner au motif de
 * la chaîne (« trois majuscules ? »), c'est-à-dire reconstruire une règle de
 * sécurité dans le navigateur — précisément ce que le point 20 interdit.
 *
 * Les libellés de suppression ne sont PAS des codes : ce sont des phrases,
 * dont la première lettre fait une initiale correcte.
 */
export function isMaskedExpertName(state?: ExpertAccountState | null): boolean {
  return !state?.anonymized_at && !state?.deletion_scheduled_at
}

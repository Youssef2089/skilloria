// lib/domain-config.ts
//
// LA CONFIGURATION D'UN ÉCOSYSTÈME, TELLE QUE LE NAVIGATEUR LA REÇOIT.
//
// ⚠️ CE FICHIER NE PORTE PLUS AUCUNE COULEUR, et c'est le changement du lot
//    « palette unique » (21/09/2026). Il en portait quatre, plus deux dans des
//    commentaires — dont un qui MENTAIT : il annonçait un accent dérivé à
//    « ~#085F87, 7:1 », quand la fonction produit #085A7F ; la valeur écrite
//    valait 6,78, sous la cible de 7 que la fonction impose elle-même.
//    Les valeurs vivent désormais dans `lib/palette.ts`, le calcul dans
//    `lib/couleur.ts`, et il n'y a plus qu'un seul endroit où se tromper.
//
// Ce qui reste ici : le TYPE que reçoit le client, et le repli de secours.

import { accentStrong, accentTint, contrastRatio, deriveAccentColor } from './couleur'
import { PALETTE_REFERENCE, resolvePalette, type Palette } from './palette'

// Réexportés pour les appelants historiques : le calcul a déménagé dans
// `lib/couleur.ts`, son adresse publique reste celle-ci le temps que les
// appelants suivent. Un jumeau serait de recopier les fonctions (§E.20) ;
// une réexportation n'en est pas un — il n'y a toujours qu'une implémentation.
export { contrastRatio, accentTint, accentStrong }

export type DomainConfig = {
  id: string
  subdomain: string
  name: string
  ecosystemName: string
  tagline: string
  primaryColor: string
  /**
   * ⚠️ NE GOUVERNE PLUS RIEN. Elle colorait la seconde moitié de trois dégradés
   * de barre de progression, dans les deux tableaux de bord experts ; ces trois
   * dégradés sont devenus des aplats de la couleur « boutons » au lot palette.
   * La colonne `domain_configs.secondary_color` reste en base et n'est plus
   * lue par aucune ligne de `app/`, `lib/` ou `components/` — documentée comme
   * telle dans architecture §B.2 ⑨ plutôt que retirée : retirer une colonne
   * que des chaînes citent est la classe §E.1, et c'est un lot à soi seul.
   */
  secondaryColor: string
  /** Rôle « boutons » de la palette. Alias conservé pour les appelants. */
  accentColor: string
  /** LA PALETTE RÉSOLUE de cet écosystème. Source unique : lib/palette.ts. */
  palette: Palette
  logoUrl: string | null
  faviconUrl: string | null
  isActive: boolean
  tags: string[]
  ecosystemTerms: {
    expertLabel: string
    communityLabel: string
    specialityLabel: string
    domainSearchLabel: string
  }
  featuredProducts: Array<{ label: string; icon: string }>
}

/**
 * Résout le rôle « boutons » : override de marque s'il existe, dérivation
 * sinon. Appelée exclusivement au serveur — le client reçoit une valeur déjà
 * calculée et ne décide de rien (§E.15).
 */
export function resolveAccentColor(
  primaryColor: string,
  accentOverride?: string | null,
  background: string = PALETTE_REFERENCE.fond_page,
): string {
  const override = typeof accentOverride === 'string' && accentOverride.trim()
    ? accentOverride.trim()
    : null
  if (override && /^#[0-9a-fA-F]{6}$/.test(override)) return override
  return deriveAccentColor(primaryColor, background, PALETTE_REFERENCE.texte_principal)
}

/**
 * ⚠️ REPLI DE SECOURS — PAS une configuration par défaut à enrichir.
 *
 * Servi UNIQUEMENT quand le domaine est IRRÉSOLVABLE : base injoignable, ou
 * sous-domaine inconnu. Sur une plateforme MULTI-ÉCOSYSTÈME, y mettre le
 * moindre nom d'écosystème ou de produit ferait afficher le MAUVAIS écosystème
 * à l'utilisateur d'un autre (du Microsoft sur sap.skilloria.io pendant une
 * panne de base).
 *
 * → Volontairement NEUTRE : marque ombrelle « Skilloria », aucun nom
 *   d'écosystème, aucun produit. Cohérent avec `handle_new_user` durci, qui
 *   fait échouer proprement une inscription venue d'un domaine irrésolvable
 *   plutôt que de la rattacher au mauvais écosystème.
 *
 * ❌ NE PAS y remettre de produits ni de noms d'écosystème (Azure, SAP…).
 *    La vraie configuration vit en base (`domains` + `domain_configs`).
 *
 * Sa PALETTE, en revanche, est celle de la référence : un écran servi pendant
 * une panne doit rester lisible, et la référence est la palette du produit.
 */
export const defaultDomainConfig: DomainConfig = {
  id: 'default',
  // Slug NEUTRE (pas 'microsoft') : sur un domaine irrésolvable, une
  // inscription enverrait domain_slug='default' → le trigger durci refuse
  // proprement au lieu de rattacher silencieusement au mauvais écosystème.
  subdomain: 'default',
  name: 'Skilloria',
  ecosystemName: 'Skilloria',
  tagline: '',
  primaryColor: PALETTE_REFERENCE.marque,
  // Inerte (cf. le commentaire du type). Aligné sur la marque plutôt que sur
  // une teinte propre : une valeur que rien ne lit n'a pas à être distincte.
  secondaryColor: PALETTE_REFERENCE.marque,
  accentColor: resolveAccentColor(PALETTE_REFERENCE.marque),
  palette: resolvePalette(null),
  logoUrl: null,
  faviconUrl: null,
  isActive: true,
  tags: [],
  // ⚠️ `ecosystemTerms` n'est consommé nulle part (aucune lecture dans app/,
  //    components/ ou lib/ — vérifié). Neutralisé par principe ; à supprimer
  //    lors d'un prochain nettoyage du type, ou laissé inerte.
  ecosystemTerms: {
    expertLabel: 'experts certifiés',
    communityLabel: 'la communauté',
    specialityLabel: 'Spécialité principale',
    domainSearchLabel: 'Domaine recherché',
  },
  featuredProducts: [],
}

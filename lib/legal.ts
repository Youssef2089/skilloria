// ─────────────────────────────────────────────────────────────────────────────
// SOCLE LÉGAL — constantes partagées (version des CGU + chemins des pages).
//
// SOURCE DE VÉRITÉ UNIQUE. Réutilisé partout (routes d'inscription serveur,
// libellés client, liens du pied de page). Ne JAMAIS dupliquer ces valeurs.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Version des CGU actuellement en vigueur, stockée comme PREUVE à l'acceptation
 * (users.cgu_version). Posée EXCLUSIVEMENT côté serveur — jamais une valeur
 * transmise par le client.
 *
 * ⚠ LIEN AVEC LES TEXTES PUBLIÉS — À TENIR À JOUR :
 *   Cette constante DOIT correspondre à la date de dernière mise à jour des CGU
 *   publiées (docs/legal/03-cgu-experts.md). Toute modification de fond des
 *   textes juridiques doit s'accompagner d'un INCRÉMENT de cette version (format
 *   'AAAA-MM'), afin qu'on sache exactement quelle version chaque utilisateur a
 *   acceptée. Ne pas l'incrémenter reviendrait à attribuer rétroactivement un
 *   nouveau texte à d'anciens consentements.
 */
export const CGU_VERSION = '2026-07'

/**
 * Chemins des pages légales publiques (hors dashboard, accessibles sans auth).
 * Les pages elles-mêmes sont créées dans un lot ultérieur (avec les textes) ;
 * ces chemins sont déjà la cible des liens du footer et de la case CGU.
 * NB : les liens réels sont préfixés par la locale courante côté composant.
 */
export const LEGAL_PATHS = {
  mentionsLegales: '/mentions-legales',
  confidentialite: '/politique-de-confidentialite',
  cgu: '/cgu',
} as const

/**
 * Liens légaux du pied de page — SOURCE UNIQUE, partagée par le Footer marketing
 * (home) et le footer discret (dashboards/admin). `key` = sous-clé i18n
 * `footer.legal.*` ; `path` = page publique cible (préfixée par la locale via le
 * <Link> i18n côté composant).
 */
export const LEGAL_FOOTER_LINKS: { key: 'privacy' | 'terms' | 'imprint'; path: string }[] = [
  { key: 'privacy', path: LEGAL_PATHS.confidentialite },
  { key: 'terms', path: LEGAL_PATHS.cgu },
  { key: 'imprint', path: LEGAL_PATHS.mentionsLegales },
]

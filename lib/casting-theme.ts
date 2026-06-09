/**
 * Thème DÉCORATIF des cartes casting (home). Couleur FIXE lavande — volontaire-
 * ment séparé de useDomain (qui pilote le chrome : sidebar, « Voir tout »,
 * badge IA, et reste inchangé). Tokens partagés par MissionCastingCard,
 * CandidatureCastingCard et la scrollbar de CastingRow → aucun hex éparpillé
 * dans les composants.
 *
 * Ne PAS appliquer à : pastilles de statut candidature (sémantiques :
 * vert/ambre/rouge) ni au texte de contenu (titre/entreprise/budget = neutres).
 */
export const castingTheme = {
  /** Lavande plein : scrollbar. */
  accent: '#8B5CF6',
  /** Bouton CTA — version douce/claire (fond pâle + texte foncé + bordure). */
  ctaBg: '#EDE9FE',
  ctaText: '#6D28D9',
  ctaBorder: '#DDD6FE',
  /** En-tête de carte (zone logo + score) : lavande très clair. */
  accentSoft: '#F5F3FF',
  /** Bordure fine de la tuile logo. */
  logoBorder: '#E5E9F0',
  /** Pastille d'accroche « Top match » / « Nouveau » — version douce. */
  pillSoftBg: 'rgba(139,92,246,.12)',
  pillSoftText: '#7C3AED',
  /** Score : vert sémantique (inchangé). */
  scoreGreen: '#16A34A',
} as const

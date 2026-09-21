/**
 * Thème des cartes casting.
 *
 * ⚠️ IL N'Y A PLUS DE LAVANDE, et c'est le changement du lot palette
 *    (21/09/2026). Ce fichier portait NEUF couleurs propres — un accent
 *    lavande, son fond doux, son texte, sa bordure, son halo — délibérément
 *    séparées du domaine. C'était la bonne intention (« aucun hex éparpillé
 *    dans les composants ») appliquée au mauvais périmètre : le résultat était
 *    un TROISIÈME accent, après celui de l'accueil et celui du back-office,
 *    et l'audit du 21/09 l'a mesuré comme tel.
 *
 *    Les cartes casting prennent désormais la couleur « boutons » de
 *    l'écosystème, comme tout ce qui appelle une action dans le produit.
 *
 * Ce que le fichier garde, et pourquoi il ne disparaît pas : il reste le
 * point unique où l'on décide QUEL RÔLE joue chaque zone d'une carte casting.
 * Les trois composants — MissionCastingCard, CandidatureCastingCard et la
 * barre de défilement de CastingRow — s'accordent ici, et nulle part ailleurs.
 *
 * Ne PAS appliquer à : les pastilles de statut d'une candidature (elles sont
 * SÉMANTIQUES : vert, ambre, rouge), ni au texte de contenu (titre, entreprise,
 * budget), qui est neutre.
 */
export const castingTheme = {
  /** Aplat d'accent : la barre de défilement. */
  accent: 'var(--sk-accent)',
  /** Bouton d'appel — version douce : fond pâle, texte d'accent, bordure. */
  ctaBg: 'var(--sk-accent-soft)',
  ctaText: 'var(--sk-accent)',
  ctaBorder: 'var(--sk-accent-soft)',
  /** En-tête de carte (zone logo + score) : l'accent, très clair. */
  accentSoft: 'var(--sk-accent-soft)',
  /** Bordure fine de la tuile logo — un trait, donc la couleur des traits. */
  logoBorder: 'var(--sk-border)',
  /** Pastille d'accroche « Top match » / « Nouveau » — version douce. */
  pillSoftBg: 'color-mix(in srgb, var(--sk-accent) 12%, transparent)',
  pillSoftText: 'var(--sk-accent)',
  /** Score : vert sémantique. C'est un ÉTAT, il ne suit pas la marque. */
  scoreGreen: 'var(--sk-success)',
} as const

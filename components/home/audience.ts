/**
 * Les deux publics de la page d'accueil. `expert` est l'onglet actif par défaut.
 * Chaque valeur est aussi le segment de clé i18n (`homepage.hero.expert`, …) et le
 * segment de scénario de démonstration, ce qui garantit qu'aucun des deux ne peut
 * dériver de l'autre.
 */
export const AUDIENCES = ['expert', 'company'] as const

export type HomeAudience = (typeof AUDIENCES)[number]

export const DEFAULT_AUDIENCE: HomeAudience = 'expert'

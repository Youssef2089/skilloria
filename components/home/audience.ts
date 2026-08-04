/**
 * Les deux publics de la page d'accueil.
 *
 * Chaque valeur est aussi le segment de clé i18n (`homepage.hero.expert`, …) et le
 * segment de scénario de démonstration, ce qui garantit qu'aucun des deux ne peut
 * dériver de l'autre.
 *
 * L'ordre d'affichage des onglets et l'onglet actif au chargement sont deux
 * décisions distinctes : « Je cherche un expert » (company) est affiché en
 * première position, et c'est aussi ce point de vue entreprise qui est
 * sélectionné à l'arrivée (cf. DEFAULT_AUDIENCE).
 */
export const AUDIENCES = ['company', 'expert'] as const

export type HomeAudience = (typeof AUDIENCES)[number]

export const DEFAULT_AUDIENCE: HomeAudience = 'company'

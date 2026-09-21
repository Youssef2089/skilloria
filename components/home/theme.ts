// components/home/theme.ts
//
// ⚠️ CE FICHIER NE PORTE PLUS AUCUNE COULEUR, et c'est le changement du lot
//    « palette unique » (21/09/2026). Il en portait soixante-deux.
//
//    Il était la bonne idée du projet, et l'audit l'a montré : l'accueil tenait
//    en quinze couleurs déclarées ici, avec une règle d'admission écrite en
//    tête, pendant que le reste du produit en comptait 184 recopiées à la main.
//    Décision de Youssef : c'est cette palette-là qui gagne, et elle devient
//    celle de TOUT le produit, réglable par écosystème.
//
//    Les quinze valeurs ont donc déménagé dans `lib/palette.ts`, la source
//    unique, et l'accueil les lit maintenant comme tout le monde — par les
//    jetons `--sk-*` posés sur `<html>`. Ce n'est pas une perte de contrôle :
//    c'est la même palette, aux mêmes valeurs, servie à tous les écrans.
//
//    Où sont parties les soixante-deux :
//      · 13 + 2 (crème et encre, importées) → `lib/palette.ts` ;
//      · 33 (les portraits de la démonstration) → `lib/portraits-demo.ts`,
//        exemption déclarée : ce sont des couleurs d'illustration ;
//      · 16 (`productPalette`) → SUPPRIMÉES. L'audit a mesuré qu'aucune ligne
//        du dépôt ne les lisait. Règle 0 : ce que personne ne lit n'existe pas.
//
// Ce qui reste ici : le rythme de la page. Ce ne sont pas des couleurs, et
// elles n'ont rien à faire dans une palette.

/**
 * Rythme horizontal : pleine largeur alignée à gauche. Aucun `margin: auto`,
 * aucune largeur maximale qui recentrerait la page.
 */
export const gutter = 'clamp(20px, 5vw, 72px)'

/** Largeur de confort réservée aux blocs de texte long — jamais à une section. */
export const readable = 620

/** Interlettrage des grands titres. */
export const tightTracking = '-0.02em'

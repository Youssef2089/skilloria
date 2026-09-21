/**
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LES COULEURS DES E-MAILS — LITTÉRALES, ET C'EST UNE CONTRAINTE, PAS UN   ║
 * ║ OUBLI.                                                                   ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ┌─ POURQUOI LES E-MAILS N'ONT PAS DE JETONS ──────────────────────────────┐
 * │ LES CLIENTS DE MESSAGERIE NE SUPPORTENT PAS LES PROPRIÉTÉS              │
 * │ PERSONNALISÉES. Outlook (moteur Word), les webmails qui réécrivent le   │
 * │ HTML, les applications mobiles : `color: var(--sk-text)` y est ignoré,  │
 * │ et le texte tombe sur la couleur par défaut du client — souvent noir    │
 * │ sur blanc, parfois blanc sur blanc en thème sombre.                     │
 * │                                                                          │
 * │ Un e-mail ne peut donc porter QUE des valeurs littérales. C'est la même │
 * │ famille que §E.48 — une variable qui ne résout pas ne se voit pas — mais│
 * │ pour une raison différente : ici ce n'est pas la syntaxe qui l'interdit,│
 * │ c'est le destinataire qui ne sait pas la lire.                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ « LITTÉRALES » NE VEUT PAS DIRE « ÉCRITES DEUX FOIS ».
 *    Ces valeurs étaient recopiées à la main dans `layout.ts` et dans
 *    `templates.ts` — l'ancienne gamme ardoise, plus le bleu `#00B9FF` qui
 *    n'est la marque de personne depuis le lot palette. Un e-mail envoyé
 *    aujourd'hui portait donc des couleurs que PLUS AUCUN ÉCRAN n'utilise.
 *
 *    Elles sont désormais RÉSOLUES depuis `lib/palette.ts`, la source unique
 *    (§D.12) : le même fichier que les écrans, la même palette, et un seul
 *    endroit où les changer.
 *
 * CE QUI RESTE OUVERT, ET QUI EST DIT PLUTÔT QUE CACHÉ (§E.38)
 *   Ces couleurs sont celles de la palette DE RÉFÉRENCE, pas celles de
 *   l'écosystème du destinataire. Les rendre dynamiques demande de faire
 *   descendre la palette jusqu'au point d'envoi — `sendEmail` ne reçoit
 *   aujourd'hui que le nom de marque. C'est un lot à soi, et il n'est pas
 *   fait ici : l'écrire est plus honnête que de laisser croire le contraire.
 */

import { COULEURS_FIXES, PALETTE_REFERENCE } from '@/lib/palette'

/**
 * Les couleurs employées par les gabarits d'e-mail, résolues une fois.
 *
 * Volontairement COURT : un e-mail n'a pas besoin de la palette entière, et
 * chaque entrée en plus est une décision de design qu'il faudra tenir sur
 * quinze clients de messagerie.
 */
export const COULEURS_EMAIL = {
  /** Le texte courant. */
  texte: PALETTE_REFERENCE.texte_principal,
  /** Le texte secondaire — paragraphes d'explication, mentions. */
  texteSecondaire: PALETTE_REFERENCE.texte_secondaire,
  /** Le texte tenu — pieds de page, liens de désinscription. */
  texteTenu: COULEURS_FIXES.texteTenu,
  /** Le fond de l'enveloppe, autour de la carte. */
  fond: PALETTE_REFERENCE.fond_page,
  /** Le fond de la carte elle-même. */
  carte: PALETTE_REFERENCE.cartes,
  /** Les filets et les bordures. */
  bordure: PALETTE_REFERENCE.bordures,
  /** L'accent — en-tête, bouton d'appel à l'action. */
  accent: PALETTE_REFERENCE.marque,
  /** Le texte posé SUR l'accent. */
  surAccent: PALETTE_REFERENCE.cartes,
  /** Un avertissement, et son fond. */
  avertissement: COULEURS_FIXES.avertissement,
  avertissementDoux: COULEURS_FIXES.avertissementDoux,
} as const

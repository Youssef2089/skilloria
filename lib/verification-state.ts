/**
 * Déduction centralisée de l'état de vérification d'un profil expert.
 *
 * SOURCE UNIQUE de l'état, de son LIBELLÉ, de sa PHRASE et de sa COULEUR, partagée
 * par tout ce qui le dit : la pastille des tableaux de bord et de « Mon profil »
 * (freelance + CDI), l'étape 3 du guide de démarrage, et les notifications de
 * vérification (lib/profil/notification-statut.ts).
 *
 * ┌─ CE QUE YOUSSEF A VU SUR STAGING, LE 01/10/2026 ─────────────────────────┐
 * │ La pastille disait « En attente de vérification », l'étape 3 « Vérifica- │
 * │ tion en cours », et la couleur changeait au rafraîchissement sans que le │
 * │ texte change. La cause : `pending` (l'IA vérifie) et `admin_review` (un  │
 * │ humain relit) partageaient UN libellé et avaient DEUX couleurs ; quand    │
 * │ l'IA déférait à un humain, seule la couleur bougeait. Et trois textes —   │
 * │ trois espaces de noms — disaient la même chose autrement.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * LA RÈGLE : un libellé PAR ÉTAT RÉEL, une couleur constante par état, le même
 * texte partout (espace `statut_profil` des messages). Un état qui change se lit
 * dans le texte, jamais dans la seule couleur.
 *
 * On NE s'appuie PAS sur users.is_verified (drapeau dérivé peu fiable après une
 * re-publication). L'état réel se déduit de profiles.visible + verification_status.
 *
 * États :
 *   - draft        : non publié (visible=false) → aucune vérif ne tourne.
 *   - pending      : publié, l'IA vérifie (verification_status='pending' OU pas
 *                    encore écrit alors que visible=true).
 *   - admin_review : 'pending_admin_review' (ou 'requires_more_info') → un
 *                    administrateur relit.
 *   - approved     : 'approved' → profil validé.
 *   - rejected     : 'rejected' → refusé (+ motif review_reason éventuel).
 *
 * ⚠️ MODULE PUR : aucun import — `diag-recette-s1` l'exécute.
 */
export type VerificationUiState =
  | 'draft'
  | 'pending'
  | 'admin_review'
  | 'approved'
  | 'rejected'

export function deriveVerificationUiState(input: {
  visible: boolean | null
  verificationStatus: string | null
}): VerificationUiState {
  const { visible, verificationStatus } = input
  if (verificationStatus === 'approved') return 'approved'
  if (verificationStatus === 'rejected') return 'rejected'
  // `requires_more_info` est admis par la contrainte de la colonne : un humain a la main,
  // comme pour `pending_admin_review`. Il retombait en « en cours » ou en « brouillon ».
  if (verificationStatus === 'pending_admin_review' || verificationStatus === 'requires_more_info') return 'admin_review'
  // Publié mais vérif 'pending' OU statut pas encore écrit → "en cours".
  if (visible === true) return 'pending'
  // Non publié → brouillon (aucune vérif ne tourne tant que non publié).
  return 'draft'
}

/**
 * Ce que l'écran AFFICHE : l'état de vérification, plus une nuance — un profil validé
 * mais masqué (§ « vérifié et visible ne sont pas la même chose », pastille). Ce n'est
 * PAS un sixième état de vérification : les `=== 'approved'` du dépôt n'en savent rien.
 */
export type EtatAffiche = VerificationUiState | 'approved_masque'

export function etatAffiche(state: VerificationUiState, masque = false): EtatAffiche {
  return state === 'approved' && masque ? 'approved_masque' : state
}

/** Clé du LIBELLÉ (espace `statut_profil.etat`) — une par état, aucune partagée. */
export function cleLibelleStatut(etat: EtatAffiche): string {
  return `etat.${etat}`
}

/**
 * Clé de la PHRASE qui dit ce qui va se passer (espace `statut_profil.phrase`). Elle
 * dépend de la voie : un freelance reçoit des missions, un CDI des offres d'emploi.
 */
export function clePhraseStatut(etat: EtatAffiche, voie: 'freelance' | 'cdi'): string {
  return `phrase.${voie}.${etat}`
}

/** Couleur de la pastille (point) par état — cohérente avec verificationChipColors. */
export function verificationDotColor(state: EtatAffiche): string {
  return verificationChipColors(state).fg
}

/** Couleurs du chip de statut par état (fond / bordure / texte) — CONSTANTES par état. */
export function verificationChipColors(state: EtatAffiche): {
  bg: string
  border: string
  fg: string
} {
  switch (state) {
    case 'approved':
      return { bg: 'var(--sk-success-soft)', border: 'var(--sk-success-soft)', fg: 'var(--sk-success)' }
    case 'pending':
      return { bg: 'var(--sk-accent-soft)', border: 'var(--sk-accent-soft)', fg: 'var(--sk-accent)' }
    case 'admin_review':
    // Un profil validé mais masqué n'est plus une bonne nouvelle : l'ambre de l'attente,
    // pas le vert de la réussite — le vert est réservé à « tout est en ordre ».
    case 'approved_masque':
      return { bg: 'var(--sk-amber-soft)', border: 'var(--sk-amber)', fg: 'var(--sk-amber)' }
    case 'rejected':
      return { bg: 'var(--sk-red-soft)', border: 'var(--sk-red-soft)', fg: 'var(--sk-red)' }
    default:
      return { bg: 'var(--sk-surface-2)', border: 'var(--sk-border)', fg: 'var(--sk-muted)' }
  }
}

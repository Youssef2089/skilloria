/**
 * Déduction centralisée de l'état de vérification d'un profil expert.
 *
 * Source unique de vérité partagée par les 3 affichages :
 *   - bandeau du dashboard freelance
 *   - bandeau du dashboard CDI
 *   - badge de la page "Mon Profil" (freelance + CDI)
 *
 * On NE s'appuie PLUS sur users.is_verified (drapeau dérivé peu fiable après
 * une re-publication : un profil jadis 'approved' repassé en
 * 'pending_admin_review' peut conserver is_verified=true). L'état réel se
 * déduit de profiles.visible + profiles.verification_status.
 *
 * États :
 *   - draft        : non publié (visible=false) → aucune vérif ne tourne.
 *   - pending      : publié et vérif en cours (verification_status='pending'
 *                    OU null pas encore écrit alors que visible=true).
 *   - admin_review : 'pending_admin_review' → attente validation manuelle.
 *   - approved     : 'approved' → profil vérifié.
 *   - rejected     : 'rejected' → refusé (+ motif review_reason éventuel).
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
  if (verificationStatus === 'pending_admin_review') return 'admin_review'
  // Publié mais vérif 'pending' OU statut pas encore écrit → "en cours".
  // (Surtout pas brouillon/invitation : la vérif tourne bien.)
  if (visible === true) return 'pending'
  // Non publié → brouillon (aucune vérif ne tourne tant que non publié).
  return 'draft'
}

/**
 * Clé i18n (namespace `verification_status`) du LIBELLÉ par état (C6).
 * admin_review partage le libellé de pending : dans les deux cas une demande de
 * publication a été faite et la vérif n'a pas rendu son verdict → « En attente
 * de vérification ». draft n'est JAMAIS « en attente » (rien ne tourne).
 */
export function verificationStatusLabelKey(state: VerificationUiState): 'draft' | 'pending' | 'approved' | 'rejected' {
  switch (state) {
    case 'approved': return 'approved'
    case 'rejected': return 'rejected'
    case 'admin_review':
    case 'pending': return 'pending'
    default: return 'draft'
  }
}

/** Couleur de la pastille (point) par état — cohérente avec verificationChipColors. */
export function verificationDotColor(state: VerificationUiState): string {
  switch (state) {
    case 'approved': return 'var(--sk-success)'
    case 'pending': return 'var(--sk-accent)'
    case 'admin_review': return 'var(--sk-amber)'
    case 'rejected': return 'var(--sk-red)'
    default: return 'var(--sk-faint)'
  }
}

/** Couleurs du chip de statut "Mon Profil" par état (fond / bordure / texte). */
export function verificationChipColors(state: VerificationUiState): {
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
      return { bg: 'var(--sk-amber-soft)', border: 'var(--sk-amber)', fg: 'var(--sk-amber)' }
    case 'rejected':
      return { bg: 'var(--sk-red-soft)', border: 'var(--sk-red-soft)', fg: 'var(--sk-red)' }
    default:
      return { bg: 'var(--sk-surface-2)', border: 'var(--sk-border)', fg: 'var(--sk-muted)' }
  }
}

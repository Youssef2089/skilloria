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

/** Couleurs du chip de statut "Mon Profil" par état (fond / bordure / texte). */
export function verificationChipColors(state: VerificationUiState): {
  bg: string
  border: string
  fg: string
} {
  switch (state) {
    case 'approved':
      return { bg: '#DCFCE7', border: '#BBF7D0', fg: '#15803D' }
    case 'pending':
      return { bg: '#DBEAFE', border: '#93C5FD', fg: '#1E40AF' }
    case 'admin_review':
      return { bg: '#FEF9C3', border: '#FACC15', fg: '#854D0E' }
    case 'rejected':
      return { bg: '#FEE2E2', border: '#FECACA', fg: '#991B1B' }
    default:
      return { bg: '#F1F5F9', border: '#CBD5E1', fg: '#475569' }
  }
}

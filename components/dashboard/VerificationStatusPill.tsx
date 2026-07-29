'use client'

import { useTranslations } from 'next-intl'
import {
  verificationChipColors,
  verificationDotColor,
  verificationStatusLabelKey,
  type VerificationUiState,
} from '@/lib/verification-state'

/**
 * VerificationStatusPill — SOURCE UNIQUE de la pastille de statut de vérification
 * (C6). Rendue à l'identique dans la topbar « Mon Profil » et dans le greeting
 * du tableau de bord (freelance + CDI), pour qu'aucun endroit de l'écran ne
 * contredise un autre.
 *
 * Rendu par les 5 états de deriveVerificationUiState (fini le binaire
 * `approved ? Disponible : En attente` qui affichait « En attente » sur un
 * simple brouillon) :
 *   draft → « Brouillon » | pending & admin_review → « En attente de
 *   vérification » | approved → « Profil vérifié » | rejected → « Profil refusé ».
 */
export default function VerificationStatusPill({ state }: { state: VerificationUiState }) {
  const t = useTranslations('verification_status')
  const colors = verificationChipColors(state)
  const dot = verificationDotColor(state)
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        padding: '7px 16px',
        borderRadius: 20,
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ fontSize: 13, fontWeight: 500, color: colors.fg, whiteSpace: 'nowrap' }}>
        {t(verificationStatusLabelKey(state))}
      </span>
    </div>
  )
}

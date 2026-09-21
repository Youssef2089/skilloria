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
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ « VÉRIFIÉ » ET « VISIBLE » NE SONT PAS LA MÊME CHOSE.                    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ┌─ CE QUE YOUSSEF A VU, LE 21/09/2026 ────────────────────────────────────┐
 * │ Sur son tableau de bord, deux lignes l'une sous l'autre :               │
 * │                                                                          │
 * │   « Votre profil n'est plus visible »        ← le bandeau, en tête       │
 * │   ● Profil vérifié                           ← cette pastille, en VERT   │
 * │                                                                          │
 * │ LES DEUX SONT VRAIES, ET ELLES SE LISENT COMME UNE CONTRADICTION. La     │
 * │ vérification dit qu'un administrateur a approuvé le dossier ; la          │
 * │ visibilité dit que de NOUVEAUX CHAMPS sont devenus nécessaires depuis, et │
 * │ que le profil est masqué en attendant. Un point vert et le mot           │
 * │ « vérifié » à côté d'un avertissement rouge : l'expert conclut que l'un   │
 * │ des deux ment, et il n'a aucun moyen de savoir lequel.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ POURQUOI `masque` EST UN ARGUMENT, ET NON UN SIXIÈME ÉTAT.
 *    Ajouter `approved_hidden` à `VerificationUiState` aurait changé le sens de
 *    tous les `=== 'approved'` du dépôt — la barre latérale, les verrous de
 *    section, la garde du flux — et un profil vérifié serait soudain devenu
 *    « non vérifié » pour du code qui n'a rien demandé. L'état de VÉRIFICATION
 *    ne bouge pas : c'est ce que la pastille AFFICHE qui gagne une nuance.
 */
export default function VerificationStatusPill({
  state,
  masque = false,
}: {
  state: VerificationUiState
  /**
   * Le profil est approuvé mais N'EST PAS visible — il lui manque des champs
   * devenus nécessaires. Passé par les surfaces qui portent AUSSI le bandeau
   * d'explication, pour que les deux disent la même chose.
   */
  masque?: boolean
}) {
  const t = useTranslations('verification_status')
  // Un profil masqué n'est plus une bonne nouvelle : la pastille prend les
  // couleurs de l'attente (ambre), pas celles de la réussite (vert). Le vert
  // est réservé à « tout est en ordre » — c'est ce qui lui donne son sens.
  const etatAffiche: VerificationUiState = state === 'approved' && masque ? 'admin_review' : state
  const colors = verificationChipColors(etatAffiche)
  const dot = verificationDotColor(etatAffiche)
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
        {state === 'approved' && masque
          ? t('approved_hidden')
          : t(verificationStatusLabelKey(state))}
      </span>
    </div>
  )
}

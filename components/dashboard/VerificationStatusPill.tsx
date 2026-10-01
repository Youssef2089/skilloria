'use client'

import { useTranslations } from 'next-intl'
import {
  cleLibelleStatut,
  clePhraseStatut,
  etatAffiche,
  verificationChipColors,
  verificationDotColor,
  type VerificationUiState,
} from '@/lib/verification-state'

/**
 * VerificationStatusPill — SOURCE UNIQUE de la pastille de statut de vérification
 * (C6). Rendue à l'identique dans la topbar « Mon Profil » et dans le greeting
 * du tableau de bord (freelance + CDI), pour qu'aucun endroit de l'écran ne
 * contredise un autre.
 *
 * « Statut de votre profil : <état> », puis UNE PHRASE qui dit ce qui va se passer
 * (recette staging du 01/10/2026, point 5). Un libellé PAR ÉTAT — `pending` (l'IA
 * vérifie) et `admin_review` (un humain relit) partageaient le leur, et seule la
 * couleur changeait quand l'IA déférait à un humain. Libellés, phrases et couleurs
 * viennent de lib/verification-state.ts ; les textes, de l'espace `statut_profil`,
 * le même que celui des notifications de vérification.
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
  voie,
  avecPhrase = true,
}: {
  state: VerificationUiState
  /**
   * Le profil est approuvé mais N'EST PAS visible — il lui manque des champs
   * devenus nécessaires. Passé par les surfaces qui portent AUSSI le bandeau
   * d'explication, pour que les deux disent la même chose.
   */
  masque?: boolean
  /** La voie dit ce que l'expert recevra : des missions (freelance) ou des offres (CDI). */
  voie: 'freelance' | 'cdi'
  /** La phrase sous la pastille — retirée seulement là où la place manque. */
  avecPhrase?: boolean
}) {
  const t = useTranslations('statut_profil')
  const etat = etatAffiche(state, masque)
  const colors = verificationChipColors(etat)
  const dot = verificationDotColor(etat)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, minWidth: 0 }}>
      <div
        role="status"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          padding: '7px 16px',
          borderRadius: 20,
          maxWidth: '100%',
        }}
      >
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: colors.fg }}>
          {t('titre', { etat: t(cleLibelleStatut(etat)) })}
        </span>
      </div>
      {avecPhrase && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--sk-muted)', lineHeight: 1.5 }}>
          {t(clePhraseStatut(etat, voie))}
        </p>
      )}
    </div>
  )
}

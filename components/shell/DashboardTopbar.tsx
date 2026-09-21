'use client'

import LanguageSwitcher from '@/components/LanguageSwitcher'
import EcosystemSwitcher from '@/components/shell/EcosystemSwitcher'
import NotificationBell from '@/components/NotificationBell'
import MessagesTopbarIcon from '@/components/MessagesTopbarIcon'

/**
 * DashboardTopbar — barre supérieure 60px (Lot refonte UX).
 *
 * Côté gauche : titre de page (dérivé du sub-layout ou pris en prop).
 * Côté droit : EcosystemSwitcher (organisation) · LanguageSwitcher ·
 *              NotificationBell · MessagesTopbarIcon ·
 *              statut "Disponible" (expert) / placeholder.
 *
 * Le titre est passé en prop ; chaque sub-layout le résout via usePathname()
 * ou les pages individuelles peuvent l'override via un store partagé. V1
 * pragmatique : la prop suffit.
 */
export default function DashboardTopbar({
  side,
  title,
  statusPill,
}: {
  side: 'freelance' | 'entreprise' | 'cdi'
  title: string
  /** Pill statut à droite (ex. "Disponible" expert vérifié). Optionnel. */
  statusPill?: React.ReactNode
}) {
  // SC7b : 'cdi' passe son propre side à l'icône messages → base path /dashboard/cdi/messages.
  const messagesSide: 'freelance' | 'entreprise' | 'cdi' = side
  return (
    <header
      style={{
        height: 60,
        flexShrink: 0,
        // ── L'EN-TÊTE EST BEIGE, COMME LA BARRE LATÉRALE ──────────────────
        //
        //  Il était en `--sk-surface`, c'est-à-dire la couleur des CARTES —
        //  blanc. Youssef a choisi le beige pour le cadre (barre latérale ET
        //  en-tête) au lot palette ; la barre latérale l'avait pris, l'en-tête
        //  non. Deux surfaces du même cadre, deux couleurs : c'est ce qu'il a
        //  vu en testant.
        //
        //  ⚠️ `--sk-bandeau`, PAS `--sk-surface-2`. Les deux portent aujourd'hui
        //     la même valeur, mais ils ne disent pas la même chose : `bandeau`
        //     nomme le CADRE, `surface-2` nomme un fond secondaire DANS une
        //     carte. Le jour où un écosystème les distinguera, l'en-tête doit
        //     suivre la barre latérale, pas les encarts.
        //
        //  Les deux couleurs de texte posées dessus sont déjà gardées :
        //  `principal_sur_bandeau` et `secondaire_sur_bandeau` font partie des
        //  sept paires que `verifierContraste()` REFUSE sous 4,5 (§D.12).
        background: 'var(--sk-bandeau)',
        borderBottom: '1px solid var(--sk-border)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '0 22px',
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 18, letterSpacing: '-0.3px', color: 'var(--sk-text)' }}>
        {title}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Sélecteur d'écosystème — CÔTÉ ORGANISATION UNIQUEMENT.
            Un expert reste sur le sien à vie : lui montrer une liste serait
            proposer un choix qui n'existe pas. Le composant se retire d'ailleurs
            de lui-même dès qu'il n'a qu'une destination, ce qui le rend inerte
            en mono-écosystème sans qu'on ait à le prévoir ici. */}
        {side === 'entreprise' && <EcosystemSwitcher />}
        <LanguageSwitcher />
        <NotificationBell />
        <MessagesTopbarIcon side={messagesSide} />
        {statusPill}
      </div>
    </header>
  )
}

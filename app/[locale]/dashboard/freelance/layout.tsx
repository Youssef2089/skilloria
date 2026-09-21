'use client'

import DashboardShell from '@/components/shell/DashboardShell'

/**
 * Sub-layout freelance — Lot refonte UX.
 *
 * Mount DashboardShell pleine largeur. AUCUNE EXCEPTION.
 *
 * ┌─ LA LISTE D'EXCLUSION EST PARTIE, ET SON HISTOIRE VAUT D'ÊTRE LUE ──────┐
 * │ Elle se décrivait elle-même comme « TEMPORAIRE — à supprimer dès que    │
 * │ /mon-profil est refactorisée ». Elle a tenu assez longtemps pour que    │
 * │ deux pages VOISINES y tombent par erreur : /profil et /profil/valider,  │
 * │ qui ne rendaient AUCUN cadre, s'affichaient nues — sans barre latérale, │
 * │ sans navigation, sans bouton Retour. Un correctif antérieur les en a    │
 * │ sorties ; la liste, elle, est restée.                                   │
 * │                                                                         │
 * │ C'est la forme même du défaut : une exception ouverte pour UNE page     │
 * │ devient un endroit où d'autres tombent, et le cadre cesse d'être une    │
 * │ garantie pour devenir une habitude.                                     │
 * │                                                                         │
 * │ /mon-profil rebâtissait sa coquille en TROIS exemplaires dans le même   │
 * │ fichier — un squelette de chargement, un helper, le rendu principal —   │
 * │ avec un en-tête de 58 px là où la coquille en fait 60, et sans le       │
 * │ bouton Retour, la cloche, ni les messages. Elle prend la coquille       │
 * │ partagée, et les trois copies disparaissent avec.                       │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

export default function FreelanceLayout({ children }: { children: React.ReactNode }) {
  // DeletionGate est monté au layout parent commun (/dashboard) → couverture
  // universelle. Rien à ajouter ici.
  return <DashboardShell side="freelance">{children}</DashboardShell>
}

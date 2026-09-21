'use client'

import DashboardShell from '@/components/shell/DashboardShell'

/**
 * Sub-layout CDI — Lot UX Finitions 2 SC7a.
 *
 * Mount DashboardShell side='cdi' pleine largeur, miroir exact du sub-layout
 * freelance. Le shell inline qui vivait dans cdi/page.tsx (1181 lignes) a été
 * retiré (cf. SC7a) et toutes les pages CDI utilisent désormais le shell
 * partagé via ce layout.
 *
 * ┌─ CE QUI A DISPARU D'ICI, ET POURQUOI C'ÉTAIT GRAVE ────────────────────┐
 * │ Une liste d'exclusion laissait /mon-profil hors du shell partagé. Sa    │
 * │ justification, écrite ici même : « elle rend DashboardSidebar           │
 * │ elle-même ».                                                            │
 * │                                                                         │
 * │ C'ÉTAIT FAUX, ET MESURÉ : `DashboardSidebar` n'était importée nulle     │
 * │ part dans cette page. Elle n'avait qu'un en-tête maison — ni barre      │
 * │ latérale, ni navigation, ni bouton Retour. Un expert qui ouvrait son    │
 * │ profil s'y retrouvait ENFERMÉ : plus aucun lien vers le reste du        │
 * │ produit, sauf le bouton « précédent » du navigateur.                    │
 * │                                                                         │
 * │ Le commentaire a survécu au code qu'il décrivait, et c'est lui qui      │
 * │ défendait l'exclusion (§E.7 : un commentaire n'a jamais rendu une       │
 * │ barre latérale).                                                        │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * CORRECTIF (bug parcours profil), miroir exact du sub-layout freelance :
 * /profil (import CV) et /profil/valider ne rendent PAS de shell inline et
 * s'affichaient nues → elles sont désormais enveloppées par le DashboardShell
 * partagé (sidebar + topbar + GlobalBackButton).
 *
 * CONFIRMATION SC7a : cdi/page.tsx ne contient PAS de PATCH /api/profile —
 * ce trigger vit uniquement dans profil/valider qui reste intact.
 */

export default function CdiLayout({ children }: { children: React.ReactNode }) {
  // AUCUNE EXCEPTION. Toutes les pages de l'espace CDI portent le même cadre —
  // c'est ce que ce layout est. Une liste d'exclusion ici a produit une page
  // sans issue pendant des semaines (cf. l'encadré en tête de fichier).
  return <DashboardShell side="cdi">{children}</DashboardShell>
}

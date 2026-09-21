import { redirect } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'

/**
 * /dashboard/cabinet → redirection SERVEUR vers /dashboard/entreprise.
 *
 * Décision produit B3.5.fix : un seul tableau de bord organisation pour les
 * trois sous-types (`client` / `esn` / `cabinet`), cf. lib/auth-routing.ts.
 * La page est conservée — et non supprimée — pour que les anciens signets et
 * les liens existants redirigent proprement au lieu d'aboutir sur un 404.
 *
 * ┌─ POURQUOI ELLE PASSE DU CLIENT AU SERVEUR ──────────────────────────────┐
 * │ Elle redirigeait dans un `useEffect`, donc APRÈS un premier rendu. Ce    │
 * │ rendu était une page NUE : ni barre latérale, ni en-tête, un « … » gris  │
 * │ centré sur un fond blanc — et une couleur écrite en toutes lettres       │
 * │ (`#64748b`), hors palette.                                              │
 * │                                                                          │
 * │ C'était la seule page de l'espace connecté sans cadre dont l'absence de  │
 * │ cadre n'était pas justifiée par une contrainte (les deux autres le sont :│
 * │ `reactivation` vit hors de la garde de suppression, `invitation/[token]` │
 * │ s'adresse à quelqu'un qui n'est pas encore membre).                      │
 * │                                                                          │
 * │ LUI DONNER LA COQUILLE AURAIT ÉTÉ LA MAUVAISE RÉPONSE : on aurait peint  │
 * │ un cadre complet pour le retirer dans la milliseconde. La bonne réponse  │
 * │ est de ne RIEN rendre du tout — le serveur redirige, le navigateur ne    │
 * │ dessine jamais cette page, et la question du cadre ne se pose plus.      │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Même forme exactement que `/admin` (`app/[locale]/admin/page.tsx`), qui
 * redirige déjà ainsi : la locale est passée explicitement, et il n'y a aucun
 * clignotement de chargement.
 */
export default async function DashboardCabinetRedirect({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect({ href: '/dashboard/entreprise', locale: locale as Locale })
}

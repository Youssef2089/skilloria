import SousTraitanceDetailView from '@/components/collaboration/SousTraitanceDetailView'

// Page de DÉTAIL ; aucun bouton Retour (on navigue par les menus (décision de Youssef, 02/10/2026)). Détail du besoin +
// candidatures reçues + action de clôture.
export default function FreelanceSousTraitanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return <SousTraitanceDetailView basePath="/dashboard/freelance" params={params} />
}

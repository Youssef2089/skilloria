import SousTraitanceDetailView from '@/components/collaboration/SousTraitanceDetailView'

// Parité freelance : page de DÉTAIL ; aucun bouton Retour (on navigue par les menus (décision de Youssef, 02/10/2026)).
export default function CdiSousTraitanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return <SousTraitanceDetailView basePath="/dashboard/cdi" params={params} />
}

import SousTraitanceDetailView from '@/components/collaboration/SousTraitanceDetailView'

// Parité freelance : page de DÉTAIL (hors menu) → bouton Retour global.
export default function CdiSousTraitanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return <SousTraitanceDetailView basePath="/dashboard/cdi" params={params} />
}

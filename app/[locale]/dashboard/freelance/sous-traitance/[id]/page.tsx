import SousTraitanceDetailView from '@/components/collaboration/SousTraitanceDetailView'

// Page de DÉTAIL (hors menu) → bouton Retour global. Détail du besoin +
// candidatures reçues + action de clôture.
export default function FreelanceSousTraitanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return <SousTraitanceDetailView basePath="/dashboard/freelance" params={params} />
}

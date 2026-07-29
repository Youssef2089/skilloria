import SousTraitanceView from '@/components/collaboration/SousTraitanceView'

// Page de DÉTAIL/création (hors menu) → bouton Retour global fourni par la
// coquille. Formulaire de publication d'un nouveau besoin de sous-traitance.
export default function FreelanceSousTraitanceNouveauPage() {
  return <SousTraitanceView basePath="/dashboard/freelance" />
}

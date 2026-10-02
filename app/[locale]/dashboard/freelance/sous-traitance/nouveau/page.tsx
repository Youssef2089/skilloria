import SousTraitanceView from '@/components/collaboration/SousTraitanceView'

// Page de création ; aucun bouton Retour (on navigue par les menus (décision de Youssef, 02/10/2026)).
// Formulaire de publication d'un nouveau besoin de sous-traitance.
export default function FreelanceSousTraitanceNouveauPage() {
  return <SousTraitanceView basePath="/dashboard/freelance" />
}

import SousTraitanceListView from '@/components/collaboration/SousTraitanceListView'

// Page de MENU (entrée sidebar « Sous-traitance ») → pas de bouton Retour.
// Liste des besoins publiés + accès à la publication d'un nouveau besoin.
export default function FreelanceSousTraitancePage() {
  return <SousTraitanceListView basePath="/dashboard/freelance" />
}

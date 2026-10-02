import SousTraitanceListView from '@/components/collaboration/SousTraitanceListView'

// Page de MENU (entrée sidebar « Besoin / Sous-traitance »).
// Liste des besoins publiés + accès à la publication d'un nouveau besoin.
export default function FreelanceSousTraitancePage() {
  return <SousTraitanceListView basePath="/dashboard/freelance" />
}

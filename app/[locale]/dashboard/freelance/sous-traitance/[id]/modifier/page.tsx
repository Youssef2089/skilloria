'use client'

import { use } from 'react'
import SousTraitanceView from '@/components/collaboration/SousTraitanceView'

// Page de reprise d'un besoin REFUSÉ par l'administration (regroupement, ARRÊT 28) : les mêmes champs que la création,
// les valeurs du besoin relues, son motif affiché ; la soumission le fait juger de nouveau sans le recompter dans le
// mois. Aucun bouton Retour (on navigue par les menus, décision de Youssef du 02/10/2026).
export default function FreelanceSousTraitanceModifierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <SousTraitanceView basePath="/dashboard/freelance" repriseId={id} />
}

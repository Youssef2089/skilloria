'use client'

import { use } from 'react'
import SousTraitanceView from '@/components/collaboration/SousTraitanceView'

// Parité freelance : la reprise d'un besoin REFUSÉ par l'administration (regroupement, ARRÊT 28) — les mêmes champs que
// la création, les valeurs relues, le motif affiché ; aucun bouton Retour (on navigue par les menus, 02/10/2026).
export default function CdiSousTraitanceModifierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return <SousTraitanceView basePath="/dashboard/cdi" repriseId={id} />
}

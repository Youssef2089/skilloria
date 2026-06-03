'use client'

import PublicationForm from '@/components/dashboard/PublicationForm'

/**
 * /dashboard/entreprise/annonces/nouvelle — création d'une annonce.
 * Thin wrapper sur PublicationForm (mode create, state vide).
 */
export default function NouvelleAnnoncePage() {
  return <PublicationForm mode="create" />
}

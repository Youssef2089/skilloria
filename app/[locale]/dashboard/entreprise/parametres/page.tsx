'use client'

import SettingsView from '@/components/settings/SettingsView'

/**
 * /dashboard/entreprise/parametres — Lot A entreprise.
 *
 * Parité stricte avec freelance/parametres et cdi/parametres : les 7 sections
 * de SettingsView (identité, email, téléphone, mot de passe, langue, sécurité,
 * suppression) portent sur le COMPTE UTILISATEUR, pas sur l'organisation —
 * elles sont donc identiques quel que soit le rôle. `side` n'est pas consommé
 * par SettingsView, il ne sert qu'à typer l'appelant.
 *
 * Les réglages de l'ORGANISATION vivent dans /dashboard/entreprise/organisation.
 * Aucune nouvelle clé i18n : le namespace `settings` couvre déjà tout.
 */
export default function EntrepriseParametresPage() {
  return <SettingsView side="entreprise" />
}

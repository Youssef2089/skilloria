'use client'

import { useDomain } from '@/context/DomainContext'
import LanguageSwitcher from '@/components/LanguageSwitcher'

/**
 * Bandeau haut de la vitrine.
 * Rendu exclusivement par <HomeView>, qui injecte les classes `skh-*`.
 */
export default function Topbar() {
  const domain = useDomain()

  return (
    <div className="skh-topbar">
      <span>
        {domain.name} — {domain.tagline}
      </span>
      <LanguageSwitcher />
    </div>
  )
}

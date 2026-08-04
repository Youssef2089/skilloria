'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { theme } from './theme'
import type { EcosystemBranch } from '@/lib/home-ecosystem'

/**
 * Domaines couverts par l'écosystème du sous-domaine servi.
 *
 * D4 — SOURCE UNIQUE DE VÉRITÉ : la liste dérive de la TAXONOMIE réelle
 * (branches + spécialités du domaine), la même que celle proposée à l'expert et à
 * l'organisation. Une pastille = une BRANCHE (un seul libellé, plus de doublon
 * code+libellé), avec ses SPÉCIALITÉS en sous-texte pour expliciter ce qu'elle
 * recouvre. Les `domain.featuredProducts` / `domain.tags` ne sont PLUS consommés
 * ici (colonnes conservées en base mais sans effet sur cette section).
 *
 * `branches` est chargé côté serveur (lib/home-ecosystem.ts) : si vide (domaine
 * sans taxonomie ou repli), la section se masque d'elle-même.
 */
export default function HomeEcosystem({ branches }: { branches: EcosystemBranch[] }) {
  const domain = useDomain()
  const t = useTranslations('homepage.ecosystem')

  if (branches.length === 0) return null

  return (
    <section id="domaines" style={{ background: theme.white, borderTop: `1px solid ${theme.border}` }}>
      <h2 className="skh-h2">{t('title', { ecosystem: domain.ecosystemName })}</h2>
      <p className="skh-sub">{t('subtitle', { ecosystem: domain.ecosystemName })}</p>

      <ul className="skh-eco-grid">
        {branches.map(branch => (
          <li key={branch.id} className="skh-eco-branch">
            <p className="skh-eco-name">{branch.label}</p>
            {branch.specialities.length > 0 ? (
              <p className="skh-eco-specs">{branch.specialities.join(', ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

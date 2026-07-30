'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { productPalette, theme } from './theme'

/**
 * Domaines couverts par l'écosystème du sous-domaine servi.
 *
 * La liste vient de `domain.featuredProducts`, avec repli sur `domain.tags` :
 * aucune liste de produits n'est écrite ici, pas même en secours. Les pastels
 * sont attribués POSITIONNELLEMENT, jamais par nom de produit — un écosystème
 * inconnu s'affiche donc correctement sans qu'une ligne soit ajoutée.
 */
export default function HomeEcosystem() {
  const domain = useDomain()
  const t = useTranslations('homepage.ecosystem')

  const products = domain.featuredProducts.length > 0
    ? domain.featuredProducts
    : domain.tags.map(label => ({ label, icon: '' }))

  if (products.length === 0) return null

  return (
    <section id="domaines" style={{ background: theme.white, borderTop: `1px solid ${theme.border}` }}>
      <h2 className="skh-h2">{t('title', { ecosystem: domain.ecosystemName })}</h2>
      <p className="skh-sub">{t('subtitle', { ecosystem: domain.ecosystemName })}</p>

      <ul className="skh-chips" style={{ listStyle: 'none', padding: 0, margin: '30px 0 0' }}>
        {products.map((product, index) => {
          const tone = productPalette[index % productPalette.length]
          return (
            <li key={product.label} className="skh-chip" style={{ background: tone.bg, color: tone.color }}>
              {product.icon ? <span aria-hidden="true">{product.icon}</span> : null}
              {product.label}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

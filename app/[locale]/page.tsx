import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getDomainConfig } from '@/lib/get-domain-config'
import { loadHomeEcosystem } from '@/lib/home-ecosystem'
import HomeView from '@/components/home/HomeView'

/**
 * Page d'accueil publique.
 *
 * Composant serveur : la résolution du domaine (donc l'écosystème servi et sa
 * couleur d'accent) reste côté serveur, et la metadata est produite par
 * `generateMetadata` avec les traductions de la locale demandée — plus de
 * <title> posé depuis le corps d'un composant client.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const [domain, t] = await Promise.all([
    getDomainConfig(locale),
    getTranslations({ locale, namespace: 'homepage.meta' }),
  ])

  const title = t('title', { name: domain.name, ecosystem: domain.ecosystemName })
  const description = t('description', { name: domain.name, ecosystem: domain.ecosystemName })

  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
  }
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  // D4 : la section écosystème dérive de la taxonomie réelle du domaine servi
  // (branches + spécialités), chargée côté serveur et passée à l'arbre client.
  const domain = await getDomainConfig(locale)
  const ecosystem = await loadHomeEcosystem(domain.id, locale)

  return <HomeView ecosystem={ecosystem} />
}

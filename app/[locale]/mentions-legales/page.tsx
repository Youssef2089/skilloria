import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getDomainConfig } from '@/lib/get-domain-config'
import { loadLegalDoc } from '@/lib/legal-docs'
import LegalPageShell from '@/components/legal/LegalPageShell'

// fs (loadLegalDoc) → runtime Node. Page PUBLIQUE, aucune garde d'auth (D3).
export const runtime = 'nodejs'

type PageParams = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return {
    title: t('mentions_legales.title'),
    description: t('mentions_legales.meta_description'),
  }
}

export default async function MentionsLegalesPage({ params }: PageParams) {
  const { locale } = await params
  const [t, domain] = await Promise.all([
    getTranslations({ locale, namespace: 'legal' }),
    getDomainConfig(locale),
  ])
  return (
    <LegalPageShell
      domainName={domain.name}
      primaryColor={domain.primaryColor}
      logoUrl={domain.logoUrl}
      notice={locale === 'fr' ? null : t('language_notice')}
      content={loadLegalDoc('mentions-legales')}
    />
  )
}

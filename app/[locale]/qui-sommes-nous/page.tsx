import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { getDomainConfig } from '@/lib/get-domain-config'
import LegalPageShell from '@/components/legal/LegalPageShell'

// Page PUBLIQUE (D3) : aucune garde d'auth, lisible par un visiteur non inscrit.
// Le contenu est ASSEMBLÉ depuis l'i18n (pas de fs / loadLegalDoc), avec
// interpolation de domain.name et domain.ecosystemName — rien de spécifique à
// un écosystème n'est codé en dur.
export const dynamic = 'force-dynamic'

type PageParams = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { locale } = await params
  const [t, domain] = await Promise.all([
    getTranslations({ locale, namespace: 'qui' }),
    getDomainConfig(locale),
  ])
  return {
    title: t('meta_title', { name: domain.name }),
    description: t('meta_description', { name: domain.name, ecosystem: domain.ecosystemName }),
  }
}

export default async function QuiSommesNousPage({ params }: PageParams) {
  const { locale } = await params
  const [t, domain] = await Promise.all([
    getTranslations({ locale, namespace: 'qui' }),
    getDomainConfig(locale),
  ])

  // Valeurs d'interpolation communes (nom de la marque + nom de l'écosystème).
  const v = { name: domain.name, ecosystem: domain.ecosystemName }

  // Assemblage du markdown consommé par <LegalArticle>. Chaque bloc est séparé
  // par une ligne vide (paragraphe markdown). Le lien /mentions-legales est
  // réécrit en <Link> i18n par LegalArticle (préfixe automatique de la locale).
  const content = [
    `# ${t('title')}`,
    t('intro', v),

    `## ${t('distinct_title')}`,

    `### ${t('distinct_commission_title')}`,
    t('distinct_commission_body', v),

    `### ${t('distinct_verified_title')}`,
    t('distinct_verified_body', v),

    `### ${t('distinct_identity_title')}`,
    t('distinct_identity_body', v),

    `### ${t('distinct_matching_title')}`,
    t('distinct_matching_body', v),

    `## ${t('how_title')}`,
    [
      `1. **${t('how_step1_title')}** — ${t('how_step1_body', v)}`,
      `2. **${t('how_step2_title')}** — ${t('how_step2_body', v)}`,
      `3. **${t('how_step3_title')}** — ${t('how_step3_body', v)}`,
    ].join('\n'),

    `## ${t('editor_title')}`,
    t('editor_body'),
  ].join('\n\n')

  return (
    <LegalPageShell
      domainName={domain.name}
      primaryColor={domain.primaryColor}
      logoUrl={domain.logoUrl}
      notice={locale === 'fr' ? null : t('language_notice')}
      content={content}
    />
  )
}

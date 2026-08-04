import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { getDomainConfig } from '@/lib/get-domain-config'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import LegalFooter from '@/components/layout/LegalFooter'
import ContactForm from '@/components/contact/ContactForm'

// Page PUBLIQUE (D3) : aucune garde d'auth. On réutilise EXACTEMENT le chrome
// des pages légales (header logo → accueil + sélecteur de langue, pied légal),
// mais avec un formulaire client au centre plutôt qu'un document markdown.
export const dynamic = 'force-dynamic'

type PageParams = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { locale } = await params
  const [t, domain] = await Promise.all([
    getTranslations({ locale, namespace: 'contact' }),
    getDomainConfig(locale),
  ])
  return {
    title: t('meta_title', { name: domain.name }),
    description: t('meta_description', { name: domain.name }),
  }
}

export default async function ContactPage({ params }: PageParams) {
  const { locale } = await params
  const [t, domain] = await Promise.all([
    getTranslations({ locale, namespace: 'contact' }),
    getDomainConfig(locale),
  ])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header public minimal — identique aux pages légales (LegalPageShell). */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 24px',
          borderBottom: '1px solid #eef2f6',
        }}
      >
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {domain.logoUrl ? (
              <img src={domain.logoUrl} alt={domain.name} width={16} height={16} />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{domain.name}</span>
        </Link>
        <LanguageSwitcher />
      </header>

      {/* Contenu : pleine largeur, aligné gauche, colonne de lecture bornée. */}
      <main style={{ flex: 1, padding: '32px 24px 56px' }}>
        <div style={{ maxWidth: 640 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: '#0f172a', lineHeight: 1.25, margin: '0 0 12px' }}>
            {t('title')}
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: '#475569', margin: '0 0 28px' }}>
            {t('intro')}
          </p>
          {locale !== 'fr' && (
            <div
              role="note"
              style={{
                background: '#f1f5f9',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                padding: '12px 16px',
                marginBottom: 28,
                fontSize: 13,
                color: '#475569',
                lineHeight: 1.5,
              }}
            >
              {t('language_notice')}
            </div>
          )}
          <ContactForm />
        </div>
      </main>

      <LegalFooter />
    </div>
  )
}

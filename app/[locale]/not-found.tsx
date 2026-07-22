'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

/**
 * 404 localisée — rendue DANS le layout `[locale]` (qui porte `<html>`/`<body>`
 * + NextIntlClientProvider/DomainProvider), donc jamais via le root layout nu.
 *
 * Déclenchée par `notFound()` (layout locale invalide, catch-all
 * `[...rest]/page.tsx`, ou tout appel explicite). Corrige le crash Next
 * « Missing <html> and <body> tags in the root layout ».
 *
 * 'use client' : le provider i18n du layout parent est disponible → useTranslations OK.
 */
export default function LocaleNotFound() {
  const t = useTranslations('not_found')

  return (
    <div
      style={{
        minHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '40px 24px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        aria-hidden
        style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '.14em',
          color: 'var(--color-text-tertiary, #94a3b8)',
          marginBottom: 14,
        }}
      >
        404
      </div>
      <h1
        style={{
          fontSize: 22,
          fontWeight: 500,
          color: 'var(--color-text-primary, #0f172a)',
          margin: '0 0 8px',
        }}
      >
        {t('title')}
      </h1>
      <p
        style={{
          fontSize: 14,
          color: 'var(--color-text-secondary, #64748b)',
          margin: '0 0 24px',
          maxWidth: 420,
          lineHeight: 1.55,
        }}
      >
        {t('description')}
      </p>
      <Link
        href="/"
        style={{
          padding: '10px 18px',
          background: '#00B9FF',
          color: '#fff',
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        {t('back_home')}
      </Link>
    </div>
  )
}

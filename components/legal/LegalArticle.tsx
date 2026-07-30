import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from '@/i18n/navigation'

/**
 * Rendu d'un document juridique markdown (docs/legal/*.md) en HTML lisible.
 *
 * - remark-gfm : tableaux (la politique de confidentialité en contient plusieurs),
 *   règles horizontales, listes.
 * - Liens INTERNES (`/xxx`) : réécrits via le <Link> i18n → préfixe automatique
 *   de la locale courante (sinon un lien absolu perdrait le segment de langue).
 *   Liens externes/mailto : nouvel onglet.
 * - Tableaux enveloppés dans un conteneur `overflow-x:auto` → jamais de
 *   débordement horizontal de la page sur mobile.
 *
 * Le composant NE MODIFIE PAS le texte : il ne fait que le styler.
 */
export default function LegalArticle({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 style={{ fontSize: 30, fontWeight: 800, color: '#0f172a', lineHeight: 1.25, margin: '0 0 20px' }}>{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, margin: '36px 0 12px' }}>{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', lineHeight: 1.4, margin: '24px 0 8px' }}>{children}</h3>
        ),
        p: ({ children }) => (
          <p style={{ fontSize: 15, lineHeight: 1.75, color: '#334155', margin: '0 0 14px' }}>{children}</p>
        ),
        ul: ({ children }) => (
          <ul style={{ margin: '0 0 14px', paddingLeft: 22, color: '#334155', fontSize: 15, lineHeight: 1.75 }}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol style={{ margin: '0 0 14px', paddingLeft: 22, color: '#334155', fontSize: 15, lineHeight: 1.75 }}>{children}</ol>
        ),
        li: ({ children }) => <li style={{ margin: '0 0 6px' }}>{children}</li>,
        strong: ({ children }) => <strong style={{ fontWeight: 700, color: '#0f172a' }}>{children}</strong>,
        hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '28px 0' }} />,
        a: ({ href, children }: { href?: string; children?: ReactNode }) => {
          if (href && href.startsWith('/')) {
            // Lien interne entre documents légaux → i18n Link (préfixe locale).
            return (
              <Link href={href} style={{ color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: 2 }}>
                {children}
              </Link>
            )
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline', textUnderlineOffset: 2 }}>
              {children}
            </a>
          )
        },
        table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
          <div style={{ overflowX: 'auto', margin: '0 0 18px' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, minWidth: 480 }}>{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead>{children}</thead>,
        th: ({ children }) => (
          <th style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e2e8f0', background: '#f8fafc', color: '#0f172a', fontWeight: 700, verticalAlign: 'top' }}>{children}</th>
        ),
        td: ({ children }) => (
          <td style={{ padding: '10px 12px', borderBottom: '1px solid #eef2f6', color: '#334155', verticalAlign: 'top', lineHeight: 1.6 }}>{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

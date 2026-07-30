import { Link } from '@/i18n/navigation'
import LanguageSwitcher from '@/components/LanguageSwitcher'
import LegalFooter from '@/components/layout/LegalFooter'
import LegalArticle from '@/components/legal/LegalArticle'

/**
 * Coquille commune aux 3 pages légales PUBLIQUES (hors dashboard).
 *
 * - Aucune garde d'auth, aucune sidebar, aucun bouton Retour du dashboard
 *   (décision D3 : lisibles par un visiteur non inscrit et par la CNIL).
 * - Pleine largeur, contenu aligné à gauche avec une colonne de lecture bornée
 *   (règle projet). Header minimal (logo → accueil + sélecteur de langue) et
 *   pied de page légal discret (navigation inter-documents).
 * - `notice` (encart de langue, décision D1) affiché uniquement hors FR.
 */
export default function LegalPageShell({
  domainName,
  primaryColor,
  logoUrl,
  notice,
  content,
}: {
  domainName: string
  primaryColor: string
  logoUrl: string | null
  notice: string | null
  content: string
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#fff', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header public minimal */}
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
          <span style={{ width: 28, height: 28, borderRadius: 7, background: primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {logoUrl ? (
              <img src={logoUrl} alt={domainName} width={16} height={16} />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{domainName}</span>
        </Link>
        <LanguageSwitcher />
      </header>

      {/* Contenu : pleine largeur, aligné gauche, colonne de lecture bornée */}
      <main style={{ flex: 1, padding: '32px 24px 56px' }}>
        <div style={{ maxWidth: 820 }}>
          {notice && (
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
              {notice}
            </div>
          )}
          <LegalArticle content={content} />
        </div>
      </main>

      <LegalFooter />
    </div>
  )
}

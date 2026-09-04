import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { ecosystemHref, parseEcosystemScreenParams } from '@/lib/ecosystem-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * /[locale]/ecosysteme-indisponible — LES TROIS REFUS ONT UN ÉCRAN.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ LA SÉCURITÉ ÉTAIT FERMÉE, PAS L'EXPÉRIENCE.                              ║
 * ║                                                                          ║
 * ║ Avant cet écran, un sous-domaine inconnu ou désactivé rendait la         ║
 * ║ coquille du tableau de bord, aux couleurs par défaut, dont chaque appel  ║
 * ║ répondait 403. Aucune donnée ne fuyait — et l'utilisateur voyait un      ║
 * ║ écran vide qu'il ne pouvait interpréter que comme une panne.             ║
 * ║                                                                          ║
 * ║ Un refus sans issue n'est qu'une impasse polie. Chacun des trois motifs  ║
 * ║ dit donc CE QUI SE PASSE et, quand c'est possible, OÙ ALLER.             ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ⚠️ CET ÉCRAN VIT HORS DE /dashboard. `assertDashboardRoleGuard` ne s'y
 *    exécute donc pas : la redirection qu'elle produit ne peut pas boucler.
 *
 * ⚠️ IL NE RÉVÈLE RIEN. Le seul slug affiché est celui de l'écosystème DU
 *    COMPTE de l'appelant, que le serveur a mis dans le refus. Le slug demandé,
 *    lui, n'est jamais réaffiché : ce serait offrir un écran de la plateforme
 *    à qui veut y écrire.
 */

type PageParams = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ code?: string | string[]; slug?: string | string[] }>
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'ecosystem_unavailable' })
  return { title: t('meta_title'), robots: { index: false, follow: false } }
}

export default async function EcosystemUnavailablePage({ params, searchParams }: PageParams) {
  const { locale } = await params
  const [t, sp, hdrs] = await Promise.all([
    getTranslations({ locale, namespace: 'ecosystem_unavailable' }),
    searchParams,
    headers(),
  ])

  // Paramètres LAVÉS : un code non reconnu retombe sur l'écran générique, un
  // slug qui n'est pas une étiquette DNS est jeté.
  const { code, slug } = parseEcosystemScreenParams(sp)

  // Le lien de sortie est reconstruit à partir de l'HÔTE COURANT, jamais d'une
  // valeur reçue : seul le slug vient de l'URL, et il a été validé.
  const host = hdrs.get('host')
  const proto = (hdrs.get('x-forwarded-proto') ?? 'https').split(',')[0].trim()
  const ownHref =
    code === 'domain_mismatch' && slug
      ? ecosystemHref({ host, slug, protocol: proto, pathname: `/${locale}` })
      : null

  const title = code ? t(`${code}.title`) : t('generic.title')
  const body = code ? t(`${code}.body`) : t('generic.body')

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        background: 'var(--sk-bg, #f8fafc)',
        fontFamily: 'var(--font-jakarta), system-ui, sans-serif',
      }}
    >
      <section
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          padding: '34px 32px',
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.06)',
        }}
      >
        <div
          aria-hidden
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#fff7ed',
            border: '1px solid #fed7aa',
            marginBottom: 18,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 8v5m0 3.5h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="#ea580c"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: '-0.4px',
            color: '#0f172a',
            textWrap: 'balance',
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 14.5,
            lineHeight: 1.65,
            color: '#475569',
          }}
        >
          {body}
        </p>

        {/* SORTIE. Un expert égaré ne lit pas « accès refusé » : il lit le nom
            de son écosystème et le chemin pour y retourner. */}
        {code === 'domain_mismatch' && slug && (
          <div
            style={{
              marginTop: 22,
              padding: '14px 16px',
              borderRadius: 12,
              background: '#f0f9ff',
              border: '1px solid #bae6fd',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: '#0369a1',
                marginBottom: 6,
              }}
            >
              {t('domain_mismatch.own_label')}
            </div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#0c4a6e',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                wordBreak: 'break-all',
              }}
            >
              {slug}
            </div>
            {ownHref ? (
              <a
                href={ownHref}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  marginTop: 12,
                  padding: '9px 15px',
                  borderRadius: 9,
                  background: '#0ea5e9',
                  color: '#fff',
                  fontSize: 13.5,
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                {t('domain_mismatch.cta')}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 12h14m-6-6 6 6-6 6"
                    stroke="#fff"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            ) : (
              // L'hôte ne permet pas de fabriquer l'adresse (développement
              // local). On le dit plutôt que d'afficher un bouton mort.
              <p style={{ margin: '10px 0 0', fontSize: 13, color: '#0369a1' }}>
                {t('domain_mismatch.no_link')}
              </p>
            )}
          </div>
        )}

        <a
          href={`/${locale}`}
          style={{
            display: 'inline-block',
            marginTop: 24,
            fontSize: 13.5,
            fontWeight: 600,
            color: '#64748b',
            textDecoration: 'none',
          }}
        >
          {t('back_home')}
        </a>
      </section>
    </main>
  )
}

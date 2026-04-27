'use client'

import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { useRouter } from '@/i18n/navigation'
import Topbar from '@/components/layout/Topbar'
import Navbar from '@/components/layout/Navbar'
import Footer from '@/components/layout/Footer'
import ProfilesSection from '@/components/home/ProfilesSection'
import AdSection from '@/components/home/AdSection'
import HeroAnimation from '@/components/home/HeroAnimation'

export default function Home() {
  return (
    <>
      <div style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <Topbar />
        <Navbar />
      </div>
      <main>
        <HeroSection />
        <CardsSection />
        <ProfilesSection />
        <AdSection />
      </main>
      <Footer />
    </>
  )
}

function HeroSection() {
  const domain = useDomain()
  const router = useRouter()
  const t = useTranslations('homepage')
  const tMeta = useTranslations('homepage.meta')
  const tHero = useTranslations('homepage.hero')

  return (
    <section style={{ background: '#fff', padding: '72px 48px 64px', borderBottom: '1px solid #f1f5f9' }}>

      <title>{tMeta('title', { name: domain.name, ecosystem: domain.ecosystemName })}</title>
      <meta name="description" content={tMeta('description', { name: domain.name, ecosystem: domain.ecosystemName })} />

      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 56,
        flexWrap: 'wrap',
      }}>

        {/* Colonne gauche */}
        <div style={{ flex: '0 0 420px', minWidth: 280 }}>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: `${domain.primaryColor}15`,
            border: `1px solid ${domain.primaryColor}40`,
            borderRadius: 100, padding: '6px 14px', marginBottom: 24,
          }}>
            <div style={{
              width: 7, height: 7,
              background: domain.primaryColor,
              borderRadius: '50%',
              animation: 'pulse 2s infinite',
            }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: domain.primaryColor }}>
              {tHero('badge', { name: domain.name })}
            </span>
          </div>

          <h1 style={{
            fontSize: 50, fontWeight: 800,
            color: '#0f172a', lineHeight: 1.1,
            letterSpacing: '-1.5px', marginBottom: 20,
          }}>
            {tHero.rich('title', {
              ecosystem: domain.ecosystemName,
              highlight: (chunks) => (
                <span style={{ color: domain.primaryColor }}>{chunks}</span>
              ),
            })}
          </h1>

          <p style={{
            fontSize: 17, color: '#64748b',
            lineHeight: 1.75, marginBottom: 36, maxWidth: 400,
          }}>
            {tHero('subtitle', { ecosystem: domain.ecosystemName })}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
            <button
              onClick={() => router.push({ pathname: '/inscription', query: { role: 'entreprise' } })}
              style={{
                background: domain.primaryColor,
                color: '#fff', border: 'none',
                borderRadius: 100, padding: '15px 32px',
                fontSize: 15, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', maxWidth: 320,
                transition: 'opacity 0.2s',
              }}
              onMouseOver={e => (e.currentTarget.style.opacity = '0.88')}
              onMouseOut={e => (e.currentTarget.style.opacity = '1')}
            >
              <span>{tHero('cta_company')}</span>
              <span>→</span>
            </button>
            <button
              onClick={() => router.push({ pathname: '/inscription', query: { role: 'freelance' } })}
              style={{
                background: '#fff',
                color: domain.primaryColor,
                border: `2px solid ${domain.primaryColor}`,
                borderRadius: 100, padding: '15px 32px',
                fontSize: 15, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', maxWidth: 320,
                transition: 'opacity 0.2s',
              }}
              onMouseOver={e => (e.currentTarget.style.opacity = '0.75')}
              onMouseOut={e => (e.currentTarget.style.opacity = '1')}
            >
              <span>{tHero('cta_expert')}</span>
              <span>→</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#94a3b8' }}>
            <span>{tHero('feature_free')}</span>
            <span>{tHero('feature_zero_commission')}</span>
            <span>{tHero('feature_ai')}</span>
          </div>
        </div>

        {/* Colonne droite — animation React */}
        <div style={{ flex: 1, minWidth: 300 }} className="hero-anim">
          <HeroAnimation
            primaryColor={domain.primaryColor}
            domainName={domain.name}
          />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%,100%{opacity:1;transform:scale(1)}
          50%{opacity:0.5;transform:scale(0.9)}
        }
        @media (max-width: 900px) {
          .hero-anim { display: none !important; }
        }
      `}</style>
    </section>
  )
}

function CardsSection() {
  const domain = useDomain()
  const router = useRouter()
  const tCards = useTranslations('homepage.cards')

  return (
    <div style={{
      background: `${domain.primaryColor}08`,
      borderTop: `1px solid ${domain.primaryColor}20`,
      borderBottom: `1px solid ${domain.primaryColor}20`,
      padding: '20px 48px',
    }}>
      <div style={{
        display: 'flex', gap: 12,
        maxWidth: 760, margin: '0 auto 16px',
        justifyContent: 'center',
        flexWrap: 'wrap',
      }}>
        <div style={{
          background: '#fff', border: '1px solid #fde68a',
          borderRadius: 12, padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 240,
        }}>
          <div style={{
            width: 32, height: 32, background: '#fef9c3',
            borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 16, flexShrink: 0,
          }}>💬</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
              {tCards('collaborate.title')}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
              {tCards('collaborate.description')}
            </div>
          </div>
        </div>

        <div style={{
          background: '#fff', border: '1px solid #c4b5fd',
          borderRadius: 12, padding: '14px 18px',
          display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 240,
        }}>
          <div style={{
            width: 32, height: 32, background: '#ede9fe',
            borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            fontSize: 16, flexShrink: 0,
          }}>💼</div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>
              {tCards('experts.title')}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
              {tCards('experts.description')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <button
          onClick={() => router.push('/inscription')}
          style={{
            background: domain.primaryColor,
            color: '#fff', border: 'none',
            borderRadius: 100, padding: '10px 28px',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          {tCards('cta_join', { name: domain.name })}
        </button>
      </div>
    </div>
  )
}

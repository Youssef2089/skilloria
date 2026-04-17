'use client'

import { useDomain } from '@/context/DomainContext'
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

  return (
    <section style={{ background: '#fff', padding: '72px 48px 64px', borderBottom: '1px solid #f1f5f9' }}>

      <title>{`${domain.name} — Trouvez l'expert ${domain.ecosystemName} qu'il vous faut`}</title>
      <meta name="description" content={`${domain.name} connecte les entreprises aux meilleurs experts ${domain.ecosystemName} certifiés via un matching IA. Publiez votre mission en 2 minutes.`} />

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
              Piloté par l'IA · {domain.name}
            </span>
          </div>

          <h1 style={{
            fontSize: 50, fontWeight: 800,
            color: '#0f172a', lineHeight: 1.1,
            letterSpacing: '-1.5px', marginBottom: 20,
          }}>
            Trouvez l'expert<br />
            <span style={{ color: domain.primaryColor }}>
              {domain.ecosystemName}
            </span><br />
            qu'il vous faut.
          </h1>

          <p style={{
            fontSize: 17, color: '#64748b',
            lineHeight: 1.75, marginBottom: 36, maxWidth: 400,
          }}>
            Publiez votre besoin, l'IA analyse 40+ critères et vous connecte
            aux meilleurs experts certifiés de l'écosystème {domain.ecosystemName}.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
            <button
              onClick={() => window.location.href = '/inscription?role=entreprise'}
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
              <span>Publier une mission/offre</span>
              <span>→</span>
            </button>
            <button
              onClick={() => window.location.href = '/inscription?role=freelance'}
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
              <span>Créer mon profil expert</span>
              <span>→</span>
            </button>
          </div>

          <div style={{ display: 'flex', gap: 20, fontSize: 12, color: '#94a3b8' }}>
            <span>✓ Gratuit</span>
            <span>✓ 0% commission</span>
            <span>✓ Piloté par l'IA</span>
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
              Experts, collaborez entre vous !
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
              Sous-traitez, formez des équipes entre experts certifiés.
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
              Expert / Freelance / CDI ?
            </div>
            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.4 }}>
              Déclarez votre dispo, recevez des alertes missions.
            </div>
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <button
          onClick={() => window.location.href = '/inscription'}
          style={{
            background: domain.primaryColor,
            color: '#fff', border: 'none',
            borderRadius: 100, padding: '10px 28px',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          Rejoindre {domain.name} →
        </button>
      </div>
    </div>
  )
}
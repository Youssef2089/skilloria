'use client'

import { useDomain } from '@/context/DomainContext'

export default function Footer() {
  const domain = useDomain()

  return (
    <footer style={{ background: 'linear-gradient(160deg, #e0f2fe, #bae6fd 40%, #93c5fd 80%, #a5b4fc)' }}>
      <div style={{ padding: '32px 32px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 24, marginBottom: 24 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 26, height: 26, borderRadius: 7, background: domain.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {domain.logoUrl ? (
                  <img src={domain.logoUrl} alt={domain.name} width={16} height={16} />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
                  </svg>
                )}
              </div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{domain.name}</span>
            </div>
            <p style={{ fontSize: 11, color: '#1e3a5f', lineHeight: 1.6, maxWidth: 200 }}>
              La marketplace premium des experts Microsoft certifiés, pilotée par l'IA Agentique.
            </p>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>Plateforme</div>
            {['Publier une offre', 'Entreprise', 'Freelance', 'CDI', 'Tarifs'].map(l => (
              <div key={l} style={{ fontSize: 11, color: '#1e3a5f', marginBottom: 6, cursor: 'pointer' }}>{l}</div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>Domaines</div>
            {['Azure', 'Power Platform', 'Dynamics 365', 'Microsoft 365'].map(l => (
              <div key={l} style={{ fontSize: 11, color: '#1e3a5f', marginBottom: 6, cursor: 'pointer' }}>{l}</div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 10 }}>Entreprise</div>
            {['À propos', 'Blog', 'Contact', 'Partenaires'].map(l => (
              <div key={l} style={{ fontSize: 11, color: '#1e3a5f', marginBottom: 6, cursor: 'pointer' }}>{l}</div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.5)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#1e3a5f' }}>© 2025 {domain.name}. Tous droits réservés.</span>
          <div style={{ display: 'flex', gap: 14 }}>
            {['Confidentialité', 'CGU', 'Mentions légales'].map(l => (
              <span key={l} style={{ fontSize: 10, color: '#1e3a5f', cursor: 'pointer' }}>{l}</span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
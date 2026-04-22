'use client'

import { useDomain } from '@/context/DomainContext'

const steps = [
  { icon: '📋', title: 'Publiez', desc: 'Mission ou CDI en 2 min', pill: '⏱ 2 min', pillBg: '#E0F2FE', pillColor: '#0284C7', bg: 'linear-gradient(135deg, #E0F7FF, #BAE6FD)' },
  { icon: '🤖', title: 'L\'IA matche', desc: '40+ critères analysés', pill: '🎯 Précis', pillBg: '#EEF2FF', pillColor: '#4F46E5', bg: 'linear-gradient(135deg, #EEF2FF, #C7D2FE)' },
  { icon: '🔔', title: 'Alertes', desc: 'Experts notifiés instantanément', pill: '⚡ Instantané', pillBg: '#FEF3C7', pillColor: '#D97706', bg: 'linear-gradient(135deg, #FFFBEB, #FDE68A)' },
  { icon: '✋', title: 'Intérêt', desc: 'Profil complet et certifs reçus', pill: '✓ Vérifié', pillBg: '#DCFCE7', pillColor: '#059669', bg: 'linear-gradient(135deg, #F0FDF4, #BBF7D0)' },
  { icon: '🔐', title: 'Validé', desc: 'Mise en contact automatique', pill: '🛡 Auto', pillBg: '#DBEAFE', pillColor: '#1D4ED8', bg: 'linear-gradient(135deg, #DBEAFE, #93C5FD)' },
  { icon: '💬', title: 'Discussion', desc: 'Canal privé et sécurisé', pill: '🔒 Privé', pillBg: '#EDE9FE', pillColor: '#6D28D9', bg: 'linear-gradient(135deg, #F5F3FF, #DDD6FE)' },
  { icon: '🚀', title: 'C\'est parti !', desc: 'La collaboration démarre', pill: '🏁 Go !', pillBg: '#D1FAE5', pillColor: '#059669', bg: 'linear-gradient(135deg, #ECFDF5, #6EE7B7)' },
]

export default function FlowSection() {
  const { ecosystemName } = useDomain()

  return (
    <div style={{ background: 'white', padding: '72px 60px' }}>

      {/* HEADER */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: 'linear-gradient(135deg, #EEF2FF, #E0F2FE)',
          borderRadius: 20, padding: '5px 16px', marginBottom: 16,
          fontSize: 10, fontWeight: 700, color: '#4F46E5',
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>
          ⚡ La première marketplace {ecosystemName} pilotée par l'IA Agentique
        </div>

        <h2 style={{ fontSize: 30, fontWeight: 500, color: '#0F172A', lineHeight: 1.2, marginBottom: 22 }}>
          De zéro à l'expert certifié{' '}
          <em style={{
            fontStyle: 'normal',
            background: 'linear-gradient(90deg, #0EA5E9, #6366F1)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            en moins de 2 heures
          </em>
        </h2>

        {/* BADGES */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
          
          {/* Agent IA */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 12,
            background: 'linear-gradient(135deg, #0F172A, #1E1B4B, #1E3A5F)',
            borderRadius: 14, padding: '11px 18px',
            border: '1px solid rgba(99,102,241,0.3)',
            boxShadow: '0 6px 24px rgba(15,23,42,0.2)',
          }}>
            <span style={{ fontSize: 32 }}>🤖</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                <div style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#34D399', boxShadow: '0 0 6px #34D399',
                }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: '#34D399', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Agent actif 24/7
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'white', marginBottom: 2 }}>Skilloria Agentic AI</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)' }}>Matching · Alertes · Workflow automatisé</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
                {['✓ En ligne', '⚡ Temps réel', '🎯 40+ critères'].map(t => (
                  <span key={t} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 20, fontWeight: 600, background: 'rgba(52,211,153,0.15)', color: '#34D399' }}>{t}</span>
                ))}
              </div>
            </div>
          </div>

          {/* 0% commission */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: 'linear-gradient(135deg, #ECFDF5, #D1FAE5)',
            border: '1.5px solid #6EE7B7', borderRadius: 12, padding: '11px 18px',
          }}>
            <span style={{ fontSize: 26, fontWeight: 900, color: '#059669', lineHeight: 1 }}>0%</span>
            <div>
              <strong style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#065F46' }}>Zéro commission</strong>
              <span style={{ fontSize: 10, color: '#10B981' }}>Zéro frais cachés</span>
            </div>
          </div>
        </div>
      </div>

      {/* STEPS */}
      <div style={{ position: 'relative' }}>
        {/* Ligne connectrice */}
        <div style={{
          position: 'absolute', top: 32, left: '6%', right: '6%',
          height: 2, zIndex: 0,
          background: 'linear-gradient(90deg, #BAE6FD, #C7D2FE, #FDE68A, #BBF7D0, #93C5FD, #DDD6FE, #6EE7B7)',
        }} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, position: 'relative', zIndex: 1 }}>
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: '0 4px' }}>
              <div style={{
                width: 64, height: 64, borderRadius: 18,
                background: step.bg, fontSize: 24,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.08)',
                border: '2px solid white',
              }}>
                {step.icon}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>{step.title}</div>
              <div style={{ fontSize: 10, color: '#64748B', lineHeight: 1.5, minHeight: 30 }}>{step.desc}</div>
              <div style={{
                marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 3,
                fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
                background: step.pillBg, color: step.pillColor,
              }}>
                {step.pill}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ textAlign: 'center', marginTop: 52 }}>
        <div style={{
          display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 18,
          background: 'linear-gradient(135deg, #F0F9FF, #EEF2FF)',
          borderRadius: 20, padding: '28px 48px',
          border: '1px solid rgba(99,102,241,0.1)',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #0EA5E9, #6366F1, #10B981)' }} />
          
          <strong style={{ fontSize: 18, color: '#0F172A', fontWeight: 500 }}>
            Votre prochain expert est disponible dès maintenant
          </strong>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { text: '🎁 Inscription gratuite', bg: '#FEF3C7', border: '#FDE68A', color: '#D97706' },
              { text: '✓ Experts vérifiés', bg: '#E0F2FE', border: '#BAE6FD', color: '#0284C7' },
              { text: '🛡 Paiement sécurisé', bg: '#EEF2FF', border: '#C7D2FE', color: '#4F46E5' },
            ].map(b => (
              <span key={b.text} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: b.bg, border: `1.5px solid ${b.border}`, color: b.color,
              }}>{b.text}</span>
            ))}
          </div>

          <div style={{ fontSize: 12, color: '#94A3B8' }}>
            650+ cabinets et entreprises font déjà confiance à Skilloria
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button style={{
              background: 'linear-gradient(135deg, #0EA5E9, #6366F1)', color: 'white',
              padding: '12px 26px', borderRadius: 9, fontSize: 13, fontWeight: 500,
              border: 'none', cursor: 'pointer', boxShadow: '0 6px 20px rgba(99,102,241,0.25)',
            }}>
              Publier ma première mission →
            </button>
            <button style={{
              background: 'white', color: '#0F172A', padding: '12px 22px',
              borderRadius: 9, fontSize: 13, fontWeight: 500,
              border: '1.5px solid #E2E8F0', cursor: 'pointer',
            }}>
              ▶ Voir une démo
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

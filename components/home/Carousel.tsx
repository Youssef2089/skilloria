'use client'

import { useState, useEffect, useRef } from 'react'

const slides = [
  {
    title: 'Les meilleurs experts Microsoft',
    titleEm: 'certifiés, disponibles maintenant',
    emColor: '#0369A1',
    desc: 'Publiez en 2 min. Notre IA analyse 40+ critères et propose les profils parfaits en quelques heures.',
    cta: 'Publier une mission →',
    bg: 'linear-gradient(160deg, #E0F7FF, #BAE6FD 30%, #93C5FD 60%, #A5B4FC 85%, #C4B5FD)',
    visual: { stat: '40+', label: 'critères analysés par l\'IA', badge: '⚡ Match en 2h', color: '#0369A1' }
  },
  {
    title: 'Clients → Cabinets :',
    titleEm: 'une mise en relation ultra ciblée',
    emColor: '#065F46',
    desc: 'Diffusez vos besoins vers des cabinets partenaires ou directement vers les experts.',
    cta: 'Démarrer comme client →',
    bg: 'linear-gradient(160deg, #F0FDF4, #BBF7D0 35%, #6EE7B7 65%, #34D399)',
    visual: { stat: '650+', label: 'cabinets partenaires actifs', badge: '✓ Réseau vérifié', color: '#065F46' }
  },
  {
    title: 'Soyez alerté dès qu\'un expert',
    titleEm: 'est disponible, en temps réel',
    emColor: '#C2410C',
    desc: 'Configurez vos critères une fois. Ne ratez plus jamais le bon profil.',
    cta: 'Configurer mes alertes →',
    bg: 'linear-gradient(160deg, #FFF7ED, #FED7AA 35%, #FB923C 65%, #F97316)',
    visual: { stat: '< 5min', label: 'délai moyen de notification', badge: '🔔 Temps réel', color: '#C2410C' }
  },
  {
    title: 'Les experts se signalent',
    titleEm: 'spontanément aux recruteurs',
    emColor: '#7E22CE',
    desc: 'Sans attendre une offre — l\'expert envoie sa disponibilité avec ses certifications.',
    cta: 'Déclarer ma disponibilité →',
    bg: 'linear-gradient(160deg, #FDF4FF, #E9D5FF 35%, #C084FC 65%, #A855F7)',
    visual: { stat: '96%', label: 'taux de satisfaction client', badge: '★ Premium', color: '#7E22CE' }
  },
  {
    title: 'Freelances, collaborez',
    titleEm: 'et grandissez entre pairs',
    emColor: '#92400E',
    desc: 'Sous-traitez à un expert de confiance. Formez des équipes certifiées Microsoft.',
    cta: 'Rejoindre la communauté →',
    bg: 'linear-gradient(160deg, #FFFBEB, #FDE68A 35%, #FBBF24 65%, #D97706)',
    visual: { stat: '8 200+', label: 'experts dans la communauté', badge: '🤜 Entraide', color: '#92400E' }
  },
  {
    title: '8 200+ experts Microsoft',
    titleEm: 'certifiés dans un seul réseau',
    emColor: '#0369A1',
    desc: 'La communauté de référence de l\'écosystème Microsoft. Ils collaborent et grandissent ensemble.',
    cta: 'Rejoindre le réseau →',
    bg: 'linear-gradient(160deg, #ECFEFF, #A5F3FC 35%, #22D3EE 65%, #0EA5E9)',
    visual: { stat: '0%', label: 'commission sur vos missions', badge: '💎 Zéro frais', color: '#0369A1' }
  },
]

const DURATION = 5000

export default function Carousel() {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const progressRef = useRef<NodeJS.Timeout | null>(null)

  const goTo = (n: number) => {
    setCurrent((n + slides.length) % slides.length)
    setProgress(0)
  }

  const startProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current)
    progressRef.current = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          setCurrent(c => (c + 1) % slides.length)
          return 0
        }
        return prev + (100 / (DURATION / 100))
      })
    }, 100)
  }

  useEffect(() => {
    if (!paused) startProgress()
    else if (progressRef.current) clearInterval(progressRef.current)
    return () => { if (progressRef.current) clearInterval(progressRef.current) }
  }, [paused, current])

  const slide = slides[current]

  return (
    <div style={{
      position: 'relative', overflow: 'hidden',
      height: '240px',
      background: slide.bg, transition: 'background 0.8s ease'
    }}>
      <div style={{
        position: 'absolute', width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.45) 0%, transparent 65%)',
        top: -80, left: -60, pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', alignItems: 'center', height: '100%', padding: '0 60px', gap: '32px' }}>
        <div style={{ flex: 1, position: 'relative', zIndex: 2 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0C1A35', lineHeight: 1.2, marginBottom: 8 }}>
            {slide.title}<br />
            <em style={{ fontStyle: 'normal', color: slide.emColor }}>{slide.titleEm}</em>
          </h2>
          <p style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 14, opacity: 0.8, color: '#1E293B', maxWidth: 420 }}>
            {slide.desc}
          </p>
          <button style={{
            background: 'rgba(255,255,255,0.9)', border: 'none',
            padding: '7px 18px', borderRadius: 9, fontSize: 12,
            fontWeight: 600, cursor: 'pointer', color: '#0F172A',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          }}>
            {slide.cta}
          </button>
        </div>

        <div style={{
          flex: '0 0 190px', background: 'rgba(255,255,255,0.65)',
          border: '1px solid rgba(255,255,255,0.95)', borderRadius: 16,
          padding: '18px 16px', boxShadow: '0 16px 48px rgba(0,0,0,0.1)',
          position: 'relative', zIndex: 2, textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, fontWeight: 800, color: slide.visual.color, letterSpacing: '-2px', lineHeight: 1, marginBottom: 6 }}>
            {slide.visual.stat}
          </div>
          <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5, marginBottom: 12 }}>
            {slide.visual.label}
          </div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.95)',
            borderRadius: 100, padding: '4px 12px', fontSize: 10, fontWeight: 600, color: slide.visual.color,
          }}>
            {slide.visual.badge}
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', top: 10, right: 20, fontSize: 10, color: 'rgba(15,23,42,0.4)', zIndex: 10 }}>
        {current + 1} / {slides.length}
      </div>

      <div style={{
        position: 'absolute', bottom: 0, left: 0, height: 3, width: `${progress}%`,
        background: 'rgba(15,23,42,0.3)', zIndex: 10, transition: 'width 0.1s linear',
      }} />

      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: 6, zIndex: 10,
        background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(8px)',
        padding: '5px 12px', borderRadius: 30, border: '1px solid rgba(255,255,255,0.85)',
      }}>
        <button onClick={() => goTo(current - 1)} style={{ width: 22, height: 22, borderRadius: '50%', background: 'white', border: 'none', cursor: 'pointer', fontSize: 10 }}>←</button>
        {slides.map((_, i) => (
          <div key={i} onClick={() => goTo(i)} style={{
            width: i === current ? 16 : 5, height: 5,
            borderRadius: i === current ? 4 : '50%',
            background: i === current ? '#0F172A' : 'rgba(0,0,0,0.2)',
            cursor: 'pointer', transition: 'all 0.3s',
          }} />
        ))}
        <button onClick={() => setPaused(!paused)} style={{
          width: 24, height: 24, borderRadius: '50%',
          background: paused ? '#0F172A' : 'white',
          color: paused ? 'white' : '#0F172A',
          border: '1.5px solid #E2E8F0', cursor: 'pointer', fontSize: 11,
        }}>
          {paused ? '▶' : '⏸'}
        </button>
        <button onClick={() => goTo(current + 1)} style={{ width: 22, height: 22, borderRadius: '50%', background: 'white', border: 'none', cursor: 'pointer', fontSize: 10 }}>→</button>
      </div>
    </div>
  )
}
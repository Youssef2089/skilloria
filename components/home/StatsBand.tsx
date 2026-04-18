'use client'

import { useDomain } from '@/context/DomainContext'

export default function StatsBand() {
  const { ecosystemName } = useDomain()

  const stats = [
    { number: '8 200+', label: `Experts ${ecosystemName}` },
    { number: '1 800+', label: 'Missions actives' },
    { number: '650+', label: 'Cabinets partenaires' },
    { number: '96%', label: 'Taux de satisfaction' },
  ]

  return (
    <div style={{
      background: 'linear-gradient(90deg, #0284C7, #4F46E5, #7C3AED)',
      display: 'flex',
    }}>
      {stats.map((stat, i) => (
        <div key={i} style={{
          flex: 1, textAlign: 'center', padding: '26px 16px',
          borderRight: i < stats.length - 1 ? '1px solid rgba(255,255,255,0.15)' : 'none',
        }}>
          <div style={{ fontSize: 26, fontWeight: 500, color: 'white' }}>
            {stat.number}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 4 }}>
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  )
}

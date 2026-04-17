'use client'

const domains = [
  { label: 'Azure', icon: '☁️', bg: '#dbeafe', color: '#1d4ed8' },
  { label: 'Business Central', icon: '📊', bg: '#dcfce7', color: '#15803d' },
  { label: 'Power BI', icon: '📈', bg: '#fef9c3', color: '#a16207' },
  { label: 'Power Platform', icon: '⚡', bg: '#ede9fe', color: '#6d28d9' },
  { label: 'D365 Finance & Ops', icon: '💼', bg: '#ffedd5', color: '#c2410c' },
  { label: 'SharePoint', icon: '🗂️', bg: '#fce7f3', color: '#9d174d' },
  { label: 'Copilot Studio', icon: '🤖', bg: '#ecfeff', color: '#0e7490' },
  { label: 'Azure DevOps', icon: '🔧', bg: '#f0fdf4', color: '#166534' },
  { label: 'Dynamics CRM', icon: '🤝', bg: '#fdf4ff', color: '#7e22ce' },
  { label: 'Microsoft Fabric', icon: '🧵', bg: '#f5f3ff', color: '#5b21b6' },
]

export default function ProfilesSection() {
  return (
    <div style={{ borderBottom: '1px solid #f0f0f0', padding: '12px 32px', background: '#fff' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 8, maxWidth: 700, marginLeft: 'auto', marginRight: 'auto' }}>
        {domains.map((d) => (
          <div key={d.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: d.bg, color: d.color }}>
            <span style={{ fontSize: 12 }}>{d.icon}</span> {d.label}
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: 11, color: '#0ea5e9', fontWeight: 600, cursor: 'pointer', borderBottom: '1px dashed #7dd3fc' }}>
          + Autres domaines Microsoft couverts →
        </span>
      </div>
    </div>
  )
}
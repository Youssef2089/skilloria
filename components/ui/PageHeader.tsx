'use client'

/**
 * PageHeader — en-tête de page cohérent (h1 + sous-titre optionnel +
 * actions à droite). Primitive partagée par toutes les pages dashboard.
 */
export default function PageHeader({
  title,
  subtitle,
  actions,
  flush = false,
}: {
  title: string
  subtitle?: string | React.ReactNode
  actions?: React.ReactNode
  /**
   * Sans marge propre : pour un conteneur qui a DÉJÀ la sienne (le `<main>` du
   * back-office). Sans cette option, la marge se doublerait et le titre ne
   * s'alignerait plus sur le contenu.
   */
  flush?: boolean
}) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: flush ? '0 0 4px' : '24px 26px 4px' }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.4px', color: 'var(--sk-text)', lineHeight: 1.25 }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{ color: 'var(--sk-muted)', fontSize: 13.5, marginTop: 4, lineHeight: 1.55 }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>{actions}</div>}
    </header>
  )
}

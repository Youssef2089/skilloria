'use client'

/**
 * Avatar — image circulaire ou initiales fallback. Multi-tenant : la couleur
 * fallback dérive de --sk-accent (via color-mix dans le CSS).
 */
export default function Avatar({
  src,
  name,
  size = 40,
  variant = 'accent',
}: {
  src?: string | null
  name?: string | null
  size?: number
  variant?: 'accent' | 'neutral'
}) {
  const initials = (name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?'

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? ''}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    )
  }

  const bg = variant === 'accent' ? 'var(--sk-accent-soft)' : 'var(--sk-surface-2)'
  const fg = variant === 'accent' ? 'var(--sk-accent-ink)' : 'var(--sk-muted)'

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        color: fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(11, Math.round(size * 0.35)),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </span>
  )
}

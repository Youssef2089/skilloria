'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * PendingInvitationGate — détection d'invitation par EMAIL VÉRIFIÉ (Lot B, B3
 * cas 2, arbitrage A2).
 *
 * Monté dans le layout du dashboard entreprise : à la première session utile,
 * interroge GET /api/me/invitations/pending. Si une invitation 'pending' matche
 * l'email VÉRIFIÉ du user (la route ne révèle rien à un email non vérifié — A4),
 * affiche un overlay d'acceptation « X vous invite à rejoindre Y en tant que Z ».
 * L'acceptation passe par la MÊME route que le cas 1
 * (POST /api/me/invitations/accept, sans token → résolution par email vérifié).
 *
 * Sans invitation, le composant ne rend rien (coût : un GET au montage).
 */

const font = 'var(--font-jakarta), Inter, system-ui, sans-serif'

type Pending = {
  id: string
  organization_id: string
  role_in_org: string
  company_name: string | null
}

export default function PendingInvitationGate() {
  const t = useTranslations('invitation_public')
  const secureFetch = useSecureFetch()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const check = useCallback(async () => {
    try {
      const res = await secureFetch('/api/me/invitations/pending')
      if (!res.ok) return
      const body = (await res.json()) as { invitation: Pending | null }
      if (body.invitation) setPending(body.invitation)
    } catch {
      // silencieux : la détection est best-effort.
    }
  }, [secureFetch])

  useEffect(() => { void check() }, [check])

  const roleLabel = (r: string) => t(`role_${r}` as 'role_admin')

  async function accept() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await secureFetch('/api/me/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setErr(body?.code === 'email_mismatch' ? t('err_email_mismatch') : t('err_generic'))
        return
      }
      // Rechargement dur : la nouvelle appartenance change tout le contexte org.
      window.location.reload()
    } finally {
      setBusy(false)
    }
  }

  function dismiss() { setPending(null) }

  if (!pending) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: font }}
    >
      <div style={{ background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(15,23,42,0.3)' }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, color: '#0f172a', margin: '0 0 8px' }}>
          {t('invite_title', { company: pending.company_name ?? '—' })}
        </h1>
        <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.55, margin: '0 0 20px' }}>
          {t('invite_body', { company: pending.company_name ?? '—', role: roleLabel(pending.role_in_org) })}
        </p>

        {err && <p style={{ fontSize: 13, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', margin: '0 0 16px' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" disabled={busy} onClick={accept} style={{ flex: 1, border: 'none', borderRadius: 10, padding: '11px 20px', fontSize: 14, fontWeight: 700, fontFamily: font, color: '#fff', background: 'var(--sk-accent, #0369a1)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
            {t('accept_cta')}
          </button>
          <button type="button" disabled={busy} onClick={dismiss} style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '11px 18px', fontSize: 14, fontWeight: 600, fontFamily: font, color: '#334155', background: '#fff', cursor: 'pointer' }}>
            {t('later_cta')}
          </button>
        </div>
      </div>
    </div>
  )
}

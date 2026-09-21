'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

/**
 * ReauthModal — ré-authentification (mission S3). L'expert re-saisit son mot
 * de passe ; on le vérifie côté serveur via POST /api/me/reauth qui renvoie un
 * grant HMAC court. `onConfirm(token)` est appelé avec ce grant ; l'appelant
 * le passe ensuite dans le header x-reauth-token de l'opération sensible.
 */
export default function ReauthModal({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onConfirm: (token: string) => void
  onCancel: () => void
}) {
  const t = useTranslations('settings.reauth')
  const secureFetch = useSecureFetch()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const close = () => {
    setPassword('')
    setError(null)
    setLoading(false)
    onCancel()
  }

  const submit = async () => {
    if (!password) {
      setError(t('error_required'))
      return
    }
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await secureFetch('/api/me/reauth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!res.ok) {
        // 401 = mot de passe réellement incorrect. Tout autre statut (500
        // `reauth_server_error`, etc.) est une erreur serveur : on NE la masque
        // PAS en « mot de passe incorrect ».
        setError(res.status === 401 ? t('error_invalid') : t('error_server'))
        return
      }
      const data = (await res.json()) as { reauth_token?: string }
      if (!data.reauth_token) {
        setError(t('error_server'))
        return
      }
      setPassword('')
      onConfirm(data.reauth_token)
    } catch {
      setError(t('error_invalid'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={close}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--sk-text) 45%, transparent)', padding: 16, fontFamily: fontJakarta,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420, background: 'var(--sk-surface)', borderRadius: 16,
          padding: 24, boxShadow: '0 20px 50px color-mix(in srgb, var(--sk-text) 25%, transparent)',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--sk-text)' }}>{t('title')}</h2>
        <p style={{ margin: '8px 0 18px', fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.5 }}>{t('description')}</p>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }}>
          {t('password_label')}
        </label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit() }}
          placeholder={t('password_placeholder')}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '11px 13px',
            border: '1.5px solid var(--sk-border)', borderRadius: 10, fontSize: 14, outline: 'none',
          }}
        />
        {error && <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--sk-red)' }}>{error}</p>}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={close}
            disabled={loading}
            style={{
              padding: '10px 16px', borderRadius: 10, border: '1.5px solid var(--sk-border)',
              background: 'var(--sk-surface)', color: 'var(--sk-text)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            style={{
              padding: '10px 18px', borderRadius: 10, border: 'none',
              background: 'var(--sk-accent, var(--sk-accent))', color: 'var(--sk-sur-accent)', fontSize: 14, fontWeight: 700,
              cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
            }}
          >
            {t('confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

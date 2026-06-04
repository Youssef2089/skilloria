'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'

/**
 * CandidatureModal — modal réutilisable pour postuler à une mission/offre
 * (Lot UX Finitions 2 SC3). Extrait du formulaire inline qui était dans
 * /dashboard/freelance/missions/[id]/page.tsx.
 *
 * Logique de soumission INCHANGÉE : POST /api/candidatures effectué par le
 * caller (la modal ne fait que collecter cover_message et appeler onSubmit).
 * Aucune modif route/serveur. UNIQUE(publication_id, profile_id) reste géré
 * côté API.
 *
 * Réutilisé côté CDI (SC7b) pour postuler à des offres — même contrat.
 */

export default function CandidatureModal({
  open,
  publicationTitle,
  onClose,
  onSubmit,
  busy = false,
  error = null,
}: {
  open: boolean
  publicationTitle?: string | null
  onClose: () => void
  /** Soumission gérée par le parent (POST /api/candidatures). Reçoit le
   *  cover_message trimmé ou null si vide. */
  onSubmit: (coverMessage: string | null) => Promise<void> | void
  busy?: boolean
  error?: string | null
}) {
  const t = useTranslations('missions.detail')
  const domain = useDomain()
  const [coverMessage, setCoverMessage] = useState('')

  // Reset à l'ouverture
  useEffect(() => {
    if (open) setCoverMessage('')
  }, [open])

  // Échap pour fermer
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  if (!open) return null

  const handleSubmit = () => {
    void onSubmit(coverMessage.trim() || null)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sk-candidature-modal-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, fontFamily: 'inherit',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        style={{
          background: 'var(--sk-surface)',
          borderRadius: 'var(--sk-r-lg)',
          width: '100%', maxWidth: 560,
          padding: '24px 26px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
        }}
      >
        <h2 id="sk-candidature-modal-title" style={{ fontSize: 18, fontWeight: 700, color: 'var(--sk-text)', letterSpacing: '-0.3px', marginBottom: 6 }}>
          {t('cover_title')}
        </h2>
        {publicationTitle && (
          <div style={{ fontSize: 13, color: 'var(--sk-muted)', marginBottom: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {publicationTitle}
          </div>
        )}
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', lineHeight: 1.55, marginBottom: 14 }}>
          {t('cover_subtitle')}
        </p>

        <textarea
          value={coverMessage}
          onChange={(e) => setCoverMessage(e.target.value)}
          placeholder={t('cover_placeholder')}
          maxLength={2000}
          rows={6}
          disabled={busy}
          style={{
            width: '100%',
            padding: '11px 14px',
            fontSize: 14,
            border: '1px solid var(--sk-border)',
            borderRadius: 10,
            outline: 'none',
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
            lineHeight: 1.55,
            marginBottom: 6,
            background: busy ? 'var(--sk-surface-2)' : 'var(--sk-surface)',
            color: 'var(--sk-text)',
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--sk-faint)', marginBottom: 14 }}>
          {coverMessage.length} / 2000
        </div>

        {error && (
          <div role="alert" style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red)', color: 'var(--sk-red)', padding: '10px 12px', borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: '10px 18px',
              background: 'transparent',
              color: 'var(--sk-muted)',
              border: '1px solid var(--sk-border)',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {t('cover_cancel')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            style={{
              padding: '10px 22px',
              background: domain.primaryColor,
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? t('cover_submitting') : t('cover_submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'

type Props = {
  open: boolean
  initialMin: number | null
  initialMax: number | null
  onClose: () => void
  onSaved: (min: number, max: number) => void
}

const ANIM_MS = 200

export default function TJMQuickEditModal({
  open,
  initialMin,
  initialMax,
  onClose,
  onSaved,
}: Props) {
  const t = useTranslations('dashboard_freelance.tjm_modal')
  const domain = useDomain()
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)
  const [min, setMin] = useState<string>('')
  const [max, setMax] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const minInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  // Reset form + animation when toggling open
  useEffect(() => {
    if (open) {
      setMin(initialMin != null ? String(initialMin) : '')
      setMax(initialMax != null ? String(initialMax) : '')
      setError(null)
      setSaving(false)
      // Trigger entry animation on next frame
      requestAnimationFrame(() => setShow(true))
      // Autofocus min input after animation start
      const id = window.setTimeout(() => minInputRef.current?.focus(), 50)
      return () => window.clearTimeout(id)
    }
    setShow(false)
  }, [open, initialMin, initialMax])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Escape key + focus trap
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        requestClose()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'input, button, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const requestClose = () => {
    if (saving) return
    setShow(false)
    window.setTimeout(onClose, ANIM_MS)
  }

  const handleSave = async () => {
    setError(null)
    const minNum = min === '' ? null : Number(min)
    const maxNum = max === '' ? null : Number(max)

    if (minNum != null && (Number.isNaN(minNum) || minNum < 0)) {
      setError(t('error_invalid'))
      return
    }
    if (maxNum != null && (Number.isNaN(maxNum) || maxNum < 0)) {
      setError(t('error_invalid'))
      return
    }
    if (minNum != null && maxNum != null && minNum >= maxNum) {
      setError(t('error_invalid'))
      return
    }
    if (minNum == null || maxNum == null) {
      setError(t('error_invalid'))
      return
    }

    setSaving(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setError(t('error_save'))
        setSaving(false)
        return
      }
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          'x-subdomain': domain.subdomain,
        },
        body: JSON.stringify({ tjm_min: minNum, tjm_max: maxNum }),
      })
      if (!res.ok) {
        setError(t('error_save'))
        setSaving(false)
        return
      }
      onSaved(minNum, maxNum)
      setShow(false)
      window.setTimeout(onClose, ANIM_MS)
    } catch {
      setError(t('error_save'))
      setSaving(false)
    }
  }

  if (!mounted || !open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tjm-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: show ? 'rgba(15,23,42,0.55)' : 'rgba(15,23,42,0)',
        transition: `background ${ANIM_MS}ms ease`,
        backdropFilter: show ? 'blur(3px)' : 'blur(0px)',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) requestClose()
      }}
    >
      <style>{`
        @keyframes tjm-modal-in-desktop {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes tjm-modal-in-mobile {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .tjm-modal {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          width: 100%;
          max-width: 460px;
          padding: 24px 26px 22px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.18);
          animation: tjm-modal-in-desktop ${ANIM_MS}ms ease both;
        }
        .tjm-modal-input {
          width: 100%;
          height: 44px;
          padding: 0 44px 0 14px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          font-size: 15px;
          color: #0f172a;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          font-family: inherit;
          background: #fff;
        }
        .tjm-modal-input:focus {
          border-color: var(--tjm-primary, #0ea5e9);
          box-shadow: 0 0 0 3px var(--tjm-primary-soft, rgba(14,165,233,0.16));
        }
        .tjm-modal-suffix {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
          font-size: 14px;
          font-weight: 500;
          pointer-events: none;
        }
        .tjm-modal-btn {
          height: 42px;
          padding: 0 18px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid transparent;
          transition: opacity 0.15s, transform 0.12s, box-shadow 0.15s;
          font-family: inherit;
        }
        .tjm-modal-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .tjm-modal-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .tjm-modal-btn-secondary {
          background: #fff;
          border-color: #e2e8f0;
          color: #475569;
        }
        .tjm-modal-btn-secondary:hover:not(:disabled) { background: #f8fafc; }
        .tjm-modal-btn-primary {
          background: var(--tjm-primary, #0ea5e9);
          color: #fff;
        }
        .tjm-modal-btn-primary:hover:not(:disabled) {
          box-shadow: 0 6px 16px var(--tjm-primary-soft, rgba(14,165,233,0.24));
        }
        @media (max-width: 767px) {
          .tjm-modal-wrap {
            align-items: flex-end !important;
          }
          .tjm-modal {
            border-radius: 18px 18px 0 0 !important;
            max-width: 100% !important;
            padding: 22px 20px 24px !important;
            animation: tjm-modal-in-mobile ${ANIM_MS}ms ease both !important;
            max-height: 90vh;
            overflow-y: auto;
          }
        }
      `}</style>

      <div
        ref={dialogRef}
        className="tjm-modal"
        style={{
          opacity: show ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
          // CSS variables consumed by the inline <style> above
          ['--tjm-primary' as string]: domain.primaryColor,
          ['--tjm-primary-soft' as string]: `${domain.primaryColor}28`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h2
              id="tjm-modal-title"
              style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', letterSpacing: '-0.2px', margin: 0 }}
            >
              {t('title')}
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', marginTop: 4, marginBottom: 0 }}>{t('subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label={t('close_aria')}
            disabled={saving}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: 22,
              lineHeight: 1,
              cursor: saving ? 'not-allowed' : 'pointer',
              padding: 4,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
              {t('min_label')}
            </span>
            <span style={{ position: 'relative', display: 'block' }}>
              <input
                ref={minInputRef}
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={min}
                onChange={e => setMin(e.target.value)}
                disabled={saving}
                className="tjm-modal-input"
              />
              <span className="tjm-modal-suffix">€</span>
            </span>
          </label>
          <label style={{ display: 'block' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', display: 'block', marginBottom: 6 }}>
              {t('max_label')}
            </span>
            <span style={{ position: 'relative', display: 'block' }}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                step={50}
                value={max}
                onChange={e => setMax(e.target.value)}
                disabled={saving}
                className="tjm-modal-input"
              />
              <span className="tjm-modal-suffix">€</span>
            </span>
          </label>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 10,
              padding: '10px 12px',
              marginBottom: 14,
              fontSize: 13,
              color: '#b91c1c',
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            onClick={requestClose}
            disabled={saving}
            className="tjm-modal-btn tjm-modal-btn-secondary"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="tjm-modal-btn tjm-modal-btn-primary"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

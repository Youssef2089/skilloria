'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper, { type Area } from 'react-easy-crop'
import { useTranslations } from 'next-intl'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'
import { useSecureFetch } from '@/lib/secure-fetch'

type Props = {
  open: boolean
  currentPhotoUrl: string | null
  onClose: () => void
  onSaved: (newUrl: string) => void
}

const ANIM_MS = 200
const MAX_FILE_SIZE = 2 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const OUTPUT_SIZE = 512
const JPEG_QUALITY = 0.85

async function getCroppedBlob(imageSrc: string, area: Area): Promise<Blob> {
  const image = new Image()
  image.crossOrigin = 'anonymous'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = reject
    image.src = imageSrc
  })

  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT_SIZE
  canvas.height = OUTPUT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) resolve(blob)
        else reject(new Error('Canvas toBlob failed'))
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

export default function AvatarUploadModal({ open, currentPhotoUrl, onClose, onSaved }: Props) {
  const t = useTranslations('dashboard_freelance.avatar_modal')
  const domain = useDomain()
  const secureFetch = useSecureFetch()
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (open) {
      setImageSrc(null)
      setCrop({ x: 0, y: 0 })
      setZoom(1)
      setCroppedAreaPixels(null)
      setError(null)
      setSaving(false)
      requestAnimationFrame(() => setShow(true))
    } else {
      setShow(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

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

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    if (!ALLOWED_TYPES.has(file.type)) {
      setError(t('error_format'))
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError(t('error_size'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setImageSrc(reader.result as string)
      setZoom(1)
      setCrop({ x: 0, y: 0 })
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!imageSrc || !croppedAreaPixels) return
    setSaving(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setError(t('error_save'))
        setSaving(false)
        return
      }
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels)
      const path = `${session.user.id}/avatar.jpg`

      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
      if (uploadErr) {
        console.error('[avatar upload]', uploadErr.message)
        setError(t('error_save'))
        setSaving(false)
        return
      }

      // M3 : bucket 'avatars' PRIVÉ. On ne génère plus d'URL publique — on
      // stocke le CHEMIN storage ('<uid>/avatar.jpg', flag de présence).
      // L'affichage passe désormais par une URL signée serveur (endpoint
      // /api/me/avatar-url + DTO org/admin). NB : l'aperçu immédiat post-upload
      // via `onSaved(path)` cassera tant que le Temps 2 (affichage client) n'est
      // pas branché — comportement attendu, pas de contournement ici.
      const res = await secureFetch('/api/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ photo_url: path }),
      })
      if (!res.ok) {
        setError(t('error_save'))
        setSaving(false)
        return
      }

      onSaved(path)
      setShow(false)
      window.setTimeout(onClose, ANIM_MS)
    } catch (err) {
      console.error('[avatar upload] exception', err)
      setError(t('error_save'))
      setSaving(false)
    }
  }

  if (!mounted || !open) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-modal-title"
      className="avatar-modal-wrap"
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
        @keyframes avatar-modal-in-desktop {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes avatar-modal-in-mobile {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .avatar-modal {
          background: #fff;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          width: 100%;
          max-width: 460px;
          padding: 24px 26px 22px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.18);
          animation: avatar-modal-in-desktop ${ANIM_MS}ms ease both;
        }
        .avatar-cropper-area {
          position: relative;
          width: 100%;
          height: 320px;
          background: #0f172a;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .avatar-zoom-row {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }
        .avatar-zoom-row span { font-size: 12px; font-weight: 600; color: #475569; min-width: 40px; }
        .avatar-zoom-row input[type=range] {
          flex: 1;
          accent-color: var(--avatar-primary, #0ea5e9);
        }
        .avatar-modal-btn {
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
        .avatar-modal-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .avatar-modal-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .avatar-modal-btn-secondary {
          background: #fff;
          border-color: #e2e8f0;
          color: #475569;
        }
        .avatar-modal-btn-secondary:hover:not(:disabled) { background: #f8fafc; }
        .avatar-modal-btn-primary {
          background: var(--avatar-primary, #0ea5e9);
          color: #fff;
        }
        .avatar-modal-btn-primary:hover:not(:disabled) {
          box-shadow: 0 6px 16px var(--avatar-primary-soft, rgba(14,165,233,0.24));
        }
        .avatar-empty-state {
          background: #f8fafc;
          border: 2px dashed #cbd5e1;
          border-radius: 12px;
          padding: 36px 18px;
          text-align: center;
          margin-bottom: 14px;
        }
        @media (max-width: 767px) {
          .avatar-modal-wrap { align-items: flex-end !important; }
          .avatar-modal {
            border-radius: 18px 18px 0 0 !important;
            max-width: 100% !important;
            padding: 22px 20px 24px !important;
            animation: avatar-modal-in-mobile ${ANIM_MS}ms ease both !important;
            max-height: 92vh;
            overflow-y: auto;
          }
          .avatar-cropper-area { height: 280px; }
        }
      `}</style>

      <div
        ref={dialogRef}
        className="avatar-modal"
        style={{
          opacity: show ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
          ['--avatar-primary' as string]: domain.primaryColor,
          ['--avatar-primary-soft' as string]: `${domain.primaryColor}28`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <h2
              id="avatar-modal-title"
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

        {imageSrc ? (
          <>
            <div className="avatar-cropper-area">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
              />
            </div>
            <div className="avatar-zoom-row">
              <span>{t('zoom_label')}</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={e => setZoom(Number(e.target.value))}
                disabled={saving}
                aria-label={t('zoom_label')}
              />
            </div>
          </>
        ) : (
          <div className="avatar-empty-state">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              className="avatar-modal-btn avatar-modal-btn-primary"
              style={{ width: '100%' }}
            >
              {t('choose_file')}
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

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
            className="avatar-modal-btn avatar-modal-btn-secondary"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !imageSrc || !croppedAreaPixels}
            className="avatar-modal-btn avatar-modal-btn-primary"
          >
            {saving ? t('saving') : t('save')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

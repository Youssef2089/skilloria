'use client'

import { useRef, useState, type RefObject } from 'react'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { supabase } from '@/lib/supabase'

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error'

const MAX_SIZE = 5 * 1024 * 1024
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 60_000

export default function ProfilUploadPage() {
  const router = useRouter()
  const domain = useDomain()

  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const cvInputRef = useRef<HTMLInputElement>(null)
  const liInputRef = useRef<HTMLInputElement>(null)

  const busy = status === 'uploading' || status === 'success'

  const requestFile = (ref: RefObject<HTMLInputElement | null>) => {
    setErrorMsg(null)
    if (!consent) {
      setErrorMsg('Veuillez accepter le traitement de vos données pour continuer.')
      return
    }
    ref.current?.click()
  }

  const pollStatus = async (
    jobId: string,
    accessToken: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> => {
    const start = Date.now()
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      const res = await fetch(`/api/profile/cv-status/${jobId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'x-subdomain': domain.subdomain,
        },
      })
      const payload = await res.json().catch(() => ({} as any))
      if (payload?.status === 'done') return { ok: true }
      if (payload?.status === 'failed') {
        return { ok: false, error: payload?.error ?? 'Analyse échouée' }
      }
    }
    return { ok: false, error: 'Délai dépassé, réessayez.' }
  }

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    if (!consent) {
      setErrorMsg('Veuillez accepter le traitement de vos données pour continuer.')
      return
    }
    if (file.size > MAX_SIZE) {
      setErrorMsg('Fichier trop volumineux (max 5 Mo).')
      return
    }
    if (file.type !== 'application/pdf') {
      setErrorMsg('Format non supporté, déposez un PDF.')
      return
    }

    setStatus('uploading')
    setErrorMsg(null)
    setStatusMsg(null)

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setStatus('error')
        setErrorMsg('Session expirée, reconnectez-vous.')
        return
      }

      const form = new FormData()
      form.append('file', file)
      form.append('consent', 'true')

      const res = await fetch('/api/profile/upload-cv', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'x-subdomain': domain.subdomain,
        },
        body: form,
      })
      const payload = await res.json().catch(() => ({} as any))

      if (!res.ok) {
        const code = payload?.code
        if (res.status === 503 && code === 'ai_disabled') {
          setErrorMsg("L'analyse IA est temporairement indisponible, réessayez plus tard.")
        } else if (res.status === 429) {
          const reset = payload?.reset_at
            ? new Date(payload.reset_at).toLocaleString('fr-FR')
            : 'plus tard'
          setErrorMsg(
            `Vous avez atteint la limite de 3 analyses par 24h. Réessayez après ${reset}.`,
          )
        } else if (code === 'file_too_large') {
          setErrorMsg('Fichier trop volumineux (max 5 Mo).')
        } else if (code === 'bad_mime') {
          setErrorMsg('Format non supporté, déposez un PDF.')
        } else if (code === 'consent_missing') {
          setErrorMsg('Veuillez accepter le traitement de vos données pour continuer.')
        } else {
          setErrorMsg(payload?.error || 'Une erreur est survenue, veuillez réessayer.')
        }
        setStatus('error')
        return
      }

      if (payload?.status === 'failed') {
        setErrorMsg(
          `L'analyse a échoué : ${payload.error ?? 'erreur inconnue'}. Vous pouvez réessayer ou compléter manuellement.`,
        )
        setStatus('error')
        return
      }

      if (payload?.status === 'processing' && payload?.jobId) {
        const poll = await pollStatus(payload.jobId, session.access_token)
        if (!poll.ok) {
          setErrorMsg(
            `L'analyse a échoué : ${poll.error}. Vous pouvez réessayer ou compléter manuellement.`,
          )
          setStatus('error')
          return
        }
      } else if (payload?.status !== 'done') {
        setErrorMsg('Une erreur est survenue, veuillez réessayer.')
        setStatus('error')
        return
      }

      setStatus('success')
      setStatusMsg('✅ Analyse terminée, redirection...')
      router.push('/dashboard/freelance/profil/valider')
    } catch (err) {
      console.error('[profil upload] unexpected error', err)
      setErrorMsg('Une erreur est survenue, veuillez réessayer.')
      setStatus('error')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, sans-serif' }}>
      <style>{`
        @keyframes sk-spin { to { transform: rotate(360deg); } }
        @media (max-width: 767px) {
          .profil-grid { grid-template-columns: 1fr !important; }
          .profil-main { padding: 18px !important; }
          .profil-title { font-size: 26px !important; }
        }
      `}</style>

      {/* Header */}
      <div
        style={{
          background: '#fff',
          borderBottom: '1px solid #e5e7eb',
          padding: '0 20px',
          height: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: domain.primaryColor,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {domain.logoUrl ? (
              <img src={domain.logoUrl} alt={domain.name} width={18} height={18} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2L12 22M2 12L22 12M5 5L19 19M19 5L5 19"
                  stroke="white"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>
          <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>{domain.name}</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: '#fef9c3',
            border: '1px solid #fde68a',
            padding: '7px 14px',
            borderRadius: 20,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#eab308' }} />
          <span style={{ fontSize: 13, fontWeight: 500, color: '#92400e', whiteSpace: 'nowrap' }}>
            En attente de vérification
          </span>
        </div>
      </div>

      {/* Main */}
      <div className="profil-main" style={{ maxWidth: 1040, margin: '0 auto', padding: 32 }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/freelance')}
          style={{
            background: 'transparent',
            border: 'none',
            color: domain.primaryColor,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            padding: 0,
            marginBottom: 24,
          }}
        >
          ← Retour au tableau de bord
        </button>

        {errorMsg && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 20,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ color: '#dc2626', fontSize: 13, flex: 1, lineHeight: 1.55 }}>
              {errorMsg}
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label="Fermer"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#991b1b',
                fontSize: 20,
                cursor: 'pointer',
                lineHeight: 1,
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        )}

        <h1
          className="profil-title"
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: '#0f172a',
            letterSpacing: '-0.3px',
            marginBottom: 8,
          }}
        >
          Créez votre profil
        </h1>
        <p style={{ fontSize: 15, color: '#64748b', lineHeight: 1.6, marginBottom: 32, maxWidth: 640 }}>
          Notre IA analyse votre document et pré-remplit votre profil. Vous validez, c'est prêt.
        </p>

        <div
          className="profil-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 20,
            marginBottom: 24,
          }}
        >
          {/* CV card */}
          <div
            style={{
              position: 'relative',
              background: '#fff',
              borderRadius: 16,
              border: `2px solid ${domain.primaryColor}`,
              padding: 24,
              opacity: busy ? 0.55 : 1,
              pointerEvents: busy ? 'none' : 'auto',
              transition: 'opacity 0.2s',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                background: domain.primaryColor,
                color: '#fff',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.05em',
                padding: '4px 10px',
                borderRadius: 100,
              }}
            >
              RECOMMANDÉ
            </span>

            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: `${domain.primaryColor}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path
                  d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                  stroke={domain.primaryColor}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <polyline
                  points="14 2 14 8 20 8"
                  fill="none"
                  stroke={domain.primaryColor}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: '#0f172a',
                marginBottom: 6,
                letterSpacing: '-0.3px',
              }}
            >
              Importer mon CV
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, marginBottom: 18 }}>
              Déposez votre CV au format PDF. Notre IA extrait vos compétences, expériences et
              certifications.
            </p>

            <button
              type="button"
              onClick={() => requestFile(cvInputRef)}
              disabled={busy}
              style={{
                width: '100%',
                background: `${domain.primaryColor}08`,
                border: `2px dashed ${domain.primaryColor}66`,
                borderRadius: 12,
                padding: '22px 16px',
                color: domain.primaryColor,
                cursor: busy ? 'not-allowed' : 'pointer',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Déposez ou cliquez pour sélectionner
              </div>
              <div style={{ fontSize: 11, color: '#64748b', fontWeight: 500 }}>PDF · 5 Mo max</div>
            </button>
            <input
              ref={cvInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>

          {/* LinkedIn card */}
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              border: '1px solid #e2e8f0',
              padding: 24,
              opacity: busy ? 0.55 : 1,
              pointerEvents: busy ? 'none' : 'auto',
              transition: 'opacity 0.2s',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: '#e0e7ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="#0a66c2">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.024-3.037-1.852-3.037-1.853 0-2.136 1.446-2.136 2.94v5.666H9.352V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.602 0 4.268 2.37 4.268 5.455v6.286zM5.337 7.433a2.063 2.063 0 0 1-2.063-2.065 2.063 2.063 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z" />
              </svg>
            </div>

            <h2
              style={{
                fontSize: 18,
                fontWeight: 800,
                color: '#0f172a',
                marginBottom: 6,
                letterSpacing: '-0.3px',
              }}
            >
              Depuis LinkedIn
            </h2>
            <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.55, marginBottom: 14 }}>
              Pas de CV ? Téléchargez votre profil LinkedIn en PDF puis déposez-le ici.
            </p>

            <ol
              style={{
                fontSize: 12,
                color: '#475569',
                lineHeight: 1.7,
                paddingLeft: 18,
                marginBottom: 18,
              }}
            >
              <li>Ouvrez votre profil LinkedIn</li>
              <li>
                Cliquez sur <strong>Ressources</strong>
              </li>
              <li>
                Choisissez <strong>Enregistrer au format PDF</strong>
              </li>
            </ol>

            <button
              type="button"
              onClick={() => requestFile(liInputRef)}
              disabled={busy}
              style={{
                width: '100%',
                background: '#f8fafc',
                border: '2px dashed #cbd5e1',
                borderRadius: 12,
                padding: '22px 16px',
                color: '#475569',
                cursor: busy ? 'not-allowed' : 'pointer',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
                Déposez ou cliquez pour sélectionner
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>PDF · 5 Mo max</div>
            </button>
            <input
              ref={liInputRef}
              type="file"
              accept="application/pdf"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>
        </div>

        {/* Consent */}
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: 16,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            marginBottom: 20,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={e => setConsent(e.target.checked)}
            style={{ marginTop: 3, flexShrink: 0, accentColor: domain.primaryColor }}
          />
          <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.6 }}>
            J'accepte que mon CV soit analysé par Anthropic Claude (États-Unis, garanties
            contractuelles SCC) pour pré-remplir mon profil. Le PDF est stocké de manière privée et
            supprimé automatiquement après 90 jours.{' '}
            <span style={{ color: domain.primaryColor, fontWeight: 600 }}>
              En savoir plus sur le traitement de mes données →
            </span>
          </span>
        </label>

        {/* Yellow locked banner */}
        <div
          style={{
            background: '#fef9c3',
            border: '1px solid #fde68a',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#fef08a',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01"
                stroke="#92400e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ fontSize: 13, color: '#92400e', lineHeight: 1.6 }}>
            <strong>Profil en attente de complétion.</strong> Les fonctionnalités Missions,
            Candidatures, Messagerie et Publication restent verrouillées tant que votre profil
            n'est pas complété et validé par l'IA.
          </div>
        </div>
      </div>

      {/* Uploading overlay */}
      {status === 'uploading' && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: '28px 32px',
              textAlign: 'center',
              maxWidth: 340,
              boxShadow: '0 20px 50px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: `3px solid ${domain.primaryColor}22`,
                borderTopColor: domain.primaryColor,
                margin: '0 auto 14px',
                animation: 'sk-spin 0.9s linear infinite',
              }}
            />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
              Analyse en cours...
            </div>
            <div style={{ fontSize: 13, color: '#64748b' }}>5 à 30 secondes</div>
          </div>
        </div>
      )}

      {/* Success overlay */}
      {status === 'success' && statusMsg && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              padding: '22px 28px',
              fontSize: 15,
              fontWeight: 600,
              color: '#0f172a',
            }}
          >
            {statusMsg}
          </div>
        </div>
      )}
    </div>
  )
}

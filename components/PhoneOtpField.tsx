'use client'

import { useEffect, useRef, useState } from 'react'
import { normalizeE164 } from '@/lib/phone'

/**
 * PhoneOtpField — champ téléphone + vérification OTP Vonage, autonome.
 *
 * Porté À L'IDENTIQUE du bloc de inscription/organisation (parcours en
 * production), avec les pièges déjà évités :
 *   P2 — `previousRequestId` SURVIT au reset de `otpRequestId` (cas mauvais
 *        code → « Renvoyer ») pour que le prochain envoi demande à l'API
 *        d'annuler la session Vonage active (sinon 409 « Concurrent »).
 *   P6 — sur erreur de code : reset `otpRequestId` + cooldown à 0 + cases
 *        retirées du DOM, erreur affichée hors du bloc conditionnel.
 *
 * Namespace-agnostique : tous les libellés arrivent via `labels`, si bien que
 * l'org (`inscription_org`) et l'expert (`signup_form`) le réutilisent sans
 * dupliquer le wording. La vérification réussie remonte le `phone_otp_token`
 * au parent via `onVerified` ; le parent détient le token (il en a besoin pour
 * le submit) et passe `verified`.
 */

const COOLDOWN_SECONDS = 60
const OTP_LENGTH = 6

export type PhoneOtpLabels = {
  phone_label: string
  phone_placeholder: string
  send_sms_button: string
  resend_sms_label: (seconds: number) => string
  code_label: string
  code_invalid: string
  phone_verified: string
  /** Message « numéro invalide » — distinct de vonage_error (service indispo.). */
  invalid_phone: string
  rate_limited: string
  vonage_error: string
  /** D4 — lien « Modifier le numéro » (sortie de l'état vérifié). */
  edit_number: string
}

export type PhoneOtpFieldProps = {
  phone: string
  onPhoneChange: (value: string) => void
  /** Appelé au succès OTP avec le phone_otp_token (HMAC, TTL 15 min). */
  onVerified: (token: string) => void
  /** true si le parent détient un token valide (champ verrouillé + coché). */
  verified: boolean
  primaryColor: string
  labels: PhoneOtpLabels
  /** D1/D6 — le numéro est déjà rattaché à un compte (avant tout envoi SMS). */
  onPhoneTaken?: () => void
  /** D4 — l'utilisateur relâche l'état vérifié pour saisir un autre numéro. */
  onEdit?: () => void
}

/**
 * Validation UI ALIGNÉE sur le serveur : le bouton « Envoyer SMS » ne doit être
 * actif que pour un numéro que le serveur (lib/phone.normalizeE164, même
 * bibliothèque) acceptera. Sans cet alignement, un numéro structurellement
 * E.164 mais non attribuable (ex. +3312345678) passait une regex laxiste →
 * bouton actif → le serveur le rejetait (invalid_phone) → le message générique
 * « Service SMS indisponible » s'affichait à tort. On refuse en amont.
 */
function isPhoneValid(phone: string): boolean {
  return normalizeE164(phone) !== null
}

export default function PhoneOtpField(props: PhoneOtpFieldProps) {
  const { phone, onPhoneChange, onVerified, verified, primaryColor, labels, onPhoneTaken, onEdit } = props

  const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
  // Survit au reset de otpRequestId (P2).
  const [previousRequestId, setPreviousRequestId] = useState<string | null>(null)
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([])

  const phoneOk = isPhoneValid(phone)

  useEffect(() => {
    if (cooldownLeft <= 0) return
    const id = setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldownLeft])

  const inputBase: React.CSSProperties = {
    width: '100%',
    padding: '11px 14px',
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
    background: '#fff',
    color: '#0f172a',
    boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    marginBottom: 6,
  }

  async function handleSendSms() {
    setPhoneError(null)
    setOtpError(null)
    if (!phoneOk) {
      // Numéro invalide (≠ service SMS indisponible).
      setPhoneError(labels.invalid_phone)
      return
    }
    const prev = previousRequestId
    setPreviousRequestId(null)
    setOtpRequestId(null)
    setOtpDigits(Array(OTP_LENGTH).fill(''))
    setOtpSending(true)
    try {
      const res = await fetch('/api/auth/public/send-phone-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, ...(prev ? { previous_request_id: prev } : {}) }),
      })
      const json = (await res.json().catch(() => ({}))) as { request_id?: string; code?: string }
      if (!res.ok || !json.request_id) {
        // D1/D6 : numéro déjà rattaché à un compte (refus AVANT tout SMS) → on
        // délègue au parent l'affichage du message de récupération ; pas d'erreur
        // « technique » ici.
        if (json.code === 'phone_already_used') {
          onPhoneTaken?.()
          return
        }
        // Message PRÉCIS selon le code serveur : un numéro rejeté par la
        // validation stricte (invalid_phone / vonage_invalid_request) ne doit
        // PAS s'afficher comme « Service SMS indisponible ».
        if (json.code === 'rate_limited') setPhoneError(labels.rate_limited)
        else if (json.code === 'invalid_phone' || json.code === 'vonage_invalid_request') setPhoneError(labels.invalid_phone)
        else setPhoneError(labels.vonage_error)
        return
      }
      setOtpRequestId(json.request_id)
      setPreviousRequestId(json.request_id)
      setCooldownLeft(COOLDOWN_SECONDS)
      setTimeout(() => otpInputRefs.current[0]?.focus(), 50)
    } catch {
      setPhoneError(labels.vonage_error)
    } finally {
      setOtpSending(false)
    }
  }

  async function verifyOtp(code: string) {
    if (!otpRequestId) return
    setOtpVerifying(true)
    setOtpError(null)
    try {
      const res = await fetch('/api/auth/public/verify-phone-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: otpRequestId, code, phone }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        phone_verified?: boolean
        phone_otp_token?: string
        code?: string
      }
      if (!res.ok || !json.phone_verified || !json.phone_otp_token) {
        // Rate-limit : Vonage PAS appelé → le request_id reste valide, on garde l'état.
        if (json.code === 'rate_limited') {
          setPhoneError(labels.rate_limited)
          setOtpDigits(Array(OTP_LENGTH).fill(''))
          return
        }
        // P6 : request_id consommé (code faux/expiré) → reset propre + cooldown 0.
        if (otpRequestId) setPreviousRequestId(otpRequestId)
        setPhoneError(labels.code_invalid)
        setOtpDigits(Array(OTP_LENGTH).fill(''))
        setOtpRequestId(null)
        setCooldownLeft(0)
        return
      }
      onVerified(json.phone_otp_token)
    } catch {
      // Réseau : état Vonage inconnu → on invalide par sécurité (P6).
      if (otpRequestId) setPreviousRequestId(otpRequestId)
      setPhoneError(labels.code_invalid)
      setOtpDigits(Array(OTP_LENGTH).fill(''))
      setOtpRequestId(null)
      setCooldownLeft(0)
    } finally {
      setOtpVerifying(false)
    }
  }

  // D4 — « Modifier le numéro » : relâche l'état vérifié SANS toucher aux autres
  // champs (le parent gère son token via onEdit), redonne le champ saisissable,
  // réactive « Envoyer SMS », purge la session Vonage courante (best-effort) et
  // efface les erreurs. Aucun état de formulaire n'est perdu.
  function handleEdit() {
    const rid = otpRequestId ?? previousRequestId
    setOtpRequestId(null)
    setPreviousRequestId(null)
    setOtpDigits(Array(OTP_LENGTH).fill(''))
    setPhoneError(null)
    setOtpError(null)
    setCooldownLeft(0)
    onEdit?.()
    if (rid) {
      // Best-effort : jamais bloquant, échec silencieux.
      void fetch('/api/auth/public/cancel-phone-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: rid }),
      }).catch(() => {})
    }
  }

  function handleOtpChange(idx: number, raw: string) {
    const cleaned = raw.replace(/\D/g, '')
    if (cleaned.length === 0) {
      const next = [...otpDigits]
      next[idx] = ''
      setOtpDigits(next)
      return
    }
    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, OTP_LENGTH).split('')
      const next = Array(OTP_LENGTH).fill('')
      chars.forEach((c, i) => {
        next[i] = c
      })
      setOtpDigits(next)
      const lastIdx = Math.min(chars.length, OTP_LENGTH) - 1
      otpInputRefs.current[lastIdx]?.focus()
      if (chars.length === OTP_LENGTH) void verifyOtp(chars.join(''))
      return
    }
    const next = [...otpDigits]
    next[idx] = cleaned[0]
    setOtpDigits(next)
    if (idx < OTP_LENGTH - 1) otpInputRefs.current[idx + 1]?.focus()
    if (next.every((d) => d.length === 1)) void verifyOtp(next.join(''))
  }

  function handleOtpKeyDown(idx: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && otpDigits[idx] === '' && idx > 0) {
      otpInputRefs.current[idx - 1]?.focus()
    }
  }

  const sendDisabled = otpSending || cooldownLeft > 0 || verified || !phoneOk

  return (
    <div>
      <label htmlFor="phone" style={labelStyle}>
        {labels.phone_label} *
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200, display: 'flex', alignItems: 'center' }}>
          <span aria-hidden style={{ position: 'absolute', left: 12, fontSize: 16, pointerEvents: 'none' }}>
            🇫🇷
          </span>
          <input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => {
              onPhoneChange(e.target.value)
              if (phoneError) setPhoneError(null)
            }}
            placeholder={labels.phone_placeholder}
            style={{
              ...inputBase,
              paddingLeft: 38,
              background: verified ? '#f1f5f9' : '#fff',
              borderColor: verified ? '#22c55e' : '#cbd5e1',
            }}
            readOnly={verified}
            required
          />
          {verified && (
            <span aria-hidden style={{ position: 'absolute', right: 12, color: '#22c55e', fontSize: 18, fontWeight: 700 }}>
              ✓
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSendSms}
          disabled={sendDisabled}
          style={{
            padding: '11px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: '#fff',
            background: sendDisabled ? '#94a3b8' : primaryColor,
            border: 'none',
            borderRadius: 8,
            cursor: sendDisabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            fontFamily: 'inherit',
          }}
        >
          {cooldownLeft > 0 ? labels.resend_sms_label(cooldownLeft) : labels.send_sms_button}
        </button>
      </div>

      {phoneError && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{phoneError}</div>}

      {verified && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>✓ {labels.phone_verified}</span>
          {/* D4 — sortie de l'état vérifié, sans perte de formulaire. */}
          <button
            type="button"
            onClick={handleEdit}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              fontSize: 13,
              fontWeight: 600,
              color: primaryColor,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {labels.edit_number}
          </button>
        </div>
      )}

      {otpRequestId && !verified && (
        <div style={{ marginTop: 12 }}>
          <label style={labelStyle}>{labels.code_label}</label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <input
                key={i}
                ref={(el) => {
                  otpInputRefs.current[i] = el
                }}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={i === 0 ? OTP_LENGTH : 1}
                value={otpDigits[i]}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(i, e)}
                disabled={otpVerifying}
                aria-label={`Code digit ${i + 1}`}
                style={{
                  width: 42,
                  height: 50,
                  textAlign: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  border: `1px solid ${otpError ? '#dc2626' : '#cbd5e1'}`,
                  borderRadius: 8,
                  outline: 'none',
                  background: '#fff',
                  color: '#0f172a',
                  boxSizing: 'border-box',
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

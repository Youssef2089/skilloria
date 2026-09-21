'use client'

import { useEffect, useRef, useState } from 'react'
import SaisieTelephone from '@/components/phone/SaisieTelephone'

/**
 * PhoneOtpField — LE SEUL parcours de vérification de téléphone du dépôt.
 *
 * ═══ CE QU'IL REMPLACE ════════════════════════════════════════════════════
 *   Trois parcours faisaient la même chose de trois façons : inscription
 *   expert (ici), inscription organisation (≈200 lignes recopiées), paramètres
 *   du compte (un `toE164` local qui inventait un `+33`). Trois validations,
 *   trois tables d'erreurs, et un correctif de l'un jamais rétroporté à
 *   l'autre. Ce n'était pas trois défauts : c'était UN défaut recopié.
 *
 * ═══ CE QUE L'ÉCRAN AFFIRME, ET CE QU'IL NE PEUT PAS AFFIRMER ════════════
 *   Vonage Verify v2 est ASYNCHRONE : il rend un `request_id` pour dire que la
 *   DEMANDE est acceptée, puis peut bloquer l'envoi — c'est ce qui arrive sur
 *   la Tunisie, où les journaux affichent BLOCKED APRÈS cette réponse.
 *
 *   Sans webhook (choix différé, cf. §H de CLAUDE.md), le serveur ne peut pas
 *   savoir si le message a été remis. L'écran dit donc « demande transmise »,
 *   pas « SMS envoyé », et OUVRE UNE SORTIE quand le compteur expire : un lien
 *   vers le formulaire de contact, prérempli avec le numéro et le pays.
 *   Un utilisateur qui ne reçoit rien doit pouvoir faire quelque chose ; le
 *   laisser regarder un compteur tourner est un écran mort.
 *
 * ═══ PIÈGES DÉJÀ PAYÉS, CONSERVÉS ════════════════════════════════════════
 *   P2 — `previousRequestId` SURVIT au reset de `otpRequestId` (cas mauvais
 *        code → « Renvoyer ») pour que le prochain envoi demande à l'API
 *        d'annuler la session Vonage active (sinon 409 « Concurrent »).
 *   P6 — sur erreur de code : reset `otpRequestId` + compteur à 0 + cases
 *        retirées du DOM, erreur affichée hors du bloc conditionnel.
 *
 * Namespace-agnostique : tous les libellés arrivent via `labels`, si bien que
 * les trois appelants le réutilisent sans dupliquer le wording.
 */

const COOLDOWN_SECONDS = 60
const OTP_LENGTH = 6

/** Chemins des routes OTP. L'appelant choisit la paire publique ou authentifiée. */
export type PhoneOtpEndpoints = {
  send: string
  verify: string
  /** Annulation best-effort de la session Vonage. Absent = pas d'annulation. */
  cancel?: string
}

export type PhoneOtpLabels = {
  phone_label: string
  pays_label: string
  send_sms_button: string
  resend_sms_label: (seconds: number) => string
  code_label: string
  code_invalid: string
  phone_verified: string
  /** « Demande transmise » — JAMAIS « SMS envoyé », cf. l'en-tête. */
  demande_transmise: string
  invalid_phone: string
  rate_limited: string
  vonage_error: string
  /** Les SMS ne partent pas vers ce pays : ce refus a une ISSUE. */
  pays_non_pris_en_charge: string
  /** Une vérification est déjà en cours sur ce numéro. */
  verification_en_cours: string
  /** Lien de sortie, affiché quand le compteur est écoulé. */
  pas_recu: string
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
  /** Routes à appeler. Par défaut : les routes PUBLIQUES d'inscription. */
  endpoints?: PhoneOtpEndpoints
  /** En-têtes additionnels (jeton de ré-authentification des paramètres). */
  extraHeaders?: () => Promise<Record<string, string> | null>
  /** D1/D6 — le numéro est déjà rattaché à un compte (avant tout envoi SMS). */
  onPhoneTaken?: () => void
  /** D4 — l'utilisateur relâche l'état vérifié pour saisir un autre numéro. */
  onEdit?: () => void
  /** Construit le lien de sortie « je ne reçois pas le code ». */
  lienAide?: (phone: string, paysIso: string) => string
}

const ENDPOINTS_PUBLICS: PhoneOtpEndpoints = {
  send: '/api/auth/public/send-phone-otp',
  verify: '/api/auth/public/verify-phone-otp',
  cancel: '/api/auth/public/cancel-phone-otp',
}

export default function PhoneOtpField(props: PhoneOtpFieldProps) {
  const {
    phone,
    onPhoneChange,
    onVerified,
    verified,
    primaryColor,
    labels,
    endpoints = ENDPOINTS_PUBLICS,
    extraHeaders,
    onPhoneTaken,
    onEdit,
    lienAide,
  } = props

  const [paysIso, setPaysIso] = useState('')
  const [otpRequestId, setOtpRequestId] = useState<string | null>(null)
  // Survit au reset de otpRequestId (P2).
  const [previousRequestId, setPreviousRequestId] = useState<string | null>(null)
  const [otpDigits, setOtpDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [cooldownLeft, setCooldownLeft] = useState(0)
  /** `true` dès qu'une demande a été TRANSMISE — jamais « le SMS est parti ». */
  const [demandeTransmise, setDemandeTransmise] = useState(false)
  const otpInputRefs = useRef<Array<HTMLInputElement | null>>([])

  // La validité est celle du composant de saisie : il ne rend un E.164 que
  // pour un numéro valide et complet. Aucune regex ici — c'est une regex
  // laxiste recopiée qui a fait afficher « Service SMS indisponible » à des
  // numéros simplement mal saisis.
  const phoneOk = phone.length > 0

  useEffect(() => {
    if (cooldownLeft <= 0) return
    const id = setInterval(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldownLeft])

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--sk-muted)',
    marginBottom: 6,
  }

  /**
   * Traduit le code serveur en message AFFICHABLE.
   *
   * UNE SEULE table, partagée par les trois appelants. Avant, chacun avait la
   * sienne : l'organisation faisait tomber `invalid_phone` dans « service
   * indisponible » alors que la clé existait, et les paramètres du compte
   * écrasaient tout en « une erreur est survenue ».
   */
  function messagePour(code: string | undefined): string {
    switch (code) {
      case 'rate_limited':
        return labels.rate_limited
      case 'invalid_phone':
      case 'vonage_invalid_request':
        return labels.invalid_phone
      case 'sms_pays_non_pris_en_charge':
        return labels.pays_non_pris_en_charge
      case 'verification_en_cours':
        return labels.verification_en_cours
      default:
        return labels.vonage_error
    }
  }

  async function handleSendSms() {
    setPhoneError(null)
    if (!phoneOk) {
      setPhoneError(labels.invalid_phone)
      return
    }
    const prev = previousRequestId
    setPreviousRequestId(null)
    setOtpRequestId(null)
    setDemandeTransmise(false)
    setOtpDigits(Array(OTP_LENGTH).fill(''))
    setOtpSending(true)
    try {
      const entetes: Record<string, string> = { 'content-type': 'application/json' }
      if (extraHeaders) {
        const sup = await extraHeaders()
        // `null` = l'utilisateur a renoncé à la ré-authentification. On ne
        // part pas sans, et on ne laisse pas non plus un état « en cours ».
        if (!sup) {
          setOtpSending(false)
          return
        }
        Object.assign(entetes, sup)
      }
      const res = await fetch(endpoints.send, {
        method: 'POST',
        headers: entetes,
        body: JSON.stringify({ phone, ...(prev ? { previous_request_id: prev } : {}) }),
      })
      const json = (await res.json().catch(() => ({}))) as { request_id?: string; code?: string }
      if (!res.ok || !json.request_id) {
        // D1/D6 : numéro déjà rattaché à un compte (refus AVANT tout SMS) → on
        // délègue au parent l'affichage du message de récupération.
        if (json.code === 'phone_already_used') {
          onPhoneTaken?.()
          return
        }
        setPhoneError(messagePour(json.code))
        return
      }
      setOtpRequestId(json.request_id)
      setPreviousRequestId(json.request_id)
      setDemandeTransmise(true)
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
    try {
      const res = await fetch(endpoints.verify, {
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
        // P6 : request_id consommé (code faux/expiré) → reset propre + compteur 0.
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
  // champs, redonne le champ saisissable, purge la session Vonage courante
  // (best-effort) et efface les erreurs.
  function handleEdit() {
    const rid = otpRequestId ?? previousRequestId
    setOtpRequestId(null)
    setPreviousRequestId(null)
    setOtpDigits(Array(OTP_LENGTH).fill(''))
    setPhoneError(null)
    setDemandeTransmise(false)
    setCooldownLeft(0)
    onEdit?.()
    if (rid && endpoints.cancel) {
      void fetch(endpoints.cancel, {
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
  // La sortie n'apparaît QUE quand attendre a cessé d'être une réponse : une
  // demande transmise, le compteur écoulé, et toujours pas de numéro vérifié.
  const montrerSortie = demandeTransmise && !verified && cooldownLeft === 0

  return (
    <div>
      <SaisieTelephone
        value={phone}
        onChange={(e164, iso) => {
          setPaysIso(iso)
          onPhoneChange(e164)
          if (phoneError) setPhoneError(null)
        }}
        primaryColor={primaryColor}
        verrouille={verified}
        hasError={!!phoneError}
        libelles={{ label: labels.phone_label, pays_label: labels.pays_label }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleSendSms}
          disabled={sendDisabled}
          style={{
            padding: '11px 16px',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--sk-sur-accent)',
            background: sendDisabled ? 'var(--sk-muted)' : primaryColor,
            border: 'none',
            borderRadius: 10,
            cursor: sendDisabled ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            fontFamily: 'inherit',
            minHeight: 44,
          }}
        >
          {cooldownLeft > 0 ? labels.resend_sms_label(cooldownLeft) : labels.send_sms_button}
        </button>
      </div>

      {phoneError && <div style={{ fontSize: 13, color: 'var(--sk-red)', marginTop: 8 }}>{phoneError}</div>}

      {/* « Demande transmise », jamais « SMS envoyé » : on ne sait pas si le
          message a été remis, et l'affirmer serait un écran mort. */}
      {demandeTransmise && !verified && !phoneError && (
        <div style={{ fontSize: 13, color: 'var(--sk-muted)', marginTop: 8 }}>{labels.demande_transmise}</div>
      )}

      {/* LA SORTIE. Aucun canal nouveau : le formulaire de contact existant,
          prérempli avec le numéro et le pays — sans quoi le support devrait
          deviner le pays depuis l'indicatif, et « +1 » ne tranche pas entre les
          États-Unis et le Canada. */}
      {montrerSortie && lienAide && (
        <div style={{ marginTop: 8 }}>
          <a
            href={lienAide(phone, paysIso)}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: primaryColor,
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            {labels.pas_recu}
          </a>
        </div>
      )}

      {verified && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--sk-success)', fontWeight: 600 }}>✓ {labels.phone_verified}</span>
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
          <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', maxWidth: 320 }}>
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
                aria-label={`${labels.code_label} ${i + 1}`}
                style={{
                  width: '100%',
                  minWidth: 0,
                  height: 50,
                  textAlign: 'center',
                  fontSize: 18,
                  fontWeight: 700,
                  border: '1.5px solid var(--sk-border)',
                  borderRadius: 10,
                  outline: 'none',
                  background: 'var(--sk-surface)',
                  color: 'var(--sk-text)',
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

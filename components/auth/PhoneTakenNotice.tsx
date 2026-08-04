'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'

/**
 * Message ORIENTÉ RÉCUPÉRATION (D6) affiché quand le numéro saisi est déjà
 * rattaché à un compte vérifié (code 'phone_already_used' renvoyé AVANT l'envoi
 * du SMS, cf. send-phone-otp). Le cas de loin le plus fréquent est « c'est mon
 * numéro, j'ai déjà un compte » : on propose la connexion, la récupération de
 * mot de passe, et la saisie d'un autre numéro. Aucune formulation accusatoire,
 * aucune info sur le compte détenteur.
 *
 * Source UNIQUE partagée par l'inscription expert ET l'inscription organisation
 * (namespace i18n dédié `phone_taken`, 4 langues). Les deux pages ne font que le
 * câbler : liens locale-aware + callback « saisir un autre numéro ».
 */
export default function PhoneTakenNotice({
  primaryColor,
  onUseAnotherNumber,
}: {
  primaryColor: string
  onUseAnotherNumber: () => void
}) {
  const t = useTranslations('phone_taken')

  const linkStyle: React.CSSProperties = {
    color: primaryColor,
    fontWeight: 600,
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  }

  return (
    <div
      role="status"
      style={{
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: 10,
        padding: '12px 14px',
        marginTop: 8,
        fontSize: 13,
        color: '#1e3a5f',
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('title')}</div>
      <p style={{ margin: '0 0 10px' }}>{t('body')}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', alignItems: 'center' }}>
        <Link href="/connexion" style={linkStyle}>{t('action_login')}</Link>
        <Link href="/mot-de-passe-oublie" style={linkStyle}>{t('action_reset')}</Link>
        <button
          type="button"
          onClick={onUseAnotherNumber}
          style={{
            ...linkStyle,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          {t('action_change')}
        </button>
      </div>
    </div>
  )
}

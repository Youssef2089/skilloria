'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import { LOGO_TAILLE_MAX_OCTETS, LOGO_TYPES_ACCEPTES } from '@/lib/org-logo'

/**
 * EcosystemeVisuelUpload — le logo et le favicon d'un écosystème, DÉPOSÉS.
 *
 * Jumeau de `OrgLogoUpload`, pour l'autre moitié du même défaut : c'étaient
 * deux champs texte, et l'adresse saisie partait telle quelle dans un
 * `<img src>` de la Navbar, du Footer, des pages légales et de contact — donc
 * chez TOUT VISITEUR, y compris non connecté, et sans CSP dans le dépôt.
 *
 * Deux composants plutôt qu'un seul générique : les contextes ne partagent ni
 * la route, ni la garde, ni le vocabulaire, ni le modèle de bucket (privé et
 * signé d'un côté, public et dérivé de l'autre). Un composant à quatre
 * paramètres de configuration aurait caché ces différences au lieu de les dire.
 * Ce qui DOIT être partagé l'est, et c'est `lib/org-logo.ts` : les bornes et la
 * vérification de contenu.
 */

const MO = 1024 * 1024

export default function EcosystemeVisuelUpload({
  ecosystemeId,
  kind,
  /** Adresse publique servie par la route, ou null. Jamais fabriquée ici. */
  urlActuelle,
  onChange,
}: {
  ecosystemeId: string
  kind: 'logo' | 'favicon'
  urlActuelle: string | null
  onChange?: () => void
}) {
  const t = useTranslations('admin_ecosystemes')
  const secureFetch = useSecureFetch()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [url, setUrl] = useState<string | null>(urlActuelle)
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<string | null>(null)

  const base = `/api/admin/ecosystemes/${ecosystemeId}/visuel?kind=${kind}`
  const tailleMax = Math.round(LOGO_TAILLE_MAX_OCTETS / MO)
  const formats = LOGO_TYPES_ACCEPTES.map((m) => m.replace('image/', '').toUpperCase()).join(' · ')

  /**
   * Un refus DIT ce qui bloque. Les codes sont ceux de `lib/org-logo.ts`, les
   * mêmes que côté organisation — une seule table de correspondance, pas deux.
   */
  function phraseDeRefus(code: string | undefined): string {
    switch (code) {
      case 'logo_trop_volumineux':
        return t('visuel.refus_trop_volumineux', { taille: tailleMax })
      case 'logo_format_refuse':
        return t('visuel.refus_format', { formats })
      case 'logo_contenu_non_conforme':
        return t('visuel.refus_contenu')
      case 'logo_type_incoherent':
        return t('visuel.refus_type_incoherent')
      case 'logo_stockage_indisponible':
        return t('visuel.refus_stockage')
      case 'config_missing':
        return t('visuel.refus_config_absente')
      default:
        return t('visuel.refus_inconnu')
    }
  }

  async function deposer(fichier: File) {
    setRefus(null)
    // Pré-vérifications de CONFORT — le serveur refait tout sur les octets.
    if (fichier.size > LOGO_TAILLE_MAX_OCTETS) {
      setRefus(phraseDeRefus('logo_trop_volumineux'))
      return
    }
    setEnCours(true)
    try {
      const corps = new FormData()
      corps.append('file', fichier)
      const res = await secureFetch(base, { method: 'POST', body: corps })
      const body = (await res.json().catch(() => ({}))) as { code?: string; url?: string | null }
      if (!res.ok) {
        setRefus(phraseDeRefus(body.code))
        return
      }
      // Anti-cache : l'adresse publique est STABLE (elle dérive de l'identifiant),
      // donc le navigateur resservirait l'ancienne image après un remplacement.
      // Le paramètre n'est pas stocké : il ne vit que dans cet écran.
      setUrl(body.url ? `${body.url}?v=${Date.now()}` : null)
      onChange?.()
    } catch {
      setRefus(phraseDeRefus('logo_stockage_indisponible'))
    } finally {
      setEnCours(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function retirer() {
    setRefus(null)
    setEnCours(true)
    try {
      const res = await secureFetch(base, { method: 'DELETE' })
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        setRefus(phraseDeRefus(body.code))
        return
      }
      setUrl(null)
      onChange?.()
    } catch {
      setRefus(phraseDeRefus('logo_stockage_indisponible'))
    } finally {
      setEnCours(false)
    }
  }

  const inputId = `visuel-${kind}-${ecosystemeId}`

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
        {t(`fields.${kind === 'logo' ? 'logo_url' : 'favicon_url'}`)}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            width={40}
            height={40}
            // État vide délibéré si le fichier ne se charge pas — jamais
            // l'icône d'image cassée du navigateur.
            onError={() => setUrl(null)}
            style={{ width: 40, height: 40, borderRadius: 8, objectFit: 'cover', border: '1px solid #e2e8f0' }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              border: '1px dashed #cbd5e1',
              background: '#f8fafc',
            }}
          />
        )}

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={LOGO_TYPES_ACCEPTES.join(',')}
          disabled={enCours}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void deposer(f)
          }}
          style={{ display: 'none' }}
        />
        <label
          htmlFor={inputId}
          style={{
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            padding: '7px 13px',
            fontSize: 12,
            fontWeight: 600,
            cursor: enCours ? 'default' : 'pointer',
            opacity: enCours ? 0.6 : 1,
            background: '#fff',
          }}
        >
          {enCours ? t('visuel.en_cours') : url ? t('visuel.remplacer') : t('visuel.deposer')}
        </label>

        {url && (
          <button
            type="button"
            onClick={() => void retirer()}
            disabled={enCours}
            style={{
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '7px 13px',
              fontSize: 12,
              fontWeight: 600,
              cursor: enCours ? 'default' : 'pointer',
              background: '#fff',
              color: '#b91c1c',
              fontFamily: 'inherit',
            }}
          >
            {t('visuel.retirer')}
          </button>
        )}
      </div>

      <p style={{ margin: '6px 0 0', fontSize: 11, color: '#64748b' }}>
        {t('visuel.aide', { formats, taille: tailleMax })}
      </p>

      {refus && (
        <p
          role="alert"
          style={{
            margin: '6px 0 0',
            fontSize: 12,
            color: '#b91c1c',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            padding: '6px 8px',
          }}
        >
          {refus}
        </p>
      )}
    </div>
  )
}

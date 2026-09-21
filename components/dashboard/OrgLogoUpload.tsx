'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import { LOGO_TAILLE_MAX_OCTETS, LOGO_TYPES_ACCEPTES } from '@/lib/org-logo'

/**
 * OrgLogoUpload — le logo de l'organisation, DÉPOSÉ et non plus SAISI.
 *
 * ┌─ CE QUI A CHANGÉ, ET POURQUOI ──────────────────────────────────────────┐
 * │ C'était un champ texte : on collait l'adresse d'une image quelconque,   │
 * │ et cette adresse partait telle quelle dans un `<img src>` sur neuf      │
 * │ surfaces, sans CSP dans le dépôt. Un mouchard posé par une saisie de    │
 * │ formulaire, dans le navigateur de tous ceux qui voyaient la fiche.      │
 * │ Le fichier est désormais hébergé par nous, dans un bucket privé, et lu  │
 * │ par URL signée courte.                                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ CE COMPOSANT N'APPLIQUE AUCUNE RÈGLE — il les AFFICHE.
 *    Les bornes viennent de `lib/org-logo.ts`, le SEUL endroit qui décide, et
 *    le serveur les applique de nouveau sur les octets reçus. Ce qui est
 *    vérifié ici ne l'est que pour éviter un aller-retour inutile : un client
 *    ne garde rien. Le verdict qui compte est celui de la route.
 *
 * ⚠️ POURQUOI L'IMPORT DE `LOGO_*` DANS UN COMPOSANT CLIENT EST LICITE ICI —
 *    à lire avant de l'assimiler à §E.15.
 *    §E.15 punit un composant client qui importe une règle RÉGLABLE EN BASE :
 *    la constante est figée dans le bundle et finit par annoncer un chiffre que
 *    le serveur n'applique plus (le cas vécu : « 30 jours » à l'écran pendant
 *    que le serveur en tenait 20). Ces bornes-ci ne sont PAS réglables : ce
 *    sont des constantes de CODE, au même titre que « CV : 5 Mo, PDF » (§P3.3,
 *    colonne « Déploiement »). Client et serveur lisent LE MÊME module et
 *    changent par le même déploiement — ils ne peuvent pas diverger.
 *    Le jour où ces bornes deviendraient réglables, ce fichier devra les
 *    recevoir d'une route, exactement comme les durées.
 *
 * ⚠️ AUCUN REFUS MUET. Chaque code rendu par la route a sa phrase, dans les
 *    quatre langues, et cette phrase dit QUOI FAIRE. Jamais « une erreur est
 *    survenue ».
 */

const MO = 1024 * 1024

/** Les codes de refus servis par la route. Un code = une phrase. */
const CODES_CONNUS = [
  'logo_absent',
  'logo_trop_volumineux',
  'logo_format_refuse',
  'logo_contenu_non_conforme',
  'logo_type_incoherent',
  'not_org_admin',
  'logo_stockage_indisponible',
] as const
type CodeRefus = (typeof CODES_CONNUS)[number]

function estCodeConnu(c: unknown): c is CodeRefus {
  return typeof c === 'string' && (CODES_CONNUS as readonly string[]).includes(c)
}

export default function OrgLogoUpload({
  /** Drapeau de présence lu en base — PAS une adresse (cf. lib/org-logo.ts). */
  logoPresent,
  /** Un non-admin voit le logo et l'explication, jamais les commandes. */
  isAdmin,
  /** Remonte le changement au parent (le drapeau, pour la barre latérale). */
  onChange,
}: {
  logoPresent: boolean
  isAdmin: boolean
  onChange?: (present: boolean) => void
}) {
  const t = useTranslations('dashboard_entreprise.organisation')
  const secureFetch = useSecureFetch()
  const inputRef = useRef<HTMLInputElement | null>(null)

  const [url, setUrl] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const [enCours, setEnCours] = useState(false)
  const [refus, setRefus] = useState<CodeRefus | 'inconnu' | null>(null)

  // ── L'URL signée, demandée à la route ─────────────────────────────────────
  const rafraichir = useCallback(async () => {
    setChargement(true)
    try {
      const res = await secureFetch('/api/me/organisation/logo')
      if (!res.ok) {
        setUrl(null)
        return
      }
      const body = (await res.json()) as { logo_url?: string | null }
      setUrl(body.logo_url ?? null)
    } catch {
      setUrl(null)
    } finally {
      setChargement(false)
    }
  }, [secureFetch])

  // ⚠️ L'EFFET NE FAIT QUE CHERCHER, et il ne remet rien à zéro.
  //    Une première version écrivait `else setUrl(null)` dans le corps de
  //    l'effet — anti-pattern React (cascade de rendus).
  //
  //    Et il ne faut SURTOUT PAS dériver l'affichage de la prop `logoPresent` :
  //    juste après un dépôt réussi, l'aperçu vient de l'état LOCAL (`url`),
  //    tandis que `logoPresent` appartient au parent et n'est mis à jour que si
  //    `onChange` a été fourni — qui est optionnel. L'aperçu disparaîtrait donc
  //    au moment même où l'utilisateur vient de déposer son logo.
  //    `url` est la seule source : null au départ, renseigné par la route,
  //    remis à null par la suppression.
  useEffect(() => {
    if (logoPresent) void rafraichir()
  }, [logoPresent, rafraichir])

  // ── Le dépôt ──────────────────────────────────────────────────────────────
  async function deposer(fichier: File) {
    setRefus(null)

    // Pré-vérifications de CONFORT. Elles évitent d'envoyer 2 Mo pour rien ;
    // elles ne protègent RIEN — le serveur refait tout, sur les octets.
    if (fichier.size > LOGO_TAILLE_MAX_OCTETS) {
      setRefus('logo_trop_volumineux')
      return
    }
    if (!(LOGO_TYPES_ACCEPTES as readonly string[]).includes(fichier.type)) {
      setRefus('logo_format_refuse')
      return
    }

    setEnCours(true)
    try {
      const corps = new FormData()
      corps.append('file', fichier)
      const res = await secureFetch('/api/me/organisation/logo', { method: 'POST', body: corps })
      const body = (await res.json().catch(() => ({}))) as { code?: string; logo_url?: string | null }

      if (!res.ok) {
        setRefus(estCodeConnu(body.code) ? body.code : 'inconnu')
        return
      }
      setUrl(body.logo_url ?? null)
      onChange?.(true)
    } catch {
      setRefus('logo_stockage_indisponible')
    } finally {
      setEnCours(false)
      // Remise à zéro : sans elle, redéposer LE MÊME fichier après un refus ne
      // déclenche aucun `change` — l'écran paraîtrait ignorer le clic.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function retirer() {
    setRefus(null)
    setEnCours(true)
    try {
      const res = await secureFetch('/api/me/organisation/logo', { method: 'DELETE' })
      const body = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        setRefus(estCodeConnu(body.code) ? body.code : 'inconnu')
        return
      }
      setUrl(null)
      onChange?.(false)
    } catch {
      setRefus('logo_stockage_indisponible')
    } finally {
      setEnCours(false)
    }
  }

  const tailleMax = Math.round(LOGO_TAILLE_MAX_OCTETS / MO)
  const formats = LOGO_TYPES_ACCEPTES.map((m) => m.replace('image/', '').toUpperCase()).join(' · ')

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)', marginBottom: 6 }}>
        {t('field_logo')}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {/* L'aperçu, ou l'ÉTAT VIDE DÉLIBÉRÉ — jamais une image cassée. */}
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={t('field_logo')}
            width={64}
            height={64}
            // Une URL signée vit 300 s. Expirée, on retombe sur l'état vide :
            // c'est normal, ce n'est pas une panne.
            onError={() => setUrl(null)}
            style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', border: '1px solid var(--sk-border)' }}
          />
        ) : (
          <div
            aria-hidden
            style={{
              width: 64,
              height: 64,
              borderRadius: 12,
              border: '1px dashed var(--sk-border)',
              background: 'var(--sk-surface-2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              color: 'var(--sk-muted)',
              textAlign: 'center',
              padding: 4,
            }}
          >
            {chargement ? '…' : t('logo_vide')}
          </div>
        )}

        {isAdmin && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={inputRef}
              type="file"
              accept={LOGO_TYPES_ACCEPTES.join(',')}
              disabled={enCours}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void deposer(f)
              }}
              style={{ display: 'none' }}
              id="org-logo-input"
            />
            <label
              htmlFor="org-logo-input"
              style={{
                border: '1px solid var(--sk-border)',
                borderRadius: 10,
                padding: '9px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: enCours ? 'default' : 'pointer',
                opacity: enCours ? 0.6 : 1,
                background: 'var(--sk-surface)',
                color: 'var(--sk-text)',
              }}
            >
              {enCours ? t('logo_en_cours') : url ? t('logo_remplacer') : t('logo_deposer')}
            </label>

            {url && (
              <button
                type="button"
                onClick={() => void retirer()}
                disabled={enCours}
                style={{
                  border: '1px solid var(--sk-red-soft)',
                  borderRadius: 10,
                  padding: '9px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: enCours ? 'default' : 'pointer',
                  background: 'var(--sk-surface)',
                  color: 'var(--sk-red)',
                  fontFamily: 'inherit',
                }}
              >
                {t('logo_retirer')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Les bornes sont ANNONCÉES AVANT le dépôt : on ne laisse pas quelqu'un
          découvrir la limite en se la prenant. */}
      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--sk-muted)' }}>
        {isAdmin ? t('logo_aide', { formats, taille: tailleMax }) : t('logo_aide_lecture')}
      </p>

      {/* LE REFUS DIT CE QUI BLOQUE ET CE QU'ON PEUT FAIRE. */}
      {refus && (
        <p
          role="alert"
          style={{
            margin: '8px 0 0',
            fontSize: 13,
            color: 'var(--sk-red)',
            background: 'var(--sk-red-soft)',
            border: '1px solid var(--sk-red-soft)',
            borderRadius: 8,
            padding: '8px 10px',
          }}
        >
          {refus === 'logo_trop_volumineux'
            ? t('logo_refus_trop_volumineux', { taille: tailleMax })
            : refus === 'logo_format_refuse'
              ? t('logo_refus_format', { formats })
              : refus === 'logo_contenu_non_conforme'
                ? t('logo_refus_contenu')
                : refus === 'logo_type_incoherent'
                  ? t('logo_refus_type_incoherent')
                  : refus === 'not_org_admin'
                    ? t('logo_refus_droits')
                    : refus === 'logo_absent'
                      ? t('logo_refus_absent')
                      : refus === 'logo_stockage_indisponible'
                        ? t('logo_refus_stockage')
                        : t('logo_refus_inconnu')}
        </p>
      )}
    </div>
  )
}

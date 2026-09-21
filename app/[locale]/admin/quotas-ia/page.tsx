'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/quotas-ia — LE QUOTA D'ANALYSES DE CV, RÉGLABLE SANS DÉPLOIEMENT.
 *
 * ┌─ POURQUOI UN ÉCRAN, ET PAS SEULEMENT UNE LIGNE EN BASE ─────────────────┐
 * │ Sortir « 3 par 24 h » du code sans donner de moyen de le changer, ce     │
 * │ serait déplacer le défaut : la valeur ne serait plus dans le code, mais  │
 * │ toujours hors de portée de celui qui doit la décider. C'est exactement   │
 * │ le reproche fait au champ « sièges » — un réglage qui ne règle rien.     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Le NOMBRE et la FENÊTRE s'éditent ensemble : « 3 par 24 h » est un seul
 * réglage à deux valeurs, et l'enregistrement les envoie toutes les deux. Les
 * séparer laisserait changer l'un en croyant avoir changé l'autre.
 *
 * Les bornes affichées viennent de la RÉPONSE du serveur, pas de constantes
 * recopiées ici : deux jeux de bornes finissent par diverger, et c'est la base
 * qui a le dernier mot.
 */

type Bornes = { min: number; max: number }
type Reponse = {
  cv_parsing: { max_per_window: number; window_hours: number }
  bounds: { max_per_window: Bornes; window_hours: Bornes }
}

const cardStyle: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
}
const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  margin: '0 0 4px',
  color: 'var(--sk-text)',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  marginBottom: 6,
  color: 'var(--sk-muted)',
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  fontSize: 14,
  border: '1px solid var(--sk-border)',
  borderRadius: 8,
  background: 'var(--sk-surface)',
  color: 'inherit',
}

export default function QuotasIaPage() {
  const t = useTranslations('admin_back_office.quotas_ia')
  const secureFetch = useSecureFetch()

  const [bornes, setBornes] = useState<Reponse['bounds'] | null>(null)
  const [max, setMax] = useState('')
  const [fenetre, setFenetre] = useState('')
  const [chargement, setChargement] = useState(true)
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)
  const [enregistrement, setEnregistrement] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreurChargement(null)
    try {
      const res = await secureFetch('/api/admin/ai-quotas')
      const body = (await res.json()) as Reponse & { code?: string }
      if (!res.ok) {
        // Le réglage absent en base est le SEUL refus qui se raconte : il dit
        // quoi faire (appliquer la migration), au lieu d'une erreur générique.
        setErreurChargement(body.code === 'quota_config_missing' ? t('err_missing') : t('err_load'))
        return
      }
      setBornes(body.bounds)
      setMax(String(body.cv_parsing.max_per_window))
      setFenetre(String(body.cv_parsing.window_hours))
    } catch {
      setErreurChargement(t('err_load'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void charger()
  }, [charger])

  async function enregistrer() {
    setEnregistrement(true)
    setMsg(null)
    try {
      const res = await secureFetch('/api/admin/ai-quotas', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          max_per_window: Number(max),
          window_hours: Number(fenetre),
        }),
      })
      const body = (await res.json()) as { code?: string }
      if (!res.ok) {
        setMsg({
          kind: 'err',
          text:
            body.code === 'invalid_max'
              ? t('err_invalid_max')
              : body.code === 'invalid_window'
                ? t('err_invalid_window')
                : t('err_save'),
        })
        return
      }
      setMsg({ kind: 'ok', text: t('saved') })
    } catch {
      setMsg({ kind: 'err', text: t('err_save') })
    } finally {
      setEnregistrement(false)
    }
  }

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 20px', maxWidth: 640 }}>
        {t('intro')}
      </p>

      <section style={cardStyle}>
        <h2 style={sectionTitle}>{t('cv_title')}</h2>
        <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '0 0 16px', maxWidth: 640 }}>
          {t('cv_hint')}
        </p>

        {chargement ? (
          <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('loading')}</p>
        ) : erreurChargement ? (
          <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)' }}>
            {erreurChargement}
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, maxWidth: 520 }}>
              <div>
                <label htmlFor="q_max" style={labelStyle}>
                  {t('field_max')}
                </label>
                <input
                  id="q_max"
                  type="number"
                  inputMode="numeric"
                  min={bornes?.max_per_window.min}
                  max={bornes?.max_per_window.max}
                  step={1}
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="q_win" style={labelStyle}>
                  {t('field_window')}
                </label>
                <input
                  id="q_win"
                  type="number"
                  inputMode="numeric"
                  min={bornes?.window_hours.min}
                  max={bornes?.window_hours.max}
                  step={1}
                  value={fenetre}
                  onChange={(e) => setFenetre(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* La phrase que le réglage produit, en toutes lettres : un nombre
                et une durée dans deux champs séparés se lisent mal. */}
            <p style={{ fontSize: 13, color: 'var(--sk-text)', margin: '14px 0 0' }}>
              {t('summary', { max: Number(max) || 0, hours: Number(fenetre) || 0 })}
            </p>

            {msg && (
              <p
                role={msg.kind === 'err' ? 'alert' : undefined}
                style={{
                  fontSize: 13,
                  margin: '12px 0 0',
                  color: msg.kind === 'err' ? 'var(--sk-red)' : 'var(--sk-success)',
                }}
              >
                {msg.text}
              </p>
            )}

            <button
              type="button"
              onClick={() => void enregistrer()}
              disabled={enregistrement}
              style={{
                marginTop: 16,
                padding: '9px 18px',
                fontSize: 14,
                fontWeight: 500,
                borderRadius: 8,
                border: 'none',
                background: 'var(--sk-accent)',
                color: 'var(--sk-surface)',
                cursor: enregistrement ? 'not-allowed' : 'pointer',
                opacity: enregistrement ? 0.6 : 1,
              }}
            >
              {enregistrement ? t('saving') : t('save')}
            </button>
          </>
        )}
      </section>
    </div>
  )
}

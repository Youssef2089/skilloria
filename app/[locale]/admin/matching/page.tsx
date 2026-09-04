'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/matching — LES DEUX SEUILS, ET CE QUE LE MOTEUR COÛTE.
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ═════════════════════════════════════════════
 *   Le score d'un reranker n'est pas calibré : aucun seuil ne peut être deviné,
 *   et aucun ne peut être traduit depuis l'ancienne échelle sur 10. Il faut LIRE
 *   la distribution réelle des runs, puis régler. Sans écran, ce réglage
 *   demanderait un développeur à chaque fois — il resterait donc à sa valeur
 *   initiale, c'est-à-dire personne notifié.
 *
 * ═══ CE QUI EST MONTRÉ À CÔTÉ DES CURSEURS, ET POURQUOI ═══════════════════
 *   La DISTRIBUTION observée : régler un seuil sans elle, c'est choisir un
 *   nombre au hasard. La COUVERTURE : elle dit si des experts éligibles n'ont
 *   pas été notés, c'est-à-dire écartés sans raison. La DÉPENSE du mois : un
 *   plafond qu'on ne voit pas est un plafond qu'on découvre atteint.
 *
 * ═══ CE QUE L'ÉCRAN NE FAIT PAS ═══════════════════════════════════════════
 *   Il ne recalcule rien et ne devine rien. Quand une lecture est indisponible,
 *   il le DIT — il n'affiche pas un tableau vide, qui se lirait « aucune
 *   donnée » alors que la vérité est « je n'ai pas pu lire ».
 */

type Reglage = {
  domain_id: string
  feed_threshold: number
  notify_threshold: number
  notify_enabled: boolean
  rerank_model: string
  rerank_batch_size: number
  updated_at: string | null
  domaine: { slug: string; name: string | null } | null
}

type LigneDistribution = {
  runs_observes: number
  seuil_median_applique: number | null
  notifies_moyen: number | null
  notifies_median: number | null
  part_notifiee_moyenne: number | null
  score_p50_moyen: number | null
  score_p90_moyen: number | null
  runs_zero_notifie: number
  runs_tout_notifie: number
}

type LigneDepense = {
  provider: string
  monthly_cap_usd: number
  depense_mois: number
  reste: number
  part_consommee: number | null
  au_plafond: boolean
}

type LigneCouverture = {
  runs_observes: number
  runs_complets: number
  runs_tronques: number
  experts_non_notes: number
  lots_rerank_en_echec: number
}

type Charge = {
  reglages: Reglage[]
  distribution: LigneDistribution[] | null
  depense: LigneDepense[] | null
  couverture: LigneCouverture[] | null
}

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 14,
  padding: '18px 20px',
  marginBottom: 16,
}
const titreBloc: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--sk-faint)',
  marginBottom: 12,
}
const champ: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  border: '1px solid var(--sk-border)',
  borderRadius: 9,
  fontSize: 14,
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
}
const etiquette: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--sk-muted)',
  marginBottom: 5,
}
const aide: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--sk-faint)',
  marginTop: 5,
  lineHeight: 1.5,
}

export default function AdminMatchingPage() {
  const t = useTranslations('admin_matching')
  const secureFetch = useSecureFetch()

  const [charge, setCharge] = useState<Charge | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)
  const [brouillons, setBrouillons] = useState<Record<string, Partial<Reglage>>>({})
  const [enregistrement, setEnregistrement] = useState<string | null>(null)

  const lire = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch('/api/admin/matching-settings', { method: 'GET' })
      if (!res.ok) {
        setErreur(t('errors.load_failed'))
        return
      }
      setCharge((await res.json()) as Charge)
    } catch {
      setErreur(t('errors.load_failed'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void lire()
  }, [lire])

  const valeur = (r: Reglage, cle: keyof Reglage) => {
    const b = brouillons[r.domain_id]
    return b && cle in b ? (b[cle] as never) : (r[cle] as never)
  }

  const modifier = (domainId: string, cle: keyof Reglage, v: unknown) => {
    setBrouillons((p) => ({ ...p, [domainId]: { ...(p[domainId] ?? {}), [cle]: v } }))
    setSucces(null)
  }

  const enregistrer = async (r: Reglage) => {
    const b = brouillons[r.domain_id]
    if (!b || Object.keys(b).length === 0) return
    setEnregistrement(r.domain_id)
    setErreur(null)
    setSucces(null)
    try {
      const res = await secureFetch('/api/admin/matching-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: r.domain_id, ...b }),
      })
      const charge = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        // Un refus NOMMÉ : l'ordre des deux seuils a sa propre explication,
        // parce que c'est l'erreur qu'on fera le plus souvent.
        setErreur(charge.code === 'ordre_seuils' ? t('errors.ordre_seuils') : t('errors.save_failed'))
        return
      }
      setBrouillons((p) => {
        const suite = { ...p }
        delete suite[r.domain_id]
        return suite
      })
      setSucces(t('saved'))
      await lire()
    } catch {
      setErreur(t('errors.save_failed'))
    } finally {
      setEnregistrement(null)
    }
  }

  if (chargement) {
    return <div style={{ padding: 26, color: 'var(--sk-muted)' }}>{t('loading')}</div>
  }

  const distribution = charge?.distribution?.[0] ?? null
  const couverture = charge?.couverture?.[0] ?? null

  return (
    <div style={{ padding: '24px 26px', maxWidth: 980 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 6 }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--sk-muted)', lineHeight: 1.6, marginBottom: 20 }}>
        {t('intro')}
      </p>

      {erreur && (
        <div role="alert" style={{ ...carte, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b', fontSize: 13 }}>
          {erreur}
        </div>
      )}
      {succes && (
        <div role="status" style={{ ...carte, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', fontSize: 13 }}>
          {succes}
        </div>
      )}

      {/* ── LA DÉPENSE ─────────────────────────────────────────────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('spend.title')}</div>
        {charge?.depense === null ? (
          // « Indisponible » n'est pas « zéro ». Afficher 0 $ sur une lecture
          // en échec ferait croire qu'on n'a rien dépensé.
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('spend.unavailable')}</div>
        ) : (charge?.depense ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('spend.none')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {(charge?.depense ?? []).map((d) => (
              <div key={d.provider} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
                <span style={{ fontWeight: 600, minWidth: 90, color: 'var(--sk-text)' }}>{d.provider}</span>
                <span style={{ color: d.au_plafond ? '#dc2626' : 'var(--sk-muted)' }}>
                  {t('spend.line', {
                    spent: Number(d.depense_mois).toFixed(2),
                    cap: Number(d.monthly_cap_usd).toFixed(2),
                  })}
                </span>
                {d.au_plafond && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{t('spend.capped')}</span>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={aide}>{t('spend.help')}</div>
      </section>

      {/* ── LA DISTRIBUTION OBSERVÉE ───────────────────────────────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('distribution.title')}</div>
        {charge?.distribution === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('distribution.unavailable')}</div>
        ) : !distribution || distribution.runs_observes === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('distribution.empty')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 6, fontSize: 13.5, color: 'var(--sk-text)' }}>
            <div>{t('distribution.runs', { count: distribution.runs_observes })}</div>
            <div>
              {t('distribution.percentiles', {
                p50: distribution.score_p50_moyen ?? '—',
                p90: distribution.score_p90_moyen ?? '—',
              })}
            </div>
            <div>{t('distribution.notified', { avg: distribution.notifies_moyen ?? '—' })}</div>
            <div>
              {t('distribution.extremes', {
                zero: distribution.runs_zero_notifie,
                all: distribution.runs_tout_notifie,
              })}
            </div>
          </div>
        )}
        <div style={aide}>{t('distribution.help')}</div>
      </section>

      {/* ── LA COUVERTURE ──────────────────────────────────────────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('coverage.title')}</div>
        {charge?.couverture === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('coverage.unavailable')}</div>
        ) : !couverture || couverture.runs_observes === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('coverage.empty')}</div>
        ) : (
          <div
            style={{
              fontSize: 13.5,
              color: couverture.experts_non_notes > 0 ? '#dc2626' : 'var(--sk-text)',
              fontWeight: couverture.experts_non_notes > 0 ? 600 : 400,
            }}
          >
            {t('coverage.line', {
              complets: couverture.runs_complets,
              total: couverture.runs_observes,
              manquants: couverture.experts_non_notes,
            })}
          </div>
        )}
        <div style={aide}>{t('coverage.help')}</div>
      </section>

      {/* ── LES RÉGLAGES, PAR ÉCOSYSTÈME ───────────────────────────────── */}
      {(charge?.reglages ?? []).map((r) => {
        const modifie = !!brouillons[r.domain_id]
        return (
          <section key={r.domain_id} style={carte}>
            <div style={titreBloc}>
              {r.domaine?.name ?? r.domaine?.slug ?? r.domain_id}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div>
                <label style={etiquette} htmlFor={`feed-${r.domain_id}`}>{t('fields.feed')}</label>
                <input
                  id={`feed-${r.domain_id}`}
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={String(valeur(r, 'feed_threshold'))}
                  onChange={(e) => modifier(r.domain_id, 'feed_threshold', Number(e.target.value))}
                  style={champ}
                />
                <div style={aide}>{t('fields.feed_help')}</div>
              </div>

              <div>
                <label style={etiquette} htmlFor={`notify-${r.domain_id}`}>{t('fields.notify')}</label>
                <input
                  id={`notify-${r.domain_id}`}
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={String(valeur(r, 'notify_threshold'))}
                  onChange={(e) => modifier(r.domain_id, 'notify_threshold', Number(e.target.value))}
                  style={champ}
                />
                <div style={aide}>{t('fields.notify_help')}</div>
              </div>

              <div>
                <label style={etiquette} htmlFor={`batch-${r.domain_id}`}>{t('fields.batch')}</label>
                <input
                  id={`batch-${r.domain_id}`}
                  type="number"
                  step="1"
                  min={1}
                  max={1000}
                  value={String(valeur(r, 'rerank_batch_size'))}
                  onChange={(e) => modifier(r.domain_id, 'rerank_batch_size', Number(e.target.value))}
                  style={champ}
                />
                <div style={aide}>{t('fields.batch_help')}</div>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={valeur(r, 'notify_enabled') as unknown as boolean}
                onChange={(e) => modifier(r.domain_id, 'notify_enabled', e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sk-text)' }}>
                  {t('fields.notify_enabled')}
                </span>
                <span style={{ ...aide, display: 'block', marginTop: 2 }}>
                  {t('fields.notify_enabled_help')}
                </span>
              </span>
            </label>

            <div style={{ ...aide, marginTop: 12 }}>
              {t('fields.model', { model: r.rerank_model })}
            </div>

            <button
              type="button"
              disabled={!modifie || enregistrement === r.domain_id}
              onClick={() => void enregistrer(r)}
              style={{
                marginTop: 14,
                padding: '9px 18px',
                borderRadius: 9,
                border: 'none',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: modifie ? 'pointer' : 'default',
                background: modifie ? '#111827' : 'var(--sk-border)',
                color: modifie ? '#fff' : 'var(--sk-faint)',
              }}
            >
              {enregistrement === r.domain_id ? t('saving') : t('save')}
            </button>
          </section>
        )
      })}
    </div>
  )
}

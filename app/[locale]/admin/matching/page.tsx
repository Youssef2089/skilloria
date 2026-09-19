'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/matching — CE QUI SE DÉCIDE, ET RIEN D'AUTRE.
 *
 * ┌─ POURQUOI CET ÉCRAN A ÉTÉ REFAIT ───────────────────────────────────────┐
 * │ Le propriétaire du produit l'a ouvert et n'a pas su quoi faire. C'est le │
 * │ seul verdict qui compte. La cause n'était pas le code : c'était un écran │
 * │ qui EXPLIQUE LE MÉCANISME au lieu de FAIRE DÉCIDER — plus de mode        │
 * │ d'emploi que de valeurs, et la supervision mêlée au réglage.             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * CE QUI Y EST : les deux plafonds de dépense, les deux alertes, les deux
 * filtres par écosystème, l'interrupteur de notification, le modèle. Rien
 * d'autre. Ce qui s'observe est sur `/admin/supervision`.
 *
 * ═══ QUATRE MOTS, UN PAR COMPORTEMENT ════════════════════════════════════
 *   PLAFOND il BLOQUE · ALERTE elle SIGNALE · FILTRE il TRIE · NOTE elle JUGE.
 *   Le mot « seuil » désignait les quatre à la fois : c'est lui qui rendait cet
 *   écran illisible. Il ne s'écrit plus nulle part.
 *
 * ═══ UNE LIGNE D'EXPLICATION, OU RIEN ════════════════════════════════════
 *   « Ce plafond bloque » suffit. Le paragraphe qui suivait disparaît. Chaque
 *   bloc porte UNE phrase, et elle dit ce que le réglage FAIT — pas comment il
 *   est implémenté.
 *
 * ═══ ON NE RÈGLE PAS UN FILTRE DANS LE VIDE ══════════════════════════════
 *   Sous chaque filtre : combien d'experts cette valeur laisse entrer, et
 *   combien elle écarte. Sans cela, régler est un tirage au sort — l'ancien
 *   écran l'écrivait, puis demandait de le faire quand même.
 */

type Distribution = {
  runs_observes: number
  repartition: number[] | null
  notes_totales: number
}
type Reglage = {
  domain_id: string
  feed_threshold: number
  notify_threshold: number
  notify_enabled: boolean
  rerank_model: string
  rerank_batch_size: number
  domaine: { slug: string; name: string | null } | null
  distribution: Distribution[] | null
}
type LigneDepense = {
  provider: string
  monthly_cap_usd: number
  depense_mois: number
  au_plafond: boolean
}
type Reponse = {
  reglages: Reglage[]
  depense: LigneDepense[] | null
  seuils_acteur: Record<string, number> | null
  modeles: string[] | null
}

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface, #fff)',
  border: '1px solid var(--color-border, #e2e8f0)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
}
const h2Style: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  margin: '0 0 2px',
  color: 'var(--color-text-primary, #0f172a)',
}
/** UNE ligne. Jamais un paragraphe. */
const uneLigne: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-tertiary, #94a3b8)',
  margin: '0 0 16px',
}
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 500,
  marginBottom: 6,
  color: 'var(--color-text-secondary, #64748b)',
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  fontSize: 14,
  border: '1px solid var(--color-border, #e2e8f0)',
  borderRadius: 8,
  background: '#fff',
  color: 'inherit',
}
const boutonStyle = (inactif: boolean): React.CSSProperties => ({
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  border: 'none',
  background: 'var(--color-primary, #2563eb)',
  color: '#fff',
  cursor: inactif ? 'not-allowed' : 'pointer',
  opacity: inactif ? 0.6 : 1,
})

/**
 * COMBIEN LA VALEUR LAISSE ENTRER, COMBIEN ELLE ÉCARTE.
 *
 * La répartition compte les notes par TRANCHE ENTIÈRE. Une valeur fractionnaire
 * est donc ramenée à sa tranche : on ne prétend pas à une précision que la
 * mesure n'a pas.
 */
function inclusExclus(repartition: number[] | null, valeur: number): { inclus: number; exclus: number } | null {
  if (!repartition || repartition.length !== 10) return null
  const seuilTranche = Math.max(0, Math.min(10, Math.floor(valeur)))
  let inclus = 0
  let exclus = 0
  for (let i = 0; i < 10; i++) {
    const n = Number(repartition[i]) || 0
    if (i >= seuilTranche) inclus += n
    else exclus += n
  }
  return { inclus, exclus }
}

export default function MatchingPage() {
  const t = useTranslations('admin_matching')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Reponse | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  /** Saisies par écosystème. */
  const [saisies, setSaisies] = useState<
    Record<string, { feed: string; notify: string; enabled: boolean; model: string; batch: string }>
  >({})
  /** Saisies d'argent, par clé (`cap_rerank`, `alerte_profile`, …). */
  const [argent, setArgent] = useState<Record<string, string>>({})

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch('/api/admin/matching-settings')
      const body = (await res.json()) as Reponse
      if (!res.ok) {
        setErreur(t('err_load'))
        return
      }
      setData(body)
      setSaisies(
        Object.fromEntries(
          body.reglages.map((r) => [
            r.domain_id,
            {
              feed: String(r.feed_threshold),
              notify: String(r.notify_threshold),
              enabled: r.notify_enabled,
              model: r.rerank_model,
              batch: String(r.rerank_batch_size),
            },
          ]),
        ),
      )
      setArgent({
        cap_rerank: String(body.depense?.find((d) => d.provider === 'rerank')?.monthly_cap_usd ?? ''),
        cap_claude: String(body.depense?.find((d) => d.provider === 'claude')?.monthly_cap_usd ?? ''),
        alerte_organization: String(body.seuils_acteur?.organization ?? ''),
        alerte_profile: String(body.seuils_acteur?.profile ?? ''),
      })
    } catch {
      setErreur(t('err_load'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void charger()
  }, [charger])

  /** CE QUI EMPÊCHE D'ENREGISTRER, EN TOUTES LETTRES. Jamais un booléen nu. */
  function motifDeBlocage(r: Reglage): string | null {
    const s = saisies[r.domain_id]
    if (!s) return null
    const feed = Number(s.feed)
    const notify = Number(s.notify)
    if (s.feed.trim() === '' || s.notify.trim() === '') return t('blocked_empty')
    if (!Number.isFinite(feed) || !Number.isFinite(notify) || feed < 0 || feed > 10 || notify < 0 || notify > 10) {
      return t('blocked_range')
    }
    if (notify < feed) return t('blocked_order')
    const inchange =
      feed === r.feed_threshold &&
      notify === r.notify_threshold &&
      s.enabled === r.notify_enabled &&
      s.model === r.rerank_model &&
      Number(s.batch) === r.rerank_batch_size
    if (inchange) return t('blocked_unchanged')
    return null
  }

  async function enregistrerEcosysteme(r: Reglage) {
    const s = saisies[r.domain_id]
    if (!s) return
    setEnCours(r.domain_id)
    setMsg(null)
    try {
      const res = await secureFetch('/api/admin/matching-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          domain_id: r.domain_id,
          feed_threshold: Number(s.feed),
          notify_threshold: Number(s.notify),
          notify_enabled: s.enabled,
          rerank_model: s.model,
          rerank_batch_size: Number(s.batch),
        }),
      })
      const body = (await res.json()) as { code?: string }
      if (!res.ok) {
        setMsg({
          kind: 'err',
          text:
            body.code === 'notify_below_feed'
              ? t('blocked_order')
              : body.code === 'model_without_price'
                ? t('err_model_without_price')
                : body.code === 'model_requires_filters'
                  ? t('err_model_requires_filters')
                  : t('err_save'),
        })
        return
      }
      setMsg({ kind: 'ok', text: t('saved') })
      await charger()
    } catch {
      setMsg({ kind: 'err', text: t('err_save') })
    } finally {
      setEnCours(null)
    }
  }

  async function enregistrerArgent() {
    setEnCours('argent')
    setMsg(null)
    try {
      const res = await secureFetch('/api/admin/plafonds-ia', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        // Le contrat de la route : `plafonds` (ils BLOQUENT) et `seuils_acteur`
        // (ils ALERTENT). Les deux noms disent le comportement, pas la table.
        body: JSON.stringify({
          plafonds: { rerank: Number(argent.cap_rerank), claude: Number(argent.cap_claude) },
          seuils_acteur: {
            organization: Number(argent.alerte_organization),
            profile: Number(argent.alerte_profile),
          },
        }),
      })
      if (!res.ok) {
        setMsg({ kind: 'err', text: t('err_save') })
        return
      }
      setMsg({ kind: 'ok', text: t('saved') })
      await charger()
    } catch {
      setMsg({ kind: 'err', text: t('err_save') })
    } finally {
      setEnCours(null)
    }
  }

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text-primary, #0f172a)' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 6px', maxWidth: 720 }}>
        {t('intro')}
      </p>
      <p style={{ margin: '0 0 20px' }}>
        <Link href="/admin/supervision" style={{ fontSize: 13, color: 'var(--color-primary, #2563eb)' }}>
          {t('to_monitoring')}
        </Link>
      </p>

      {msg && (
        <p
          role={msg.kind === 'err' ? 'alert' : undefined}
          style={{
            fontSize: 13,
            margin: '0 0 14px',
            color: msg.kind === 'err' ? 'var(--color-error, #dc2626)' : 'var(--color-success, #16a34a)',
          }}
        >
          {msg.text}
        </p>
      )}

      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)' }}>{t('loading')}</p>
      ) : erreur ? (
        <p role="alert" style={{ fontSize: 13, color: 'var(--color-error, #dc2626)' }}>
          {erreur}
        </p>
      ) : (
        <>
          {/* ─── L'ARGENT ─────────────────────────────────────────────────── */}
          <section style={cardStyle}>
            <h2 style={h2Style}>{t('money_title')}</h2>
            <p style={uneLigne}>{t('money_currency')}</p>

            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 2px', color: 'var(--color-text-primary, #0f172a)' }}>
              {t('caps_title')}
            </h3>
            <p style={uneLigne}>{t('caps_one_line')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, maxWidth: 560 }}>
              {(['rerank', 'claude'] as const).map((p) => {
                const d = data?.depense?.find((x) => x.provider === p)
                return (
                  <div key={p}>
                    <label htmlFor={`cap_${p}`} style={labelStyle}>
                      {t(`usage.${p}` as 'usage.claude')}
                    </label>
                    <input
                      id={`cap_${p}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={1}
                      value={argent[`cap_${p}`] ?? ''}
                      onChange={(e) => setArgent((a) => ({ ...a, [`cap_${p}`]: e.target.value }))}
                      style={inputStyle}
                    />
                    {d && (
                      <p style={{ fontSize: 12, margin: '6px 0 0', color: d.au_plafond ? 'var(--color-error, #dc2626)' : 'var(--color-text-tertiary, #94a3b8)' }}>
                        {d.au_plafond
                          ? t('cap_reached')
                          : t('cap_spent', { amount: Number(d.depense_mois).toFixed(2) })}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '20px 0 2px', color: 'var(--color-text-primary, #0f172a)' }}>
              {t('alerts_title')}
            </h3>
            <p style={uneLigne}>{t('alerts_one_line')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, maxWidth: 560 }}>
              {(['organization', 'profile'] as const).map((a) => (
                <div key={a}>
                  <label htmlFor={`al_${a}`} style={labelStyle}>
                    {t(`actor.${a}` as 'actor.organization')}
                  </label>
                  <input
                    id={`al_${a}`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    value={argent[`alerte_${a}`] ?? ''}
                    onChange={(e) => setArgent((x) => ({ ...x, [`alerte_${a}`]: e.target.value }))}
                    style={inputStyle}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void enregistrerArgent()}
              disabled={enCours === 'argent'}
              style={{ ...boutonStyle(enCours === 'argent'), marginTop: 16 }}
            >
              {enCours === 'argent' ? t('saving') : t('save')}
            </button>
          </section>

          {/* ─── LES FILTRES, PAR ÉCOSYSTÈME ──────────────────────────────── */}
          {data?.reglages.map((r) => {
            const s = saisies[r.domain_id] ?? { feed: '', notify: '', enabled: false, model: '', batch: '' }
            const dist = r.distribution?.[0] ?? null
            const repartition = dist?.repartition ?? null
            const total = Number(dist?.notes_totales ?? 0)
            const blocage = motifDeBlocage(r)
            const simFeed = inclusExclus(repartition, Number(s.feed))
            const simNotify = inclusExclus(repartition, Number(s.notify))
            const modeleChange = s.model !== r.rerank_model
            return (
              <section key={r.domain_id} style={cardStyle}>
                {/* L'INTITULÉ DIT QU'ON RÈGLE **UN** ÉCOSYSTÈME PARMI D'AUTRES.
                    « SKILLORIA 365 » tout seul ne le disait pas. */}
                <h2 style={h2Style}>
                  {t('ecosystem_title', { name: r.domaine?.name ?? r.domaine?.slug ?? r.domain_id })}
                </h2>
                <p style={uneLigne}>{t('filters_one_line')}</p>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, maxWidth: 680 }}>
                  <div>
                    <label htmlFor={`f_${r.domain_id}`} style={labelStyle}>
                      {t('field_feed')}
                    </label>
                    <input
                      id={`f_${r.domain_id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10}
                      step={1}
                      value={s.feed}
                      onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, feed: e.target.value } }))}
                      style={inputStyle}
                    />
                    {/* ON NE RÈGLE PAS DANS LE VIDE. */}
                    <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--color-text-secondary, #64748b)' }}>
                      {repartition === null
                        ? t('spread_unavailable')
                        : total === 0
                          ? t('spread_none_yet')
                          : t('spread_effect', { included: simFeed?.inclus ?? 0, excluded: simFeed?.exclus ?? 0, total })}
                    </p>
                  </div>

                  <div>
                    <label htmlFor={`n_${r.domain_id}`} style={labelStyle}>
                      {t('field_notify')}
                    </label>
                    <input
                      id={`n_${r.domain_id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10}
                      step={1}
                      value={s.notify}
                      onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, notify: e.target.value } }))}
                      style={inputStyle}
                    />
                    <p style={{ fontSize: 12, margin: '6px 0 0', color: 'var(--color-text-secondary, #64748b)' }}>
                      {repartition === null
                        ? t('spread_unavailable')
                        : total === 0
                          ? t('spread_none_yet')
                          : t('spread_effect_notify', { included: simNotify?.inclus ?? 0, total })}
                    </p>
                  </div>
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, enabled: e.target.checked } }))}
                  />
                  {t('field_notify_enabled')}
                </label>

                <div style={{ marginTop: 18, maxWidth: 340 }}>
                  <label htmlFor={`m_${r.domain_id}`} style={labelStyle}>
                    {t('field_model')}
                  </label>
                  <select
                    id={`m_${r.domain_id}`}
                    value={s.model}
                    onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, model: e.target.value } }))}
                    style={inputStyle}
                  >
                    {/* Le modèle en vigueur figure toujours, même s'il a quitté
                        la grille : sinon le champ se réinitialiserait tout seul. */}
                    {[...new Set([r.rerank_model, ...(data?.modeles ?? [])])].map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {/* LE GARDE-FOU N'EST PLUS UNE PHRASE EN GRIS : la route EXIGE
                      que les deux filtres soient reposés dans le même geste. On
                      le DIT ici, au moment où le choix change. */}
                  {modeleChange && (
                    <p role="alert" style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--color-warning, #d97706)' }}>
                      {t('model_changes_scale')}
                    </p>
                  )}
                </div>

                {/* ─── CE QUI N'EST PAS UNE DÉCISION ────────────────────────
                    La taille de lot est TECHNIQUE : elle se change quand le
                    fournisseur change ses limites, pas quand on arbitre quelque
                    chose. Elle sort donc de la zone de décision — mais elle ne
                    disparaît pas : un réglage sans écran est exactement ce que
                    ce lot est venu corriger (§D.7). Elle est ici, à part,
                    visiblement à part, et en dessous de tout le reste. */}
                <details style={{ marginTop: 18 }}>
                  <summary style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', cursor: 'pointer' }}>
                    {t('technical_title')}
                  </summary>
                  <div style={{ marginTop: 10, maxWidth: 260 }}>
                    <label htmlFor={`b_${r.domain_id}`} style={labelStyle}>
                      {t('field_batch')}
                    </label>
                    <input
                      id={`b_${r.domain_id}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={1000}
                      step={1}
                      value={s.batch}
                      onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, batch: e.target.value } }))}
                      style={inputStyle}
                    />
                    <p style={uneLigne}>{t('technical_one_line')}</p>
                  </div>
                </details>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 18 }}>
                  <button
                    type="button"
                    onClick={() => void enregistrerEcosysteme(r)}
                    disabled={enCours === r.domain_id || blocage !== null}
                    style={boutonStyle(enCours === r.domain_id || blocage !== null)}
                  >
                    {enCours === r.domain_id ? t('saving') : t('save')}
                  </button>
                  {blocage && (
                    <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)' }}>{blocage}</span>
                  )}
                </div>
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}

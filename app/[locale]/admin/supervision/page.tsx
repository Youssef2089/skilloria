'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/supervision — CE QUI S'OBSERVE. Le réglage est ailleurs.
 *
 * ┌─ POURQUOI DEUX ÉCRANS ──────────────────────────────────────────────────┐
 * │ `/admin/matching` mélangeait ce qui se DÉCIDE et ce qui se CONSTATE.     │
 * │ Devant cette page, on ne savait plus lequel des deux on était censé      │
 * │ faire. Ici on ne règle rien : on regarde, et on peut ouvrir.             │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ CE QUI NE VA PAS EST EN HAUT, ET LE SERVEUR L'A DÉJÀ TRIÉ ═══════════
 *   Cet écran ne décide PAS de ce qui est grave : `lib/supervision/problemes.ts`
 *   le fait, au serveur, et rend une liste ordonnée. Une couleur choisie au
 *   milieu du JSX se réécrit à chaque refonte et diverge entre deux surfaces.
 *
 *   Le rouge ne sert QU'AUX problèmes. Aucune explication n'est peinte en
 *   rouge : c'est ainsi qu'on apprend à l'ignorer, et six mises en relation
 *   jamais tentées finissent par passer inaperçues dans le gris ambiant.
 *
 * ═══ UN ÉTAT VIDE EST UN ÉTAT, PAS UN REPROCHE ═══════════════════════════
 *   Tant qu'aucun run n'a tourné depuis la bascule d'échelle, la répartition
 *   est vide. On le DIT — « aucune exécution pour l'instant » — au lieu
 *   d'afficher un graphique plat qui se lirait « tout le monde à zéro ».
 */

type Probleme = {
  cle: string
  gravite: 'bloquant' | 'attention'
  compte: number | null
  depuis: string | null
  sujet: string | null
}
type Distribution = {
  runs_observes: number
  score_p50_moyen: number | null
  score_p90_moyen: number | null
  repartition: number[] | null
  notes_totales: number
}
type LigneDepense = {
  provider: string
  monthly_cap_usd: number
  depense_mois: number
  reste: number
  part_consommee: number | null
  au_plafond: boolean
}
type LigneHistorique = {
  mois: string
  provider: string
  action: string | null
  total_usd: number
  operations: number
  sans_tarif: number
}
type Operation = {
  id: string
  created_at: string
  provider: string
  action: string | null
  cost_usd: number
  model: string | null
  tarif_manquant: boolean
  acteur_type: string
  acteur_nom: string | null
}
type Reponse = {
  problemes: Probleme[]
  distribution: Distribution[] | null
  depense: LigneDepense[] | null
  historique: LigneHistorique[] | null
  operations: Operation[] | null
  mois: number
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
  margin: '0 0 12px',
  color: 'var(--color-text-primary, #0f172a)',
}
const cellule: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 13,
  borderBottom: '1px solid var(--color-border, #e2e8f0)',
  textAlign: 'left',
}

const somme = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

export default function SupervisionPage() {
  const t = useTranslations('admin_back_office.supervision')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Reponse | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch('/api/admin/supervision')
      const body = (await res.json()) as Reponse
      if (!res.ok) {
        setErreur(t('err_load'))
        return
      }
      setData(body)
    } catch {
      setErreur(t('err_load'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void charger()
  }, [charger])

  /** Les mois présents dans l'historique, du plus récent au plus ancien. */
  const mois = useMemo(() => {
    if (!data?.historique) return []
    return [...new Set(data.historique.map((l) => l.mois))].sort().reverse()
  }, [data])

  /** Le total par mois, tous fournisseurs et toutes actions confondus. */
  const totalParMois = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of data?.historique ?? []) m.set(l.mois, (m.get(l.mois) ?? 0) + Number(l.total_usd))
    return m
  }, [data])

  /** Le total par ACTION sur le mois le plus récent — la question « de quoi ? ». */
  const parAction = useMemo(() => {
    const dernier = mois[0]
    if (!dernier) return []
    const m = new Map<string, { total: number; operations: number }>()
    for (const l of data?.historique ?? []) {
      if (l.mois !== dernier) continue
      const cle = l.action ?? 'inconnue'
      const p = m.get(cle) ?? { total: 0, operations: 0 }
      m.set(cle, { total: p.total + Number(l.total_usd), operations: p.operations + Number(l.operations) })
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [data, mois])

  const sansTarif = useMemo(
    () => somme((data?.historique ?? []).map((l) => Number(l.sans_tarif))),
    [data],
  )

  const distribution = data?.distribution?.[0] ?? null
  const repartition = distribution?.repartition ?? null
  const totalNotes = repartition ? somme(repartition.map(Number)) : 0

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--color-text-primary, #0f172a)' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 20px', maxWidth: 720 }}>
        {t('intro')}
      </p>

      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)' }}>{t('loading')}</p>
      ) : erreur ? (
        <p role="alert" style={{ fontSize: 13, color: 'var(--color-error, #dc2626)' }}>
          {erreur}
        </p>
      ) : (
        <>
          {/* ─── CE QUI NE VA PAS, EN PREMIER ─────────────────────────────── */}
          <section style={cardStyle}>
            <h2 style={h2Style}>{t('problems_title')}</h2>
            {(data?.problemes.length ?? 0) === 0 ? (
              /* Le cas normal ne crie pas. Aucune couleur, une phrase. */
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: 0 }}>
                {t('problems_none')}
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {data?.problemes.map((p) => {
                  const bloquant = p.gravite === 'bloquant'
                  return (
                    <li
                      key={`${p.cle}-${p.sujet ?? ''}`}
                      role={bloquant ? 'alert' : undefined}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'baseline',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: `1px solid ${bloquant ? 'var(--color-error, #dc2626)' : 'var(--color-warning, #d97706)'}`,
                        background: bloquant ? 'var(--color-error-soft, #fef2f2)' : 'var(--color-warning-soft, #fffbeb)',
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          color: bloquant ? 'var(--color-error, #dc2626)' : 'var(--color-warning, #d97706)',
                        }}
                      >
                        {bloquant ? t('gravity_blocking') : t('gravity_attention')}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)', flex: '1 1 260px' }}>
                        {t(`problem.${p.cle}` as 'problem.annonces_jamais_tentees', { count: p.compte ?? 0 })}
                        {p.depuis && (
                          <span style={{ color: 'var(--color-text-tertiary, #94a3b8)' }}>
                            {' '}
                            {t('since', { date: new Date(p.depuis).toLocaleDateString() })}
                          </span>
                        )}
                      </span>
                      {p.sujet && (
                        <Link
                          href={`/admin/supervision/${p.sujet}`}
                          style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-primary, #2563eb)' }}
                        >
                          {t('open')}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* ─── LA RÉPARTITION DES NOTES ─────────────────────────────────── */}
          <section style={cardStyle}>
            <h2 style={h2Style}>{t('spread_title')}</h2>
            {!repartition || totalNotes === 0 ? (
              /* UN ÉTAT, PAS UN REPROCHE. */
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: 0 }}>
                {t('spread_empty')}
              </p>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)', margin: '0 0 14px' }}>
                  {t('spread_intro', { runs: distribution?.runs_observes ?? 0, notes: totalNotes })}
                </p>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
                  {repartition.map((n, i) => {
                    const max = Math.max(...repartition.map(Number), 1)
                    const hauteur = Math.round((Number(n) / max) * 100)
                    return (
                      <div key={i} style={{ flex: 1, textAlign: 'center' }}>
                        <div
                          title={t('spread_bar', { from: i, to: i + 1, count: Number(n) })}
                          style={{
                            height: `${Math.max(2, hauteur)}%`,
                            background: 'var(--sk-accent, #2563eb)',
                            borderRadius: '4px 4px 0 0',
                            opacity: 0.85,
                          }}
                        />
                        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary, #94a3b8)' }}>{i}</span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </section>

          {/* ─── LA CONSOMMATION ──────────────────────────────────────────── */}
          <section style={cardStyle}>
            <h2 style={h2Style}>{t('spend_title')}</h2>
            {/* CE QUE LE COMPTEUR EST, en une ligne. */}
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)', margin: '0 0 14px', maxWidth: 720 }}>
              {t('spend_estimate')}
            </p>

            {sansTarif > 0 && (
              <p
                role="alert"
                style={{ fontSize: 13, color: 'var(--color-warning, #d97706)', margin: '0 0 14px' }}
              >
                {t('spend_missing_price', { count: sansTarif })}
              </p>
            )}

            {(data?.depense?.length ?? 0) > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14, marginBottom: 18 }}>
                {data?.depense?.map((d) => (
                  <div key={d.provider} style={{ border: '1px solid var(--color-border, #e2e8f0)', borderRadius: 10, padding: 14 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, margin: 0, color: 'var(--color-text-primary, #0f172a)' }}>
                      {t(`usage.${d.provider}` as 'usage.claude')}
                    </p>
                    <p style={{ fontSize: 20, fontWeight: 600, margin: '6px 0 0', color: 'var(--color-text-primary, #0f172a)' }}>
                      {t('spend_amount', { amount: Number(d.depense_mois).toFixed(2) })}
                    </p>
                    <p style={{ fontSize: 12, margin: '2px 0 0', color: 'var(--color-text-tertiary, #94a3b8)' }}>
                      {t('spend_of_cap', { cap: Number(d.monthly_cap_usd).toFixed(2) })}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* L'HISTORIQUE — ce que deux totaux ne pouvaient pas dire. */}
            {mois.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--color-text-primary, #0f172a)' }}>
                  {t('history_title')}
                </h3>
                <div style={{ overflowX: 'auto', marginBottom: 18 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 320 }}>
                    <tbody>
                      {mois.map((m) => (
                        <tr key={m}>
                          <td style={cellule}>{new Date(m).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</td>
                          <td style={{ ...cellule, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {t('spend_amount', { amount: (totalParMois.get(m) ?? 0).toFixed(2) })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* PAR TYPE D'ACTION — la question « de quoi ? ». */}
            {parAction.length > 0 && (
              <>
                <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px', color: 'var(--color-text-primary, #0f172a)' }}>
                  {t('by_action_title')}
                </h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
                    <tbody>
                      {parAction.map(([action, v]) => (
                        <tr key={action}>
                          <td style={cellule}>{t(`action.${action}` as 'action.cv_parsing')}</td>
                          <td style={{ ...cellule, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {t('operations_count', { count: v.operations })}
                          </td>
                          <td style={{ ...cellule, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {t('spend_amount', { amount: v.total.toFixed(2) })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <p style={{ margin: '16px 0 0' }}>
              <Link
                href="/admin/supervision/operations"
                style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary, #2563eb)' }}
              >
                {t('open_operations')}
              </Link>
            </p>
          </section>
        </>
      )}
    </div>
  )
}

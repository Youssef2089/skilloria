'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { etatRepartition, inclusExclus, type LectureRepartition } from '@/lib/matching/etat-repartition'

/**
 * /admin/matching — CE QUI SE DÉCIDE, ET RIEN D'AUTRE.
 *
 * ┌─ DEUXIÈME PASSE ────────────────────────────────────────────────────────┐
 * │ La première séparait déjà le réglage de la supervision. Youssef l'a      │
 * │ rouvert et ne comprenait toujours pas — pour trois raisons mesurables :  │
 * │   · les deux budgets étaient nommés PAR FOURNISSEUR, pas par usage : il  │
 * │     cherchait « analyse de CV » et ne la trouvait nulle part ;           │
 * │   · les notifications étaient fermées DEUX FOIS dans le même bloc (le    │
 * │     filtre à 10 ET la case décochée) — devant deux verrous pour une      │
 * │     porte, on ne sait plus lequel agit ;                                 │
 * │   · l'écran annonçait « la lecture a échoué » alors que le moteur        │
 * │     n'avait jamais tourné.                                               │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * ═══ « AUCUNE EXÉCUTION » N'EST PAS « LECTURE EN PANNE » ═════════════════
 *   La décision vit dans `lib/matching/etat-repartition.ts`, en fonction PURE
 *   à trois états. Le compilateur force cet écran à répondre aux trois, et le
 *   diagnostic l'éprouve sans navigateur. Écrite dans un ternaire au milieu du
 *   JSX, elle s'était déjà réécrite de travers une fois (§E.22).
 */

type Reglage = {
  domain_id: string
  feed_threshold: number
  notify_threshold: number
  notify_enabled: boolean
  rerank_model: string
  rerank_batch_size: number
  domaine: { slug: string; name: string | null } | null
  distribution: LectureRepartition
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

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
}
const titreBloc: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  margin: '0 0 2px',
  color: 'var(--sk-text)',
}
/** UNE ligne. Jamais un paragraphe. */
const uneLigne: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--sk-muted)',
  margin: '0 0 18px',
  maxWidth: 760,
}
const etiquette: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 4,
  color: 'var(--sk-text)',
}
const sousEtiquette: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--sk-muted)',
  margin: '0 0 8px',
  lineHeight: 1.5,
}
const champ: React.CSSProperties = {
  width: 130,
  padding: '9px 11px',
  fontSize: 15,
  border: '1px solid var(--sk-border)',
  borderRadius: 8,
  background: '#fff',
  color: 'inherit',
}
const encart: React.CSSProperties = {
  background: 'var(--sk-bg, #f8fafc)',
  border: '1px solid var(--sk-border)',
  borderRadius: 10,
  padding: '12px 14px',
  marginTop: 14,
}
const bouton = (inactif: boolean): React.CSSProperties => ({
  padding: '9px 18px',
  fontSize: 14,
  fontWeight: 500,
  borderRadius: 8,
  border: 'none',
  background: 'var(--sk-accent)',
  color: '#fff',
  cursor: inactif ? 'not-allowed' : 'pointer',
  opacity: inactif ? 0.6 : 1,
})

/** Un montant, toujours précédé de son symbole. Youssef l'a demandé nommément. */
function Montant({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 15, color: 'var(--sk-muted)' }}>$</span>
      {children}
    </span>
  )
}

export default function MatchingPage() {
  const t = useTranslations('admin_matching')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Reponse | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [saisies, setSaisies] = useState<
    Record<string, { feed: string; notify: string; enabled: boolean; model: string; batch: string }>
  >({})
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
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 6px', maxWidth: 760 }}>
        {t('intro')}{' '}
        <Link href="/admin/supervision" style={{ color: 'var(--sk-accent)' }}>
          {t('to_monitoring')}
        </Link>
      </p>

      {msg && (
        <p
          role={msg.kind === 'err' ? 'alert' : undefined}
          style={{
            fontSize: 13,
            margin: '14px 0',
            color: msg.kind === 'err' ? 'var(--sk-red)' : 'var(--sk-success)',
          }}
        >
          {msg.text}
        </p>
      )}

      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', marginTop: 20 }}>{t('loading')}</p>
      ) : erreur ? (
        <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)', marginTop: 20 }}>
          {erreur}
        </p>
      ) : (
        <>
          {/* ─── LE BUDGET ────────────────────────────────────────────────
              NOMMÉ PAR USAGE, PAS PAR FOURNISSEUR. « Classement des experts »
              et « Rédaction et analyse » étaient un découpage de facturation :
              Youssef cherchait « analyse de CV » et ne la trouvait nulle part.
              Chaque champ dit désormais CE QU'IL PAIE, et le fournisseur passe
              en second. */}
          <section style={{ ...carte, marginTop: 20 }}>
            <h2 style={titreBloc}>{t('budget_title')}</h2>
            <p style={uneLigne}>{t('budget_one_line')}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
              {(['rerank', 'claude'] as const).map((p) => {
                const d = data?.depense?.find((x) => x.provider === p)
                return (
                  <div key={p}>
                    <label htmlFor={`cap_${p}`} style={etiquette}>
                      {t(`budget.${p}.label` as 'budget.rerank.label')}
                    </label>
                    <p style={sousEtiquette}>{t(`budget.${p}.pays` as 'budget.rerank.pays')}</p>
                    <Montant>
                      <input
                        id={`cap_${p}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={1}
                        value={argent[`cap_${p}`] ?? ''}
                        onChange={(e) => setArgent((a) => ({ ...a, [`cap_${p}`]: e.target.value }))}
                        style={champ}
                      />
                    </Montant>
                    {d && (
                      <p
                        style={{
                          fontSize: 12,
                          margin: '8px 0 0',
                          color: d.au_plafond ? 'var(--sk-red)' : 'var(--sk-muted)',
                        }}
                      >
                        {d.au_plafond
                          ? t('budget_reached')
                          : t('budget_spent', { amount: Number(d.depense_mois).toFixed(2) })}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* ─── LES ALERTES ─────────────────────────────────────────────── */}
          <section style={carte}>
            <h2 style={titreBloc}>{t('alerts_title')}</h2>
            <p style={uneLigne}>{t('alerts_one_line')}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
              {(['organization', 'profile'] as const).map((a) => (
                <div key={a}>
                  <label htmlFor={`al_${a}`} style={etiquette}>
                    {t(`alert.${a}` as 'alert.organization')}
                  </label>
                  <Montant>
                    <input
                      id={`al_${a}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={1}
                      value={argent[`alerte_${a}`] ?? ''}
                      onChange={(e) => setArgent((x) => ({ ...x, [`alerte_${a}`]: e.target.value }))}
                      style={champ}
                    />
                  </Montant>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => void enregistrerArgent()}
                disabled={enCours === 'argent'}
                style={bouton(enCours === 'argent')}
              >
                {enCours === 'argent' ? t('saving') : t('save')}
              </button>
              <span style={{ fontSize: 12, color: 'var(--sk-faint)' }}>{t('audited')}</span>
            </div>
          </section>

          {/* ─── PAR ÉCOSYSTÈME ──────────────────────────────────────────── */}
          {data?.reglages.map((r) => {
            const s = saisies[r.domain_id] ?? { feed: '', notify: '', enabled: false, model: '', batch: '' }
            const blocage = motifDeBlocage(r)
            const modeleChange = s.model !== r.rerank_model
            const etat = etatRepartition(r.distribution)
            return (
              <div key={r.domain_id}>
                {/* L'INTITULÉ DIT QU'ON RÈGLE **UN** ÉCOSYSTÈME PARMI D'AUTRES. */}
                <h2
                  style={{
                    fontSize: 17,
                    fontWeight: 600,
                    margin: '28px 0 2px',
                    color: 'var(--sk-text)',
                  }}
                >
                  {t('ecosystem_title', { name: r.domaine?.name ?? r.domaine?.slug ?? r.domain_id })}
                </h2>
                <p style={{ ...uneLigne, margin: '0 0 14px' }}>{t('ecosystem_one_line')}</p>

                {/* CE QUE VOIT L'EXPERT */}
                <section style={carte}>
                  <h3 style={titreBloc}>{t('feed_title')}</h3>
                  <p style={uneLigne}>{t('feed_one_line')}</p>

                  <label htmlFor={`f_${r.domain_id}`} style={etiquette}>
                    {t('field_feed')}
                  </label>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      id={`f_${r.domain_id}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={10}
                      step={1}
                      value={s.feed}
                      onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, feed: e.target.value } }))}
                      style={{ ...champ, width: 100 }}
                    />
                    <span style={{ fontSize: 14, color: 'var(--sk-muted)' }}>{t('out_of_ten')}</span>
                  </span>
                  {Number(s.feed) === 0 && (
                    <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '8px 0 0' }}>
                      {t('feed_at_zero')}
                    </p>
                  )}

                  {/* TROIS ÉTATS, ET LE COMPILATEUR FORCE À RÉPONDRE AUX TROIS. */}
                  <div style={encart}>
                    {etat.etat === 'indisponible' ? (
                      <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--sk-red)' }}>
                        {t('spread_unavailable')}
                      </p>
                    ) : etat.etat === 'aucune_execution' ? (
                      <>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--sk-text)' }}>
                          {t('spread_none_yet_title')}
                        </p>
                        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--sk-muted)' }}>
                          {t('spread_none_yet_help')}
                        </p>
                      </>
                    ) : (
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--sk-text)' }}>
                        {t('spread_effect', {
                          ...inclusExclus(etat.tranches, Number(s.feed)),
                          total: etat.total,
                        })}
                      </p>
                    )}
                  </div>
                </section>

                {/* PRÉVENIR L'EXPERT — UN SEUL INTERRUPTEUR DÉCIDE.
                    Le filtre à 10 fermait la porte une seconde fois, dans le
                    même bloc : devant deux verrous pour une porte, on ne sait
                    plus lequel agit. La note passe dans son propre sous-bloc,
                    inerte tant que l'interrupteur est fermé — et elle n'est pas
                    seulement grisée : le champ est DÉSACTIVÉ. Un champ gris mais
                    saisissable est un champ qu'on remplit. */}
                <section style={carte}>
                  <h3 style={titreBloc}>{t('notify_title')}</h3>
                  <p style={uneLigne}>{t('notify_one_line')}</p>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, enabled: e.target.checked } }))}
                      style={{ width: 18, height: 18 }}
                    />
                    {t('field_notify_enabled')}
                  </label>

                  <div style={{ marginTop: 18, opacity: s.enabled ? 1 : 0.45 }}>
                    <label htmlFor={`n_${r.domain_id}`} style={etiquette}>
                      {t('field_notify')}
                    </label>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <input
                        id={`n_${r.domain_id}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={10}
                        step={1}
                        disabled={!s.enabled}
                        value={s.notify}
                        onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, notify: e.target.value } }))}
                        style={{ ...champ, width: 100 }}
                      />
                      <span style={{ fontSize: 14, color: 'var(--sk-muted)' }}>{t('out_of_ten')}</span>
                    </span>
                    {!s.enabled && (
                      <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '8px 0 0' }}>
                        {t('notify_inactive')}
                      </p>
                    )}
                  </div>
                </section>

                {/* PARAMÈTRES TECHNIQUES — REPLIÉS. Ce ne sont pas des décisions
                    produit ; ils ne disparaissent pas pour autant (§D.7). */}
                <details style={carte}>
                  <summary style={{ fontSize: 14, fontWeight: 600, cursor: 'pointer', color: 'var(--sk-text)' }}>
                    {t('technical_title')}
                  </summary>
                  <p style={{ ...uneLigne, margin: '8px 0 14px' }}>{t('technical_one_line')}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
                    <div>
                      <label htmlFor={`m_${r.domain_id}`} style={etiquette}>
                        {t('field_model')}
                      </label>
                      <select
                        id={`m_${r.domain_id}`}
                        value={s.model}
                        onChange={(e) => setSaisies((p) => ({ ...p, [r.domain_id]: { ...s, model: e.target.value } }))}
                        style={{ ...champ, width: '100%', maxWidth: 300 }}
                      >
                        {[...new Set([r.rerank_model, ...(data?.modeles ?? [])])].map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                      {modeleChange && (
                        <p role="alert" style={{ fontSize: 12, margin: '8px 0 0', color: 'var(--sk-amber)' }}>
                          {t('model_changes_scale')}
                        </p>
                      )}
                    </div>
                    <div>
                      <label htmlFor={`b_${r.domain_id}`} style={etiquette}>
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
                        style={champ}
                      />
                    </div>
                  </div>
                </details>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => void enregistrerEcosysteme(r)}
                    disabled={enCours === r.domain_id || blocage !== null}
                    style={bouton(enCours === r.domain_id || blocage !== null)}
                  >
                    {enCours === r.domain_id ? t('saving') : t('save')}
                  </button>
                  {/* UN BOUTON GRISÉ DIT POURQUOI. */}
                  <span style={{ fontSize: 12, color: 'var(--sk-faint)' }}>
                    {blocage ?? t('audited')}
                  </span>
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

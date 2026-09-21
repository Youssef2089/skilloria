'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/tarifs-ia — LA GRILLE TARIFAIRE, RÉGLABLE SANS DÉPLOIEMENT.
 *
 * ┌─ POURQUOI CET ÉCRAN ────────────────────────────────────────────────────┐
 * │ La grille vivait en base, et aucun écran ne l'exposait : changer un prix │
 * │ exigeait d'écrire une migration et de déployer. Un réglage qui ne se     │
 * │ règle pas n'est pas un réglage (§D.7) — et celui-ci gouverne un chiffre  │
 * │ d'ARGENT. Son absence a coûté DEUX surévaluations, dont une de 50 % sur  │
 * │ le seul point que le plafond comptait (§E.13).                           │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * CE QUE CET ÉCRAN DIT, ET QU'AUCUN AUTRE NE DISAIT : le compteur de dépense
 * est une ESTIMATION reconstituée, pas la facture du fournisseur. Personne
 * n'est interrogé. C'est écrit en une ligne, en haut, et la date de dernière
 * modification est affichée par ligne — un prix qu'on n'a pas revu depuis des
 * mois est un prix qu'on croit à tort.
 *
 * LE LIEN VERS LA GRILLE OFFICIELLE est là pour qu'on puisse comparer sans
 * chercher : c'est la seule façon qu'une vérification ait lieu.
 */

type Tarif = {
  model: string
  provider: string
  usd_par_1m_entree: number | null
  usd_par_1m_sortie: number | null
  usd_par_unite: number | null
  source: string | null
  updated_at: string
}
type Reponse = {
  tarifs: Tarif[]
  plus_ancienne_modification: string | null
  bornes: { prix_max: number }
}

/**
 * La grille officielle, par fournisseur. Ce sont des ADRESSES DE DOCUMENTATION,
 * pas des réglages : elles ne décident de rien et ne changent qu'avec le
 * fournisseur lui-même. Les mettre en base créerait un réglage de plus à tenir.
 */
const GRILLE_OFFICIELLE: Record<string, string> = {
  claude: 'https://www.anthropic.com/pricing',
  rerank: 'https://cohere.com/pricing',
}

const cardStyle: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
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
  background: '#fff',
  color: 'inherit',
}

/** Jours écoulés depuis un horodatage ISO. `null` si illisible. */
function joursDepuis(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

export default function TarifsIaPage() {
  const t = useTranslations('admin_back_office.tarifs_ia')
  const secureFetch = useSecureFetch()

  const [tarifs, setTarifs] = useState<Tarif[] | null>(null)
  const [plusAncienne, setPlusAncienne] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreurChargement, setErreurChargement] = useState<string | null>(null)
  /** Saisies en cours, par modèle. Vide = la valeur du serveur fait foi. */
  const [saisies, setSaisies] = useState<Record<string, { entree: string; sortie: string; unite: string }>>({})
  const [enCours, setEnCours] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreurChargement(null)
    try {
      const res = await secureFetch('/api/admin/tarifs-ia')
      const body = (await res.json()) as Reponse & { code?: string }
      if (!res.ok) {
        setErreurChargement(t('err_load'))
        return
      }
      setTarifs(body.tarifs)
      setPlusAncienne(body.plus_ancienne_modification)
      setSaisies(
        Object.fromEntries(
          body.tarifs.map((l) => [
            l.model,
            {
              entree: l.usd_par_1m_entree == null ? '' : String(l.usd_par_1m_entree),
              sortie: l.usd_par_1m_sortie == null ? '' : String(l.usd_par_1m_sortie),
              unite: l.usd_par_unite == null ? '' : String(l.usd_par_unite),
            },
          ]),
        ),
      )
    } catch {
      setErreurChargement(t('err_load'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void charger()
  }, [charger])

  const joursSansVerification = useMemo(() => joursDepuis(plusAncienne), [plusAncienne])

  async function enregistrer(ligne: Tarif) {
    const s = saisies[ligne.model]
    if (!s) return
    setEnCours(ligne.model)
    setMsg(null)
    const parJetons = ligne.usd_par_unite == null
    try {
      const res = await secureFetch('/api/admin/tarifs-ia', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ligne.model,
          usd_par_1m_entree: parJetons ? Number(s.entree) : null,
          usd_par_1m_sortie: parJetons ? Number(s.sortie) : null,
          usd_par_unite: parJetons ? null : Number(s.unite),
        }),
      })
      const body = (await res.json()) as { code?: string }
      if (!res.ok) {
        setMsg({
          kind: 'err',
          text:
            body.code === 'invalid_price'
              ? t('err_invalid_price')
              : body.code === 'invalid_shape'
                ? t('err_invalid_shape')
                : t('err_save'),
        })
        return
      }
      setMsg({ kind: 'ok', text: t('saved', { model: ligne.model }) })
      await charger()
    } catch {
      setMsg({ kind: 'err', text: t('err_save') })
    } finally {
      setEnCours(null)
    }
  }

  /**
   * CE QUI EMPÊCHE D'ENREGISTRER, EN TOUTES LETTRES.
   * Un bouton grisé sans raison est un cul-de-sac : on ne sait ni pourquoi, ni
   * quoi faire. On rend donc le MOTIF, pas un booléen.
   */
  function motifDeBlocage(ligne: Tarif): string | null {
    const s = saisies[ligne.model]
    if (!s) return null
    const parJetons = ligne.usd_par_unite == null
    const champs = parJetons ? [s.entree, s.sortie] : [s.unite]
    if (champs.some((v) => v.trim() === '')) return t('blocked_empty')
    if (champs.some((v) => !Number.isFinite(Number(v)) || Number(v) < 0)) return t('blocked_invalid')
    const inchange = parJetons
      ? Number(s.entree) === ligne.usd_par_1m_entree && Number(s.sortie) === ligne.usd_par_1m_sortie
      : Number(s.unite) === ligne.usd_par_unite
    if (inchange) return t('blocked_unchanged')
    return null
  }

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
        {t('title')}
      </h1>
      {/* UNE LIGNE, pas un paragraphe. C'est la seule chose qu'il faut savoir
          avant de toucher à un prix. */}
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 8px', maxWidth: 720 }}>
        {t('intro')}
      </p>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 20px', maxWidth: 720 }}>
        {t('devise')}
      </p>

      {/* CE QUI NE VA PAS SE VOIT. Une grille jamais revue depuis longtemps
          n'est pas une information neutre : le compteur de dépense en dépend
          entièrement. Au-delà de 90 jours, l'avertissement change de ton. */}
      {joursSansVerification !== null && joursSansVerification >= 90 && (
        <p
          role="alert"
          style={{
            fontSize: 13,
            margin: '0 0 20px',
            padding: '10px 12px',
            borderRadius: 8,
            background: 'var(--sk-red-soft)',
            color: 'var(--sk-red)',
            border: '1px solid var(--sk-red)',
            maxWidth: 720,
          }}
        >
          {t('stale_warning', { days: joursSansVerification })}
        </p>
      )}

      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('loading')}</p>
      ) : erreurChargement ? (
        <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)' }}>
          {erreurChargement}
        </p>
      ) : (tarifs?.length ?? 0) === 0 ? (
        /* ÉTAT VIDE, dit comme un état. Une grille vide n'accuse personne : elle
           dit que la migration qui la pose n'a pas été appliquée ici. */
        <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('empty')}</p>
      ) : (
        <>
          {msg && (
            <p
              role={msg.kind === 'err' ? 'alert' : undefined}
              style={{
                fontSize: 13,
                margin: '0 0 14px',
                color: msg.kind === 'err' ? 'var(--sk-red)' : 'var(--sk-success)',
              }}
            >
              {msg.text}
            </p>
          )}

          {tarifs?.map((ligne) => {
            const s = saisies[ligne.model] ?? { entree: '', sortie: '', unite: '' }
            const parJetons = ligne.usd_par_unite == null
            const blocage = motifDeBlocage(ligne)
            const jours = joursDepuis(ligne.updated_at)
            const grille = GRILLE_OFFICIELLE[ligne.provider]
            return (
              <section key={ligne.model} style={cardStyle}>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <h2
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        margin: 0,
                        color: 'var(--sk-text)',
                      }}
                    >
                      {t(`usage.${ligne.provider}` as 'usage.claude')}
                    </h2>
                    {/* Le NOM TECHNIQUE en second et en petit : c'est lui qu'il
                        faut comparer à la grille du fournisseur, mais ce n'est
                        pas lui qui dit à quoi sert la ligne. */}
                    <p
                      style={{
                        fontSize: 12,
                        margin: '2px 0 0',
                        color: 'var(--sk-faint)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {ligne.model}
                    </p>
                  </div>
                  <p style={{ fontSize: 12, margin: 0, color: 'var(--sk-faint)' }}>
                    {jours === null
                      ? t('modified_unknown')
                      : jours === 0
                        ? t('modified_today')
                        : t('modified_days', { days: jours })}
                  </p>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                    gap: 14,
                    maxWidth: 560,
                  }}
                >
                  {parJetons ? (
                    <>
                      <div>
                        <label htmlFor={`e_${ligne.model}`} style={labelStyle}>
                          {t('field_in')}
                        </label>
                        <input
                          id={`e_${ligne.model}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={s.entree}
                          onChange={(e) =>
                            setSaisies((p) => ({ ...p, [ligne.model]: { ...s, entree: e.target.value } }))
                          }
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label htmlFor={`s_${ligne.model}`} style={labelStyle}>
                          {t('field_out')}
                        </label>
                        <input
                          id={`s_${ligne.model}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          value={s.sortie}
                          onChange={(e) =>
                            setSaisies((p) => ({ ...p, [ligne.model]: { ...s, sortie: e.target.value } }))
                          }
                          style={inputStyle}
                        />
                      </div>
                    </>
                  ) : (
                    <div>
                      <label htmlFor={`u_${ligne.model}`} style={labelStyle}>
                        {t('field_unit')}
                      </label>
                      <input
                        id={`u_${ligne.model}`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.000001"
                        value={s.unite}
                        onChange={(e) =>
                          setSaisies((p) => ({ ...p, [ligne.model]: { ...s, unite: e.target.value } }))
                        }
                        style={inputStyle}
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <button
                    type="button"
                    onClick={() => void enregistrer(ligne)}
                    disabled={enCours === ligne.model || blocage !== null}
                    style={{
                      padding: '9px 18px',
                      fontSize: 14,
                      fontWeight: 500,
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--sk-accent)',
                      color: '#fff',
                      cursor: enCours === ligne.model || blocage !== null ? 'not-allowed' : 'pointer',
                      opacity: enCours === ligne.model || blocage !== null ? 0.6 : 1,
                    }}
                  >
                    {enCours === ligne.model ? t('saving') : t('save')}
                  </button>
                  {/* UN BOUTON GRISÉ DIT POURQUOI. Sans ce motif, on reste
                      devant un bouton mort sans savoir ce qu'on a mal fait. */}
                  {blocage && (
                    <span style={{ fontSize: 12, color: 'var(--sk-faint)' }}>{blocage}</span>
                  )}
                  {grille && (
                    <a
                      href={grille}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 12, color: 'var(--sk-accent)' }}
                    >
                      {t('official_grid')}
                    </a>
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

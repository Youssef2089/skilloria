'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/consommation — CE QUE CHAQUE COMPTE A COÛTÉ CE MOIS-CI.
 *
 * Page de MENU : aucun bouton Retour (règle projet).
 *
 * ┌─ POURQUOI CET ÉCRAN EXISTE ─────────────────────────────────────────────┐
 * │ Depuis ce lot, un compte peut être ARRÊTÉ par son propre plafond : son  │
 * │ annonce n'est plus classée, ou ses recherches ne partent plus. Rien ne  │
 * │ casse et rien n'échoue — il ne se passe simplement plus rien.           │
 * │                                                                          │
 * │ La supervision dit COMBIEN de comptes sont dans cet état. Elle ne dit   │
 * │ pas LESQUELS, ni à combien, ni sur quoi. Sans cet écran, on relèverait  │
 * │ le plafond au jugé — ou on le retirerait, ce qui revient au même.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ LES DEUX ÉTATS VIENNENT DE LA BASE, ILS NE SONT PAS RECALCULÉS ICI.
 *    Comparer une dépense à un plafond dans le navigateur ferait une seconde
 *    règle, sur une seconde fenêtre mensuelle, et c'est ainsi que deux écrans
 *    finissent par ne plus dire la même chose (§E.15, §E.20).
 *
 * ⚠️ LA SOMME BOUCLE, ET L'ÉCRAN LE MONTRE. Les acteurs détaillés, le reste
 *    AGRÉGÉ ET COMPTÉ, et le non-imputable : trois familles disjointes dont
 *    la somme est la dépense du mois. Cacher la troisième donnerait un total
 *    plus propre et faux.
 */

type LigneActeur = {
  acteur_type: string
  acteur_id: string | null
  acteur_nom: string | null
  depense_mois: number | string
  evenements: number
  acteurs_regroupes: number
  plafond_mensuel_usd: number | string | null
  seuil_mensuel_usd: number | string | null
  au_plafond: boolean | null
  en_alerte: boolean | null
}

type LigneGlobale = {
  provider: string
  monthly_cap_usd: number | string
  depense_mois: number | string
  au_plafond: boolean
}

type Reponse = {
  acteurs: LigneActeur[] | null
  reglages: Array<{ acteur: string; seuil_mensuel_usd: number | string; plafond_mensuel_usd: number | string }> | null
  global: LigneGlobale[] | null
  bornes: { acteurs_detailles: number }
}

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 12,
  padding: 20,
  marginBottom: 16,
}

const cellule: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 13,
  color: 'var(--sk-text)',
  borderBottom: '1px solid var(--sk-border)',
  textAlign: 'left',
  verticalAlign: 'top',
}

const enTete: React.CSSProperties = {
  ...cellule,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--sk-muted)',
  whiteSpace: 'nowrap',
}

const montant: React.CSSProperties = { ...cellule, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

const nombre = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v))

export default function ConsommationPage() {
  const t = useTranslations('admin_back_office.consommation')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Reponse | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch('/api/admin/consommation')
      if (!res.ok) {
        setErreur(t('err_load'))
        return
      }
      setData((await res.json()) as Reponse)
    } catch {
      setErreur(t('err_load'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void charger()
  }, [charger])

  /**
   * LE TOTAL EST LA SOMME DES LIGNES RENDUES, calculée ici — c'est ce qui
   * permet de VÉRIFIER que la somme boucle en regardant l'écran, plutôt que
   * de devoir croire la fonction de base sur parole.
   */
  const total = useMemo(
    () => (data?.acteurs ?? []).reduce((s, l) => s + nombre(l.depense_mois), 0),
    [data],
  )

  const detailles = (data?.acteurs ?? []).filter(
    (l) => l.acteur_type === 'organization' || l.acteur_type === 'profile',
  )
  const reste = (data?.acteurs ?? []).find((l) => l.acteur_type === 'reste_non_detaille')
  const nonImputable = (data?.acteurs ?? []).find((l) => l.acteur_type === 'non_imputable')

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 6px', maxWidth: 760 }}>
        {t('intro')}{' '}
        <Link href="/admin/matching" style={{ color: 'var(--sk-accent)' }}>
          {t('to_settings')}
        </Link>
      </p>

      {chargement && (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', marginTop: 20 }}>{t('loading')}</p>
      )}

      {erreur && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)', marginTop: 20 }}>
          {erreur}
        </p>
      )}

      {!chargement && !erreur && (
        <>
          {/* ─── LE DERNIER GARDE-FOU, RAPPELÉ EN PREMIER ──────────────────
              Un plafond de compte se lit mal sans savoir ce qu'il reste au
              budget commun : à 100 % du global, plus rien ne part, quel que
              soit l'état des comptes. */}
          <section style={{ ...carte, marginTop: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
              {t('global_title')}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 14px' }}>
              {t('global_one_line')}
            </p>
            {data?.global === null ? (
              <p style={{ fontSize: 13, color: 'var(--sk-amber)' }}>{t('unreadable')}</p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
                {(data?.global ?? []).map((g) => (
                  <div key={g.provider}>
                    <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: 0 }}>{g.provider}</p>
                    <p
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        margin: '2px 0 0',
                        fontVariantNumeric: 'tabular-nums',
                        color: g.au_plafond ? 'var(--sk-red)' : 'var(--sk-text)',
                      }}
                    >
                      {t('amount_of', {
                        spent: nombre(g.depense_mois).toFixed(2),
                        cap: nombre(g.monthly_cap_usd).toFixed(2),
                      })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ─── PAR COMPTE ─────────────────────────────────────────────── */}
          <section style={carte}>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>
              {t('accounts_title')}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 14px', maxWidth: 720 }}>
              {t('accounts_one_line')}
            </p>

            {data?.acteurs === null ? (
              <p style={{ fontSize: 13, color: 'var(--sk-amber)' }}>{t('unreadable')}</p>
            ) : detailles.length === 0 ? (
              // UN ÉTAT VIDE DIT QUELQUE CHOSE : il prend `--sk-muted`, pas le
              // texte tenu (§D.12).
              <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('empty')}</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={enTete}>{t('col_account')}</th>
                      <th style={enTete}>{t('col_kind')}</th>
                      <th style={enTete}>{t('col_spent')}</th>
                      <th style={enTete}>{t('col_cap')}</th>
                      <th style={enTete}>{t('col_state')}</th>
                      <th style={enTete}>{t('col_calls')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailles.map((l) => (
                      <tr key={`${l.acteur_type}:${l.acteur_id}`}>
                        <td style={cellule}>{l.acteur_nom ?? t('unnamed')}</td>
                        <td style={cellule}>
                          {t(`kind.${l.acteur_type}` as 'kind.organization')}
                        </td>
                        <td style={montant}>{nombre(l.depense_mois).toFixed(4)}</td>
                        <td style={montant}>{nombre(l.plafond_mensuel_usd).toFixed(2)}</td>
                        <td style={cellule}>
                          {/* TROIS ÉTATS, ET ILS NE DISENT PAS LA MÊME CHOSE :
                              au plafond, ce qui est automatique s'est ARRÊTÉ ;
                              en alerte, rien n'est arrêté, il faut regarder. */}
                          {l.au_plafond === true ? (
                            <span style={{ color: 'var(--sk-red)', fontWeight: 600 }}>
                              {t('state_capped')}
                            </span>
                          ) : l.en_alerte === true ? (
                            <span style={{ color: 'var(--sk-amber)' }}>{t('state_alert')}</span>
                          ) : (
                            <span style={{ color: 'var(--sk-muted)' }}>{t('state_ok')}</span>
                          )}
                        </td>
                        <td style={montant}>{l.evenements}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ─── CE QUI N'EST PAS DÉTAILLÉ EST DIT, PAS CACHÉ ──────────── */}
            {(reste || nonImputable) && (
              <div style={{ marginTop: 16, display: 'grid', gap: 6 }}>
                {reste && nombre(reste.depense_mois) > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: 0 }}>
                    {t('rest', {
                      count: reste.acteurs_regroupes,
                      amount: nombre(reste.depense_mois).toFixed(4),
                    })}
                  </p>
                )}
                {nonImputable && nombre(nonImputable.depense_mois) > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: 0 }}>
                    {t('unattributed', {
                      amount: nombre(nonImputable.depense_mois).toFixed(4),
                      count: nonImputable.evenements,
                    })}
                  </p>
                )}
                <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '6px 0 0', fontWeight: 600 }}>
                  {t('total', { amount: total.toFixed(4) })}
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

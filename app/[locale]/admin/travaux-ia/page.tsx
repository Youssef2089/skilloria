'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/travaux-ia — LES TRAVAUX D'IA QUI ATTENDENT UN HUMAIN (§D.30).
 *
 * Aucun bouton Retour : on navigue par les menus (décision de Youssef, 02/10/2026).
 *
 * Depuis le 30/09/2026, l'analyse d'un CV et la vérification d'un expert sont des
 * TRAVAUX, exécutés hors de la requête de l'expert et rejoués d'eux-mêmes quand
 * l'échec est de notre côté. Ce qui arrive ici est ce qui ne s'est PAS réglé seul :
 * un travail abandonné (et son motif), un travail que personne n'a pris, un travail
 * dont l'exécutant est mort. La supervision rougit tant que la liste n'est pas vide ;
 * « Relancer » la fait descendre (§E.52 : une alarme qu'aucune action n'éteint
 * apprend à être ignorée).
 *
 * ⚠️ AUCUN BOUTON DÉSACTIVÉ : un travail en retard n'a pas de bouton — le pilote le
 *    reprend à la minute, et l'écran le DIT ; seul un travail ÉCHOUÉ se relance.
 */

type Ligne = {
  id: string
  nature: 'analyse_cv' | 'verification_expert'
  profile_id: string
  statut: 'echoue' | 'en_attente' | 'en_cours'
  tentatives: number
  max_tentatives: number
  erreur_code: string | null
  cree_at: string
  fin_at: string | null
  prochaine_tentative_at: string
  expert: { titre: string | null; nom: string | null } | null
}

export default function TravauxIaPage() {
  const t = useTranslations('admin_back_office.travaux_ia')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur'>('chargement')
  const [lignes, setLignes] = useState<Ligne[]>([])
  // La liste est COUPÉE au plafond du serveur : l'écran le dit, il ne laisse pas croire qu'il montre tout.
  const [coupee, setCoupee] = useState(false)
  const [enCours, setEnCours] = useState<string | null>(null)
  const [message, setMessage] = useState<{ ton: 'ok' | 'erreur'; texte: string } | null>(null)

  const charger = useCallback(async () => {
    try {
      const res = await secureFetch('/api/admin/travaux-ia', { method: 'GET' })
      if (!res.ok) {
        setEtat('erreur')
        return
      }
      const data = (await res.json()) as { travaux?: Ligne[]; troncature?: { atteint?: boolean; plafond?: number } }
      setLignes(data.travaux ?? [])
      setCoupee(data.troncature?.atteint === true)
      setEtat('pret')
    } catch {
      setEtat('erreur')
    }
  }, [secureFetch])

  useEffect(() => {
    void charger()
  }, [charger])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    [locale],
  )

  /** La cause, traduite — jamais un code brut à l'écran (§D.11). */
  const libelleCause = (code: string | null): string => {
    if (!code) return t('cause_aucune')
    const cle = `causes.${code}`
    return t.has(cle as 'causes.delai_depasse') ? t(cle as 'causes.delai_depasse') : t('cause_inconnue', { code })
  }

  const relancer = async (id: string) => {
    setEnCours(id)
    setMessage(null)
    try {
      const res = await secureFetch('/api/admin/travaux-ia', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ travail_id: id }),
      })
      if (res.ok) {
        setMessage({ ton: 'ok', texte: t('relance_ok') })
      } else {
        const p = (await res.json().catch(() => ({}))) as { code?: string }
        setMessage({ ton: 'erreur', texte: p.code === 'plus_en_echec' ? t('relance_plus_en_echec') : t('relance_erreur') })
      }
    } catch {
      setMessage({ ton: 'erreur', texte: t('relance_erreur') })
    } finally {
      setEnCours(null)
      await charger()
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'inherit' }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', margin: 0 }}>{t('title')}</h1>
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '4px 0 0', lineHeight: 1.55 }}>{t('subtitle')}</p>
      </header>

      {message && (
        <div
          role="status"
          style={{
            marginBottom: 14, padding: '12px 16px', borderRadius: 10, fontSize: 13, lineHeight: 1.55,
            background: message.ton === 'erreur' ? 'var(--sk-red-soft)' : 'var(--sk-success-soft)',
            color: message.ton === 'erreur' ? 'var(--sk-red)' : 'var(--sk-success)',
          }}
        >
          {message.texte}
        </div>
      )}

      {etat === 'chargement' && <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('loading')}</p>}
      {etat === 'erreur' && (
        <div role="alert" style={{ padding: '12px 16px', borderRadius: 10, fontSize: 13, background: 'var(--sk-red-soft)', color: 'var(--sk-red)' }}>
          {t('err_load')}
        </div>
      )}
      {etat === 'pret' && lignes.length === 0 && (
        <div style={{ padding: '18px 20px', borderRadius: 12, border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', fontSize: 14, color: 'var(--sk-text)' }}>
          {t('empty')}
        </div>
      )}
      {etat === 'pret' && coupee && (
        <p role="status" style={{ fontSize: 13, color: 'var(--sk-amber)', margin: '0 0 10px' }}>{t('liste_coupee', { n: lignes.length })}</p>
      )}
      {etat === 'pret' && lignes.length > 0 && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--sk-border)', borderRadius: 12, background: 'var(--sk-surface)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--sk-muted)' }}>
                <th style={{ padding: '10px 14px' }}>{t('col_expert')}</th>
                <th style={{ padding: '10px 14px' }}>{t('col_nature')}</th>
                <th style={{ padding: '10px 14px' }}>{t('col_etat')}</th>
                <th style={{ padding: '10px 14px' }}>{t('col_cause')}</th>
                <th style={{ padding: '10px 14px' }}>{t('col_tentatives')}</th>
                <th style={{ padding: '10px 14px' }}>{t('col_date')}</th>
                <th style={{ padding: '10px 14px' }}>{t('col_action')}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--sk-border)', color: 'var(--sk-text)' }}>
                  <td style={{ padding: '10px 14px' }}>
                    <Link href={`/admin/experts/${l.profile_id}`} style={{ color: 'var(--sk-accent)', textDecoration: 'none', fontWeight: 600 }}>
                      {l.expert?.nom || t('expert_sans_nom')}
                    </Link>
                    {l.expert?.titre && <div style={{ color: 'var(--sk-muted)', fontSize: 12 }}>{l.expert.titre}</div>}
                  </td>
                  <td style={{ padding: '10px 14px' }}>{t(`nature.${l.nature}`)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span
                      style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                        background: l.statut === 'echoue' ? 'var(--sk-red-soft)' : 'var(--sk-amber-soft)',
                        color: l.statut === 'echoue' ? 'var(--sk-red)' : 'var(--sk-amber)',
                      }}
                    >
                      {t(`statut.${l.statut}`)}
                    </span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>{libelleCause(l.erreur_code)}</td>
                  <td style={{ padding: '10px 14px' }}>{t('tentatives', { n: l.tentatives, sur: l.max_tentatives })}</td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>{dateFmt.format(new Date(l.fin_at ?? l.prochaine_tentative_at ?? l.cree_at))}</td>
                  <td style={{ padding: '10px 14px' }}>
                    {l.statut === 'echoue' ? (
                      <button
                        type="button"
                        onClick={() => void relancer(l.id)}
                        style={{
                          padding: '7px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                          background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', fontFamily: 'inherit',
                        }}
                      >
                        {enCours === l.id ? t('relance_en_cours') : t('relancer')}
                      </button>
                    ) : (
                      <span style={{ color: 'var(--sk-muted)', fontSize: 12 }}>{t('repris_par_le_pilote')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

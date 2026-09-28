'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import ReauthModal from '@/components/settings/ReauthModal'

/**
 * CONSERVATION ET NETTOYAGE DU GRAND LIVRE (§D.26, phase B 2.7) — la section du
 * bas de /admin/journal.
 *
 * ⚠️ L'ANNONCE AVANT L'ACTE. Ce que le nettoyage effacerait — combien, jusqu'à
 *    quelle date, famille par famille — est affiché AVANT tout bouton ; une famille
 *    qui ne se nettoie pas dit POURQUOI (plancher légal non saisi, conservation
 *    non saisie, journal toujours conservé).
 * ⚠️ LA CONFIRMATION EST UNE COMPARAISON. Le total affiché part avec la demande ;
 *    la base recalcule et refuse s'il a changé — l'écran réaffiche l'annonce.
 * ⚠️ IRRÉVERSIBLE : ré-authentification (le mécanisme existant, ReauthModal).
 * ⚠️ TOUT EST PARAMÉTRABLE (décision de Youssef, 28/09/2026) : la conservation ET
 *    le plancher légal se SAISISSENT ici, famille par famille. Ils naissent VIDES,
 *    rien n'est pré-rempli ; une valeur vide interdit le nettoyage de sa famille.
 *    Sous chaque famille, en AIDE, la référence légale proposée — du texte, jamais
 *    une valeur posée dans un champ. La famille `journal` ne se règle pas : elle
 *    n'offre aucun champ (§D.11).
 */

type Famille = {
  famille: string
  conservation_mois: number | null
  plancher_mois: number | null
  jusqu_au: string | null
  lignes: number
  raison: 'plancher_non_saisi' | 'conservation_non_saisie' | 'journal_conserve' | null
}
type Annonce = { familles: Famille[]; total: number; calcule_le: string }

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 12, padding: 16, marginTop: 24,
}
const cellule: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13, color: 'var(--sk-text)', borderBottom: '1px solid var(--sk-border)', textAlign: 'left', verticalAlign: 'middle',
}
const enTete: React.CSSProperties = { ...cellule, fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)', whiteSpace: 'nowrap' }
const bouton: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
  border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', color: 'var(--sk-text)',
}

export default function NettoyageJournal() {
  const t = useTranslations('admin_back_office.journal.nettoyage')
  const tF = useTranslations('journal.familles')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [annonce, setAnnonce] = useState<Annonce | null>(null)
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur'>('chargement')
  const [saisies, setSaisies] = useState<Record<string, { plancher: string; conservation: string }>>({})
  const [messages, setMessages] = useState<Record<string, { ok: boolean; texte: string }>>({})
  const [confirmation, setConfirmation] = useState(false)
  const [reauth, setReauth] = useState(false)
  const [resultat, setResultat] = useState<{ ok: boolean; texte: string } | null>(null)
  const [enCours, setEnCours] = useState(false)

  const date = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso))

  const charger = useCallback(async () => {
    setEtat('chargement')
    try {
      const res = await secureFetch('/api/admin/journal/conservation')
      if (!res.ok) { setEtat('erreur'); return }
      const a = (await res.json()) as Annonce
      setAnnonce(a)
      setSaisies(Object.fromEntries(a.familles.map((f) => [f.famille, {
        plancher: f.plancher_mois == null ? '' : String(f.plancher_mois),
        conservation: f.conservation_mois == null ? '' : String(f.conservation_mois),
      }])))
      setEtat('pret')
    } catch {
      setEtat('erreur')
    }
  }, [secureFetch])

  useEffect(() => { void charger() }, [charger])

  const regler = async (famille: string) => {
    const lire = (brut: string, minimum: number): number | null | 'invalide' => {
      const v = brut.trim()
      if (v === '') return null
      const n = Number(v)
      return Number.isInteger(n) && n >= minimum && n <= 1200 ? n : 'invalide'
    }
    const s = saisies[famille] ?? { plancher: '', conservation: '' }
    const plancher = lire(s.plancher, 0)
    const conservation = lire(s.conservation, 1)
    if (plancher === 'invalide' || conservation === 'invalide') {
      setMessages((m) => ({ ...m, [famille]: { ok: false, texte: t('err_duree_invalide') } }))
      return
    }
    try {
      const res = await secureFetch('/api/admin/journal/conservation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ famille, conservation_mois: conservation, plancher_mois: plancher }),
      })
      const corps = (await res.json().catch(() => ({}))) as { code?: string; plancher_mois?: number | null; inchange?: boolean }
      if (!res.ok) {
        const texte = corps.code === 'sous_le_plancher'
          ? t('err_sous_le_plancher', { plancher: corps.plancher_mois ?? 0 })
          : corps.code === 'plancher_manquant' ? t('err_plancher_manquant')
          : corps.code === 'duree_invalide' ? t('err_duree_invalide')
          : t('err_generique')
        setMessages((m) => ({ ...m, [famille]: { ok: false, texte } }))
        return
      }
      setMessages((m) => ({ ...m, [famille]: { ok: true, texte: corps.inchange ? t('inchange') : t('enregistre') } }))
      setConfirmation(false)
      await charger()
    } catch {
      setMessages((m) => ({ ...m, [famille]: { ok: false, texte: t('err_generique') } }))
    }
  }

  const nettoyer = async (jeton: string) => {
    if (!annonce) return
    setReauth(false)
    setEnCours(true)
    try {
      const res = await secureFetch('/api/admin/journal/nettoyage', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reauth-token': jeton },
        body: JSON.stringify({ total_annonce: annonce.total }),
      })
      const corps = (await res.json().catch(() => ({}))) as { code?: string; lignes?: number; issue?: string }
      if (res.status === 409 && corps.code === 'annonce_perimee') {
        setResultat({ ok: false, texte: t('perimee') })
      } else if (!res.ok) {
        setResultat({ ok: false, texte: t('err_nettoyage') })
      } else if (corps.issue === 'rien_a_nettoyer') {
        setResultat({ ok: true, texte: t('rien') })
      } else {
        setResultat({ ok: true, texte: t('resultat', { count: corps.lignes ?? 0 }) })
      }
    } catch {
      setResultat({ ok: false, texte: t('err_nettoyage') })
    } finally {
      setEnCours(false)
      setConfirmation(false)
      await charger()
    }
  }

  return (
    <section style={carte} aria-labelledby="journal-nettoyage-titre">
      <h2 id="journal-nettoyage-titre" style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px', color: 'var(--sk-text)' }}>{t('titre')}</h2>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 12px', maxWidth: 760 }}>{t('intro')}</p>

      {etat === 'chargement' && <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('chargement')}</p>}
      {etat === 'erreur' && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)' }}>
          {t('erreur')}{' '}
          <button type="button" style={bouton} onClick={() => void charger()}>{t('reessayer')}</button>
        </p>
      )}

      {etat === 'pret' && annonce && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr>
                  <th style={enTete}>{t('col_famille')}</th>
                  <th style={enTete}>{t('col_reglage')}</th>
                  <th style={enTete}>{t('col_efface')}</th>
                </tr>
              </thead>
              <tbody>
                {annonce.familles.map((f) => {
                  const reglable = f.famille !== 'journal'
                  const msg = messages[f.famille]
                  const s = saisies[f.famille] ?? { plancher: '', conservation: '' }
                  const champ = { width: 80, font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', color: 'var(--sk-text)' }
                  return (
                    <tr key={f.famille}>
                      <td style={{ ...cellule, maxWidth: 320 }}>
                        <span style={{ fontWeight: 600 }}>{tF(f.famille as 'journal')}</span>
                        {/* L'AIDE : la référence légale proposée — du texte, rien de pré-rempli. */}
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--sk-muted)', marginTop: 2 }}>
                          {t(`reference.${f.famille}` as 'reference.journal')}
                        </span>
                      </td>
                      <td style={cellule}>
                        {reglable ? (
                          <form
                            onSubmit={(e) => { e.preventDefault(); void regler(f.famille) }}
                            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                          >
                            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--sk-muted)' }}>
                              {t('col_plancher')}
                              <input
                                type="number" min={0} max={1200} inputMode="numeric"
                                value={s.plancher}
                                placeholder={t('vide')}
                                onChange={(e) => setSaisies((x) => ({ ...x, [f.famille]: { ...s, plancher: e.target.value } }))}
                                aria-label={t('plancher_label', { famille: tF(f.famille as 'journal') })}
                                style={champ}
                              />
                            </label>
                            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--sk-muted)' }}>
                              {t('col_conservation')}
                              <input
                                type="number" min={1} max={1200} inputMode="numeric"
                                value={s.conservation}
                                placeholder={t('vide')}
                                onChange={(e) => setSaisies((x) => ({ ...x, [f.famille]: { ...s, conservation: e.target.value } }))}
                                aria-label={t('mois_label', { famille: tF(f.famille as 'journal') })}
                                style={champ}
                              />
                            </label>
                            <span style={{ fontSize: 12, color: 'var(--sk-muted)', alignSelf: 'end', paddingBottom: 8 }}>{t('unite_mois')}</span>
                            <button type="submit" style={{ ...bouton, alignSelf: 'end' }}>{t('enregistrer')}</button>
                            {msg && (
                              <span role={msg.ok ? 'status' : 'alert'} style={{ flexBasis: '100%', fontSize: 12, color: msg.ok ? 'var(--sk-muted)' : 'var(--sk-red)' }}>
                                {msg.texte}
                              </span>
                            )}
                          </form>
                        ) : (
                          <span style={{ color: 'var(--sk-muted)' }}>{t('journal_non_reglable')}</span>
                        )}
                      </td>
                      <td style={cellule}>
                        {f.raison ? (
                          <span style={{ color: 'var(--sk-muted)' }}>{t(`raison_${f.raison}`)}</span>
                        ) : f.lignes > 0 && f.jusqu_au ? (
                          t('efface_famille', { count: f.lignes, date: date(f.jusqu_au) })
                        ) : (
                          <span style={{ color: 'var(--sk-muted)' }}>{t('rien_famille')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '10px 0 0' }}>{t('note_plancher')}</p>

          {/* ─── L'ANNONCE, PUIS LA CONFIRMATION ─────────────────────────── */}
          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            {annonce.total === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: 0 }}>{t('rien')}</p>
            ) : !confirmation ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <p style={{ fontSize: 13, color: 'var(--sk-text)', margin: 0, fontWeight: 600 }}>{t('annonce_total', { count: annonce.total })}</p>
                <button type="button" style={bouton} onClick={() => { setResultat(null); setConfirmation(true) }}>{t('nettoyer')}</button>
              </div>
            ) : (
              <div role="alertdialog" aria-labelledby="journal-confirmation" style={{ border: '1px solid var(--sk-red-soft)', background: 'var(--sk-red-soft)', borderRadius: 10, padding: 14, display: 'grid', gap: 10 }}>
                <p id="journal-confirmation" style={{ fontSize: 13, color: 'var(--sk-text)', margin: 0 }}>
                  {t('confirmer_corps', { count: annonce.total })}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={enCours}
                    onClick={() => setReauth(true)}
                    style={{ ...bouton, color: 'var(--sk-red)', borderColor: 'var(--sk-red)' }}
                  >
                    {enCours ? t('en_cours') : t('confirmer')}
                  </button>
                  <button type="button" style={bouton} onClick={() => setConfirmation(false)}>{t('annuler')}</button>
                </div>
              </div>
            )}
            {resultat && (
              <p role={resultat.ok ? 'status' : 'alert'} style={{ fontSize: 13, margin: 0, color: resultat.ok ? 'var(--sk-text)' : 'var(--sk-red)' }}>
                {resultat.texte}
              </p>
            )}
          </div>
        </>
      )}
      <ReauthModal open={reauth} onConfirm={(jeton) => void nettoyer(jeton)} onCancel={() => setReauth(false)} />
    </section>
  )
}

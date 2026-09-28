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
 *    qui ne se nettoie pas dit POURQUOI (plancher légal à arbitrer, conservation
 *    sans limite, journal toujours conservé).
 * ⚠️ LA CONFIRMATION EST UNE COMPARAISON. Le total affiché part avec la demande ;
 *    la base recalcule et refuse s'il a changé — l'écran réaffiche l'annonce.
 * ⚠️ IRRÉVERSIBLE : ré-authentification (le mécanisme existant, ReauthModal).
 * ⚠️ LE PLANCHER LÉGAL NE SE RÈGLE PAS ICI : il se lit. C'est une obligation,
 *    décidée et posée par écrit ; tant qu'il est à arbitrer, la famille ne se
 *    règle pas — et l'écran ne montre pas de champ qui ne réglerait rien (§D.11).
 */

type Famille = {
  famille: string
  conservation_mois: number | null
  plancher_mois: number | null
  jusqu_au: string | null
  lignes: number
  raison: 'plancher_a_arbitrer' | 'conservation_illimitee' | 'journal_conserve' | null
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
  const [saisies, setSaisies] = useState<Record<string, string>>({})
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
      setSaisies(Object.fromEntries(a.familles.map((f) => [f.famille, f.conservation_mois == null ? '' : String(f.conservation_mois)])))
      setEtat('pret')
    } catch {
      setEtat('erreur')
    }
  }, [secureFetch])

  useEffect(() => { void charger() }, [charger])

  const regler = async (famille: string) => {
    const brut = (saisies[famille] ?? '').trim()
    const mois = brut === '' ? null : Number(brut)
    if (mois !== null && (!Number.isInteger(mois) || mois < 1 || mois > 1200)) {
      setMessages((m) => ({ ...m, [famille]: { ok: false, texte: t('err_duree_invalide') } }))
      return
    }
    try {
      const res = await secureFetch('/api/admin/journal/conservation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ famille, mois }),
      })
      const corps = (await res.json().catch(() => ({}))) as { code?: string; plancher_mois?: number | null; inchange?: boolean }
      if (!res.ok) {
        const texte = corps.code === 'sous_le_plancher'
          ? t('err_sous_le_plancher', { plancher: corps.plancher_mois ?? 0 })
          : corps.code === 'plancher_a_arbitrer' ? t('err_plancher_a_arbitrer')
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
                  <th style={enTete}>{t('col_plancher')}</th>
                  <th style={enTete}>{t('col_conservation')}</th>
                  <th style={enTete}>{t('col_efface')}</th>
                </tr>
              </thead>
              <tbody>
                {annonce.familles.map((f) => {
                  const reglable = f.famille !== 'journal' && f.plancher_mois !== null
                  const msg = messages[f.famille]
                  return (
                    <tr key={f.famille}>
                      <td style={cellule}>{tF(f.famille as 'journal')}</td>
                      <td style={{ ...cellule, color: f.plancher_mois === null ? 'var(--sk-amber)' : 'var(--sk-text)' }}>
                        {f.famille === 'journal' ? t('plancher_sans_objet')
                          : f.plancher_mois === null ? t('plancher_a_arbitrer')
                          : f.plancher_mois === 0 ? t('plancher_aucun')
                          : t('mois', { count: f.plancher_mois })}
                      </td>
                      <td style={cellule}>
                        {reglable ? (
                          <form
                            onSubmit={(e) => { e.preventDefault(); void regler(f.famille) }}
                            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                          >
                            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'var(--sk-muted)' }}>
                              <input
                                type="number"
                                min={Math.max(1, f.plancher_mois ?? 1)}
                                max={1200}
                                inputMode="numeric"
                                value={saisies[f.famille] ?? ''}
                                placeholder={t('illimitee')}
                                onChange={(e) => setSaisies((s) => ({ ...s, [f.famille]: e.target.value }))}
                                aria-label={t('mois_label', { famille: tF(f.famille as 'journal') })}
                                style={{ width: 90, font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', color: 'var(--sk-text)' }}
                              />
                              {t('unite_mois')}
                            </label>
                            <button type="submit" style={bouton}>{t('enregistrer')}</button>
                            {msg && (
                              <span role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 12, color: msg.ok ? 'var(--sk-muted)' : 'var(--sk-red)' }}>
                                {msg.texte}
                              </span>
                            )}
                          </form>
                        ) : (
                          <span style={{ color: 'var(--sk-muted)' }}>
                            {f.conservation_mois == null ? t('illimitee') : t('mois', { count: f.conservation_mois })}
                          </span>
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

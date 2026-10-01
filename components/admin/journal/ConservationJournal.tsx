'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import ReauthModal from '@/components/settings/ReauthModal'

/**
 * LA CONSERVATION DU JOURNAL, SUR UN ÉCRAN À PART (décision de Youssef, 01/10/2026, ARRÊT 22, §D.33).
 *
 * Réécrit pour se comprendre à la première lecture : par famille, une phrase — « Ces écritures sont gardées X mois,
 * puis effacées. La loi impose au moins Y mois » —, la référence légale proposée et un bouton pour l'appliquer ; puis
 * ce qu'un nettoyage ferait, dit simplement, et le nettoyage lui-même.
 *
 * ⚠️ AUCUNE VALEUR DANS LE CODE. Les durées proposées viennent de la base (`grand_livre_conservation_proposee`), les
 *    durées appliquées aussi (`grand_livre_conservation`, née vide) ; les traductions ne portent que le TEXTE de la
 *    référence légale, sans nombre. Une proposition illisible n'est pas affichée — jamais inventée.
 * ⚠️ L'ANNONCE AVANT L'ACTE (inchangé, §D.26 2.7) : ce qu'un nettoyage effacerait est affiché avant tout bouton ;
 *    la confirmation est une comparaison (la base recalcule et refuse si le total a changé) ; ré-authentification.
 * ⚠️ La famille « journal » (les traces des nettoyages) ne se règle pas : elle n'offre aucun champ (§D.11).
 */

type Famille = {
  famille: string
  conservation_mois: number | null
  plancher_mois: number | null
  jusqu_au: string | null
  lignes: number
  raison: 'plancher_non_saisi' | 'conservation_non_saisie' | 'journal_conserve' | null
}
type Proposition = { famille: string; plancher_mois: number; conservation_mois: number | null }
type Annonce = { familles: Famille[]; total: number; calcule_le: string; propositions: Proposition[] | null }

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 12, padding: 16,
  display: 'grid', gap: 10,
}
const texte: React.CSSProperties = { fontSize: 13, color: 'var(--sk-text)', margin: 0, lineHeight: 1.55 }
const discret: React.CSSProperties = { fontSize: 12, color: 'var(--sk-muted)', margin: 0, lineHeight: 1.55 }
const bouton: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 8, padding: '7px 12px', cursor: 'pointer',
  border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', color: 'var(--sk-text)',
}
const boutonPrincipal: React.CSSProperties = {
  ...bouton, background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', borderColor: 'var(--sk-accent)',
}
const saisie: React.CSSProperties = {
  width: 90, font: 'inherit', fontSize: 13, padding: '6px 8px', borderRadius: 8,
  border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', color: 'var(--sk-text)',
}

export default function ConservationJournal() {
  const t = useTranslations('admin_back_office.conservation')
  const tF = useTranslations('journal.familles')
  const tFd = useTranslations('journal.familles_description')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [annonce, setAnnonce] = useState<Annonce | null>(null)
  const [etat, setEtat] = useState<'chargement' | 'pret' | 'erreur'>('chargement')
  const [saisies, setSaisies] = useState<Record<string, { plancher: string; conservation: string }>>({})
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const [messages, setMessages] = useState<Record<string, { ok: boolean; texte: string }>>({})
  const [enCoursFamille, setEnCoursFamille] = useState<string | null>(null)
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

  const refus = (code: string | undefined, plancher?: number | null) =>
    code === 'sous_le_plancher' ? t('err_sous_le_plancher', { plancher: plancher ?? 0 })
      : code === 'plancher_manquant' ? t('err_plancher_manquant')
      : code === 'duree_invalide' ? t('err_duree_invalide')
      : code === 'sans_proposition' ? t('err_sans_proposition')
      : t('err_generique')

  /** Le bouton « Appliquer la proposition » : la base pose les valeurs proposées, rien ne vient de l'écran. */
  const appliquer = async (famille: string) => {
    setEnCoursFamille(famille)
    try {
      const res = await secureFetch('/api/admin/journal/conservation/proposition', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ famille }),
      })
      const corps = (await res.json().catch(() => ({}))) as { code?: string; inchange?: boolean }
      setMessages((m) => ({ ...m, [famille]: res.ok
        ? { ok: true, texte: corps.inchange ? t('deja_applique') : t('applique') }
        : { ok: false, texte: refus(corps.code) } }))
      if (res.ok) { setConfirmation(false); await charger() }
    } catch {
      setMessages((m) => ({ ...m, [famille]: { ok: false, texte: t('err_generique') } }))
    } finally {
      setEnCoursFamille(null)
    }
  }

  /** Régler soi-même : deux nombres de mois, ou vide. */
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
    setEnCoursFamille(famille)
    try {
      const res = await secureFetch('/api/admin/journal/conservation', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ famille, conservation_mois: conservation, plancher_mois: plancher }),
      })
      const corps = (await res.json().catch(() => ({}))) as { code?: string; plancher_mois?: number | null; inchange?: boolean }
      setMessages((m) => ({ ...m, [famille]: res.ok
        ? { ok: true, texte: corps.inchange ? t('inchange') : t('enregistre') }
        : { ok: false, texte: refus(corps.code, corps.plancher_mois) } }))
      if (res.ok) { setConfirmation(false); await charger() }
    } catch {
      setMessages((m) => ({ ...m, [famille]: { ok: false, texte: t('err_generique') } }))
    } finally {
      setEnCoursFamille(null)
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

  /** La phrase de l'état réglé — celle que la décision du 01/10/2026 demande, mot pour mot. */
  const phraseEtat = (f: Famille): string => {
    if (f.famille === 'journal') return t('etat_journal')
    if (f.conservation_mois == null) return t('etat_sans_duree')
    const garde = t('etat_garde', { mois: f.conservation_mois })
    if (f.plancher_mois == null) return `${garde} ${t('etat_minimum_non_saisi')}`
    if (f.plancher_mois === 0) return `${garde} ${t('etat_aucun_minimum')}`
    return `${garde} ${t('etat_minimum', { mois: f.plancher_mois })}`
  }

  /** Ce qu'un nettoyage ferait MAINTENANT pour cette famille. */
  const phraseNettoyage = (f: Famille): string => {
    if (f.raison === 'journal_conserve') return t('nettoyage_jamais')
    if (f.raison === 'conservation_non_saisie') return t('nettoyage_sans_duree')
    if (f.raison === 'plancher_non_saisi') return t('nettoyage_sans_minimum')
    if (f.lignes > 0 && f.jusqu_au) return t('nettoyage_effacerait', { count: f.lignes, date: date(f.jusqu_au) })
    return t('nettoyage_rien')
  }

  return (
    <div style={{ width: '100%', textAlign: 'left', display: 'grid', gap: 16 }}>
      {/* ─── CE QUE FAIT CET ÉCRAN, DIT SIMPLEMENT ─────────────────────────── */}
      <section style={carte} aria-labelledby="conservation-principe">
        <h2 id="conservation-principe" style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--sk-text)' }}>{t('principe_titre')}</h2>
        <p style={texte}>{t('principe_1')}</p>
        <p style={texte}>{t('principe_2')}</p>
        <p style={texte}>{t('principe_3')}</p>
        <p style={discret}>{t('avertissement_juriste')}</p>
      </section>

      {etat === 'chargement' && <p style={discret}>{t('chargement')}</p>}
      {etat === 'erreur' && (
        <p role="alert" style={{ ...texte, color: 'var(--sk-red)' }}>
          {t('erreur')}{' '}
          <button type="button" style={bouton} onClick={() => void charger()}>{t('reessayer')}</button>
        </p>
      )}

      {etat === 'pret' && annonce && (
        <>
          {annonce.propositions === null && <p role="status" style={{ ...texte, color: 'var(--sk-amber)' }}>{t('propositions_illisibles')}</p>}

          {/* ─── UNE CARTE PAR FAMILLE ─────────────────────────────────────── */}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {annonce.familles.map((f) => {
              const nom = tF(f.famille as 'journal')
              const p = annonce.propositions?.find((x) => x.famille === f.famille) ?? null
              const msg = messages[f.famille]
              const s = saisies[f.famille] ?? { plancher: '', conservation: '' }
              const dejaAppliquee = p != null && f.plancher_mois === p.plancher_mois
                && (p.conservation_mois == null || f.conservation_mois === p.conservation_mois)
              return (
                <li key={f.famille} style={carte}>
                  <div style={{ display: 'grid', gap: 2 }}>
                    <strong style={{ fontSize: 14, color: 'var(--sk-text)' }}>{nom}</strong>
                    <span style={discret}>{tFd(f.famille as 'journal')}</span>
                  </div>

                  <p style={texte}>{phraseEtat(f)}</p>

                  {f.famille !== 'journal' && p && (
                    <div style={{ display: 'grid', gap: 6, borderLeft: '3px solid var(--sk-border)', paddingLeft: 12 }}>
                      <p style={texte}>
                        {p.conservation_mois != null
                          ? t('proposition_duree', { mois: p.conservation_mois })
                          : t('proposition_sans_duree')}
                        {' '}
                        {p.plancher_mois > 0 ? t('proposition_minimum', { mois: p.plancher_mois }) : t('proposition_aucun_minimum')}
                      </p>
                      <p style={discret}>{t(`reference.${f.famille}` as 'reference.commerce')}</p>
                      <div>
                        {dejaAppliquee ? (
                          <span style={discret}>{t('proposition_en_place')}</span>
                        ) : (
                          <button type="button" style={boutonPrincipal} disabled={enCoursFamille === f.famille} onClick={() => void appliquer(f.famille)}>
                            {enCoursFamille === f.famille ? t('en_cours_reglage') : t('appliquer_proposition')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {f.famille !== 'journal' && (
                    <div style={{ display: 'grid', gap: 8 }}>
                      <button
                        type="button"
                        aria-expanded={!!ouverts[f.famille]}
                        onClick={() => setOuverts((o) => ({ ...o, [f.famille]: !o[f.famille] }))}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontSize: 12, color: 'var(--sk-accent)', cursor: 'pointer', justifySelf: 'start' }}
                      >
                        {ouverts[f.famille] ? t('regler_soi_meme_fermer') : t('regler_soi_meme')}
                      </button>
                      {ouverts[f.famille] && (
                        <form
                          onSubmit={(e) => { e.preventDefault(); void regler(f.famille) }}
                          style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}
                        >
                          <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--sk-muted)' }}>
                            {t('champ_garde')}
                            <input
                              type="number" min={1} max={1200} inputMode="numeric"
                              value={s.conservation}
                              placeholder={t('vide')}
                              onChange={(e) => setSaisies((x) => ({ ...x, [f.famille]: { ...s, conservation: e.target.value } }))}
                              aria-label={t('champ_garde_label', { famille: nom })}
                              style={saisie}
                            />
                          </label>
                          <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--sk-muted)' }}>
                            {t('champ_minimum')}
                            <input
                              type="number" min={0} max={1200} inputMode="numeric"
                              value={s.plancher}
                              placeholder={t('vide')}
                              onChange={(e) => setSaisies((x) => ({ ...x, [f.famille]: { ...s, plancher: e.target.value } }))}
                              aria-label={t('champ_minimum_label', { famille: nom })}
                              style={saisie}
                            />
                          </label>
                          <button type="submit" style={bouton} disabled={enCoursFamille === f.famille}>{t('enregistrer')}</button>
                          <span style={{ ...discret, flexBasis: '100%' }}>{t('regler_aide')}</span>
                        </form>
                      )}
                    </div>
                  )}

                  {msg && (
                    <p role={msg.ok ? 'status' : 'alert'} style={{ ...discret, color: msg.ok ? 'var(--sk-muted)' : 'var(--sk-red)' }}>{msg.texte}</p>
                  )}
                  <p style={discret}>{phraseNettoyage(f)}</p>
                </li>
              )
            })}
          </ol>

          {/* ─── LE NETTOYAGE : L'ANNONCE, PUIS LA CONFIRMATION ───────────────── */}
          <section style={carte} aria-labelledby="conservation-nettoyage">
            <h2 id="conservation-nettoyage" style={{ fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--sk-text)' }}>{t('nettoyage_titre')}</h2>
            <p style={texte}>{t('nettoyage_explication')}</p>
            {annonce.total === 0 ? (
              <p style={discret}>{t('rien')}</p>
            ) : !confirmation ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                <p style={{ ...texte, fontWeight: 600 }}>{t('annonce_total', { count: annonce.total })}</p>
                <button type="button" style={bouton} onClick={() => { setResultat(null); setConfirmation(true) }}>{t('nettoyer')}</button>
              </div>
            ) : (
              <div role="alertdialog" aria-labelledby="conservation-confirmation" style={{ border: '1px solid var(--sk-red-soft)', background: 'var(--sk-red-soft)', borderRadius: 10, padding: 14, display: 'grid', gap: 10 }}>
                <p id="conservation-confirmation" style={texte}>{t('confirmer_corps', { count: annonce.total })}</p>
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
              <p role={resultat.ok ? 'status' : 'alert'} style={{ ...texte, color: resultat.ok ? 'var(--sk-text)' : 'var(--sk-red)' }}>{resultat.texte}</p>
            )}
          </section>
        </>
      )}
      <ReauthModal open={reauth} onConfirm={(jeton) => void nettoyer(jeton)} onCancel={() => setReauth(false)} />
    </div>
  )
}

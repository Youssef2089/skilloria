'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { ACTIONS_JOURNAL } from '@/lib/journal/actions'
import { FAMILLES_JOURNAL, ORIGINES_JOURNAL, STATUTS_JOURNAL, estUuid, type PageJournal } from '@/lib/journal/lecture'
import { Acteur, Glossaire, Montant, PastilleStatut, PhraseEcriture, Quand, lienObjet, type Ligne } from '@/components/admin/journal/presentation'
import type { NomsJournal } from '@/lib/journal/phrase'

/**
 * /admin/journal — LE GRAND LIVRE (§D.26, phase B 2.6). Page de MENU : aucun
 * bouton Retour (règle projet) ; la pièce, elle, est une page de détail.
 *
 * ⚠️ LA LECTURE EST EN BASE (`lire_grand_livre`, bornée, AD002) : l'écran ne
 *    trie, ne filtre ni ne compte rien lui-même — il affiche ce que la base rend
 *    et dit ce qu'elle ne rend pas (la suite, la panne).
 * ⚠️ L'IDENTIFIANT DE LIGNE N'EST JAMAIS AFFICHÉ : il a des trous normaux, et une
 *    suite de numéros ferait croire à des lignes manquantes. La PIÈCE, oui.
 * ⚠️ LE NETTOYAGE RESTE VISIBLE SOUS TOUT FILTRE — c'est la base qui le garantit ;
 *    l'écran le DIT, pour qu'on ne cherche pas pourquoi une ligne « déborde ».
 * ⚠️ CHAQUE ÉCRITURE SE LIT COMME UNE PHRASE (ARRÊT 22, §D.33) : `PhraseEcriture`, avec les noms relus par la
 *    route ; une relecture des noms en panne se DIT (bandeau), les phrases retombent sur « un profil ».
 * ⚠️ LA CONSERVATION ET LE NETTOYAGE ONT LEUR ÉCRAN (/admin/journal/conservation) : on n'efface pas là où l'on enquête.
 */

type Filtres = {
  famille: string
  action: string
  statut: string
  origine: string
  ecosysteme: string
  acteur: string
  du: string
  au: string
}
const VIDE: Filtres = { famille: '', action: '', statut: '', origine: '', ecosysteme: '', acteur: '', du: '', au: '' }

/** Le filtre d'ACTION propose toute la liste fermée, triée par libellé dans la langue de l'écran. */
const ACTIONS = [...ACTIONS_JOURNAL]

const champ: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--sk-muted)', minWidth: 150, flex: '1 1 150px',
}
const saisie: React.CSSProperties = {
  font: 'inherit', fontSize: 13, color: 'var(--sk-text)', background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)', borderRadius: 8, padding: '8px 10px', minHeight: 36,
}
const bouton: React.CSSProperties = {
  font: 'inherit', fontSize: 13, fontWeight: 600, borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
  border: '1px solid var(--sk-border)', background: 'var(--sk-surface)', color: 'var(--sk-text)',
}

export default function JournalPage() {
  const t = useTranslations('admin_back_office.journal')
  const tA = useTranslations('journal.actions')
  const tF = useTranslations('journal.familles')
  const tS = useTranslations('journal.statuts')
  const tO = useTranslations('journal.origines')
  const secureFetch = useSecureFetch()

  const [saisies, setSaisies] = useState<Filtres>(VIDE)
  const [actifs, setActifs] = useState<Filtres>(VIDE)
  const [lignes, setLignes] = useState<Ligne[]>([])
  const [noms, setNoms] = useState<NomsJournal>({})
  const [nomsDisponibles, setNomsDisponibles] = useState(true)
  const [suivant, setSuivant] = useState<string | null>(null)
  const [chargement, setChargement] = useState(true)
  const [suiteEnCours, setSuiteEnCours] = useState(false)
  const [erreur, setErreur] = useState(false)
  const [invalide, setInvalide] = useState<string | null>(null)
  const [domaines, setDomaines] = useState<Array<{ id: string; name: string }>>([])

  const actionsTriees = useMemo(() => [...ACTIONS].sort((a, b) => tA(a).localeCompare(tA(b))), [tA])

  useEffect(() => {
    void (async () => {
      try {
        const res = await secureFetch('/api/admin/list-domains')
        if (res.ok) setDomaines(((await res.json()) as { domains: Array<{ id: string; name: string }> }).domains)
      } catch { /* le filtre d'écosystème reste vide : les autres filtres restent utilisables */ }
    })()
  }, [secureFetch])

  const url = useCallback((f: Filtres, curseur: string | null) => {
    const q = new URLSearchParams()
    if (f.famille) q.set('familles', f.famille)
    if (f.action) q.set('types', f.action)
    if (f.statut) q.set('statuts', f.statut)
    if (f.origine) q.set('origines', f.origine)
    if (f.ecosysteme) q.set('ecosysteme', f.ecosysteme)
    if (f.acteur) q.set('acteur', f.acteur)
    if (f.du) q.set('du', new Date(`${f.du}T00:00:00`).toISOString())
    if (f.au) q.set('au', new Date(new Date(`${f.au}T00:00:00`).getTime() + 86_400_000).toISOString())
    if (curseur) q.set('curseur', curseur)
    return `/api/admin/journal?${q.toString()}`
  }, [])

  const charger = useCallback(async (f: Filtres, curseur: string | null) => {
    if (curseur) setSuiteEnCours(true)
    else { setChargement(true); setLignes([]); setSuivant(null); setNoms({}); setNomsDisponibles(true) }
    setErreur(false)
    try {
      const res = await secureFetch(url(f, curseur))
      if (!res.ok) { setErreur(true); return }
      const page = (await res.json()) as PageJournal
      setLignes((l) => (curseur ? [...l, ...page.lignes] : page.lignes))
      setNoms((n) => ({ ...n, ...page.noms }))
      if (page.noms_indisponibles) setNomsDisponibles(false)
      setSuivant(page.suivant)
    } catch {
      setErreur(true)
    } finally {
      setChargement(false)
      setSuiteEnCours(false)
    }
  }, [secureFetch, url])

  useEffect(() => { void charger(VIDE, null) }, [charger])

  const appliquer = (f: Filtres) => {
    if (f.acteur && !estUuid(f.acteur)) { setInvalide(t('acteur_invalide')); return }
    if (f.du && f.au && f.au < f.du) { setInvalide(t('periode_invalide')); return }
    setInvalide(null)
    setActifs(f)
    void charger(f, null)
  }
  const filtrerActeur = (id: string) => {
    const f = { ...saisies, acteur: id }
    setSaisies(f)
    appliquer(f)
  }
  const modifie = JSON.stringify(saisies) !== JSON.stringify(actifs)

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <PageHeader flush title={t('title')} subtitle={t('intro')} />
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        <Glossaire />
        <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: 0 }}>
          {t('conservation_ailleurs')}{' '}
          <Link href="/admin/journal/conservation" style={{ color: 'var(--sk-accent)' }}>{t('conservation_lien')}</Link>
        </p>
      </div>

      {/* ─── LES FILTRES — ils s'enroulent sur mobile ────────────────────── */}
      <form
        onSubmit={(e) => { e.preventDefault(); appliquer(saisies) }}
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', margin: '16px 0 8px',
          background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 12, padding: 16,
        }}
      >
        <label style={champ}>{t('f_famille')}
          <select style={saisie} value={saisies.famille} onChange={(e) => setSaisies({ ...saisies, famille: e.target.value })}>
            <option value="">{t('toutes')}</option>
            {FAMILLES_JOURNAL.map((f) => <option key={f} value={f}>{tF(f)}</option>)}
          </select>
        </label>
        <label style={champ}>{t('f_action')}
          <select style={saisie} value={saisies.action} onChange={(e) => setSaisies({ ...saisies, action: e.target.value })}>
            <option value="">{t('toutes')}</option>
            {actionsTriees.map((a) => <option key={a} value={a}>{tA(a)}</option>)}
          </select>
        </label>
        <label style={champ}>{t('f_statut')}
          <select style={saisie} value={saisies.statut} onChange={(e) => setSaisies({ ...saisies, statut: e.target.value })}>
            <option value="">{t('tous')}</option>
            {STATUTS_JOURNAL.map((s) => <option key={s} value={s}>{tS(s)}</option>)}
          </select>
        </label>
        <label style={champ}>{t('f_origine')}
          <select style={saisie} value={saisies.origine} onChange={(e) => setSaisies({ ...saisies, origine: e.target.value })}>
            <option value="">{t('toutes')}</option>
            {ORIGINES_JOURNAL.map((o) => <option key={o} value={o}>{tO(o)}</option>)}
          </select>
        </label>
        <label style={champ}>{t('f_ecosysteme')}
          <select style={saisie} value={saisies.ecosysteme} onChange={(e) => setSaisies({ ...saisies, ecosysteme: e.target.value })}>
            <option value="">{t('tous')}</option>
            {domaines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label style={{ ...champ, flex: '2 1 260px' }}>{t('f_acteur')}
          <input
            style={{ ...saisie, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            value={saisies.acteur}
            placeholder={t('acteur_placeholder')}
            onChange={(e) => setSaisies({ ...saisies, acteur: e.target.value.trim() })}
            aria-invalid={invalide === t('acteur_invalide')}
          />
        </label>
        <label style={champ}>{t('f_du')}
          <input type="date" style={saisie} value={saisies.du} onChange={(e) => setSaisies({ ...saisies, du: e.target.value })} />
        </label>
        <label style={champ}>{t('f_au')}
          <input type="date" style={saisie} value={saisies.au} onChange={(e) => setSaisies({ ...saisies, au: e.target.value })} />
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="submit"
            style={{ ...bouton, background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', borderColor: 'var(--sk-accent)' }}
          >
            {t('appliquer')}{modifie ? ' •' : ''}
          </button>
          <button type="button" style={bouton} onClick={() => { setSaisies(VIDE); appliquer(VIDE) }}>{t('effacer')}</button>
        </div>
        {invalide && <p role="alert" style={{ flexBasis: '100%', margin: 0, fontSize: 13, color: 'var(--sk-red)' }}>{invalide}</p>}
      </form>
      <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '0 0 16px' }}>{t('nettoyage_toujours')}</p>
      {!nomsDisponibles && (
        <p role="status" style={{ fontSize: 13, color: 'var(--sk-amber)', margin: '0 0 12px' }}>{t('noms_indisponibles')}</p>
      )}

      {/* ─── LES ÉCRITURES ─────────────────────────────────────────────── */}
      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('chargement')}</p>
      ) : erreur && lignes.length === 0 ? (
        <div role="alert" style={{ fontSize: 13, color: 'var(--sk-red)' }}>
          {t('erreur')}{' '}
          <button type="button" style={{ ...bouton, padding: '4px 10px' }} onClick={() => void charger(actifs, null)}>{t('reessayer')}</button>
        </div>
      ) : lignes.length === 0 ? (
        <EmptyState title={t('vide_titre')} body={t('vide_corps')} />
      ) : (
        <>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {lignes.map((l) => {
              const objet = lienObjet(l)
              return (
                <li
                  key={`${l.piece}:${l.curseur_id}`}
                  style={{
                    background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 12, padding: '12px 14px',
                    display: 'grid', gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sk-muted)' }}>{tA(l.type_action)}</span>
                      <PastilleStatut statut={l.statut} />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--sk-muted)' }}><Quand iso={l.horodatage} /></span>
                  </div>
                  {/* LA PHRASE : qui, quoi, sur quoi, le résultat (§D.33). */}
                  <p style={{ fontSize: 14, color: 'var(--sk-text)', margin: 0, lineHeight: 1.5 }}>
                    <PhraseEcriture ligne={l} noms={noms} nomsDisponibles={nomsDisponibles} />
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12, color: 'var(--sk-muted)' }}>
                    <span>{t('par')} <Acteur ligne={l} /></span>
                    <span>{l.ecosysteme_nom ? t('ecosysteme_nomme', { nom: l.ecosysteme_nom }) : t('ecosysteme_aucun')}</span>
                    <Montant ligne={l} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
                    <Link href={`/admin/journal/${l.piece}`} style={{ color: 'var(--sk-accent)', fontWeight: 600 }}>{t('voir_piece')}</Link>
                    {objet && <Link href={objet} style={{ color: 'var(--sk-accent)' }}>{t('ouvrir_objet')}</Link>}
                    {l.acteur_id && !l.acteur_supprime && actifs.acteur !== l.acteur_id && (
                      <button
                        type="button"
                        onClick={() => filtrerActeur(l.acteur_id as string)}
                        style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'var(--sk-accent)', cursor: 'pointer' }}
                      >
                        {t('filtrer_acteur')}
                      </button>
                    )}
                    <span style={{ color: 'var(--sk-muted)' }}>{tF(l.famille)}</span>
                  </div>
                </li>
              )
            })}
          </ol>

          {/* ─── LA SUITE, ANNONCÉE — jamais une fin silencieuse ────────── */}
          <div style={{ margin: '14px 0 4px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            {suivant ? (
              <>
                <span style={{ fontSize: 12, color: 'var(--sk-muted)' }}>{t('tronque', { count: lignes.length })}</span>
                <button type="button" style={bouton} disabled={suiteEnCours} onClick={() => void charger(actifs, suivant)}>
                  {suiteEnCours ? t('suite_chargement') : t('suite')}
                </button>
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--sk-muted)' }}>{t('fin')}</span>
            )}
            {erreur && lignes.length > 0 && <span role="alert" style={{ fontSize: 12, color: 'var(--sk-red)' }}>{t('erreur')}</span>}
          </div>
        </>
      )}

    </div>
  )
}

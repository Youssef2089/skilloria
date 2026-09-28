'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/domaines-adresse — LES DEUX LISTES DE DOMAINES D'ADRESSE (§D.27, décision 6).
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ═════════════════════════════════════════════
 *   La règle d'inscription (en base, `inscription_refus`) lit deux listes : les
 *   domaines BLOQUÉS (une organisation ne s'y préinscrit pas) et les domaines PUBLICS
 *   (gmail.com… : accepté, mais le domaine ne se réserve pas). Elles vivaient en base
 *   sans écran : les régler demandait l'éditeur SQL, sans trace. Ici, chaque ajout et
 *   chaque retrait est un geste, avec sa ligne au grand livre.
 *
 * ═══ RETIRER N'EST PAS EFFACER ═════════════════════════════════════════════
 *   Un domaine retiré reste listé, désactivé, avec sa raison : on retire une
 *   décision, on ne la fait pas disparaître. Le réactiver est un clic.
 *
 * ═══ CE QUE L'ÉCRAN NE JUGE PAS ════════════════════════════════════════════
 *   Le format d'un domaine, sa présence dans l'autre liste : la BASE refuse, avec un
 *   code, et l'écran affiche la phrase de ce code. Aucune règle recopiée ici (§E.15).
 */

type Ligne = { id: string; email_domain: string; reason: string | null; active: boolean; updated_at: string }
type Charge = { bloques: Ligne[]; publics: Ligne[] }
type Liste = 'bloques' | 'publics'

const carte: React.CSSProperties = {
  background: 'var(--sk-surface)',
  border: '1px solid var(--sk-border)',
  borderRadius: 14,
  padding: '18px 20px',
  marginBottom: 16,
}
const titreBloc: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.08em',
  color: 'var(--sk-muted)',
  marginBottom: 8,
}
const champ: React.CSSProperties = {
  flex: '1 1 180px',
  minWidth: 0,
  padding: '8px 10px',
  border: '1px solid var(--sk-border)',
  borderRadius: 8,
  fontSize: 14,
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
}
const aide: React.CSSProperties = { fontSize: 12.5, color: 'var(--sk-muted)', lineHeight: 1.55, marginBottom: 12 }
const REFUS = ['liste_inconnue', 'domaine_invalide', 'dans_l_autre_liste', 'domaine_inconnu'] as const

export default function AdminDomainesAdressePage() {
  const t = useTranslations('admin_domaines_adresse')
  const secureFetch = useSecureFetch()

  const [charge, setCharge] = useState<Charge | null>(null)
  const [illisible, setIllisible] = useState(false)
  const [saisie, setSaisie] = useState<Record<Liste, { domaine: string; raison: string }>>({
    bloques: { domaine: '', raison: '' },
    publics: { domaine: '', raison: '' },
  })
  const [erreur, setErreur] = useState<Record<Liste, string | null>>({ bloques: null, publics: null })
  const [succes, setSucces] = useState<string | null>(null)
  const [enCours, setEnCours] = useState<string | null>(null)

  const lire = useCallback(async () => {
    try {
      const res = await secureFetch('/api/admin/domaines-adresse', { cache: 'no-store' })
      if (!res.ok) throw new Error(`domaines ${res.status}`)
      setCharge((await res.json()) as Charge)
      setIllisible(false)
    } catch {
      // « Illisible » n'est pas « vide » : une liste vide affichée ferait croire qu'aucun domaine n'est bloqué.
      setIllisible(true)
    }
  }, [secureFetch])

  useEffect(() => {
    void lire()
  }, [lire])

  const regler = async (liste: Liste, domaine: string, actif: boolean, raison: string, cle: string) => {
    setEnCours(cle)
    setSucces(null)
    setErreur((e) => ({ ...e, [liste]: null }))
    try {
      const res = await secureFetch('/api/admin/domaines-adresse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ liste, domaine, actif, raison }),
      })
      const data = (await res.json().catch(() => ({}))) as { code?: string; issue?: string }
      if (!res.ok) {
        const code = data.code ?? ''
        setErreur((e) => ({ ...e, [liste]: (REFUS as readonly string[]).includes(code) ? t(`refus.${code}`) : t('save_failed') }))
        return
      }
      if (actif) setSaisie((s) => ({ ...s, [liste]: { domaine: '', raison: '' } }))
      setSucces(data.issue === 'inchange' ? t('unchanged') : actif ? t('added', { domain: domaine.trim().toLowerCase() }) : t('removed', { domain: domaine }))
      await lire()
    } catch {
      setErreur((e) => ({ ...e, [liste]: t('save_failed') }))
    } finally {
      setEnCours(null)
    }
  }

  const bloc = (liste: Liste) => {
    const lignes = charge ? charge[liste] : []
    const s = saisie[liste]
    return (
      <section style={carte} aria-labelledby={`titre-${liste}`}>
        <div id={`titre-${liste}`} style={titreBloc}>{t(`${liste}.title`)}</div>
        <p style={aide}>{t(`${liste}.help`)}</p>

        {erreur[liste] && (
          <p role="alert" style={{ fontSize: 13, color: 'var(--sk-red)', background: 'var(--sk-red-soft)', borderRadius: 8, padding: '8px 12px', margin: '0 0 12px' }}>
            {erreur[liste]}
          </p>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (s.domaine.trim()) void regler(liste, s.domaine, true, s.raison, `ajout-${liste}`)
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}
        >
          <input
            aria-label={t('domain_label')}
            placeholder={t('domain_placeholder')}
            value={s.domaine}
            onChange={(e) => setSaisie((x) => ({ ...x, [liste]: { ...x[liste], domaine: e.target.value } }))}
            style={champ}
            disabled={!charge}
          />
          <input
            aria-label={t('reason_label')}
            placeholder={t('reason_placeholder')}
            value={s.raison}
            onChange={(e) => setSaisie((x) => ({ ...x, [liste]: { ...x[liste], raison: e.target.value } }))}
            style={champ}
            disabled={!charge}
          />
          <button
            type="submit"
            disabled={!charge || !s.domaine.trim() || enCours !== null}
            style={{
              padding: '8px 16px',
              background: charge && s.domaine.trim() && enCours === null ? 'var(--sk-text)' : 'var(--sk-border)',
              color: charge && s.domaine.trim() && enCours === null ? 'var(--sk-surface)' : 'var(--sk-muted)',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: charge && s.domaine.trim() && enCours === null ? 'pointer' : 'default',
            }}
          >
            {enCours === `ajout-${liste}` ? t('saving') : t('add')}
          </button>
        </form>

        {!charge ? (
          <p style={{ ...aide, marginBottom: 0 }}>{illisible ? t('unavailable') : t('loading')}</p>
        ) : lignes.length === 0 ? (
          <p style={{ ...aide, marginBottom: 0 }}>{t(`${liste}.empty`)}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {lignes.map((l) => (
              <li
                key={l.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderTop: '1px solid var(--sk-border)', flexWrap: 'wrap' }}
              >
                <span style={{ fontSize: 14, fontWeight: 600, color: l.active ? 'var(--sk-text)' : 'var(--sk-muted)', flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
                  {l.email_domain}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--sk-muted)', flex: '2 1 200px', minWidth: 0 }}>{l.reason ?? '—'}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: l.active ? 'var(--sk-success)' : 'var(--sk-muted)' }}>
                  {l.active ? t('active') : t('inactive')}
                </span>
                <button
                  type="button"
                  onClick={() => void regler(liste, l.email_domain, !l.active, '', l.id)}
                  disabled={enCours !== null}
                  style={{
                    padding: '6px 12px',
                    background: 'transparent',
                    color: 'var(--sk-text)',
                    border: '1px solid var(--sk-border)',
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: enCours === null ? 'pointer' : 'default',
                  }}
                >
                  {enCours === l.id ? t('saving') : l.active ? t('remove') : t('reactivate')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6, color: 'var(--sk-text)' }}>{t('title')}</h1>
      <p style={{ fontSize: 13.5, color: 'var(--sk-muted)', lineHeight: 1.6, marginBottom: 20 }}>{t('intro')}</p>

      {illisible && (
        <div role="alert" style={{ ...carte, background: 'var(--sk-red-soft)', borderColor: 'var(--sk-red-soft)', color: 'var(--sk-red)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 240px' }}>{t('unavailable')}</span>
          <button type="button" onClick={() => void lire()} style={{ padding: '6px 12px', background: 'transparent', color: 'var(--sk-red)', border: '1px solid var(--sk-red)', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
            {t('retry')}
          </button>
        </div>
      )}
      {succes && (
        <div role="status" style={{ ...carte, background: 'var(--sk-success-soft)', borderColor: 'var(--sk-success-soft)', color: 'var(--sk-success)', fontSize: 13 }}>
          {succes}
        </div>
      )}

      {bloc('bloques')}
      {bloc('publics')}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import { CAUSES_DEPOT, type EtatDepotAffiche } from '@/lib/candidatures/depot-etats'

/**
 * /admin/depots-en-echec — LES CANDIDATURES QUI N'ONT PAS PU ÊTRE ÉCRITES.
 *
 * Page de MENU : aucun bouton Retour (règle projet).
 *
 * ┌─ POURQUOI CET ÉCRAN EXISTE, ET POURQUOI IL EST BLOQUANT ────────────────┐
 * │ Depuis le 23/09/2026, une candidature dont le jugement échoue n'est PAS │
 * │ écrite (§D.19) : « une candidature avec sa note et son résumé, ou pas de │
 * │ candidature ». L'expert n'est PAS prévenu — décision arbitrée : il ne    │
 * │ paie pas une panne qui ne le concerne pas.                              │
 * │                                                                          │
 * │ Cet écran est la contrepartie EXACTE de ce silence. Sans lui, personne   │
 * │ ne se plaindrait : l'expert croit avoir postulé, l'organisation ignore   │
 * │ qu'elle devait recevoir quelque chose. C'est pour ça qu'il remonte en    │
 * │ BLOQUANT dans la supervision tant qu'il n'est pas vide.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ LE BOUTON RELANCER REJOUE LE DÉPÔT, IL NE LE RECONSTRUIT PAS. Il appelle
 *    la MÊME fonction que le dépôt d'un expert (`deposerCandidature`) avec
 *    l'annonce, l'expert et le message. Tout le reste est relu. Un chemin
 *    parallèle de rattrapage serait le pire des jumeaux (§E.20) : il ne sert
 *    que le jour où le chemin normal a déjà échoué.
 *
 * ⚠️ AUCUN BOUTON DÉSACTIVÉ SUR UNE LIGNE RELANÇABLE. Un bouton qu'on ne peut
 *    pas cliquer promet une porte qui n'existe pas (§D.1). Pendant la relance,
 *    le bouton PORTE son état — il dit ce qu'il fait, il ne disparaît pas.
 */

type Ligne = {
  id: string
  etat: EtatDepotAffiche
  cause: string | null
  detail: string | null
  tentatives: number
  commence_at: string
  termine_at: string | null
  domain_id: string | null
  publication: { id: string; title: string | null; type: string | null }
  expert: { profile_id: string; prenom: string | null; nom: string | null; titre: string | null }
  contexte_lisible: boolean
}

type Domaine = { id: string; name: string; slug: string; active: boolean }

/** Rouge = il faut agir. Ambre = il faut regarder. */
const TON: Record<'red' | 'amber', { bg: string; fg: string }> = {
  red: { bg: 'var(--sk-red-soft)', fg: 'var(--sk-red)' },
  amber: { bg: 'var(--sk-amber-soft)', fg: 'var(--sk-amber)' },
}

/**
 * ⚠️ « INTERROMPU » EST AMBRE, PAS ROUGE, ET LA NUANCE EST RÉELLE.
 *    Un échec a une cause : on sait quoi réparer. Un dépôt interrompu, non :
 *    la fonction a été tuée, on ne sait pas où. Peindre les deux pareil ferait
 *    croire qu'on en sait autant sur l'un que sur l'autre.
 */
const TON_PAR_ETAT: Record<'echec' | 'interrompu', 'red' | 'amber'> = {
  echec: 'red',
  interrompu: 'amber',
}

/** Durées proposées. Fermées : une saisie libre de date n'apporte rien ici. */
const PERIODES = [0, 7, 30, 90] as const

export default function AdminDepotsEnEchecPage() {
  const t = useTranslations('admin_back_office.depots_echec')
  const tErr = useTranslations('admin_back_office.errors')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [lignes, setLignes] = useState<Ligne[] | null>(null)
  const [total, setTotal] = useState(0)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [domaines, setDomaines] = useState<Domaine[]>([])

  const [cause, setCause] = useState('')
  const [domaine, setDomaine] = useState('')
  const [jours, setJours] = useState<number>(0)

  const [relance, setRelance] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)

  const charger = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const params = new URLSearchParams()
      if (cause) params.set('cause', cause)
      if (domaine) params.set('domain_id', domaine)
      if (jours > 0) params.set('jours', String(jours))
      const res = await secureFetch(`/api/admin/depots-en-echec?${params.toString()}`, {
        method: 'GET',
      })
      const payload = (await res.json().catch(() => ({}))) as { lignes?: Ligne[]; total?: number }
      if (res.status === 403) { setErreur(tErr('forbidden')); return }
      if (!res.ok) { setErreur(t('error_title')); return }
      setLignes(payload.lignes ?? [])
      setTotal(payload.total ?? 0)
    } catch {
      setErreur(t('error_title'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, cause, domaine, jours, t, tErr])

  useEffect(() => { void charger() }, [charger])

  // Les écosystèmes, pour le filtre. Une panne ici n'empêche RIEN : le filtre
  // reste sur « tous », et le reste de l'écran fonctionne.
  useEffect(() => {
    let vivant = true
    void (async () => {
      try {
        const res = await secureFetch('/api/admin/list-domains', { method: 'GET' })
        if (!res.ok) return
        const payload = (await res.json().catch(() => ({}))) as { domains?: Domaine[] }
        if (vivant) setDomaines(payload.domains ?? [])
      } catch {
        // Silencieux À DESSEIN : le filtre par écosystème est un confort, et
        // son absence se voit (la liste déroulante n'a qu'une entrée).
      }
    })()
    return () => { vivant = false }
  }, [secureFetch])

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }),
    [locale],
  )

  /** Traduit une cause. Jamais d'identifiant brut à l'écran (§D.11). */
  const libelleCause = useCallback(
    (c: string): string => {
      if (c === 'plafond') return t('cause_plafond')
      if (c === 'modele_indisponible') return t('cause_modele_indisponible')
      if (c === 'reponse_illisible') return t('cause_reponse_illisible')
      if (c === 'interrompu') return t('cause_interrompu')
      return t('cause_inconnue')
    },
    [t],
  )

  const relancer = useCallback(async (ligne: Ligne) => {
    setRelance(ligne.id)
    setToast(null)
    try {
      const res = await secureFetch('/api/admin/depots-en-echec', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ligne.id }),
      })
      const payload = (await res.json().catch(() => ({}))) as {
        issue?: string
        cause?: string
        code?: string
      }
      if (payload.issue === 'deposee') {
        setToast({ msg: t('toast_deposee'), kind: 'success' })
      } else if (payload.issue === 'sans_jugement') {
        // LA RELANCE A ÉCHOUÉ À SON TOUR, et on le dit avec sa cause. Un
        // « réessayez » sans motif enverrait cliquer en boucle.
        setToast({ msg: t('toast_sans_jugement', { cause: libelleCause(payload.cause ?? '') }), kind: 'error' })
      } else {
        setToast({ msg: t('toast_refusee', { code: payload.code ?? '—' }), kind: 'error' })
      }
      await charger()
    } catch {
      setToast({ msg: t('error_title'), kind: 'error' })
    } finally {
      setRelance(null)
    }
  }, [secureFetch, t, charger, libelleCause])

  const nomExpert = useCallback((e: Ligne['expert']): string => {
    const complet = [e.prenom, e.nom].filter(Boolean).join(' ').trim()
    return complet.length > 0 ? complet : t('expert_sans_nom')
  }, [t])

  const puce: React.CSSProperties = {
    padding: '6px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
    border: '1px solid var(--sk-border)', background: 'var(--sk-surface)',
    color: 'var(--sk-text)', cursor: 'pointer', fontFamily: 'inherit',
  }
  const puceActive: React.CSSProperties = {
    ...puce, background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)',
    borderColor: 'var(--sk-accent)',
  }
  const champ: React.CSSProperties = {
    padding: '7px 11px', borderRadius: 9, border: '1px solid var(--sk-border)',
    background: 'var(--sk-surface)', color: 'var(--sk-text)', fontSize: 13,
    fontFamily: 'inherit',
  }

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit' }}>
      {toast && (
        <div
          role="status"
          style={{
            marginBottom: 14, padding: '12px 16px', borderRadius: 10, fontSize: 13, lineHeight: 1.55,
            background: toast.kind === 'error' ? 'var(--sk-red-soft)' : 'var(--sk-success-soft)',
            color: toast.kind === 'error' ? 'var(--sk-red)' : 'var(--sk-success)',
          }}
        >
          {toast.msg}
        </div>
      )}

      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', margin: 0, letterSpacing: '-0.2px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '4px 0 0', lineHeight: 1.55, maxWidth: 760 }}>
          {t('subtitle')}
        </p>
      </header>

      {/* ── LES FILTRES ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <button type="button" style={cause === '' ? puceActive : puce} onClick={() => setCause('')}>
          {t('filtre_toutes')}
        </button>
        {[...CAUSES_DEPOT, 'interrompu'].map((c) => (
          <button
            key={c}
            type="button"
            style={cause === c ? puceActive : puce}
            onClick={() => setCause(c)}
          >
            {libelleCause(c)}
          </button>
        ))}

        <span style={{ flex: '1 1 12px' }} />

        <label style={{ fontSize: 12.5, color: 'var(--sk-muted)' }} htmlFor="filtre-ecosysteme">
          {t('filtre_ecosysteme')}
        </label>
        <select
          id="filtre-ecosysteme"
          style={champ}
          value={domaine}
          onChange={(e) => setDomaine(e.target.value)}
        >
          <option value="">{t('filtre_tous_ecosystemes')}</option>
          {domaines.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        <label style={{ fontSize: 12.5, color: 'var(--sk-muted)' }} htmlFor="filtre-periode">
          {t('filtre_periode')}
        </label>
        <select
          id="filtre-periode"
          style={champ}
          value={String(jours)}
          onChange={(e) => setJours(Number(e.target.value))}
        >
          {PERIODES.map((j) => (
            <option key={j} value={String(j)}>
              {j === 0 ? t('periode_tout') : t('periode_jours', { jours: j })}
            </option>
          ))}
        </select>
      </div>

      {/* ── LES ÉTATS DE L'ÉCRAN ─────────────────────────────────────────── */}
      {chargement && (
        <p style={{ fontSize: 13, color: 'var(--sk-muted)' }}>{t('chargement')}</p>
      )}

      {!chargement && erreur && (
        <div
          role="alert"
          style={{
            padding: '14px 16px', borderRadius: 10, fontSize: 13, lineHeight: 1.55,
            background: 'var(--sk-red-soft)', color: 'var(--sk-red)',
          }}
        >
          {erreur}
        </div>
      )}

      {/* L'ÉTAT VIDE DIT QUELQUE CHOSE : il prend `--sk-muted`, jamais le texte
          tenu (§D.12). « Aucun dépôt perdu » est une bonne nouvelle, et elle se
          lit. */}
      {!chargement && !erreur && (lignes ?? []).length === 0 && (
        <div
          style={{
            padding: '28px 22px', borderRadius: 12, border: '1px solid var(--sk-border)',
            background: 'var(--sk-surface)', textAlign: 'left',
          }}
        >
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--sk-text)' }}>
            {t('vide_titre')}
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--sk-muted)', lineHeight: 1.55, maxWidth: 620 }}>
            {t('vide_detail')}
          </p>
        </div>
      )}

      {!chargement && !erreur && (lignes ?? []).length > 0 && (
        <>
          <p style={{ fontSize: 12.5, color: 'var(--sk-muted)', margin: '0 0 10px' }}>
            {t('compte', { total })}
          </p>
          {(lignes ?? []).map((l) => {
            const ton = TON[TON_PAR_ETAT[l.etat === 'echec' ? 'echec' : 'interrompu']]
            return (
              <div
                key={l.id}
                style={{
                  borderRadius: 12, padding: '16px 18px', marginBottom: 10,
                  border: '1px solid var(--sk-border)', background: 'var(--sk-surface)',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  <span
                    style={{
                      padding: '4px 10px', borderRadius: 999, fontSize: 11.5, fontWeight: 700,
                      background: ton.bg, color: ton.fg, letterSpacing: '0.2px',
                    }}
                  >
                    {l.etat === 'echec' ? libelleCause(l.cause ?? '') : t('cause_interrompu')}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)' }}>
                    {l.publication.title ?? t('annonce_sans_titre')}
                  </span>
                  <span style={{ flex: '1 1 40px' }} />
                  <button
                    type="button"
                    onClick={() => void relancer(l)}
                    style={{
                      padding: '8px 14px', borderRadius: 9,
                      border: '1px solid var(--sk-accent)',
                      background: relance === l.id ? 'var(--sk-surface)' : 'var(--sk-accent)',
                      color: relance === l.id ? 'var(--sk-text)' : 'var(--sk-sur-accent)',
                      fontSize: 12.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                    }}
                  >
                    {relance === l.id ? t('bouton_relance_en_cours') : t('bouton_relancer')}
                  </button>
                </div>

                <dl
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                    gap: '10px 22px', margin: '14px 0 0',
                  }}
                >
                  <div>
                    <dt style={{ fontSize: 11.5, color: 'var(--sk-muted)', margin: 0 }}>{t('champ_expert')}</dt>
                    <dd style={{ fontSize: 13, color: 'var(--sk-text)', margin: '2px 0 0' }}>
                      {nomExpert(l.expert)}
                      {l.expert.titre ? (
                        <span style={{ color: 'var(--sk-muted)' }}> — {l.expert.titre}</span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 11.5, color: 'var(--sk-muted)', margin: 0 }}>{t('champ_quand')}</dt>
                    <dd style={{ fontSize: 13, color: 'var(--sk-text)', margin: '2px 0 0' }}>
                      {dateFmt.format(new Date(l.commence_at))}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 11.5, color: 'var(--sk-muted)', margin: 0 }}>{t('champ_tentatives')}</dt>
                    <dd style={{ fontSize: 13, color: 'var(--sk-text)', margin: '2px 0 0' }}>
                      {l.tentatives}
                    </dd>
                  </div>
                </dl>

                {/* LE MOTIF EXACT, tel que le modèle ou la base l'a rendu. Il
                    n'est PAS traduit : c'est une phrase de journal, et la
                    traduire en inventerait le sens. */}
                {l.detail ? (
                  <p
                    style={{
                      margin: '12px 0 0', padding: '9px 12px', borderRadius: 8,
                      background: 'var(--sk-surface-2)', color: 'var(--sk-muted)',
                      fontSize: 12, lineHeight: 1.5, fontFamily: 'ui-monospace, monospace',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {l.detail}
                  </p>
                ) : null}

                {/* ⚠️ UNE LIGNE DONT LE CONTEXTE N'A PAS PU ÊTRE LU LE DIT.
                    Sans cette phrase, « annonce sans titre » se lirait comme
                    une annonce réellement sans titre (§E.22). */}
                {!l.contexte_lisible ? (
                  <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--sk-amber)' }}>
                    {t('contexte_illisible')}
                  </p>
                ) : null}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

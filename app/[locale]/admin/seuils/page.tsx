'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/seuils — LES SEUILS DE JUGEMENT.
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ═════════════════════════════════════════════
 *   Ces seuils décident qui est approuvé sans intervention humaine, et ils
 *   vivaient EN BASE SANS ÉCRAN. Les changer demandait un accès direct à la
 *   base : ni pratique, ni tracé.
 *   Le passage de 9 à 8 du seuil expert, en juin, n'a laissé AUCUNE trace
 *   exploitable — il a fallu croiser un commit et un `updated_at` pour le
 *   reconstituer. Cet écran existe pour que ça ne se reproduise pas.
 *
 * ═══ UN NOMBRE NU N'EST PAS UN RÉGLAGE ═════════════════════════════════════
 *   Chaque seuil est accompagné de CE QU'IL PRODUIT, en toutes lettres :
 *   « au-dessus, le profil est approuvé sans intervention ; en dessous, il
 *   arrive dans /admin/experts ». Un champ nu invite à bouger un chiffre sans
 *   savoir ce qu'il déclenche.
 *
 * ═══ LA COLONNE INERTE EST MONTRÉE COMME INERTE ════════════════════════════
 *   Sur le chemin expert, `confidence_threshold` est lue puis JAMAIS utilisée :
 *   la décision se prend sur `auto_approve_threshold`, dans le jsonb. On
 *   l'affiche donc EN LECTURE SEULE, avec la raison — cachée, elle serait un
 *   jour renseignée par quelqu'un qui croirait régler quelque chose. Même
 *   parti pris que `packages.max_seats`.
 *
 * ═══ LA GARDE EST AU SERVEUR ═══════════════════════════════════════════════
 *   Les bornes 0–10, le refus d'écrire une clé que le chemin ne lit pas, et le
 *   refus d'une liste de drapeaux vide vivent dans la route. Cet écran prévient
 *   AVANT l'envoi ; il ne garde rien à lui seul.
 */

type Fournisseur = {
  id: string
  country_code: string
  provider_type: string
  provider_name: string
  is_active: boolean
  priority: number
  confidence_threshold: number
  auto_approve_threshold: number | null
  blocking_flags: string[] | null
  updated_at: string | null
  gere: boolean
  cle_decisive: string | null
  colonne_inerte: boolean
  porte_drapeaux: boolean
}

type Charge = {
  fournisseurs: Fournisseur[]
  pays_sans_decideur: { code: string; nom: string }[]
  drapeaux_connus: string[]
}

type Brouillon = {
  confidence_threshold?: number
  auto_approve_threshold?: number
  blocking_flags?: string[]
}

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
  color: 'var(--sk-faint)',
  marginBottom: 12,
}
const champ: React.CSSProperties = {
  width: '100%',
  maxWidth: 120,
  padding: '9px 11px',
  border: '1px solid var(--sk-border)',
  borderRadius: 9,
  fontSize: 14,
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
}
const etiquette: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--sk-muted)',
  marginBottom: 5,
}
const aide: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--sk-faint)',
  marginTop: 5,
  lineHeight: 1.5,
}
const bouton: React.CSSProperties = {
  padding: '9px 16px',
  borderRadius: 9,
  border: '1px solid var(--sk-border)',
  background: 'var(--sk-accent-soft)',
  color: 'var(--sk-accent-ink)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

export default function AdminSeuilsPage() {
  const t = useTranslations('admin_seuils')
  const secureFetch = useSecureFetch()

  const [charge, setCharge] = useState<Charge | null>(null)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)
  const [brouillons, setBrouillons] = useState<Record<string, Brouillon>>({})
  const [enregistrement, setEnregistrement] = useState<string | null>(null)

  const lire = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch('/api/admin/seuils', { method: 'GET' })
      if (!res.ok) {
        setErreur(t('errors.load_failed'))
        return
      }
      setCharge((await res.json()) as Charge)
      setBrouillons({})
    } catch {
      setErreur(t('errors.load_failed'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void lire()
  }, [lire])

  const enregistrer = useCallback(
    async (f: Fournisseur) => {
      const b = brouillons[f.id]
      if (!b || Object.keys(b).length === 0) return
      setEnregistrement(f.id)
      setErreur(null)
      setSucces(null)
      try {
        const res = await secureFetch('/api/admin/seuils', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider_id: f.id, ...b }),
        })
        if (!res.ok) {
          const corps = (await res.json().catch(() => null)) as { code?: string } | null
          // Le serveur NOMME son refus : on rend son motif, jamais un « échec »
          // générique qui laisserait chercher.
          const cle = corps?.code ?? 'save_failed'
          setErreur(t.has(`errors.${cle}`) ? t(`errors.${cle}`) : t('errors.save_failed'))
          return
        }
        setSucces(t('saved'))
        await lire()
      } catch {
        setErreur(t('errors.save_failed'))
      } finally {
        setEnregistrement(null)
      }
    },
    [brouillons, secureFetch, t, lire],
  )

  const majBrouillon = (id: string, patch: Brouillon) =>
    setBrouillons((b) => ({ ...b, [id]: { ...b[id], ...patch } }))

  if (chargement) {
    return (
      <main style={{ padding: '24px 20px', width: '100%' }}>
        <p style={{ color: 'var(--sk-faint)', fontSize: 14 }}>{t('loading')}</p>
      </main>
    )
  }

  return (
    <main style={{ padding: '24px 20px', width: '100%', textAlign: 'left' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', margin: '0 0 6px' }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--sk-muted)', margin: '0 0 20px', maxWidth: 760, lineHeight: 1.6 }}>
        {t('intro')}
      </p>

      {erreur && (
        <div style={{ ...carte, borderColor: '#b45309', color: '#b45309', fontSize: 13.5 }}>{erreur}</div>
      )}
      {succes && (
        <div style={{ ...carte, borderColor: 'var(--sk-accent-ink)', color: 'var(--sk-accent-ink)', fontSize: 13.5 }}>
          {succes}
        </div>
      )}

      {/* ── LES PAYS SANS FOURNISSEUR DE DÉCISION ─────────────────────────── */}
      {charge && charge.pays_sans_decideur.length > 0 && (
        <section style={{ ...carte, borderColor: '#b45309' }}>
          <div style={{ ...titreBloc, color: '#b45309' }}>{t('no_decider.title')}</div>
          <p style={{ fontSize: 13.5, color: 'var(--sk-text)', margin: '0 0 8px', lineHeight: 1.6 }}>
            {t('no_decider.explain')}
          </p>
          <p style={{ fontSize: 12.5, color: 'var(--sk-muted)', margin: 0 }}>
            {charge.pays_sans_decideur.map((p) => `${p.nom} (${p.code})`).join(' · ')}
          </p>
        </section>
      )}

      {(charge?.fournisseurs ?? []).map((f) => {
        const b = brouillons[f.id] ?? {}
        const modifie = Object.keys(b).length > 0
        const flags = b.blocking_flags ?? f.blocking_flags ?? []
        return (
          <section key={f.id} style={carte}>
            <div style={titreBloc}>
              {t(`types.${f.provider_type}.name`, { default: f.provider_type })} · {f.country_code}
            </div>
            <p style={{ fontSize: 13.5, color: 'var(--sk-text)', margin: '0 0 4px', fontWeight: 600 }}>
              {f.provider_name}
            </p>

            {!f.gere ? (
              <p style={aide}>{t('not_editable')}</p>
            ) : (
              <>
                {/* CE QUE LE SEUIL PRODUIT — avant le champ, pas après. */}
                <p style={{ fontSize: 13, color: 'var(--sk-muted)', margin: '0 0 14px', lineHeight: 1.6, maxWidth: 720 }}>
                  {t(`types.${f.provider_type}.effect`)}
                </p>

                {/* ── LA VALEUR QUI DÉCIDE — quand il y en a une ───────────────
                    UN FOURNISSEUR DE DONNÉES NE DÉCIDE PAS. Sirene renseigne,
                    l'IA tranche : sa ligne n'a aucune valeur décisive, et lui
                    en afficher une inviterait à régler quelque chose qui ne
                    règle rien — puis l'enregistrement serait refusé.
                    `cle_decisive: null` est donc un cas RENDU, pas un cas oublié. */}
                {f.cle_decisive === null ? (
                  <p style={aide}>{t('no_decisive')}</p>
                ) : (
                  <div style={{ marginBottom: 14 }}>
                    <label style={etiquette} htmlFor={`decisif-${f.id}`}>
                      {t('decisive_label')}
                    </label>
                    <input
                      id={`decisif-${f.id}`}
                      type="number"
                      min={0}
                      max={10}
                      step={1}
                      style={champ}
                      value={
                        f.cle_decisive === 'auto_approve_threshold'
                          ? (b.auto_approve_threshold ?? f.auto_approve_threshold ?? '')
                          : (b.confidence_threshold ?? f.confidence_threshold)
                      }
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        majBrouillon(
                          f.id,
                          f.cle_decisive === 'auto_approve_threshold'
                            ? { auto_approve_threshold: n }
                            : { confidence_threshold: n },
                        )
                      }}
                    />
                    <p style={aide}>{t('decisive_help', { cle: f.cle_decisive })}</p>
                  </div>
                )}

                {/* ── LA COLONNE INERTE, MONTRÉE COMME INERTE ──────────────── */}
                {f.colonne_inerte && (
                  <div style={{ marginBottom: 14, opacity: 0.6 }}>
                    <label style={etiquette} htmlFor={`inerte-${f.id}`}>
                      {t('inert_label')}
                    </label>
                    <input
                      id={`inerte-${f.id}`}
                      type="number"
                      value={f.confidence_threshold}
                      disabled
                      readOnly
                      style={{ ...champ, background: 'var(--sk-surface-2, #f8fafc)', color: 'var(--sk-faint)' }}
                    />
                    <p style={aide}>{t('inert_help')}</p>
                  </div>
                )}

                {/* ── LES DRAPEAUX DISQUALIFIANTS ──────────────────────────── */}
                {f.porte_drapeaux && (
                  <div style={{ marginBottom: 14 }}>
                    <span style={etiquette}>{t('flags_label')}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      {(charge?.drapeaux_connus ?? []).map((d) => (
                        <label
                          key={d}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--sk-text)' }}
                        >
                          <input
                            type="checkbox"
                            checked={flags.includes(d)}
                            onChange={(e) => {
                              const suivant = e.target.checked
                                ? [...flags, d]
                                : flags.filter((x) => x !== d)
                              majBrouillon(f.id, { blocking_flags: suivant })
                            }}
                          />
                          {t(`flags.${d}`)}
                        </label>
                      ))}
                    </div>
                    <p style={aide}>{t('flags_help')}</p>
                  </div>
                )}

                <button
                  type="button"
                  style={{ ...bouton, opacity: modifie && enregistrement !== f.id ? 1 : 0.5 }}
                  disabled={!modifie || enregistrement === f.id}
                  onClick={() => void enregistrer(f)}
                >
                  {enregistrement === f.id ? t('saving') : t('save')}
                </button>
              </>
            )}
          </section>
        )
      })}

      <p style={{ fontSize: 12, color: 'var(--sk-faint)', marginTop: 20, maxWidth: 760, lineHeight: 1.6 }}>
        {t('audit_note')}
      </p>
    </main>
  )
}

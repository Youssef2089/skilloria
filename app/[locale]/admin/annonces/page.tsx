'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/annonces — LES ANNONCES À VALIDER (lot S3), sur le modèle exact de /admin/experts.
 *
 * 4 onglets : En attente · Validées · Refusées · Toutes, avec leurs compteurs exacts.
 * Source : GET /api/admin/annonces?status=<filtre> (et ?counts=1). Une seule liste pour les annonces des
 * organisations (client, cabinet, ESN) et les besoins de sous-traitance des experts : ce sont toutes des annonces.
 * La garde administrateur est au serveur (requireAdmin) ; le cadre /admin la double côté écran.
 */

type TabKey = 'pending' | 'validated' | 'rejected' | 'all'

type Ligne = {
  id: string
  type: string
  title: string
  status: string
  note: number | null
  // Jamais jugée par la vérification automatique (ou elle n'a pas pu se prononcer) : « non jugée », jamais « 0/10 ».
  non_jugee: boolean
  voie: 'automatique' | 'administrateur' | null
  organisation: string | null
  org_type: string | null
  auteur: string | null
  ecosysteme: string | null
  date: string | null
}

const TYPES = ['mission', 'offre', 'sous_traitance'] as const
const TYPES_ORG = ['client', 'cabinet', 'esn', 'freelance'] as const
const STATUTS = ['draft', 'pending_review', 'published', 'suspended', 'expired', 'archived', 'rejected'] as const

function noteCouleur(note: number | null): string {
  if (note == null) return 'var(--sk-muted)'
  if (note < 5) return 'var(--sk-red)'
  if (note < 9) return 'var(--sk-amber)'
  return 'var(--sk-success)'
}

function statutCouleur(statut: string): { fond: string; texte: string } {
  if (statut === 'pending_review') return { fond: 'var(--sk-amber-soft)', texte: 'var(--sk-amber)' }
  if (statut === 'published') return { fond: 'var(--sk-success-soft)', texte: 'var(--sk-success)' }
  if (statut === 'rejected') return { fond: 'var(--sk-red-soft)', texte: 'var(--sk-red)' }
  return { fond: 'var(--sk-surface-2)', texte: 'var(--sk-muted)' }
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return iso }
}

export default function AdminAnnoncesPage() {
  const t = useTranslations('validation_annonces')
  const tAdmin = useTranslations('admin_back_office')
  // Message de troncature MUTUALISÉ avec les écrans Utilisateurs et Experts : même plafond, même phrase.
  const tUsers = useTranslations('admin_back_office.users')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const [tab, setTab] = useState<TabKey>('pending')
  const [counts, setCounts] = useState<Record<TabKey, number | null>>({ pending: null, validated: null, rejected: null, all: null })
  const [rows, setRows] = useState<Ligne[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [truncation, setTruncation] = useState<{ total: number; limit: number } | null>(null)

  // La liste de l'onglet : l'état n'est écrit qu'à l'ARRIVÉE de la réponse (la remise à « chargement » se fait au
  // clic, dans `changerOnglet`) — une réponse d'un onglet quitté entre-temps est ignorée.
  useEffect(() => {
    let actuel = true
    const charger = async () => {
      try {
        const res = await secureFetch(`/api/admin/annonces?status=${tab}`, { method: 'GET' })
        if (!actuel) return
        if (!res.ok) {
          setError(t('erreurs.chargement'))
          return
        }
        const payload = (await res.json()) as { annonces: Ligne[]; total?: number; truncated?: boolean; limit?: number }
        if (!actuel) return
        setRows(payload.annonces ?? [])
        setTruncation(payload.truncated ? { total: payload.total ?? 0, limit: payload.limit ?? (payload.annonces ?? []).length } : null)
      } catch (err) {
        console.error('[admin/annonces] load threw', err)
        if (actuel) setError(t('erreurs.chargement'))
      }
    }
    void charger()
    return () => { actuel = false }
  }, [tab, secureFetch, t])

  // Compteurs exacts des 4 onglets, indépendants de l'onglet actif — lus une fois au montage.
  useEffect(() => {
    let actuel = true
    const compter = async () => {
      try {
        const res = await secureFetch('/api/admin/annonces?counts=1', { method: 'GET' })
        if (!res.ok) return
        const payload = (await res.json()) as { counts: Record<TabKey, number> }
        if (actuel && payload.counts) setCounts(payload.counts)
      } catch (err) {
        console.error('[admin/annonces] loadCounts threw', err)
      }
    }
    void compter()
    return () => { actuel = false }
  }, [secureFetch])

  const changerOnglet = (k: TabKey) => {
    if (k === tab) return
    setTab(k)
    setRows(null)
    setError(null)
    setTruncation(null)
  }

  const tabs: Array<{ key: TabKey; label: string; dot: string }> = useMemo(() => [
    { key: 'pending', label: t('admin.onglet_attente'), dot: 'var(--sk-amber)' },
    { key: 'validated', label: t('admin.onglet_validees'), dot: 'var(--sk-success)' },
    { key: 'rejected', label: t('admin.onglet_refusees'), dot: 'var(--sk-red)' },
    { key: 'all', label: t('admin.onglet_toutes'), dot: 'var(--sk-muted)' },
  ], [t])

  const libelleType = (type: string) => ((TYPES as readonly string[]).includes(type) ? t(`types.${type as (typeof TYPES)[number]}`) : t('types.autre'))
  const libelleOrg = (o: string | null) => (o && (TYPES_ORG as readonly string[]).includes(o) ? t(`types_organisation.${o as (typeof TYPES_ORG)[number]}`) : null)
  const libelleStatut = (s: string) => ((STATUTS as readonly string[]).includes(s) ? t(`statuts.${s as (typeof STATUTS)[number]}`) : t('statuts.autre'))

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 6 }}>{t('admin.titre')}</h1>
      <p style={{ fontSize: 13, color: 'var(--sk-muted)', marginBottom: 22 }}>{t('admin.sous_titre')}</p>

      {truncation && (
        <div
          role="status"
          style={{
            marginBottom: 16, padding: '11px 15px', borderRadius: 10,
            background: 'var(--sk-amber-soft)', border: '1px solid var(--sk-amber-soft)', color: 'var(--sk-amber)',
            fontSize: 12.5, lineHeight: 1.55,
          }}
        >
          {tUsers('truncated_notice', { limit: truncation.limit, total: truncation.total })}
        </div>
      )}

      <div role="tablist" style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--sk-border)', marginBottom: 18, flexWrap: 'wrap' }}>
        {tabs.map((tabDef) => {
          const active = tab === tabDef.key
          const count = counts[tabDef.key]
          return (
            <button
              key={tabDef.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => changerOnglet(tabDef.key)}
              style={{
                padding: '10px 14px', background: 'transparent', border: 'none',
                borderBottom: active ? '2px solid var(--sk-text)' : '2px solid transparent',
                color: active ? 'var(--sk-text)' : 'var(--sk-muted)',
                fontSize: 13, fontWeight: active ? 600 : 500, cursor: 'pointer',
                fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6,
                marginBottom: -1,
              }}
            >
              <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: tabDef.dot }} />
              {tabDef.label}{count !== null ? ` (${count})` : ''}
            </button>
          )
        })}
      </div>

      {error && (
        <div role="alert" style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red-soft)', color: 'var(--sk-red)', padding: '12px 16px', borderRadius: 10, fontSize: 13 }}>{error}</div>
      )}

      {rows === null && !error && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>{t('admin.chargement')}</div>
      )}

      {rows !== null && rows.length === 0 && (
        <div style={{ background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)', borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: 'var(--sk-muted)', fontSize: 14 }}>
          {t(`admin.vide_${tab}`)}
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div style={{ background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)', borderRadius: 14, overflowX: 'auto' }}>
          {rows.map((r, i) => {
            const couleur = statutCouleur(r.status)
            const org = libelleOrg(r.org_type)
            return (
              <Link
                key={r.id}
                href={`/admin/annonces/${r.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) 130px 70px 150px 110px',
                  minWidth: 640,
                  gap: 14,
                  alignItems: 'center',
                  padding: '14px 18px',
                  borderTop: i === 0 ? 'none' : '0.5px solid var(--sk-border)',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.title || '—'}
                    </span>
                    {r.ecosysteme && (
                      <span title={tAdmin('ecosystem_label')} style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--sk-accent)', background: 'var(--sk-accent-soft)', border: '0.5px solid var(--sk-accent-soft)', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                        {r.ecosysteme}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sk-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                    {[r.organisation, org, r.auteur ? t('admin.par_auteur', { auteur: r.auteur }) : null].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--sk-muted)' }}>{libelleType(r.type)}</div>
                <div style={{ textAlign: 'right' }}>
                  {r.non_jugee && (
                    <span title={t('admin.note_titre')} style={{ display: 'inline-block', padding: '3px 9px', background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', fontSize: 11, fontWeight: 600, borderRadius: 10 }}>
                      {t('admin.non_jugee')}
                    </span>
                  )}
                  {!r.non_jugee && r.note != null && (
                    <span title={t('admin.note_titre')} style={{ display: 'inline-block', padding: '3px 9px', background: `color-mix(in srgb, ${noteCouleur(r.note)} 10%, transparent)`, color: noteCouleur(r.note), fontSize: 11, fontWeight: 700, borderRadius: 10 }}>
                      {Math.round(r.note)}/10
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right', minWidth: 0 }}>
                  <span style={{ display: 'inline-block', padding: '3px 9px', background: couleur.fond, color: couleur.texte, fontSize: 11, fontWeight: 600, borderRadius: 10, whiteSpace: 'nowrap' }}>
                    {libelleStatut(r.status)}
                  </span>
                  {r.voie && (
                    <div style={{ fontSize: 11, color: 'var(--sk-muted)', marginTop: 3 }}>{t(`voies.${r.voie}`)}</div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--sk-muted)', textAlign: 'right' }}>{formatDate(r.date, locale)}</div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

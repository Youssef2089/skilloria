'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import type { CriteresAnnonceLus } from '@/lib/annonces/criteres'
import { estTypeAnnonce } from '@/lib/annonces/audience'
import { libelleBudget, libelleDuree, libellesModesTravail, libellesTempsTravail } from '@/lib/annonces/mise-en-forme'

/**
 * /dashboard/entreprise/annonces/[id] — fiche détail annonce (lecture seule).
 *
 * Lot refonte dashboard org : créée pour remplir le rôle « Voir l'annonce »
 * qui pointait à tort vers la page casting (cf. fix de la page candidatures
 * org). La fiche affiche titre, type, statut, description, critères
 * (compétences, séniorité, lieu, modes et temps de travail, durée avec son unité, démarrage), budget.
 *
 * Source : GET /api/publications/[id] (déjà existante, projette le détail
 * complet pour les membres de l'org propriétaire).
 *
 * Actions : "Modifier" (si statut éditable) + "Voir les candidatures"
 * (si statut publié). Pas d'action serveur déclenchée depuis cette page.
 *
 * useDomain pour l'accent (multi-tenant). Mobile-first.
 */

type PublicationDetail = {
  id: string
  type: 'mission' | 'offre' | string
  title: string
  description: string
  branch_id: string | null
  speciality_ids: string[] | null
  speciality_labels: string[] | null
  skills_required: string[] | null
  seniorities: string[] | null
  location_note: string | null
  work_zone_labels: string[] | null
  start_date: string | null
  budget_min: number | null
  budget_max: number | null
  confidential: boolean
  status: string
  verification_score: number | null
  created_at: string
  updated_at: string
  published_at: string | null
} & CriteresAnnonceLus

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; publication: PublicationDetail }

type Props = { params: Promise<{ id: string }> }

const EDITABLE_STATUSES = ['draft', 'suspended', 'archived']

export default function AnnonceDetailPage({ params }: Props) {
  const t = useTranslations('publications.detail_org')
  const tPub = useTranslations('publications')
  const tCrit = useTranslations('criteres')
  const locale = useLocale()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  const [pubId, setPubId] = useState<string | null>(null)
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async (id: string) => {
    setState({ kind: 'loading' })
    try {
      // La locale accompagne la lecture : les libellés de référentiel sont
      // résolus au serveur, traduits, et non pas devinés ici.
      const res = await secureFetch(`/api/publications/${id}?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
      const payload = (await res.json().catch(() => ({} as { code?: string }))) as {
        code?: string
        publication?: PublicationDetail
      }
      if (!res.ok || !payload.publication) {
        setState({
          kind: 'error',
          message: payload.code === 'not_found' ? t('error_not_found') : t('error_generic'),
        })
        return
      }
      setState({ kind: 'ready', publication: payload.publication })
    } catch (err) {
      console.error('[annonce detail] fetch threw', err)
      setState({ kind: 'error', message: t('error_generic') })
    }
  }, [secureFetch, t, locale])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await params
      if (cancelled) return
      setPubId(p.id)
      void load(p.id)
    })()
    return () => { cancelled = true }
  }, [params, load])

  if (state.kind === 'loading') {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sk-muted)' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return (
      <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'var(--sk-red)', marginBottom: 18 }}>{state.message}</p>
      </div>
    )
  }

  const pub = state.publication
  const isEditable = EDITABLE_STATUSES.includes(pub.status)
  const isPublished = pub.status === 'published'

  // LE BUDGET ET LES CRITÈRES, PAR lib/annonces/mise-en-forme.ts (§D.39) : l'unité suit le TYPE d'annonce
  // (`budgetUnitForAnnonce` — « mission → jour, sinon an » rangeait la sous-traitance parmi les salaires), la durée
  // porte son unité, les modes de travail sont multiples.
  const budgetText = estTypeAnnonce(pub.type) ? libelleBudget({ ...pub, type: pub.type }, tPub, locale) : null
  const modesText = libellesModesTravail(pub, tCrit).join(', ')
  const tempsText = libellesTempsTravail(pub, tCrit).join(', ')
  const dureeText = pub.type === 'offre' ? null : libelleDuree(pub, tCrit)

  return (
    <div style={{ padding: '24px 26px 40px', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      {/* En-tête : badge type + titre + statut + actions */}
      <header
        style={{
          background: 'var(--sk-surface)',
          border: '1px solid var(--sk-border)',
          borderRadius: 14,
          padding: '18px 22px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                display: 'inline-flex',
                padding: '4px 10px',
                borderRadius: 999,
                background: `color-mix(in srgb, ${domain.primaryColor} 8%, transparent)`,
                color: domain.primaryColor,
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.06em',
              }}
            >
              {/* Les 3 types de la contrainte BDD ont désormais une clé i18n
                  (mission / offre / sous_traitance). Le repli sur 'mission'
                  affichait « Mission » sur un besoin de sous-traitance : on lit
                  le type tel qu'il est, comme partout ailleurs. */}
              {tPub(`type.${pub.type}` as 'type.mission')}
            </span>
            <span
              style={{
                display: 'inline-flex',
                padding: '4px 10px',
                borderRadius: 999,
                background: 'var(--sk-surface-2)',
                color: 'var(--sk-muted)',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '.06em',
              }}
            >
              {tPub(`status.${pub.status}` as 'status.published')}
            </span>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', margin: 0, letterSpacing: '-0.3px', lineHeight: 1.3 }}>
            {pub.title}
          </h1>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {isEditable && (
            <Link
              href={`/dashboard/entreprise/annonces/${pub.id}/modifier`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 9,
                border: '1px solid var(--sk-border)',
                color: 'var(--sk-text)', textDecoration: 'none',
                fontSize: 13, fontWeight: 600,
                background: 'var(--sk-surface)',
              }}
            >
              ✎ {t('edit_cta')}
            </Link>
          )}
          {isPublished && (
            <Link
              href={`/dashboard/entreprise/annonces/${pub.id}/candidatures`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '9px 14px', borderRadius: 9,
                background: domain.primaryColor,
                color: 'var(--sk-surface)', textDecoration: 'none',
                fontSize: 13, fontWeight: 700,
              }}
            >
              👥 {t('view_candidatures_cta')}
            </Link>
          )}
        </div>
      </header>

      {/* Bloc Description */}
      <section style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 14, padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sk-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
          {t('section_description')}
        </div>
        <div style={{ fontSize: 14, color: 'var(--sk-text)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
          {pub.description || <span style={{ color: 'var(--sk-muted)', fontStyle: 'italic' }}>{t('description_empty')}</span>}
        </div>
      </section>

      {/* Bloc Critères */}
      <section style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 14, padding: '18px 22px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--sk-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14 }}>
          {t('section_criteria')}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          {budgetText && (
            <Field label={t('field_budget')} value={budgetText} />
          )}
          {/* ZONES DE TRAVAIL — le critère qui décide vraiment où l'annonce
              cherche. Il vient AVANT la note de localisation, qui n'est qu'un
              texte d'appoint. */}
          {pub.work_zone_labels && pub.work_zone_labels.length > 0 && (
            <Field label={tPub('form.field_work_zones')} value={pub.work_zone_labels.join(', ')} />
          )}
          {pub.location_note && (
            <Field label={tPub('form.field_location_note')} value={pub.location_note} />
          )}
          {modesText && (
            <Field label={t('field_work_mode')} value={modesText} />
          )}
          {tempsText && (
            <Field label={tCrit('champs.temps_travail')} value={tempsText} />
          )}
          {dureeText && (
            <Field label={t('field_duration')} value={dureeText} />
          )}
          {pub.start_date && (
            <Field label={t('field_start_date')} value={new Date(pub.start_date).toLocaleDateString(locale)} />
          )}
          {pub.seniorities && pub.seniorities.length > 0 && (
            <Field
              label={t('field_seniority')}
              value={pub.seniorities
                .map((s) => tPub(`seniority.${s}` as 'seniority.junior'))
                .join(', ')}
            />
          )}
          {pub.confidential && (
            <Field label={t('field_confidential')} value={t('confidential_yes')} />
          )}
        </div>

        {pub.skills_required && pub.skills_required.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: 'var(--sk-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              {t('field_skills_required')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {pub.skills_required.map((s) => (
                <span
                  key={s}
                  style={{
                    padding: '4px 10px',
                    background: `color-mix(in srgb, ${domain.primaryColor} 8%, transparent)`,
                    color: domain.primaryColor,
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: `1px solid color-mix(in srgb, ${domain.primaryColor} 20%, transparent)`,
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div style={{ fontSize: 11, color: 'var(--sk-muted)', textAlign: 'center' }}>
        {t('footer_pub_id', { id: pub.id })}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--sk-faint)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--sk-text)', fontWeight: 500 }}>{value}</div>
    </div>
  )
}

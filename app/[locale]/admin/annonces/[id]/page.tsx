'use client'

import { use, useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'
import PublicationSynthesisLine from '@/components/dashboard/PublicationSynthesisLine'
import type { PublicationSynthesis } from '@/lib/publication-synthesis'
import { MOTIF_LONGUEUR_MAX } from '@/lib/validation-annonces/motif'
import { libelleChampPubliable } from '@/lib/annonces/formulaire'
import { PUBLICATION_PUBLISHABLE_FIELDS, type PublicationPublishableField } from '@/lib/publications/publishable'

/**
 * /admin/annonces/[id] — LA FICHE D'UNE ANNONCE À VALIDER, ET LA DÉCISION (lot S3), sur le modèle de /admin/experts/[id].
 *
 *   · le CONTENU, mis en forme par les fonctions communes (synthèse servie par la route, <PublicationSynthesisLine>) ;
 *   · POURQUOI elle est en revue : la note de la vérification automatique et ses signalements, EN MOTS — jamais un code
 *     brut ; un code cité dans le commentaire du modèle est remplacé par son libellé ;
 *   · l'AUTEUR et son ORGANISATION ;
 *   · VALIDER (en ligne, la recherche d'experts part, l'auteur est prévenu) ou REFUSER avec un motif (transmis à
 *     l'auteur). Chaque refus du serveur est NOMMÉ.
 */

type Props = { params: Promise<{ id: string }> }

type Payload = {
  annonce: {
    id: string
    status: string
    synthese: PublicationSynthesis
    description: string
    skills_required: string[]
    speciality_other: string | null
    created_at: string
    updated_at: string
    published_at: string | null
    voie: 'automatique' | 'administrateur' | null
    ecosysteme: string | null
  }
  verdict: {
    note: number | null
    signalements: string[]
    bloquants: string[]
    autres: number
    non_aboutie: boolean
    commentaire: string | null
  }
  signalements_connus: string[]
  decision: { par: string | null; le: string | null; motif: string | null }
  auteur: { nom: string | null; email: string | null; user_type: string | null }
  organisation: { nom: string | null; org_type: string | null }
}

type Issue = { genre: 'ok' | 'attention'; texte: string }

const TYPES = ['mission', 'offre', 'sous_traitance'] as const
const TYPES_ORG = ['client', 'cabinet', 'esn', 'freelance'] as const
const STATUTS = ['draft', 'pending_review', 'published', 'suspended', 'expired', 'archived', 'rejected'] as const
// Les refus du serveur que l'écran sait nommer — tout autre code se dit « réponse inattendue », avec son code.
const ERREURS_CONNUES = ['already_processed', 'active_publications_limit_reached', 'active_publications_check_failed',
  'durees_illisibles', 'motif_requis', 'motif_trop_long', 'not_found', 'db_error', 'forbidden',
  // Un besoin de sous-traitance dont l'auteur n'est plus un expert approuvé (relecture ARRÊT 28, point 3), et la lecture
  // de son profil impossible : deux refus distincts.
  'auteur_non_approuve', 'profile_check_unavailable'] as const

function noteCouleur(note: number | null): string {
  if (note == null) return 'var(--sk-muted)'
  if (note < 5) return 'var(--sk-red)'
  if (note < 9) return 'var(--sk-amber)'
  return 'var(--sk-success)'
}

const carte: React.CSSProperties = { background: 'var(--sk-surface)', border: '0.5px solid var(--sk-border)', borderRadius: 14, padding: '16px 18px', marginBottom: 14 }
const titreCarte: React.CSSProperties = { fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-muted)', marginBottom: 10 }
const etiquette: React.CSSProperties = { color: 'var(--sk-muted)', fontSize: 11 }

export default function AdminAnnonceFichePage({ params }: Props) {
  const { id } = use(params)
  const t = useTranslations('validation_annonces')
  const tAdmin = useTranslations('admin_back_office')
  const tCommon = useTranslations('common')
  const tPub = useTranslations('publications')
  const tCrit = useTranslations('criteres')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [busy, setBusy] = useState<'valider' | 'refuser' | null>(null)
  const [showRefus, setShowRefus] = useState(false)
  const [motif, setMotif] = useState('')
  const [motifErreur, setMotifErreur] = useState<string | null>(null)

  const formatDate = (iso: string | null): string => {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
    catch { return iso }
  }
  const libelleSignalement = (code: string) => t(`signalements.${code}`)
  const messageErreur = (code: string | undefined, status: number): string =>
    code && (ERREURS_CONNUES as readonly string[]).includes(code)
      ? t(`erreurs.${code}`)
      : t('erreurs.inattendue', { code: code ?? `HTTP ${status}` })

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await secureFetch(`/api/admin/annonces/${id}?locale=${encodeURIComponent(locale)}`, { method: 'GET' })
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as { code?: string }
        setError(p.code === 'not_found' ? t('erreurs.not_found') : t('erreurs.chargement'))
        return
      }
      setData((await res.json()) as Payload)
    } catch (err) {
      console.error('[admin/annonce] load threw', err)
      setError(t('erreurs.chargement'))
    }
  }, [id, locale, secureFetch, t])

  useEffect(() => { void load() }, [load])

  /** Ce que la décision a fait pour l'auteur — un échec se dit (§D.36). */
  const issueAuteur = (p: { auteur_prevenu?: boolean; auteur_introuvable?: boolean; auteur_illisible?: boolean }): string =>
    p.auteur_illisible ? t('admin.auteur_illisible')
      : p.auteur_introuvable ? t('admin.auteur_introuvable')
      : p.auteur_prevenu ? t('admin.auteur_prevenu') : t('admin.auteur_non_prevenu')

  /**
   * DÉJÀ TRANCHÉE — par un autre onglet, un autre administrateur, ou la seconde de deux validations simultanées (relecture
   * de l'ARRÊT 28, point 6) : la fiche se RECHARGE vraiment (la décision s'affiche, les boutons disparaissent avec le
   * statut), et le message le dit APRÈS le rechargement — `load()` efface les erreurs, il ne doit pas effacer celle-ci.
   */
  const dejaTranchee = async () => {
    setShowRefus(false)
    setMotif('')
    await load()
    setIssue({ genre: 'attention', texte: t('erreurs.already_processed') })
  }

  const valider = async () => {
    setBusy('valider')
    setIssue(null)
    setError(null)
    try {
      const res = await secureFetch(`/api/admin/annonces/${id}/valider`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ site_url: window.location.origin }),
      })
      const p = (await res.json().catch(() => ({}))) as { code?: string; missing?: unknown; auteur_prevenu?: boolean; auteur_introuvable?: boolean; auteur_illisible?: boolean }
      if (!res.ok && p.code === 'already_processed') { await dejaTranchee(); return }
      if (!res.ok) {
        // Une annonce incomplète (une spécialité, le temps de travail…) : les champs sont NOMMÉS, et l'écran dit que
        // c'est à son auteur de la compléter — les mêmes libellés que le formulaire de l'auteur (regroupement, ARRÊT 28).
        const noms = p.code === 'missing_fields' && Array.isArray(p.missing)
          ? p.missing.filter((c): c is PublicationPublishableField =>
            typeof c === 'string' && (PUBLICATION_PUBLISHABLE_FIELDS as readonly string[]).includes(c))
            .map((c) => libelleChampPubliable(c, tPub, tCrit))
          : []
        setError(noms.length > 0 ? t('erreurs.missing_fields', { fields: noms.join(', ') }) : messageErreur(p.code, res.status))
        return
      }
      setIssue({ genre: p.auteur_prevenu ? 'ok' : 'attention', texte: `${t('admin.validee_ok')} ${issueAuteur(p)}` })
      await load()
    } catch (err) {
      console.error('[admin/annonce] valider threw', err)
      setError(t('erreurs.reseau'))
    } finally {
      setBusy(null)
    }
  }

  const refuser = async () => {
    const texte = motif.trim()
    if (!texte) { setMotifErreur(t('erreurs.motif_requis')); return }
    setMotifErreur(null)
    setBusy('refuser')
    setIssue(null)
    setError(null)
    try {
      const res = await secureFetch(`/api/admin/annonces/${id}/refuser`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ motif: texte, site_url: window.location.origin }),
      })
      const p = (await res.json().catch(() => ({}))) as { code?: string; auteur_prevenu?: boolean; auteur_introuvable?: boolean; auteur_illisible?: boolean }
      if (!res.ok && p.code === 'already_processed') { await dejaTranchee(); return }
      if (!res.ok) {
        if (p.code === 'motif_requis' || p.code === 'motif_trop_long') setMotifErreur(messageErreur(p.code, res.status))
        else setError(messageErreur(p.code, res.status))
        return
      }
      setShowRefus(false)
      setMotif('')
      setIssue({ genre: p.auteur_prevenu ? 'ok' : 'attention', texte: `${t('admin.refusee_ok')} ${issueAuteur(p)}` })
      await load()
    } catch (err) {
      console.error('[admin/annonce] refuser threw', err)
      setError(t('erreurs.reseau'))
    } finally {
      setBusy(null)
    }
  }

  if (!data && !error) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--sk-muted)' }}>{t('admin.chargement')}</div>
  }
  if (!data) {
    return <div role="alert" style={{ background: 'var(--sk-red-soft)', color: 'var(--sk-red)', padding: '12px 16px', borderRadius: 10, fontSize: 13 }}>{error}</div>
  }

  const { annonce: a, verdict: v, decision, auteur, organisation } = data
  const s = a.synthese
  const enRevue = a.status === 'pending_review'
  const typeLibelle = (TYPES as readonly string[]).includes(s.type) ? t(`types.${s.type}`) : t('types.autre')
  const orgLibelle = organisation.org_type && (TYPES_ORG as readonly string[]).includes(organisation.org_type)
    ? t(`types_organisation.${organisation.org_type as (typeof TYPES_ORG)[number]}`) : null
  const statutLibelle = (STATUTS as readonly string[]).includes(a.status) ? t(`statuts.${a.status}`) : t('statuts.autre')
  const statutCouleurs = a.status === 'pending_review'
    ? { fond: 'var(--sk-amber-soft)', texte: 'var(--sk-amber)' }
    : a.status === 'published' ? { fond: 'var(--sk-success-soft)', texte: 'var(--sk-success)' }
    : a.status === 'rejected' ? { fond: 'var(--sk-red-soft)', texte: 'var(--sk-red)' }
    : { fond: 'var(--sk-surface-2)', texte: 'var(--sk-muted)' }

  // Le commentaire du modèle cite parfois un signalement par son code (« contact_info ») : il se lit en mots.
  const commentaire = v.commentaire
    ? data.signalements_connus.reduce(
        (txt, code) => txt.split(new RegExp(`['"«]?\\b${code}\\b['"»]?`, 'g')).join(`« ${libelleSignalement(code).toLowerCase()} »`),
        v.commentaire,
      )
    : null

  // POURQUOI ELLE EST (OU ÉTAIT) EN REVUE — une phrase, la plus forte d'abord.
  const pourquoi = v.non_aboutie
    ? t('verdict.non_aboutie')
    : v.bloquants.length > 0
      ? t('verdict.bloquant', { signalements: v.bloquants.map((c) => libelleSignalement(c).toLowerCase()).join(', ') })
      : v.note !== null
        ? t('verdict.note_insuffisante', { note: Math.round(v.note) })
        : t('verdict.non_aboutie')

  const specialites = [...s.speciality_labels, ...(a.speciality_other ? [t('fiche.specialite_autre', { valeur: a.speciality_other })] : [])]

  return (
    <div>
      {error && (
        <div role="alert" style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red-soft)', color: 'var(--sk-red)', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}
      {issue && (
        <div role="status" style={{ background: issue.genre === 'ok' ? 'var(--sk-success-soft)' : 'var(--sk-amber-soft)', color: issue.genre === 'ok' ? 'var(--sk-success)' : 'var(--sk-amber)', padding: '10px 14px', borderRadius: 10, fontSize: 13, marginBottom: 16 }}>{issue.texte}</div>
      )}

      {/* En-tête */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 4 }}>{s.title || '—'}</h1>
            {a.ecosysteme && (
              <span title={tAdmin('ecosystem_label')} style={{ fontSize: 11, fontWeight: 700, color: 'var(--sk-accent)', background: 'var(--sk-accent-soft)', border: '0.5px solid var(--sk-accent-soft)', borderRadius: 7, padding: '2px 9px', whiteSpace: 'nowrap' }}>
                {a.ecosysteme}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: 'var(--sk-muted)' }}>
            {[typeLibelle, organisation.nom, t('fiche.soumise_le', { date: formatDate(a.updated_at) })].filter(Boolean).join(' · ')}
          </div>
        </div>
        <span style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, borderRadius: 12, background: statutCouleurs.fond, color: statutCouleurs.texte, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          {statutLibelle}
        </span>
      </div>

      {/* La vérification automatique, en mots */}
      <section style={carte}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
          <h2 style={{ ...titreCarte, marginBottom: 0 }}>{enRevue ? t('verdict.titre_revue') : t('verdict.titre')}</h2>
          {v.note !== null && (
            <span title={t('admin.note_titre')} style={{ padding: '4px 12px', background: `color-mix(in srgb, ${noteCouleur(v.note)} 10%, transparent)`, color: noteCouleur(v.note), fontSize: 13, fontWeight: 700, borderRadius: 12 }}>
              {Math.round(v.note)}/10
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: 'var(--sk-text)', lineHeight: 1.55, margin: '0 0 10px' }}>{pourquoi}</p>
        {(v.signalements.length > 0 || v.autres > 0) && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ ...etiquette, marginBottom: 6 }}>{t('verdict.signalements')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {v.signalements.map((c) => (
                <span key={c} title={v.bloquants.includes(c) ? t('verdict.bloquant_titre') : undefined} style={{ background: v.bloquants.includes(c) ? 'var(--sk-red-soft)' : 'var(--sk-amber-soft)', color: v.bloquants.includes(c) ? 'var(--sk-red)' : 'var(--sk-amber)', padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                  {libelleSignalement(c)}
                </span>
              ))}
              {v.autres > 0 && (
                <span style={{ background: 'var(--sk-surface-2)', color: 'var(--sk-muted)', padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                  {t('verdict.autres', { count: v.autres })}
                </span>
              )}
            </div>
          </div>
        )}
        {commentaire && (
          <div>
            <div style={{ ...etiquette, marginBottom: 4 }}>{t('verdict.commentaire')}</div>
            <p style={{ fontSize: 13, color: 'var(--sk-text)', lineHeight: 1.55, whiteSpace: 'pre-wrap', margin: 0 }}>{commentaire}</p>
          </div>
        )}
      </section>

      {/* L'auteur et son organisation */}
      <section style={carte}>
        <h2 style={titreCarte}>{t('fiche.titre_auteur')}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 13 }}>
          <div><div style={etiquette}>{t('fiche.auteur')}</div><div>{auteur.nom ?? t('fiche.auteur_inconnu')}</div></div>
          <div><div style={etiquette}>{t('fiche.email')}</div><div>{auteur.email ?? '—'}</div></div>
          <div><div style={etiquette}>{t('fiche.organisation')}</div><div>{organisation.nom ?? '—'}</div></div>
          <div><div style={etiquette}>{t('fiche.type_organisation')}</div><div>{orgLibelle ?? '—'}</div></div>
        </div>
      </section>

      {/* Le contenu, par les fonctions communes de mise en forme */}
      <section style={carte}>
        <h2 style={titreCarte}>{t('fiche.titre_contenu')}</h2>
        <div style={{ marginBottom: 12 }}>
          <PublicationSynthesisLine pub={s} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, fontSize: 13, marginBottom: 12 }}>
          <div><div style={etiquette}>{t('fiche.branche')}</div><div>{s.branch_label ?? '—'}</div></div>
          <div><div style={etiquette}>{t('fiche.specialites')}</div><div>{specialites.join(', ') || '—'}</div></div>
          <div><div style={etiquette}>{t('fiche.zones')}</div><div>{s.work_zone_labels.join(', ') || '—'}</div></div>
          {s.location_note && <div><div style={etiquette}>{t('fiche.precision_lieu')}</div><div>{s.location_note}</div></div>}
        </div>
        {a.skills_required.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ ...etiquette, marginBottom: 6 }}>{t('fiche.competences')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {a.skills_required.map((k) => <span key={k} style={{ background: 'var(--sk-surface-2)', color: 'var(--sk-text)', padding: '3px 9px', borderRadius: 10, fontSize: 11, fontWeight: 500 }}>{k}</span>)}
            </div>
          </div>
        )}
        <div style={{ ...etiquette, marginBottom: 4 }}>{t('fiche.description')}</div>
        <div style={{ fontSize: 13, color: 'var(--sk-text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{a.description || '—'}</div>
      </section>

      {/* La décision passée — ou un refus antérieur, quand l'annonce revient en revue après modification */}
      {a.status === 'rejected' && (
        <section style={{ ...carte, background: 'color-mix(in srgb, var(--sk-red-soft) 19%, transparent)', border: '1px solid var(--sk-red-soft)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-red)', marginBottom: 6 }}>
            {t('fiche.refusee_par', { par: decision.par ?? t('fiche.administrateur'), date: formatDate(decision.le) })}
          </div>
          {decision.motif && <p style={{ fontSize: 13, color: 'var(--sk-text)', whiteSpace: 'pre-wrap', margin: 0 }}>{decision.motif}</p>}
        </section>
      )}
      {a.voie && (
        <section style={{ ...carte, background: 'color-mix(in srgb, var(--sk-success-soft) 19%, transparent)', border: '1px solid var(--sk-success-soft)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--sk-success)' }}>
            {a.voie === 'administrateur'
              ? t('fiche.validee_par', { par: decision.par ?? t('fiche.administrateur'), date: formatDate(decision.le) })
              : t('fiche.en_ligne_automatiquement', { date: formatDate(a.published_at) })}
          </div>
        </section>
      )}
      {a.status !== 'rejected' && decision.motif && (
        <section style={carte}>
          <div style={{ ...etiquette, marginBottom: 4 }}>{t('fiche.refus_anterieur', { date: formatDate(decision.le) })}</div>
          <p style={{ fontSize: 13, color: 'var(--sk-text)', whiteSpace: 'pre-wrap', margin: 0 }}>{decision.motif}</p>
        </section>
      )}

      {/* La décision */}
      {enRevue && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          {!showRefus ? (
            <>
              <button type="button" onClick={() => { setShowRefus(true); setMotifErreur(null) }} disabled={busy !== null} style={{ padding: '10px 18px', background: 'transparent', color: 'var(--sk-muted)', border: '1px solid var(--sk-border)', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>{t('admin.bouton_refuser')}</button>
              <button type="button" onClick={valider} disabled={busy !== null} style={{ padding: '10px 22px', background: 'var(--sk-success)', color: 'var(--sk-surface)', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'valider' ? 0.6 : 1 }}>{busy === 'valider' ? t('admin.validation_en_cours') : t('admin.bouton_valider')}</button>
            </>
          ) : (
            <div style={{ flex: 1, background: 'var(--sk-red-soft)', border: '1.5px solid var(--sk-red-soft)', borderRadius: 12, padding: '14px 16px' }}>
              <label htmlFor="motif-refus" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--sk-red)', marginBottom: 4 }}>{t('admin.refus_titre')}</label>
              <p style={{ fontSize: 12, color: 'var(--sk-text)', margin: '0 0 8px' }}>{t('admin.refus_aide')}</p>
              <textarea
                id="motif-refus"
                value={motif}
                onChange={(ev) => { setMotif(ev.target.value); if (motifErreur) setMotifErreur(null) }}
                placeholder={t('admin.refus_placeholder')}
                maxLength={MOTIF_LONGUEUR_MAX}
                rows={4}
                aria-invalid={motifErreur ? true : undefined}
                aria-describedby="motif-refus-aide"
                autoFocus
                style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${motifErreur ? 'var(--sk-red)' : 'var(--sk-red-soft)'}`, borderRadius: 8, outline: 'none', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 4 }}
              />
              <div id="motif-refus-aide" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11, marginBottom: 10 }}>
                <span role={motifErreur ? 'alert' : undefined} style={{ color: 'var(--sk-red)' }}>{motifErreur ?? ''}</span>
                <span style={{ color: 'var(--sk-muted)' }}>{t('admin.refus_compteur', { n: motif.length, max: MOTIF_LONGUEUR_MAX })}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => { setShowRefus(false); setMotif(''); setMotifErreur(null) }} disabled={busy !== null} style={{ padding: '8px 14px', background: 'transparent', color: 'var(--sk-muted)', border: '1px solid var(--sk-border)', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>{tCommon('cancel')}</button>
                <button type="button" onClick={refuser} disabled={busy !== null} style={{ padding: '8px 14px', background: 'var(--sk-red)', color: 'var(--sk-surface)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy === 'refuser' ? 0.6 : 1 }}>{busy === 'refuser' ? t('admin.refus_en_cours') : t('admin.refus_confirmer')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

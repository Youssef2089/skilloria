'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useDomain } from '@/context/DomainContext'
import WorkZoneSelector from '@/components/ui/WorkZoneSelector'
import type { WorkZone } from '@/lib/work-zones'
import { missingForPublish, type PublicationPublishableField } from '@/lib/publications/publishable'

/**
 * SousTraitanceView — FORMULAIRE de publication d'un BESOIN de sous-traitance
 * entre experts (page /dashboard/{role}/sous-traitance/nouveau).
 *
 * Rendu DANS la coquille dashboard (sidebar + header via le layout). Au montage :
 * lecture des droits de l'offre + verrou « profil non vérifié », AUCUNE
 * écriture — ouvrir le formulaire puis renoncer ne laisse aucune trace. Le
 * formulaire publie un besoin type='sous_traitance' via la MÊME chaîne que les
 * entreprises (POST /api/publications → POST /publish), et c'est ce POST qui
 * crée l'organisation personnelle si elle n'existe pas encore. Les gates
 * commerce de l'offre de collaboration s'appliquent. Quota atteint → mur
 * « Bientôt disponible ».
 *
 * AUCUN CHIFFRE COMMERCIAL EN DUR : le récapitulatif de l'offre (« N
 * publications par mois, N profils dévoilés ») est COMPOSÉ à partir des limites
 * lues au catalogue via GET /api/me/collaboration/quota. Ces valeurs vivaient
 * auparavant en toutes lettres dans messages/{fr,en,es,de}.json — modifier
 * l'offre en back-office ne changeait pas la phrase. Quand les limites ne sont
 * pas lisibles, on n'affiche AUCUN nombre plutôt qu'un nombre faux.
 *
 * `basePath` = base du dashboard courant ('/dashboard/freelance' | '/dashboard/
 * cdi'), pour renvoyer vers la LISTE des besoins après publication.
 *
 * ⚠️ CE FORMULAIRE NE POUVAIT RIEN PUBLIER (lot zones de travail, 02/10/2026) : il n'envoyait ni
 * BRANCHE ni ZONES, et la publication les exige (lib/publications/publishable.ts) — chaque essai
 * était refusé `missing_fields`, l'écran disait « la publication a échoué », et laissait un
 * brouillon de plus. Il porte désormais la branche et les zones, avec LES MÊMES composants que
 * l'annonce d'une organisation (la même liste de branches, le même WorkZoneSelector), vérifie
 * avant d'envoyer avec le MÊME prédicat que le serveur, réutilise son brouillon quand la
 * publication est refusée, et DIT chaque refus — dans les quatre langues, avec les mots de
 * l'annonce d'organisation quand c'est le même refus.
 */

type Phase = 'loading' | 'ready' | 'org_error' | 'published' | 'pending' | 'wall' | 'locked'

/** Le référentiel servi par /api/taxonomy : les branches et les zones, déjà traduites. */
type Referentiel = { branches: Array<{ id: string; name: string }>; work_zones: WorkZone[] }

/** Limites de l'offre effective (null = illimité). */
type QuotaLimits = {
  publicationsPerMonth: number | null
  revealedCandidatesPerPublication: number | null
}

export default function SousTraitanceView({ basePath }: { basePath: string }) {
  const t = useTranslations('collaboration')
  // Les mots de l'annonce d'organisation pour les mêmes champs et les mêmes refus : un vocabulaire.
  const tPub = useTranslations('publications')
  const tCommerce = useTranslations('commerce')
  const secureFetch = useSecureFetch()
  const locale = useLocale()
  const domain = useDomain()

  const [phase, setPhase] = useState<Phase>('loading')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [skills, setSkills] = useState('')
  const [budgetMin, setBudgetMin] = useState('')
  const [budgetMax, setBudgetMax] = useState('')
  const [branchId, setBranchId] = useState('')
  const [workZoneIds, setWorkZoneIds] = useState<string[]>([])
  const [referentiel, setReferentiel] = useState<Referentiel | null>(null)
  const [referentielIllisible, setReferentielIllisible] = useState(false)
  // Les champs qui manquent, nommés sous chacun d'eux (le même prédicat que /publish).
  const [manquants, setManquants] = useState<PublicationPublishableField[]>([])
  // Le brouillon déjà créé : une publication refusée se REPREND sur lui, sans en créer un autre.
  const [brouillonId, setBrouillonId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limits, setLimits] = useState<QuotaLimits | null>(null)
  /**
   * LE VERROU D'ENCAISSEMENT, resolu au SERVEUR.
   *
   * `false` par defaut, et un quota illisible le laisse a `false` : on n'ouvre
   * jamais un chemin de paiement par ignorance. Le mur reste un mur tant que
   * le lancement est gratuit.
   */
  const [billingEnabled, setBillingEnabled] = useState(false)

  // ── Chargement : droits de l'offre + verrou profil ───────────────────────
  //  PLUS DE CRÉATION D'ORGANISATION ICI. Ouvrir le formulaire ne doit rien
  //  écrire en base : l'organisation personnelle naît à la SOUMISSION, dans
  //  POST /api/publications. Un expert qui ouvre le formulaire puis renonce ne
  //  laisse aucune trace.
  //
  //  La route quota porte désormais le verrou « profil non vérifié » et sait
  //  répondre sans organisation (droits de l'offre par défaut, consommation
  //  zéro) — le récapitulatif chiffré est donc juste dès la première visite.
  const ensureOrg = useCallback(async () => {
    setPhase('loading')
    setError(null)
    try {
      const qRes = await secureFetch('/api/me/collaboration/quota', { method: 'GET' })
      if (!qRes.ok) {
        const p = (await qRes.json().catch(() => ({}))) as { code?: string }
        if (p.code === 'profile_not_verified') { setPhase('locked'); return }
        // Autre échec : best-effort, on n'empêche pas la saisie — on retire
        // seulement le récapitulatif chiffré (comportement d'avant ce lot).
        // Mais un quota ILLISIBLE referme le verrou : best-effort sur les droits,
        // jamais sur l’ouverture d’un chemin de paiement (jumeau de DetailView,
        // rétroporté au lot C4a — §E.20).
        setLimits(null)
        setBillingEnabled(false)
        setPhase('ready')
        return
      }
      const q = (await qRes.json().catch(() => null)) as {
        limits?: QuotaLimits
        billing_enabled?: boolean
      } | null
      setLimits(q?.limits ?? null)
      // Le verrou vient de la MÊME lecture que les droits : une requête de plus
      // pour un booléen serait un aller-retour pour rien. Jamais une variable
      // NEXT_PUBLIC_ — le serveur reste seul à décider.
      setBillingEnabled(q?.billing_enabled === true)
      setPhase('ready')
    } catch {
      setPhase('org_error')
    }
  }, [secureFetch])

  useEffect(() => {
    void ensureOrg()
  }, [ensureOrg])

  // ── Le référentiel : les branches et les zones, comme l'annonce d'une organisation ──
  //  Même route, mêmes paramètres que PublicationForm. Illisible, on le DIT : un formulaire sans
  //  branches ni zones ne pourrait rien publier, et l'expert ne saurait pas pourquoi.
  useEffect(() => {
    let annule = false
    if (!domain.id || domain.id === 'default') {
      setReferentielIllisible(true)
      return
    }
    void (async () => {
      try {
        const res = await fetch(
          `/api/taxonomy?locale=${encodeURIComponent(locale)}&domain_id=${encodeURIComponent(domain.id)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) throw new Error(`taxonomy ${res.status}`)
        const data = (await res.json()) as Referentiel
        if (annule) return
        setReferentiel({ branches: data.branches ?? [], work_zones: data.work_zones ?? [] })
        setReferentielIllisible(false)
      } catch {
        if (!annule) setReferentielIllisible(true)
      }
    })()
    return () => { annule = true }
  }, [domain.id, locale])

  const canSubmit = !submitting && phase === 'ready' && referentiel !== null

  /**
   * Récapitulatif de l'offre, COMPOSÉ depuis le catalogue. `null` si les
   * limites n'ont pas pu être lues : on préfère ne rien annoncer plutôt
   * qu'annoncer un chiffre qui ne serait pas celui de l'offre.
   */
  const offerSummary = useMemo(() => {
    if (!limits) return null
    const publications =
      limits.publicationsPerMonth == null
        ? t('offer_publications_unlimited')
        : t('offer_publications', { count: limits.publicationsPerMonth })
    const revealed =
      limits.revealedCandidatesPerPublication == null
        ? t('offer_revealed_unlimited')
        : t('offer_revealed', { count: limits.revealedCandidatesPerPublication })
    return `${publications} ${revealed}`
  }, [limits, t])

  // ── CHAQUE REFUS SE DIT — jamais « la publication a échoué » quand le serveur a nommé la raison ──
  const LIBELLE_CHAMP: Record<PublicationPublishableField, string> = {
    title: tPub('form.field_title'),
    description: tPub('form.field_description'),
    branch_id: tPub('form.field_branch'),
    work_zone_ids: tPub('form.field_work_zones'),
  }
  const champsManquants = (liste: unknown): string | null => {
    if (!Array.isArray(liste) || liste.length === 0) return null
    const noms = liste.map((c) => LIBELLE_CHAMP[c as PublicationPublishableField]).filter(Boolean)
    return noms.length > 0 ? tPub('errors.missing_fields', { fields: noms.join(', ') }) : null
  }
  const messageDuRefus = (code: string | undefined, repli: string): string => {
    switch (code) {
      case 'invalid_title': return tPub('errors.invalid_title')
      case 'invalid_description': return tPub('errors.invalid_description')
      case 'invalid_budget': return tPub('errors.invalid_budget')
      case 'budget_inverted': return tPub('errors.budget_inverted')
      case 'bad_work_zone': return tPub('form.field_errors.work_zone_ids')
      case 'wrong_status': return tPub('errors.wrong_status')
      case 'verification_failed': return tPub('errors.verification_failed')
      // PAYS ABSENT ≠ ÉCHEC D'ENREGISTREMENT : l'espace de collaboration reprend l'adresse du profil.
      case 'expert_country_missing': return t('errors.expert_country_missing')
      case 'profile_not_verified': return t('errors.profile_not_verified')
      // LE COMPTE ILLISIBLE n'est pas un refus, et l'OFFRE ABSENTE n'est pas une faute de saisie (relecture du 02/10/2026) :
      // tous deux tombaient sur « vérifiez les champs ».
      case 'compte_verification_indisponible': return t('errors.compte_illisible')
      case 'package_missing': return t('errors.offre_indisponible')
      // Une session expirée n'est pas une panne de notre côté : useSecureFetch n'intercepte que la session remplacée.
      case 'no_token':
      case 'invalid_token': return t('errors.session_expiree')
      // MÊME FAMILLE, AUTRE LECTURE : une garde qui n'a pas pu LIRE n'a pas rendu de verdict (§E.22).
      case 'profile_check_unavailable': return t('errors.profile_check_failed')
      // PANNE DE VÉRIFICATION ≠ MUR PAYANT : le décompte n'a pas pu se faire.
      case 'active_publications_check_failed': return t('errors.publish_check_failed')
      case 'durees_illisibles': return t('errors.durees_illisibles')
      default: return repli
    }
  }

  async function publish() {
    if (!canSubmit) return
    setError(null)
    // LE MÊME PRÉDICAT QUE LE SERVEUR (lib/publications/publishable.ts), avant d'envoyer : les champs qui
    // manquent sont NOMMÉS sous chacun d'eux, et rien ne part.
    const manque = missingForPublish({ title, description, branch_id: branchId || null, work_zone_ids: workZoneIds })
    setManquants(manque)
    if (manque.length > 0) {
      setError(champsManquants(manque))
      return
    }
    const titre = title.trim()
    const texte = description.trim()
    if (titre.length < 5 || titre.length > 200) { setError(tPub('errors.invalid_title')); return }
    if (texte.length < 20 || texte.length > 10_000) { setError(tPub('errors.invalid_description')); return }
    setSubmitting(true)
    try {
      // Les zones partent en CODES stables, jamais en uuid : le serveur résout et refuse un code inconnu.
      const workZoneCodes = workZoneIds
        .map((id) => referentiel?.work_zones.find((z) => z.id === id)?.code)
        .filter((c): c is string => !!c)
      const champs = {
        title: titre,
        description: texte,
        skills_required: skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        budget_min: budgetMin.trim() === '' ? null : Number(budgetMin.trim()),
        budget_max: budgetMax.trim() === '' ? null : Number(budgetMax.trim()),
        branch_id: branchId,
        work_zone_codes: workZoneCodes,
      }

      // 1. Le brouillon (type sous_traitance ; domaine implicite = celui de l'expert). Déjà créé par un essai
      //    refusé : on le MET À JOUR, on n'en crée pas un second.
      let id = brouillonId
      const draftRes = id
        ? await secureFetch(`/api/publications/${id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(champs),
          })
        : await secureFetch('/api/publications', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'sous_traitance', ...champs }),
          })
      const draft = (await draftRes.json().catch(() => ({}))) as { id?: string; code?: string }
      if (!draftRes.ok || (!id && !draft.id)) {
        setError(messageDuRefus(draft.code, t('errors.create_failed')))
        return
      }
      id = id ?? (draft.id as string)
      setBrouillonId(id)

      // 2. Publication (gates commerce du package collaboration appliqués ici).
      const pubRes = await secureFetch(`/api/publications/${id}/publish`, {
        method: 'POST',
        headers: { 'x-locale': locale },
      })
      const pub = (await pubRes.json().catch(() => ({}))) as { code?: string; status?: string; missing?: unknown }
      if (!pubRes.ok) {
        // Mur payant (quota atteint) → « Bientôt disponible ».
        if (pub.code === 'quota_publications_reached' || pub.code === 'active_publications_limit_reached') {
          setPhase('wall')
          return
        }
        // Un refus de publiabilité NOMME ses champs : on les dit, sous le formulaire et sous chacun d'eux.
        if (pub.code === 'missing_fields' && Array.isArray(pub.missing)) {
          setManquants(pub.missing.filter((c): c is PublicationPublishableField => c in LIBELLE_CHAMP))
          setError(champsManquants(pub.missing) ?? t('errors.publish_failed'))
          return
        }
        setError(messageDuRefus(pub.code, t('errors.publish_failed')))
        return
      }
      // Une publication relue avant sa mise en ligne n'est PAS en ligne : l'écran le dit.
      setPhase(pub.status === 'pending_review' ? 'pending' : 'published')
    } catch {
      setError(t('errors.publish_failed'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Styles (pattern dashboard, pleine largeur gauche) ────────────────────
  const card: React.CSSProperties = {
    background: 'var(--sk-surface)',
    border: '1px solid var(--sk-border)',
    borderRadius: 16,
    padding: 24,
    maxWidth: 640,
  }
  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--sk-muted)',
    marginBottom: 6,
  }
  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: 14,
    border: '1px solid var(--sk-border)',
    borderRadius: 10,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    color: 'var(--sk-text)',
    background: 'var(--sk-surface)',
  }

  const header = (
    <div style={{ marginBottom: 20 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--sk-text)', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
        {t('page_title')}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--sk-muted)', margin: 0, maxWidth: 640 }}>{t('page_subtitle')}</p>
    </div>
  )

  return (
    <div style={{ padding: '24px 24px 56px', width: '100%' }}>
      {header}

      {phase === 'loading' && (
        <div style={{ ...card, color: 'var(--sk-muted)', fontSize: 14 }}>{t('loading')}</div>
      )}

      {phase === 'org_error' && (
        <div style={{ ...card, borderColor: 'var(--sk-red-soft)', background: 'var(--sk-red-soft)' }}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--sk-red)' }}>{t('errors.org_unavailable')}</p>
          <button type="button" onClick={() => void ensureOrg()} style={btn('var(--sk-accent)')}>
            {t('retry')}
          </button>
        </div>
      )}

      {phase === 'locked' && (
        <div style={{ ...card, borderColor: 'var(--sk-amber-soft)', background: 'var(--sk-amber-soft)' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }} aria-hidden>🔒</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--sk-amber)' }}>{t('list.locked_title')}</h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--sk-amber)', lineHeight: 1.6 }}>{t('list.locked_body')}</p>
        </div>
      )}

      {phase === 'published' && (
        <div style={{ ...card, borderColor: 'var(--sk-success-soft)', background: 'var(--sk-success-soft)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>✅</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--sk-success)' }}>{t('published_title')}</h2>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--sk-success)', lineHeight: 1.55 }}>{t('published_body')}</p>
          <Link
            href={`${basePath}/sous-traitance`}
            style={{ display: 'inline-flex', padding: '10px 16px', background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', borderRadius: 10, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}
          >
            {t('published_cta')}
          </Link>
        </div>
      )}

      {phase === 'pending' && (
        <div style={{ ...card, borderColor: 'var(--sk-amber-soft)', background: 'var(--sk-amber-soft)' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--sk-amber)' }}>{t('pending_title')}</h2>
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--sk-amber)', lineHeight: 1.55 }}>{t('pending_body')}</p>
          <Link
            href={`${basePath}/sous-traitance`}
            style={{ display: 'inline-flex', padding: '10px 16px', background: 'var(--sk-accent)', color: 'var(--sk-sur-accent)', borderRadius: 10, fontSize: 13.5, fontWeight: 700, textDecoration: 'none' }}
          >
            {t('published_cta')}
          </Link>
        </div>
      )}

      {phase === 'wall' && (
        <div style={{ ...card, borderColor: 'var(--sk-amber-soft)', background: 'var(--sk-amber-soft)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }} aria-hidden>🔒</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--sk-amber)' }}>{t('wall_title')}</h2>
          <p style={{ margin: '0 0 6px', fontSize: 14, color: 'var(--sk-amber)', lineHeight: 1.55 }}>{t('wall_body')}</p>
          {/* L'issue depend du VERROU, pas d'une phrase figee : « contactez-nous »
              tant qu'il est ferme, « decouvrez nos offres » le jour ou il s'ouvre.
              Ferme par defaut — un quota illisible n'ouvre aucun chemin. */}
          <p style={{ margin: 0, fontSize: 13, color: 'var(--sk-amber)' }}>
            {billingEnabled ? tCommerce('need_more_upgrade') : tCommerce('need_more_contact')}
          </p>
        </div>
      )}

      {phase === 'ready' && (
        <div style={card}>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="st_title" style={labelStyle}>{t('form.title_label')} *</label>
            <input id="st_title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={t('form.title_placeholder')} style={inputStyle} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="st_desc" style={labelStyle}>{t('form.description_label')} *</label>
            <textarea id="st_desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10_000} rows={6} placeholder={t('form.description_placeholder')} style={{ ...inputStyle, resize: 'vertical' }} />
            <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '6px 0 0' }}>{t('form.description_hint')}</p>
          </div>
          {/* LA BRANCHE ET LES ZONES — exigées pour publier, comme pour l'annonce d'une organisation, avec
              les mêmes composants. Sans elles, ce formulaire ne pouvait rien publier (lot zones de travail). */}
          {referentielIllisible ? (
            <div role="alert" style={{ padding: '10px 14px', background: 'var(--sk-red-soft)', color: 'var(--sk-red)', fontSize: 13, borderRadius: 10, marginBottom: 16 }}>
              {t('errors.taxonomie_indisponible')}
            </div>
          ) : null}
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="st_branch" style={labelStyle}>{tPub('form.field_branch')} *</label>
            <select
              id="st_branch"
              value={branchId}
              onChange={(e) => { setBranchId(e.target.value); setManquants((m) => m.filter((c) => c !== 'branch_id')) }}
              disabled={!referentiel}
              aria-invalid={manquants.includes('branch_id')}
              style={{ ...inputStyle, ...(manquants.includes('branch_id') ? { border: '1.5px solid var(--sk-red)' } : null) }}
            >
              <option value="">{tPub('form.field_branch_placeholder')}</option>
              {(referentiel?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            {manquants.includes('branch_id') ? (
              <p style={{ fontSize: 12, color: 'var(--sk-red)', margin: '6px 0 0' }}>{tPub('form.field_errors.branch_id')}</p>
            ) : null}
          </div>
          <div style={{ marginBottom: 16 }}>
            <span style={labelStyle}>{tPub('form.field_work_zones')} *</span>
            <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '0 0 8px' }}>{tPub('form.field_work_zones_help')}</p>
            <WorkZoneSelector
              zones={referentiel?.work_zones ?? []}
              selected={workZoneIds}
              onChange={(next) => { setWorkZoneIds(next); setManquants((m) => m.filter((c) => c !== 'work_zone_ids')) }}
              invalid={manquants.includes('work_zone_ids')}
            />
            {manquants.includes('work_zone_ids') ? (
              <p style={{ fontSize: 12, color: 'var(--sk-red)', margin: '6px 0 0' }}>{tPub('form.field_errors.work_zone_ids')}</p>
            ) : null}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="st_skills" style={labelStyle}>{t('form.skills_label')}</label>
            <input id="st_skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder={t('form.skills_placeholder')} style={inputStyle} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
            <div>
              <label htmlFor="st_bmin" style={labelStyle}>{t('form.budget_min_label')}</label>
              <input id="st_bmin" type="number" min={0} inputMode="numeric" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} placeholder={t('form.budget_placeholder')} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="st_bmax" style={labelStyle}>{t('form.budget_max_label')}</label>
              <input id="st_bmax" type="number" min={0} inputMode="numeric" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} placeholder={t('form.budget_placeholder')} style={inputStyle} />
            </div>
          </div>

          {error && (
            <div role="alert" style={{ padding: '10px 14px', background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red-soft)', color: 'var(--sk-red)', fontSize: 13, borderRadius: 10, marginBottom: 14 }}>
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => void publish()}
            disabled={!canSubmit}
            style={{ ...btn('var(--sk-accent)'), opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
          >
            {submitting ? t('form.submitting') : t('form.submit')}
          </button>
          {/* Récapitulatif chiffré de l'offre, juste avant l'action. Alimenté
              par le catalogue — jamais écrit en dur dans les traductions. */}
          {offerSummary && (
            <p style={{ fontSize: 12, color: 'var(--sk-muted)', margin: '12px 0 0' }}>{offerSummary}</p>
          )}
        </div>
      )}
    </div>
  )
}

function btn(color: string): React.CSSProperties {
  return {
    padding: '11px 18px',
    background: color,
    color: 'var(--sk-sur-accent)',
    border: 'none',
    borderRadius: 10,
    fontSize: 14,
    fontWeight: 700,
    fontFamily: 'inherit',
    cursor: 'pointer',
  }
}

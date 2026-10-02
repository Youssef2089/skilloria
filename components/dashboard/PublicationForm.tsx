'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { useDomain } from '@/context/DomainContext'
import { useSecureFetch } from '@/lib/secure-fetch'
import type { PublicationDraft } from '@/types/publication'
import type { AnnonceType } from '@/types/annonce'
import ChampsAnnonce, { type ReferentielAnnonce } from '@/components/annonces/ChampsAnnonce'
import { specialitesGardees } from '@/lib/criteres/specialites'
import {
  VALEURS_VIDES,
  corpsDeRequete,
  erreursDeSaisie,
  libelleChampPubliable,
  messageDeRefusCommun,
  messagesDeSaisie,
  valeursDepuisBrouillon,
  type ChampAnnonce,
  type ValeursAnnonce,
} from '@/lib/annonces/formulaire'
import type { PublicationPublishableField } from '@/lib/publications/publishable'

/**
 * Formulaire de création + édition d'une publication.
 *
 * Mode 'create' :
 *   - State vide ; SAVE → POST /api/publications → récupère l'id → reste sur
 *     /annonces/nouvelle avec un toast "brouillon enregistré" + bouton Publier
 *     activé. Optionnellement on peut migrer l'URL vers /annonces/[id]/modifier
 *     pour que F5 charge l'état (non implémenté V1 — l'utilisateur revient
 *     toujours via la liste).
 *   - PUBLISH → SAVE puis POST /api/publications/[id]/publish.
 *
 * Mode 'edit' :
 *   - Pré-rempli depuis prop `initial`.
 *   - SAVE → PATCH. PUBLISH → PATCH puis POST publish (id déjà connu).
 *
 * LES CHAMPS VIVENT DANS components/annonces/ChampsAnnonce.tsx (lot « critères des annonces », 03/10/2026, §D.39) :
 * le besoin de sous-traitance rend LE MÊME composant — exactement les mêmes champs (décision de Youssef). Ce fichier ne
 * garde que ce qui est propre à l'annonce d'une organisation : le choix du type, l'enregistrement du brouillon, la
 * confirmation et l'écran de résultat de la publication. L'état, la validation et le corps de requête vivent dans
 * lib/annonces/formulaire.ts, partagés avec le besoin de sous-traitance.
 *
 * Sécurité :
 *   - Le client n'envoie JAMAIS `status` dans son body POST/PATCH.
 *   - La publication passe TOUJOURS par /publish (gate non contournable).
 *   - Si publish échoue après save : brouillon préservé, erreur affichée,
 *     l'utilisateur peut réessayer sans perdre sa saisie.
 */

// ── Types props + state ──────────────────────────────────────────────────────

type Props =
  | { mode: 'create' }
  | { mode: 'edit'; initial: PublicationDraft }

type TaxonomyResponse = ReferentielAnnonce & { locale: string }

type PublishOutcome =
  | { kind: 'published'; score: number }
  | { kind: 'pending_review'; score: number }

/**
 * Les refus qui viennent d'une LIMITE D'OFFRE, et non d'une saisie fautive.
 *
 * Ils se traitent autrement : le formulaire ne peut rien y corriger, et
 * l'utilisateur a besoin d'une issue, pas d'un champ à reprendre. D'où un ton
 * distinct (ambre, pas rouge) et une ligne d'appel à l'action.
 */
const LIMITES_COMMERCE = new Set(['quota_publications_reached', 'active_publications_limit_reached'])

// ── Component ────────────────────────────────────────────────────────────────

export default function PublicationForm(props: Props) {
  const t = useTranslations('publications')
  const tStatus = useTranslations('publications.status')
  const tCommerce = useTranslations('commerce')
  const tCrit = useTranslations('criteres')
  const locale = useLocale()
  const router = useRouter()
  const domain = useDomain()
  const secureFetch = useSecureFetch()

  /**
   * LA VIE D'UNE ANNONCE, LUE PAR LE SERVEUR — jamais supposée ici.
   *
   * Ce composant annonçait « visible jusqu'au … » à partir d'une constante
   * compilée dans le bundle. Depuis que la durée est réglable, cette constante
   * aurait dit 30 jours pendant que le serveur en appliquait 20 — un chiffre
   * faux annoncé à la seconde exacte où l'organisation s'engage.
   *
   * `null` tant qu'on ne sait pas, et `null` si la lecture échoue. La phrase
   * n'est alors PAS affichée : mieux vaut ne rien promettre que promettre une
   * date fausse. Aucun repli à 30, nulle part.
   */
  const [vieAnnonceJours, setVieAnnonceJours] = useState<number | null>(null)

  const isEdit = props.mode === 'edit'
  const initialStatus = isEdit ? props.initial.status : 'draft'

  const [type, setType] = useState<AnnonceType>(isEdit ? props.initial.type : 'mission')
  const [form, setForm] = useState<ValeursAnnonce>(isEdit ? valeursDepuisBrouillon(props.initial) : VALEURS_VIDES)
  const [pubId, setPubId] = useState<string | null>(isEdit ? props.initial.id : null)
  const [status, setStatus] = useState(initialStatus)

  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null)
  const [taxonomyError, setTaxonomyError] = useState(false)

  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  /**
   * Le code du dernier refus, gardé À CÔTÉ du message.
   *
   * Un refus COMMERCE n'appelle pas la même chose qu'un refus de saisie : il ne
   * se corrige pas dans le formulaire, il se lève par une action hors de
   * l'écran. On garde donc le code pour savoir s'il faut ajouter cette issue —
   * plutôt que de la coller au message, qui se retrouverait à porter un appel
   * à l'action même sur « titre invalide ».
   */
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ChampAnnonce, string>>>({})

  // ── Charger taxonomie ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!domain.id || domain.id === 'default') {
      setTaxonomyError(true)
      return
    }
    const load = async () => {
      try {
        const res = await fetch(
          `/api/taxonomy?locale=${encodeURIComponent(locale)}&domain_id=${encodeURIComponent(domain.id)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) throw new Error(`taxonomy ${res.status}`)
        const data = (await res.json()) as TaxonomyResponse
        if (cancelled) return
        setTaxonomy(data)
      } catch (err) {
        if (cancelled) return
        console.error('[PublicationForm] taxonomy load failed', err)
        setTaxonomyError(true)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [domain.id, locale])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await secureFetch('/api/durees', { cache: 'no-store' })
        if (!res.ok) throw new Error(`durees ${res.status}`)
        const data = (await res.json()) as { vie_annonce_jours?: number }
        if (cancelled) return
        const v = data.vie_annonce_jours
        setVieAnnonceJours(typeof v === 'number' && Number.isFinite(v) ? v : null)
      } catch (err) {
        if (cancelled) return
        // On JOURNALISE et on laisse `null` : l'écran perd une phrase, il ne
        // gagne pas une date inventée.
        console.error('[PublicationForm] durées non lues — la date d expiration ne sera pas annoncée', err)
        setVieAnnonceJours(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [secureFetch])

  // Au changement de branche, seules les spécialités devenues hors branche
  // partent — on ne vide pas TOUTE la sélection, ce qui obligerait à tout
  // ressaisir pour une seule. « Autre » n'est rattachée à aucune branche : elle
  // survit toujours.
  useEffect(() => {
    if (!taxonomy) return
    setForm((p) => {
      const gardees = specialitesGardees(p.speciality_ids, taxonomy.specialities, p.branch_id)
      return gardees.length === p.speciality_ids.length ? p : { ...p, speciality_ids: gardees }
    })
  }, [form.branch_id, taxonomy])

  const setField = useCallback(<K extends keyof ValeursAnnonce>(k: K, v: ValeursAnnonce[K]) => {
    setForm((p) => ({ ...p, [k]: v }))
    setFieldErrors((e) => ({
      ...e,
      [k]: undefined,
      ...(k === 'jours_sur_site' || k === 'jours_teletravail' || k === 'work_modes' ? { repartition_hybride: undefined } : null),
      ...(k === 'duree_valeur' || k === 'duree_unite' ? { duree: undefined } : null),
    }))
  }, [])

  // ── Validation client (le prédicat du serveur, plus les bornes fines) ──
  //  SOURCE UNIQUE : lib/annonces/formulaire.ts — la même que le besoin de sous-traitance.
  const validate = (state: ValeursAnnonce): boolean => {
    const erreurs = erreursDeSaisie(state, type)
    setFieldErrors(messagesDeSaisie(erreurs, t, tCrit))
    return Object.keys(erreurs).length === 0
  }

  // ── Codes d'erreur API → libellé ───────────────────────────────────────
  const apiErrorMessage = (code: string | undefined): string => {
    // Les refus communs aux deux écrans (saisie, critères, statut) : lib/annonces/formulaire.ts.
    const commun = messageDeRefusCommun(code, t, tCrit)
    if (commun) return commun
    const known: Record<string, string> = {
      org_required: t('errors.org_required'),
      // ── Refus COMMERCE (402) ────────────────────────────────────────────
      //  Ils manquaient à cette table, et le serveur les nomme pourtant depuis
      //  toujours : l'organisation qui butait sur son quota lisait « une erreur
      //  est survenue », sans savoir ni ce qui bloquait ni quoi faire. Le
      //  message dit maintenant les deux — la limite ATTEINTE, et le geste qui
      //  débloque : attendre le 1er du mois, ou clôturer une annonce.
      //
      //  Les VALEURS ne sont jamais citées : elles vivent au catalogue, et les
      //  écrire ici les figerait au moment où on les recopie.
      quota_publications_reached: t('errors.quota_publications_reached'),
      active_publications_limit_reached: t('errors.active_publications_limit_reached'),
      //  DISTINCT de la limite atteinte, et ce n'est pas un détail : ici le
      //  serveur n'a PAS PU compter. Annoncer « offre pleine » serait un
      //  mensonge, et l'organisation clôturerait une annonce pour rien.
      active_publications_check_failed: t('errors.active_publications_check_failed'),
      db_error: t('errors.db_error'),
    }
    // Un code que l'écran ne connaît pas se NOMME, plutôt qu'« une erreur est survenue ».
    return (code && known[code]) ?? tCrit('erreurs.refus_inconnu', { code: code ?? '—' })
  }

  /**
   * Refus NOMMÉ de /publish. Le serveur rend la LISTE des champs qui bloquent ;
   * on la rend lisible plutôt que d'afficher « une erreur est survenue ».
   *
   * Sans cela, l'organisation lisait `db_error` — la contrainte de base violée —
   * pour une annonce à laquelle il manquait simplement une zone.
   */
  const messageChampsManquants = (missing: unknown): string | null => {
    if (!Array.isArray(missing) || missing.length === 0) return null
    const noms = missing
      .filter((m): m is PublicationPublishableField => typeof m === 'string')
      .map((m) => libelleChampPubliable(m, t, tCrit))
      .filter(Boolean)
    if (noms.length === 0) return null
    return t('errors.missing_fields', { fields: noms.join(', ') })
  }

  // ── Save (POST si create / PATCH si edit) ──────────────────────────────
  const saveDraft = async (state: ValeursAnnonce): Promise<{ ok: true; id: string } | { ok: false }> => {
    const isCreating = pubId == null
    const url = isCreating ? '/api/publications' : `/api/publications/${pubId}`
    const method = isCreating ? 'POST' : 'PATCH'
    // Jamais de `status` envoyé ; le type seulement à la création (il est immuable).
    const corps = corpsDeRequete(state, type, (id) => taxonomy?.work_zones.find((z) => z.id === id)?.code)
    const body = isCreating ? { ...corps, type } : corps
    const res = await secureFetch(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => ({} as { code?: string; id?: string; status?: string })))
    if (!res.ok) {
      setErrorMsg(apiErrorMessage(payload.code))
      setErrorCode(payload.code ?? null)
      return { ok: false }
    }
    const newId = (payload.id as string | undefined) ?? pubId
    if (!newId) {
      setErrorMsg(tCrit('erreurs.reponse_sans_identifiant'))
      return { ok: false }
    }
    if (isCreating) setPubId(newId)
    if (payload.status) setStatus(payload.status as typeof status)
    return { ok: true, id: newId }
  }

  // ── Handler boutons ────────────────────────────────────────────────────
  const handleSaveDraft = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setErrorCode(null)
    setSuccessMsg(null)
    if (!validate(form)) {
      setErrorMsg(tCrit('erreurs.corriger_les_champs'))
      return
    }
    if (saving) return
    setSaving(true)
    // saveDraft appelle secureFetch sans catch : une exception réseau laissait
    // « enregistrement… » pour toujours. Le finally relâche, le catch dit.
    try {
      const res = await saveDraft(form)
      if (res.ok) {
        setSuccessMsg(isEdit ? t('form.success_draft_updated') : t('form.success_draft_created'))
      }
    } catch (err) {
      console.error('[PublicationForm] saveDraft threw', err)
      setErrorMsg(tCrit('erreurs.reseau'))
    } finally {
      setSaving(false)
    }
  }

  const openConfirmPublish = (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setErrorCode(null)
    setSuccessMsg(null)
    if (!validate(form)) {
      setErrorMsg(tCrit('erreurs.corriger_les_champs'))
      return
    }
    setConfirmOpen(true)
  }

  const handlePublish = async () => {
    if (publishing) return
    setConfirmOpen(false)
    setErrorMsg(null)
    setErrorCode(null)
    setSuccessMsg(null)
    setPublishing(true)
    try {
      // 1. Save first — DANS le try : saveDraft peut lever, et le finally relâche.
      const saveRes = await saveDraft(form)
      if (!saveRes.ok) return
      // 2. Then publish
      const res = await secureFetch(`/api/publications/${saveRes.id}/publish`, {
        method: 'POST',
        headers: { 'x-locale': locale },
      })
      const payload = (await res.json().catch(() => ({} as { code?: string; status?: string; score?: number; missing?: unknown })))
      if (!res.ok) {
        // Un refus de publiabilité NOMME ses champs ; les autres codes gardent
        // leur message. Dire « une erreur est survenue » pour une zone
        // manquante laisse l'organisation sans rien à corriger.
        setErrorMsg(messageChampsManquants(payload.missing) ?? apiErrorMessage(payload.code))
        setErrorCode(payload.code ?? null)
        return
      }
      const finalStatus = payload.status === 'published' ? 'published' : 'pending_review'
      const score = typeof payload.score === 'number' ? payload.score : 0
      setStatus(finalStatus)
      setOutcome({ kind: finalStatus, score })
    } catch (err) {
      console.error('[PublicationForm] publish threw', err)
      setErrorMsg(t('errors.verification_failed'))
    } finally {
      setPublishing(false)
    }
  }

  function radioPill(active: boolean): React.CSSProperties {
    return {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      minHeight: 44,
      padding: '10px 16px',
      border: `1.5px solid ${active ? domain.primaryColor : 'var(--sk-border)'}`,
      borderRadius: 10,
      background: active ? `color-mix(in srgb, ${domain.primaryColor} 6%, transparent)` : 'var(--sk-surface)',
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: 600,
      color: active ? domain.primaryColor : 'var(--sk-muted)',
      userSelect: 'none',
      boxSizing: 'border-box',
    }
  }

  const formId = 'sk-publication-form'
  const canPublish = status === 'draft' && !publishing
  const headerTitle = isEdit ? t('form.title_edit') : t('form.title_create')

  // ── Outcome (écran résultat post-publish) ──────────────────────────────
  if (outcome) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div
          style={{
            background: outcome.kind === 'published' ? 'var(--sk-success-soft)' : 'var(--sk-amber-soft)',
            border: `1px solid ${outcome.kind === 'published' ? 'var(--sk-success-soft)' : 'var(--sk-amber-soft)'}`,
            borderRadius: 16,
            padding: '36px 28px',
            marginBottom: 24,
          }}
        >
          <div
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: outcome.kind === 'published' ? 'var(--sk-success)' : 'var(--sk-amber)',
              marginBottom: 8,
            }}
          >
            {outcome.kind === 'published' ? t('gate.published_title') : t('gate.pending_title')}
          </div>
          <div style={{ fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.6, marginBottom: 16 }}>
            {outcome.kind === 'published' ? t('gate.published_body') : t('gate.pending_body')}
          </div>
          <div style={{ fontSize: 13, color: 'var(--sk-muted)' }}>
            {t('gate.score_label', { score: Math.round(outcome.score) })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push('/dashboard/entreprise')}
          style={{
            padding: '12px 22px',
            background: domain.primaryColor,
            color: 'var(--sk-surface)',
            border: 'none',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {t('form.button_back_to_list')}
        </button>
      </div>
    )
  }

  // ── Form principal ─────────────────────────────────────────────────────
  //  PLEINE LARGEUR (règle commune) : le formulaire occupe la largeur de la page ; ses grilles se replient.
  return (
    <div style={{ width: '100%', padding: '24px 26px 40px', fontFamily: 'inherit', boxSizing: 'border-box' }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 6, letterSpacing: '-0.3px' }}>
        {headerTitle}
      </h1>
      <p style={{ fontSize: 14, color: 'var(--sk-muted)', marginBottom: 24, lineHeight: 1.55 }}>
        {t('form.subtitle')}
      </p>

      {taxonomyError && (
        <div role="alert" style={{ background: 'var(--sk-red-soft)', border: '1px solid var(--sk-red-soft)', color: 'var(--sk-red)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          {tCrit('erreurs.referentiel_indisponible')}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          style={{
            background: LIMITES_COMMERCE.has(errorCode ?? '') ? 'var(--sk-amber-soft)' : 'var(--sk-red-soft)',
            border: `1px solid ${LIMITES_COMMERCE.has(errorCode ?? '') ? 'var(--sk-amber-soft)' : 'var(--sk-red-soft)'}`,
            color: LIMITES_COMMERCE.has(errorCode ?? '') ? 'var(--sk-amber)' : 'var(--sk-red)',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 18,
            lineHeight: 1.55,
          }}
        >
          {errorMsg}
          {/* Une limite d'offre n'est pas une panne : elle se distingue en ambre,
              et elle porte l'issue qui reste quand le formulaire ne peut rien
              corriger. Aucun bouton de paiement — le verrou est fermé. */}
          {LIMITES_COMMERCE.has(errorCode ?? '') && (
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: 'var(--sk-amber)' }}>
              {tCommerce('need_more_contact')}
            </p>
          )}
        </div>
      )}

      {successMsg && (
        <div role="status" style={{ background: 'var(--sk-success-soft)', border: '1px solid var(--sk-success-soft)', color: 'var(--sk-success)', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 18 }}>
          {successMsg}
        </div>
      )}

      <form id={formId} onSubmit={handleSaveDraft}>
        {/* Le TYPE — radio pills, immuable en édition. Le seul champ propre à l'annonce d'une organisation. */}
        <div style={{ background: 'var(--sk-surface)', border: '1px solid var(--sk-border)', borderRadius: 14, padding: '22px 24px', marginBottom: 18 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--sk-text)', marginBottom: 6 }}>{t('form.field_type')} *</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['mission', 'offre'] as const).map((tp) => {
              const active = type === tp
              const disabled = isEdit  // le type est immuable côté API
              return (
                <label
                  key={tp}
                  style={{
                    ...radioPill(active),
                    opacity: disabled ? 0.5 : 1,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="type"
                    value={tp}
                    checked={active}
                    onChange={() => !disabled && setType(tp)}
                    disabled={disabled}
                    style={{ display: 'none' }}
                  />
                  {t(`type.${tp}`)}
                </label>
              )
            })}
          </div>
        </div>

        {/* LES CHAMPS — exactement ceux du besoin de sous-traitance (un composant, §D.39). */}
        <ChampsAnnonce type={type} valeurs={form} changer={setField} erreurs={fieldErrors} referentiel={taxonomy} />

        {/* Boutons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 28 }}>
          <button
            type="submit"
            disabled={saving || publishing}
            style={{
              padding: '12px 22px',
              background: 'var(--sk-surface)',
              color: domain.primaryColor,
              border: `1.5px solid ${domain.primaryColor}`,
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: saving || publishing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: saving || publishing ? 0.5 : 1,
            }}
          >
            {saving ? t('form.button_save_draft_loading') : t('form.button_save_draft')}
          </button>
          <button
            type="button"
            onClick={openConfirmPublish}
            disabled={!canPublish || saving}
            title={!canPublish ? t('form.publish_disabled_reason', { status: tStatus(status) }) : ''}
            style={{
              padding: '12px 22px',
              background: !canPublish || saving ? 'var(--sk-muted)' : domain.primaryColor,
              color: 'var(--sk-surface)',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              cursor: !canPublish || saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {publishing ? t('form.button_publish_loading') : t('form.button_publish')}
          </button>
        </div>
      </form>

      {/* Modale de confirmation publish */}
      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sk-confirm-title"
          style={{
            position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--sk-encre) 65%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px 16px', zIndex: 9999,
          }}
        >
          <div style={{ background: 'var(--sk-surface)', borderRadius: 16, padding: '28px 26px', width: '100%', maxWidth: 520 }}>
            <h2 id="sk-confirm-title" style={{ fontSize: 19, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 8 }}>
              {t('form.confirm_publish_title')}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--sk-muted)', lineHeight: 1.6, marginBottom: 14 }}>
              {t('form.confirm_publish_body_p1')}
            </p>
            <ul style={{ fontSize: 13, color: 'var(--sk-muted)', lineHeight: 1.6, paddingLeft: 18, marginBottom: 14 }}>
              <li>{t('form.confirm_publish_rule_clear')}</li>
              <li>{t('form.confirm_publish_rule_no_contact')}</li>
              <li>{t('form.confirm_publish_rule_no_discrimination')}</li>
              <li>{t('form.confirm_publish_rule_legal')}</li>
            </ul>
            <p style={{ fontSize: 13, color: 'var(--sk-amber)', background: 'var(--sk-amber-soft)', border: '1px solid var(--sk-amber-soft)', borderRadius: 8, padding: '10px 12px', lineHeight: 1.55, marginBottom: 12 }}>
              {t('form.confirm_publish_warning')}
            </p>
            {/* Avertissement d'expiration : date calculée à partir de la durée
                RÉGLÉE, lue au serveur. Absente ⇒ la phrase n'est pas affichée,
                plutôt qu'affichée avec une date que le serveur ne tiendra pas. */}
            {vieAnnonceJours !== null && (
              <p style={{ fontSize: 13, color: 'var(--sk-text)', lineHeight: 1.55, marginBottom: 18 }}>
                {t('form.confirm_publish_expiry', {
                  date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
                    new Date(Date.now() + vieAnnonceJours * 24 * 60 * 60 * 1000),
                  ),
                })}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                style={{
                  padding: '10px 18px',
                  background: 'transparent',
                  color: 'var(--sk-muted)',
                  border: '1px solid var(--sk-border)',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('form.confirm_publish_no')}
              </button>
              <button
                type="button"
                onClick={handlePublish}
                style={{
                  padding: '10px 18px',
                  background: domain.primaryColor,
                  color: 'var(--sk-surface)',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {t('form.confirm_publish_yes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { useSecureFetch } from '@/lib/secure-fetch'
import { useDomain } from '@/context/DomainContext'
import ChampsAnnonce, { type ReferentielAnnonce } from '@/components/annonces/ChampsAnnonce'
import { specialitesGardees } from '@/lib/criteres/specialites'
import {
  VALEURS_VIDES,
  corpsDeRequete,
  erreursDeSaisie,
  libelleChampPubliable,
  messageDeRefusCommun,
  messagesDeSaisie,
  type ChampAnnonce,
  type ValeursAnnonce,
} from '@/lib/annonces/formulaire'
import { PUBLICATION_PUBLISHABLE_FIELDS, type PublicationPublishableField } from '@/lib/publications/publishable'

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
 *
 * ⚠️ ET IL N'AVAIT PAS LES MÊMES CHAMPS (lot « critères des annonces », 03/10/2026, §D.39) : ni spécialité, ni
 * séniorité, ni mode de travail, ni durée. Décision de Youssef : « client et collaboration entre experts ont exactement
 * les mêmes champs ». Il rend donc LE MÊME composant que l'annonce d'une organisation (components/annonces/
 * ChampsAnnonce.tsx), sur le même état, validé et envoyé par les mêmes fonctions (lib/annonces/formulaire.ts) ; seul le
 * type est imposé (`sous_traitance`). `diag-criteres-communs` (BLOQUANT) compare les écrans.
 */

type Phase = 'loading' | 'ready' | 'org_error' | 'published' | 'pending' | 'wall' | 'locked'


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
  const tCrit = useTranslations('criteres')
  const secureFetch = useSecureFetch()
  const locale = useLocale()
  const domain = useDomain()

  const [phase, setPhase] = useState<Phase>('loading')
  // LES CHAMPS DE L'ANNONCE D'UNE ORGANISATION, à l'identique (§D.39) : un état, celui de lib/annonces/formulaire.ts.
  const [valeurs, setValeurs] = useState<ValeursAnnonce>(VALEURS_VIDES)
  const [referentiel, setReferentiel] = useState<ReferentielAnnonce | null>(null)
  const [referentielIllisible, setReferentielIllisible] = useState(false)
  // Les erreurs nommées sous chacun des champs (le même prédicat que /publish, plus les bornes fines).
  const [erreurs, setErreurs] = useState<Partial<Record<ChampAnnonce, string>>>({})
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
        const data = (await res.json()) as Partial<ReferentielAnnonce>
        if (annule) return
        setReferentiel({ branches: data.branches ?? [], specialities: data.specialities ?? [], work_zones: data.work_zones ?? [] })
        setReferentielIllisible(false)
      } catch {
        if (!annule) setReferentielIllisible(true)
      }
    })()
    return () => { annule = true }
  }, [domain.id, locale])

  // Au changement de branche, seules les spécialités hors branche partent (« Autre » survit) — comme l'annonce d'une
  // organisation.
  useEffect(() => {
    if (!referentiel) return
    setValeurs((p) => {
      const gardees = specialitesGardees(p.speciality_ids, referentiel.specialities, p.branch_id)
      return gardees.length === p.speciality_ids.length ? p : { ...p, speciality_ids: gardees }
    })
  }, [valeurs.branch_id, referentiel])

  const changer = useCallback(<K extends keyof ValeursAnnonce>(k: K, v: ValeursAnnonce[K]) => {
    setValeurs((p) => ({ ...p, [k]: v }))
    setErreurs((e) => ({
      ...e,
      [k]: undefined,
      ...(k === 'jours_sur_site' || k === 'jours_teletravail' || k === 'work_modes' ? { repartition_hybride: undefined } : null),
      ...(k === 'duree_valeur' || k === 'duree_unite' ? { duree: undefined } : null),
    }))
  }, [])

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
  const estChampPubliable = (c: unknown): c is PublicationPublishableField =>
    typeof c === 'string' && (PUBLICATION_PUBLISHABLE_FIELDS as readonly string[]).includes(c)
  const champsManquants = (liste: unknown): string | null => {
    if (!Array.isArray(liste) || liste.length === 0) return null
    const noms = liste.filter(estChampPubliable).map((c) => libelleChampPubliable(c, tPub, tCrit))
    return noms.length > 0 ? tPub('errors.missing_fields', { fields: noms.join(', ') }) : null
  }
  const messageDuRefus = (code: string | undefined, repli: string): string => {
    // Les refus communs avec l'annonce d'une organisation (saisie, critères, statut) : les mêmes phrases.
    const commun = messageDeRefusCommun(code, tPub, tCrit)
    if (commun) return commun
    switch (code) {
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
    // LE MÊME PRÉDICAT QUE LE SERVEUR (lib/publications/publishable.ts) ET LES MÊMES BORNES que l'annonce d'une
    // organisation (lib/annonces/formulaire.ts), avant d'envoyer : chaque champ fautif est NOMMÉ sous lui, rien ne part.
    const fautes = erreursDeSaisie(valeurs, 'sous_traitance')
    setErreurs(messagesDeSaisie(fautes, tPub, tCrit))
    if (Object.keys(fautes).length > 0) {
      setError(tCrit('erreurs.corriger_les_champs'))
      return
    }
    setSubmitting(true)
    try {
      // Le corps de l'annonce d'une organisation, à l'identique (les zones en CODES stables, jamais en uuid).
      const champs = corpsDeRequete(valeurs, 'sous_traitance', (id) => referentiel?.work_zones.find((z) => z.id === id)?.code)

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
          const nommes = pub.missing.filter(estChampPubliable)
          setErreurs((e) => ({
            ...e,
            ...Object.fromEntries(nommes.map((c) => [c, tCrit('erreurs.champ_obligatoire')])),
          }))
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
        // PLEINE LARGEUR : les champs occupent la largeur de la page, comme l'annonce d'une organisation.
        <div style={{ width: '100%' }}>
          {/* Le référentiel illisible se DIT : sans branches, spécialités ni zones, rien ne pourrait se publier. */}
          {referentielIllisible ? (
            <div role="alert" style={{ padding: '10px 14px', background: 'var(--sk-red-soft)', color: 'var(--sk-red)', fontSize: 13, borderRadius: 10, marginBottom: 16 }}>
              {t('errors.taxonomie_indisponible')}
            </div>
          ) : null}

          {/* LES CHAMPS DE L'ANNONCE D'UNE ORGANISATION, à l'identique (un composant, §D.39). */}
          <ChampsAnnonce type="sous_traitance" valeurs={valeurs} changer={changer} erreurs={erreurs} referentiel={referentiel} />

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

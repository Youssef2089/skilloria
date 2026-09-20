'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/facturation — CE QUE STRIPE NE PEUT PAS SAVOIR.
 *
 * ═══ CE QUE CET ÉCRAN NE FAIT PAS, ET C'EST LA MOITIÉ DU LOT ══════════════
 *   Il ne montre NI paiement, NI facture, NI remboursement, NI litige : tout
 *   cela vit dans le tableau de bord Stripe, s'y consulte mieux, et un écran
 *   qui le recopierait finirait par en diverger. Un lien suffit, et il est en
 *   tête.
 *
 *   Il ne CORRIGE rien non plus. Aucun bouton n'écrit, aucun formulaire n'est
 *   rendu. Corriger automatiquement un écart qu'on ne comprend pas encore est
 *   le pire des remèdes — et sur de l'argent, il est irréversible.
 *
 * ═══ « ZÉRO ÉCART » ET « JE N'AI PAS PU COMPARER » NE SE CONFONDENT PAS ═══
 *   Le serveur rend une union à deux branches (`EtatEcarts`), et `ecarts`
 *   n'existe QUE dans la branche `'compare'`. Il n'y a donc aucun moyen
 *   d'écrire ici `data.ecarts.ecarts.length === 0` sans avoir répondu à
 *   l'autre branche : le compilateur l'interdit. C'est §E.36 fermé par le
 *   type, et non par la vigilance de celui qui écrit le JSX.
 *
 * ═══ LE MUR FERMÉ EST UN ÉTAT NORMAL, PAS UNE PANNE ══════════════════════
 *   `ENABLE_BILLING` absent est aujourd'hui le cas nominal : rien n'encaisse,
 *   donc il n'y a rien à rapprocher. Il a son propre texte, en gris, et non
 *   le rouge des vraies pannes. Un écran qui peint en rouge le fonctionnement
 *   normal apprend à faire ignorer ses propres signaux.
 *
 * ═══ AUCUN CHAMP DE SAISIE ═══════════════════════════════════════════════
 *   La seule commande de cette page est un FILTRE d'affichage sur le journal.
 *   Il ne règle rien et n'écrit rien : c'est de la navigation dans une liste
 *   bornée, pas un réglage (§D.11).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Ce que la route rend. Les unions sont recopiées telles quelles : une branche
// d'échec qu'on ne déclarerait pas ici la rendrait impensable à l'écran (§E.30).
// ─────────────────────────────────────────────────────────────────────────────

type MotifIndisponible =
  | 'billing_disabled'
  | 'billing_key_missing'
  | 'billing_key_malformed'
  | 'billing_key_env_mismatch'
  | 'billing_webhook_secret_missing'
  | 'stripe_injoignable'
  | 'stripe_permission'
  | 'lecture_locale'

type NatureEcart =
  | 'paie_sans_acces'
  | 'acces_sans_paiement'
  | 'offre_differente'
  | 'validite_en_retard'
  | 'client_sans_organisation'
  | 'prix_hors_catalogue'
  | 'statut_inconnu'
  | 'plusieurs_abonnements'

type StatutEvenement = 'received' | 'processed' | 'ignored' | 'failed'

type Ecart = {
  nature: NatureEcart
  gravite: 'bloquant' | 'attention'
  organizationId: string | null
  organizationName: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  statutStripe: string | null
  offreLocale: string | null
  finDePeriodeStripe: string | null
  validiteLocale: string | null
}

type LigneJournal = {
  id: string
  type: string
  statut: StatutEvenement
  livemode: boolean
  tentatives: number
  erreur: string | null
  organizationId: string | null
  recuLe: string
  cloturLe: string | null
  /** Verdict CALCULÉ AU SERVEUR (lib/stripe-exploitation/journal.ts). */
  coince: boolean
}

type Alerte = {
  nature:
    | 'secret_absent'
    | 'endpoint_desactive'
    | 'aucun_endpoint'
    | 'actif_mais_muet'
    | 'silence_prolonge'
    | 'mode_croise'
    | 'types_manquants'
    | 'endpoints_illisibles'
  gravite: 'bloquant' | 'attention'
  compte: number | null
}

type Charge = {
  journal:
    | { etat: 'indisponible' }
    | {
        etat: 'disponible'
        lignes: LigneJournal[]
        resume: {
          total: number
          traites: number
          ignores: number
          echoues: number
          enCours: number
          coinces: number
          dernierRecuLe: string | null
        }
      }
  ecarts:
    | { etat: 'impossible'; motif: MotifIndisponible; detail: string }
    | {
        etat: 'compare'
        ecarts: Ecart[]
        organisationsComparees: number
        abonnementsStripe: number
        attributionsManuelles: number
      }
  sante: {
    secretPresent: boolean
    production: boolean
    endpointsConnus: boolean
    notreEndpoint: { id: string; url: string; statut: string } | null
    autresEndpoints: number | null
    dernierRecuLe: string | null
    joursDeSilence: number | null
    dernierLivemode: boolean | null
    alertes: Alerte[]
  }
  derniere_nuit:
    | null
    | 'aucune'
    | {
        etat: 'compare' | 'impossible'
        motif_impossible: string | null
        fenetre_debut: string
        fenetre_fin: string
        evenements_stripe: number | null
        manquants: number | null
        ids_manquants: string[]
        tronque: boolean
        ran_at: string
      }
  journal_limite: number
  journal_filtre: StatutEvenement | null
  abonnements_tronques: boolean | null
}

const carte: React.CSSProperties = {
  background: 'var(--color-surface, #fff)',
  border: '1px solid var(--color-border, #e2e8f0)',
  borderRadius: 12,
  padding: '16px 18px',
  marginBottom: 16,
}

const titreSection: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 650,
  margin: '0 0 6px',
  color: 'var(--color-text-primary, #0f172a)',
}

const sousTitre: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--color-text-secondary, #64748b)',
  lineHeight: 1.55,
  margin: '0 0 14px',
  maxWidth: 760,
}

const cellule: React.CSSProperties = {
  padding: '8px 10px',
  fontSize: 12.5,
  textAlign: 'left',
  borderBottom: '1px solid var(--color-border, #e2e8f0)',
  verticalAlign: 'top',
}

/**
 * L'UNIQUE BOUTON QUI ÉCRIT DE TOUT CET ÉCRAN.
 *
 * Le reste est en LECTURE SEULE, délibérément : corriger automatiquement un
 * écart qu'on ne comprend pas encore est irréversible dans les deux sens.
 * Celui-ci ne corrige aucun écart — il rend UNE ligne rejouable, et rien
 * d'autre.
 */
const boutonReprise: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  cursor: 'pointer',
  border: '1px solid var(--color-border, #e2e8f0)',
  background: 'var(--color-surface, #ffffff)',
  color: 'var(--color-text-primary, #0f172a)',
  whiteSpace: 'nowrap',
}

const enTete: React.CSSProperties = {
  ...cellule,
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: 'var(--color-text-tertiary, #94a3b8)',
  whiteSpace: 'nowrap',
}

const mono: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11.5,
}

/** Une ligne « étiquette : valeur » du bloc raccordement. */
function Ligne({ label, valeur, alerte }: { label: string; valeur: string; alerte?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '7px 0',
        borderBottom: '1px solid var(--color-border, #e2e8f0)',
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          color: 'var(--color-text-tertiary, #94a3b8)',
          flex: '0 0 180px',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          flex: '1 1 240px',
          color: alerte ? 'var(--color-error, #dc2626)' : 'var(--color-text-primary, #0f172a)',
          fontWeight: alerte ? 600 : 400,
        }}
      >
        {valeur}
      </span>
    </div>
  )
}

export default function AdminFacturationPage() {
  const t = useTranslations('admin_facturation')
  const secureFetch = useSecureFetch()

  const [data, setData] = useState<Charge | null>(null)
  const [erreur, setErreur] = useState<boolean>(false)
  const [chargement, setChargement] = useState(true)
  const [filtre, setFiltre] = useState<'' | StatutEvenement>('')
  // ⚠️ LA REPRISE EST EXPLICITE, TRACÉE, ET ELLE EXIGE UNE RAISON ÉCRITE.
  //    Le délai de grâce automatique a été REFUSÉ : il ouvrirait une course
  //    avec un processus lent mais vivant, et transformerait une propriété
  //    vérifiable en pari sur un chronomètre. Arbitrage du 20/09/2026.
  const [reprise, setReprise] = useState<string | null>(null)
  const [motif, setMotif] = useState('')
  const [repriseEtat, setRepriseEtat] = useState<
    { kind: 'idle' } | { kind: 'envoi' } | { kind: 'erreur'; code: string } | { kind: 'fait' }
  >({ kind: 'idle' })

  const lire = useCallback(async () => {
    setChargement(true)
    try {
      const q = filtre ? `?statut=${filtre}` : ''
      const res = await secureFetch(`/api/admin/facturation${q}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`facturation ${res.status}`)
      setData((await res.json()) as Charge)
      setErreur(false)
    } catch {
      // ⚠️ ON N'AFFICHE PAS UN ÉCRAN VIDE. Une page sans écart et une page qui
      //    n'a pas pu être chargée se ressembleraient trait pour trait, et la
      //    première est rassurante. On efface donc la donnée précédente et on
      //    dit ce qui s'est passé.
      setData(null)
      setErreur(true)
    } finally {
      setChargement(false)
    }
  }, [secureFetch, filtre])

  const rouvrir = useCallback(
    async (evenementId: string, raison: string) => {
      setRepriseEtat({ kind: 'envoi' })
      try {
        const res = await secureFetch('/api/admin/facturation', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ evenement_id: evenementId, motif: raison }),
        })
        const corps = (await res.json().catch(() => ({}))) as { code?: string }
        if (!res.ok) {
          // Le code est RENDU tel quel a l'ecran : « deja cloture ou trop
          // recent » (409) et « je n ai pas pu ecrire » (503) appellent des
          // suites opposees, et un message unique les confondrait.
          setRepriseEtat({ kind: 'erreur', code: corps.code ?? 'inconnu' })
          return
        }
        setRepriseEtat({ kind: 'fait' })
        setReprise(null)
        setMotif('')
      } catch {
        setRepriseEtat({ kind: 'erreur', code: 'reseau' })
      }
    },
    [secureFetch],
  )

  useEffect(() => {
    void lire()
  }, [lire])

  const dateCourte = (iso: string | null) =>
    iso === null ? '' : new Date(iso).toLocaleDateString()
  const dateLongue = (iso: string | null) =>
    iso === null ? '' : new Date(iso).toLocaleString()

  return (
    <div style={{ width: '100%', textAlign: 'left' }}>
      <h1
        style={{
          fontSize: 20,
          fontWeight: 600,
          margin: '0 0 4px',
          color: 'var(--color-text-primary, #0f172a)',
        }}
      >
        {t('title')}
      </h1>
      <p style={{ ...sousTitre, marginBottom: 12 }}>{t('intro')}</p>

      {/* LE LIEN, ET PAS UN ÉCRAN. Ce qui vit chez Stripe s'y consulte. */}
      <p style={{ margin: '0 0 20px' }}>
        <a
          href="https://dashboard.stripe.com/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary, #2563eb)' }}
        >
          {t('open_stripe')}
        </a>
        <span
          style={{
            display: 'block',
            fontSize: 12,
            color: 'var(--color-text-tertiary, #94a3b8)',
            marginTop: 4,
            maxWidth: 760,
          }}
        >
          {t('open_stripe_hint')}
        </span>
      </p>

      {chargement ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary, #64748b)' }}>{t('loading')}</p>
      ) : erreur || data === null ? (
        <div
          role="alert"
          style={{
            ...carte,
            borderColor: 'var(--color-error, #dc2626)',
            background: 'var(--color-error-soft, #fef2f2)',
          }}
        >
          <p style={{ ...titreSection, color: 'var(--color-error, #dc2626)' }}>{t('err_load')}</p>
          <p style={{ ...sousTitre, margin: 0 }}>{t('err_load_hint')}</p>
        </div>
      ) : (
        <>
          {/* ═══ 1. LE RACCORDEMENT — quatre lignes, pas un écran ═══════════ */}
          <section style={carte}>
            <h2 style={titreSection}>{t('sante.title')}</h2>
            <p style={sousTitre}>{t('sante.intro')}</p>

            <Ligne
              label={t('sante.secret_label')}
              valeur={data.sante.secretPresent ? t('sante.secret_present') : t('sante.secret_absent')}
              alerte={!data.sante.secretPresent}
            />
            <Ligne
              label={t('sante.mode_label')}
              valeur={data.sante.production ? t('sante.mode_production') : t('sante.mode_test')}
            />
            <Ligne
              label={t('sante.endpoint_label')}
              valeur={
                !data.sante.endpointsConnus
                  ? t('sante.endpoint_unknown')
                  : data.sante.notreEndpoint === null
                    ? t('sante.endpoint_none')
                    : data.sante.notreEndpoint.statut === 'enabled'
                      ? t('sante.endpoint_ok')
                      : t('sante.endpoint_disabled')
              }
              alerte={
                data.sante.endpointsConnus &&
                (data.sante.notreEndpoint === null ||
                  data.sante.notreEndpoint.statut !== 'enabled')
              }
            />
            {/* ⚠️ « AUCUN ÉVÉNEMENT DEPUIS N JOURS » EST ÉCRIT, PAS DÉDUCTIBLE.
                   C'est la seule ligne qui attrape le secret désaccordé : tout
                   arrive, tout est rejeté avant enregistrement, et la seule
                   trace de la panne est ce silence. */}
            <Ligne
              label={t('sante.last_event_label')}
              valeur={
                data.sante.dernierRecuLe === null
                  ? data.journal.etat === 'indisponible'
                    ? t('sante.last_event_unknown')
                    : t('sante.last_event_never')
                  : (data.sante.joursDeSilence ?? 0) < 1
                    ? t('sante.last_event_today', { date: dateLongue(data.sante.dernierRecuLe) })
                    : t('sante.last_event_days', {
                        count: data.sante.joursDeSilence ?? 0,
                        date: dateLongue(data.sante.dernierRecuLe),
                      })
              }
              alerte={data.sante.dernierRecuLe === null}
            />

            {data.sante.alertes.length > 0 && (
              <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 10 }}>
                {data.sante.alertes.map((a) => {
                  const bloquant = a.gravite === 'bloquant'
                  return (
                    <li
                      key={a.nature}
                      role={bloquant ? 'alert' : undefined}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: `1px solid ${bloquant ? 'var(--color-error, #dc2626)' : 'var(--color-warning, #d97706)'}`,
                        background: bloquant
                          ? 'var(--color-error-soft, #fef2f2)'
                          : 'var(--color-warning-soft, #fffbeb)',
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          marginBottom: 4,
                          color: bloquant ? 'var(--color-error, #dc2626)' : 'var(--color-warning, #d97706)',
                        }}
                      >
                        {bloquant ? t('gravity_blocking') : t('gravity_attention')}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--color-text-primary, #0f172a)' }}>
                        {t(`sante.alerte.${a.nature}` as 'sante.alerte.secret_absent', {
                          count: a.compte ?? 0,
                        })}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* ═══ 2. LES ÉCARTS — celui qui compte ═══════════════════════════ */}
          <section style={carte}>
            <h2 style={titreSection}>{t('ecarts.title')}</h2>
            <p style={sousTitre}>{t('ecarts.intro')}</p>

            {data.ecarts.etat === 'impossible' ? (
              // ⚠️ DEUX TEXTES, DEUX COULEURS, ET C'EST TOUT L'ENJEU.
              //    Le mur fermé est le cas NOMINAL : rien n'encaisse, il n'y a
              //    rien à rapprocher. Le peindre en rouge apprendrait à ignorer
              //    le rouge, précisément là où il devra dire vrai un jour.
              <div
                role={data.ecarts.motif === 'billing_disabled' ? undefined : 'alert'}
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: `1px solid ${
                    data.ecarts.motif === 'billing_disabled'
                      ? 'var(--color-border, #e2e8f0)'
                      : 'var(--color-error, #dc2626)'
                  }`,
                  background:
                    data.ecarts.motif === 'billing_disabled'
                      ? 'var(--color-surface-subtle, #f8fafc)'
                      : 'var(--color-error-soft, #fef2f2)',
                }}
              >
                <p
                  style={{
                    fontSize: 13.5,
                    fontWeight: 650,
                    margin: '0 0 6px',
                    color:
                      data.ecarts.motif === 'billing_disabled'
                        ? 'var(--color-text-primary, #0f172a)'
                        : 'var(--color-error, #dc2626)',
                  }}
                >
                  {data.ecarts.motif === 'billing_disabled'
                    ? t('ecarts.impossible_normal')
                    : t('ecarts.impossible')}
                </p>
                <p style={{ ...sousTitre, margin: '0 0 6px' }}>
                  {data.ecarts.motif === 'billing_disabled'
                    ? t('ecarts.impossible_normal_hint')
                    : t('ecarts.impossible_hint')}
                </p>
                <p style={{ ...sousTitre, margin: 0 }}>
                  {t(`motif.${data.ecarts.motif}` as 'motif.billing_disabled')}
                </p>
              </div>
            ) : data.ecarts.ecarts.length === 0 ? (
              <>
                {/* Le cas normal ne crie pas : aucune couleur, une phrase, et le
                    CHIFFRE de ce sur quoi la comparaison a porté — « aucun
                    écart » sans dire sur quoi ne prouve rien. */}
                <p
                  style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    margin: '0 0 6px',
                    color: 'var(--color-text-primary, #0f172a)',
                  }}
                >
                  {t('ecarts.none')}
                </p>
                <p style={{ ...sousTitre, margin: 0 }}>
                  {t('ecarts.none_hint', {
                    orgs: data.ecarts.organisationsComparees,
                    subs: data.ecarts.abonnementsStripe,
                  })}
                </p>
              </>
            ) : (
              <>
                <p style={{ ...sousTitre, marginBottom: 10 }}>
                  {t('ecarts.compared', {
                    orgs: data.ecarts.organisationsComparees,
                    subs: data.ecarts.abonnementsStripe,
                  })}
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={enTete}>{t('ecarts.col_org')}</th>
                        <th style={enTete}>{t('ecarts.col_nature')}</th>
                        <th style={enTete}>{t('ecarts.col_stripe')}</th>
                        <th style={enTete}>{t('ecarts.col_local')}</th>
                        <th style={enTete}>{t('ecarts.col_until')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ecarts.ecarts.map((e, i) => {
                        const bloquant = e.gravite === 'bloquant'
                        return (
                          <tr key={`${e.nature}-${e.organizationId ?? e.stripeCustomerId ?? i}`}>
                            <td style={cellule}>
                              <span style={{ fontWeight: 600 }}>
                                {e.organizationName ?? t('ecarts.no_org')}
                              </span>
                              {e.stripeCustomerId && (
                                <span
                                  style={{
                                    ...mono,
                                    display: 'block',
                                    color: 'var(--color-text-tertiary, #94a3b8)',
                                  }}
                                >
                                  {e.stripeCustomerId}
                                </span>
                              )}
                            </td>
                            <td style={cellule}>
                              <span
                                style={{
                                  fontWeight: 650,
                                  color: bloquant
                                    ? 'var(--color-error, #dc2626)'
                                    : 'var(--color-warning, #d97706)',
                                }}
                              >
                                {t(`ecarts.nature.${e.nature}` as 'ecarts.nature.paie_sans_acces')}
                              </span>
                              {/* CE QU'ON PEUT FAIRE. Un écran qui nomme un
                                  défaut sans dire par où le prendre est un
                                  écran mort. */}
                              <span
                                style={{
                                  display: 'block',
                                  marginTop: 3,
                                  color: 'var(--color-text-secondary, #64748b)',
                                  lineHeight: 1.5,
                                }}
                              >
                                {t(
                                  `ecarts.nature_action.${e.nature}` as 'ecarts.nature_action.paie_sans_acces',
                                )}
                              </span>
                            </td>
                            <td style={cellule}>
                              <span style={mono}>{e.statutStripe ?? '—'}</span>
                              {e.stripeSubscriptionId && (
                                <span
                                  style={{
                                    ...mono,
                                    display: 'block',
                                    color: 'var(--color-text-tertiary, #94a3b8)',
                                  }}
                                >
                                  {e.stripeSubscriptionId}
                                </span>
                              )}
                            </td>
                            <td style={cellule}>{e.offreLocale ?? t('ecarts.no_package')}</td>
                            <td style={cellule}>
                              {e.validiteLocale ? dateCourte(e.validiteLocale) : '—'}
                              {e.finDePeriodeStripe && (
                                <span
                                  style={{
                                    display: 'block',
                                    color: 'var(--color-text-tertiary, #94a3b8)',
                                  }}
                                >
                                  {dateCourte(e.finDePeriodeStripe)}
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Les attributions manuelles sont DITES, pas tues : sans cette
                ligne, l'exploitant croirait la comparaison exhaustive. */}
            {data.ecarts.etat === 'compare' && data.ecarts.attributionsManuelles > 0 && (
              <p style={{ ...sousTitre, margin: '12px 0 0' }}>
                {t('ecarts.manual', { count: data.ecarts.attributionsManuelles })}
              </p>
            )}
            {data.abonnements_tronques === true && (
              <p role="alert" style={{ ...sousTitre, margin: '8px 0 0', color: 'var(--color-warning, #d97706)' }}>
                {t('ecarts.truncated')}
              </p>
            )}
          </section>

          {/* ═══ 3. LA DERNIÈRE NUIT VÉRIFIÉE ══════════════════════════════ */}
          <section style={carte}>
            <h2 style={titreSection}>{t('nuit.title')}</h2>
            {data.derniere_nuit === null ? (
              <p style={{ ...sousTitre, margin: 0 }}>{t('nuit.unavailable')}</p>
            ) : data.derniere_nuit === 'aucune' ? (
              <>
                <p style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 6px' }}>{t('nuit.never')}</p>
                <p style={{ ...sousTitre, margin: 0 }}>{t('nuit.never_hint')}</p>
              </>
            ) : (
              <>
                <p
                  style={{
                    fontSize: 13.5,
                    margin: '0 0 6px',
                    fontWeight: 600,
                    color:
                      data.derniere_nuit.etat === 'impossible' ||
                      (data.derniere_nuit.manquants ?? 0) > 0
                        ? 'var(--color-error, #dc2626)'
                        : 'var(--color-text-primary, #0f172a)',
                  }}
                >
                  {data.derniere_nuit.etat === 'impossible'
                    ? t('nuit.impossible', { date: dateCourte(data.derniere_nuit.ran_at) })
                    : (data.derniere_nuit.manquants ?? 0) > 0
                      ? t('nuit.compare_gap', {
                          date: dateCourte(data.derniere_nuit.ran_at),
                          count: data.derniere_nuit.manquants ?? 0,
                        })
                      : t('nuit.compare_ok', {
                          date: dateCourte(data.derniere_nuit.ran_at),
                          stripe: data.derniere_nuit.evenements_stripe ?? 0,
                        })}
                </p>
                <p style={{ ...sousTitre, margin: 0 }}>
                  {t('nuit.window', {
                    debut: dateLongue(data.derniere_nuit.fenetre_debut),
                    fin: dateLongue(data.derniere_nuit.fenetre_fin),
                  })}
                </p>
                {data.derniere_nuit.ids_manquants.length > 0 && (
                  <p style={{ ...mono, margin: '8px 0 0', color: 'var(--color-error, #dc2626)' }}>
                    {data.derniere_nuit.ids_manquants.join(' · ')}
                  </p>
                )}
                {data.derniere_nuit.tronque && (
                  <p style={{ ...sousTitre, margin: '8px 0 0', color: 'var(--color-warning, #d97706)' }}>
                    {t('nuit.truncated')}
                  </p>
                )}
              </>
            )}
          </section>

          {/* ═══ 4. LE JOURNAL ═════════════════════════════════════════════ */}
          <section style={carte}>
            <h2 style={titreSection}>{t('journal.title')}</h2>
            <p style={sousTitre}>{t('journal.intro')}</p>

            {data.journal.etat === 'indisponible' ? (
              <div
                role="alert"
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--color-error, #dc2626)',
                  background: 'var(--color-error-soft, #fef2f2)',
                }}
              >
                <p
                  style={{
                    fontSize: 13.5,
                    fontWeight: 650,
                    margin: '0 0 6px',
                    color: 'var(--color-error, #dc2626)',
                  }}
                >
                  {t('journal.unavailable')}
                </p>
                <p style={{ ...sousTitre, margin: 0 }}>{t('journal.unavailable_hint')}</p>
              </div>
            ) : (
              <>
                {/* ⚠️ LE BLOC LE PLUS GRAVE DE CET ÉCRAN, ET IL EST EN TÊTE.
                       Un événement réclamé et jamais clôturé ne se rejouera
                       JAMAIS : la garde d'idempotence le refuse. */}
                {data.journal.resume.coinces > 0 && (
                  <div
                    role="alert"
                    style={{
                      padding: '12px 14px',
                      borderRadius: 8,
                      marginBottom: 14,
                      border: '1px solid var(--color-error, #dc2626)',
                      background: 'var(--color-error-soft, #fef2f2)',
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13.5,
                        fontWeight: 650,
                        margin: '0 0 6px',
                        color: 'var(--color-error, #dc2626)',
                      }}
                    >
                      {t('journal.stuck_title', { count: data.journal.resume.coinces })}
                    </p>
                    <p style={{ ...sousTitre, margin: 0 }}>{t('journal.stuck_text')}</p>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <label
                    htmlFor="filtre-statut"
                    style={{ fontSize: 12, color: 'var(--color-text-secondary, #64748b)' }}
                  >
                    {t('journal.filter_label')}
                  </label>
                  <select
                    id="filtre-statut"
                    value={filtre}
                    onChange={(e) => setFiltre(e.target.value as '' | StatutEvenement)}
                    style={{
                      padding: '6px 8px',
                      fontSize: 12.5,
                      border: '1px solid var(--color-border, #e2e8f0)',
                      borderRadius: 7,
                      background: 'var(--color-surface, #fff)',
                      color: 'var(--color-text-primary, #0f172a)',
                    }}
                  >
                    <option value="">{t('journal.filter_all')}</option>
                    <option value="processed">{t('journal.statut.processed')}</option>
                    <option value="ignored">{t('journal.statut.ignored')}</option>
                    <option value="failed">{t('journal.statut.failed')}</option>
                    <option value="received">{t('journal.statut.received')}</option>
                  </select>
                  <span style={{ fontSize: 12, color: 'var(--color-text-tertiary, #94a3b8)' }}>
                    {t('journal.resume', {
                      total: data.journal.resume.total,
                      traites: data.journal.resume.traites,
                      ignores: data.journal.resume.ignores,
                      echoues: data.journal.resume.echoues,
                    })}
                  </span>
                </div>

                {data.journal.lignes.length === 0 ? (
                  <>
                    <p style={{ fontSize: 13.5, fontWeight: 600, margin: '0 0 6px' }}>
                      {t('journal.empty')}
                    </p>
                    {/* Le journal vide a DEUX causes opposées, et l'écran le dit
                        plutôt que de laisser croire que tout va bien. */}
                    <p style={{ ...sousTitre, margin: 0 }}>{t('journal.empty_hint')}</p>
                  </>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                      <thead>
                        <tr>
                          <th style={enTete}>{t('journal.col_event')}</th>
                          <th style={enTete}>{t('journal.col_type')}</th>
                          <th style={enTete}>{t('journal.col_status')}</th>
                          <th style={enTete}>{t('journal.col_received')}</th>
                          <th style={enTete}>{t('journal.col_error')}</th>
                          <th style={enTete}>{t('journal.col_action')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.journal.lignes.map((l) => {
                          // ⚠️ LE VERDICT VIENT DU SERVEUR, IL N'EST PAS
                          //    RECALCULÉ ICI. Le délai se déduit du `maxDuration`
                          //    du webhook ; le refaire dans ce fichier le
                          //    figerait dans le bundle, et le tableau finirait
                          //    par contredire son propre bandeau (§E.15).
                          const mauvais = l.statut === 'failed' || l.coince
                          return (
                            <tr key={l.id}>
                              <td style={{ ...cellule, ...mono }}>{l.id}</td>
                              <td style={{ ...cellule, ...mono }}>{l.type}</td>
                              <td style={cellule}>
                                <span
                                  style={{
                                    fontWeight: mauvais ? 650 : 400,
                                    color: mauvais
                                      ? 'var(--color-error, #dc2626)'
                                      : 'var(--color-text-primary, #0f172a)',
                                  }}
                                >
                                  {l.coince
                                    ? t('journal.statut_stuck')
                                    : t(`journal.statut.${l.statut}` as 'journal.statut.processed')}
                                </span>
                              </td>
                              <td style={cellule}>{dateLongue(l.recuLe)}</td>
                              <td style={{ ...cellule, color: 'var(--color-text-secondary, #64748b)' }}>
                                {l.erreur ?? '—'}
                              </td>
                              <td style={cellule}>
                                {/* Le bouton n’apparaît QUE sur une ligne coincée.
                                    Ailleurs il n’y a rien à rouvrir, et un bouton
                                    inerte promet une porte qui n’existe pas (§D.1). */}
                                {l.coince ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRepriseEtat({ kind: 'idle' })
                                      setReprise(l.id)
                                      setMotif('')
                                    }}
                                    style={boutonReprise}
                                  >
                                    {t('journal.reopen_action')}
                                  </button>
                                ) : ('—')}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {reprise !== null && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: '12px 14px',
                      borderRadius: 8,
                      border: '1px solid var(--color-border, #e2e8f0)',
                      background: 'var(--color-surface-subtle, #f8fafc)',
                    }}
                  >
                    <p style={{ fontSize: 13, fontWeight: 650, margin: '0 0 4px' }}>
                      {t('journal.reopen_title', { id: reprise })}
                    </p>
                    <p style={{ ...sousTitre, margin: '0 0 10px' }}>{t('journal.reopen_help')}</p>
                    <textarea
                      value={motif}
                      onChange={(e) => setMotif(e.target.value)}
                      placeholder={t('journal.reopen_placeholder')}
                      rows={3}
                      style={{
                        width: '100%',
                        fontSize: 13,
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--color-border, #e2e8f0)',
                        resize: 'vertical',
                      }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        onClick={() => void rouvrir(reprise, motif.trim())}
                        disabled={motif.trim().length < 10 || repriseEtat.kind === 'envoi'}
                        style={{
                          ...boutonReprise,
                          opacity: motif.trim().length < 10 || repriseEtat.kind === 'envoi' ? 0.55 : 1,
                        }}
                      >
                        {repriseEtat.kind === 'envoi'
                          ? t('journal.reopen_sending')
                          : t('journal.reopen_confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setReprise(null); setMotif('') }}
                        style={boutonReprise}
                      >
                        {t('journal.reopen_cancel')}
                      </button>
                    </div>
                    {repriseEtat.kind === 'erreur' && (
                      <p style={{ ...sousTitre, margin: '10px 0 0', color: 'var(--color-error, #dc2626)' }}>
                        {repriseEtat.code === 'evenement_non_coince'
                          ? t('journal.reopen_err_not_stuck')
                          : repriseEtat.code === 'reouverture_indisponible'
                            ? t('journal.reopen_err_unavailable')
                            : t('journal.reopen_err_generic')}
                      </p>
                    )}
                  </div>
                )}
                {repriseEtat.kind === 'fait' && (
                  <p style={{ ...sousTitre, margin: '10px 0 0' }}>{t('journal.reopen_done')}</p>
                )}

                {data.journal.lignes.length >= data.journal_limite && (
                  <p style={{ ...sousTitre, margin: '10px 0 0' }}>
                    {t('journal.truncated', { count: data.journal_limite })}
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /dashboard/entreprise/offre — page « Mon offre » (Lot A).
 *
 * Remplace l'entrée « Factures et paiements » : Stripe n'est pas branché et
 * `transactions` est indexée sur user_id (inexploitable par organisation), donc
 * une page Factures n'aurait strictement rien à afficher. On montre à la place
 * ce qui EXISTE déjà : l'offre effective de l'org et sa consommation du mois.
 *
 * ⚠️ AUCUNE mention de facture, de paiement ni de moyen de paiement tant que
 * Stripe n'est pas branché — et pas de bouton « Changer d'offre » (le
 * libre-service viendra avec Stripe), seulement une ligne de contact.
 *
 * Les données viennent de GET /api/me/organisation/offre : `usage_peek` et
 * `getOrgEntitlements` sont service-role only, donc inatteignables en
 * client-direct.
 */

const fontJakarta = 'var(--font-jakarta), system-ui, sans-serif'

type Payload = {
  available: boolean
  reason?: string
  package?: { slug: string; name: string | null; price_monthly: number | null; currency: string }
  // null = illimité (convention entitlements.ts).
  limits?: {
    publicationsPerMonth: number | null
    activePublicationsMax: number | null
    revealedCandidatesPerPublication: number | null
    manualUnlocksPerMonth: number | null
  }
  /** `null` = compteur illisible. L'écran affiche « — », jamais `0` (§E.22). */
  usage?: { publications: number | null; manual_unlocks: number | null }
  period_start?: string
  package_valid_until?: string | null
  /**
   * LE VERROU, résolu au SERVEUR. Jamais une variable `NEXT_PUBLIC_` : une
   * variable publique est inlinée dans le bundle navigateur, et l'UI pourrait
   * alors diverger du serveur — qui reste seul à décider.
   *
   * Faux tant que le lancement est gratuit : l'écran propose de nous contacter.
   * Vrai le jour où il s'ouvre : les mêmes emplacements portent les chemins de
   * paiement, sans redéploiement de logique. `undefined` (payload d'une version
   * antérieure) est traité comme FERMÉ — on n'ouvre jamais par ignorance.
   */
  billing_enabled?: boolean
  /**
   * AFFICHAGE UNIQUEMENT. Le statut Stripe alimente le bandeau d'échec de
   * paiement, et rien d'autre : aucune lecture de droits n'en dépend. Les
   * droits, eux, viennent de `limits`, calculées par getOrgEntitlements.
   */
  subscription_status?: string | null
  /**
   * LE DERNIER MONTANT RÉELLEMENT PRÉLEVÉ. Source : `transactions`.
   *
   * Les `Price` Stripe sont IMMUABLES : une organisation abonnée à 349 € y reste
   * même si le catalogue passe à 399 €. Afficher le prix catalogue à la place du
   * prix payé est un litige commercial en puissance.
   *
   * `null` = aucun encaissement enregistré. On le DIT — jamais de repli sur le
   * prix catalogue, ce repli-là réintroduirait le défaut par la bande.
   */
  billed?: {
    amount: number | null
    currency: string
    period_end: string | null
    paid_at: string | null
  } | null
  /**
   * L'organisation est-elle ABONNÉE ? C'est ce qui décide quel prix fait foi.
   *
   * Abonnée : seul le montant prélevé compte. Non abonnée : elle est sur l'offre
   * par défaut du catalogue, gratuite par contrainte de base — « Gratuit » est
   * alors la vérité, pas un repli.
   */
  has_subscription?: boolean
}

/** Le drapeau déposé par la route de retour de paiement. Liste fermée. */
type RetourPaiement = 'succes' | 'annule'

/**
 * Le catalogue achetable, servi par /api/billing/offers.
 *
 * Les prix et les quotas viennent du CATALOGUE, jamais de cet écran : les
 * recopier ici les figerait au moment où on les écrit, et l'écran mentirait dès
 * le premier réglage au back-office.
 */
type Offres = {
  current_package_id: string | null
  offers: {
    id: string
    slug: string
    name: string
    description: string | null
    price_monthly: number | null
    currency: string
    limits: Partial<Record<string, number | null>>
  }[]
}

/** Limites d'une offre → clés i18n, dans l'ordre où l'organisation les lit. */
const LIMITES_OFFRE = [
  ['publications_per_month', 'limit_annonces_per_month'],
  ['active_publications_max', 'limit_active_annonces_max'],
  ['revealed_candidates_per_publication', 'limit_revealed_candidates_per_annonce'],
  ['manual_unlocks_per_month', 'limit_manual_unlocks_per_month'],
] as const

/**
 * Limites → clés i18n de l'écran ORGANISATION.
 *
 * Ces lignes empruntaient les libellés `admin_back_office.packages.feature_*`.
 * L'économie était fausse : le back-office parle de « publications », l'écran
 * entreprise dit « annonce » partout ailleurs (« Publier une annonce », « Voir
 * mes annonces », « Suivi des annonces »). Un même écran affichait donc deux
 * mots pour une seule chose. Les libellés admin restent INCHANGÉS — ils
 * s'adressent à un autre lecteur ; l'organisation a désormais les siens.
 */
const LIMIT_ROWS = [
  { key: 'publicationsPerMonth', labelKey: 'limit_annonces_per_month' },
  { key: 'activePublicationsMax', labelKey: 'limit_active_annonces_max' },
  { key: 'revealedCandidatesPerPublication', labelKey: 'limit_revealed_candidates_per_annonce' },
  { key: 'manualUnlocksPerMonth', labelKey: 'limit_manual_unlocks_per_month' },
] as const

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1.5px solid #eef2f7',
        borderRadius: 18,
        padding: 'clamp(18px, 3vw, 26px)',
      }}
    >
      <h2 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
      {children}
    </section>
  )
}

/**
 * Bandeau d'information, du plus neutre au plus alarmant.
 *
 * Mobile-first : pleine largeur, texte qui coule, aucune hauteur fixe — un
 * bandeau d'échec de paiement doit rester lisible sur un téléphone, c'est
 * souvent là qu'on le lit.
 */
function Bandeau({
  ton,
  titre,
  corps,
  children,
}: {
  ton: 'succes' | 'neutre' | 'alerte'
  titre: string
  corps: string
  children?: React.ReactNode
}) {
  const palette = {
    succes: { bg: '#F0FDF4', bord: '#BBF7D0', titre: '#166534', texte: '#15803D' },
    neutre: { bg: '#F8FAFC', bord: '#E2E8F0', titre: '#334155', texte: '#475569' },
    alerte: { bg: '#FFFBEB', bord: '#FDE68A', titre: '#92400E', texte: '#A16207' },
  }[ton]
  return (
    <section
      role={ton === 'alerte' ? 'alert' : undefined}
      style={{
        background: palette.bg,
        border: `1.5px solid ${palette.bord}`,
        borderRadius: 14,
        padding: 'clamp(14px, 2.5vw, 18px)',
      }}
    >
      <h2 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: palette.titre }}>
        {titre}
      </h2>
      <p style={{ margin: 0, fontSize: 13, color: palette.texte, lineHeight: 1.55 }}>{corps}</p>
      {children}
    </section>
  )
}

/** Ligne label / valeur, séparateur discret. */
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid #f1f5f9',
        fontSize: 14,
      }}
    >
      <span style={{ color: '#475569' }}>{label}</span>
      <span style={{ color: '#0f172a', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

/** Barre de consommation. `limit` null = illimité → pas de barre. */
function UsageRow({ label, used, limit, unlimitedLabel }: {
  label: string
  /** `null` = pas lisible. Ni barre, ni alerte : on n'affirme rien (§E.22). */
  used: number | null
  limit: number | null
  unlimitedLabel: string
}) {
  const pct = used != null && limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  // Une consommation inconnue n'est jamais « au plafond » — et pas davantage
  // « à zéro ». Un `0` de repli aurait peint la barre vide et promis de la
  // place qui n'a pas été comptée.
  const atLimit = used != null && limit != null && used >= limit
  const affiche = used == null ? '—' : String(used)
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14, marginBottom: limit == null ? 0 : 8 }}>
        <span style={{ color: '#475569' }}>{label}</span>
        <span style={{ color: atLimit ? '#B45309' : '#0f172a', fontWeight: 600 }}>
          {limit == null ? `${affiche} · ${unlimitedLabel}` : `${affiche} / ${limit}`}
        </span>
      </div>
      {limit != null && (
        <div style={{ height: 6, borderRadius: 999, background: '#f1f5f9', overflow: 'hidden' }}>
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              borderRadius: 999,
              background: atLimit ? '#F59E0B' : 'var(--sk-accent, #0369a1)',
            }}
          />
        </div>
      )}
    </div>
  )
}

export default function MonOffrePage() {
  const t = useTranslations('dashboard_entreprise.offre')
  const tCommerce = useTranslations('commerce')
  const locale = useLocale()
  const secureFetch = useSecureFetch()
  const searchParams = useSearchParams()

  /**
   * LE RETOUR DE PAIEMENT, ENFIN RAMASSÉ.
   *
   * La route de retour dépose `?paiement=succes|annule` depuis le premier jour ;
   * cet écran l'ignorait. Quelqu'un qui venait de payer atterrissait sur une
   * page juste — elle montre l'offre réelle — mais muette.
   *
   * Liste FERMÉE : le paramètre vient de l'URL, donc de l'utilisateur. Toute
   * autre valeur est ignorée.
   *
   * ⚠️ Ce drapeau n'accorde RIEN et ne prouve RIEN : les droits sont posés par
   *    le webhook, jamais par un retour de navigation — c'est ce qui permet de
   *    fermer son navigateur avant la redirection sans rien perdre. Le message
   *    dit d'ailleurs que l'offre se met à jour « dès que la banque a
   *    confirmé », et l'écran montre l'offre RÉELLE juste en dessous.
   */
  const drapeau = searchParams.get('paiement')
  const retourPaiement: RetourPaiement | null =
    drapeau === 'succes' || drapeau === 'annule' ? drapeau : null

  const [portailEnCours, setPortailEnCours] = useState(false)
  const [portailErreur, setPortailErreur] = useState(false)

  /** Le sélecteur d'offres, replié tant qu'on ne le demande pas. */
  const [offresOuvertes, setOffresOuvertes] = useState(false)
  const [offres, setOffres] = useState<
    { kind: 'idle' } | { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: Offres }
  >({ kind: 'idle' })
  const [choixEnCours, setChoixEnCours] = useState<string | null>(null)
  const [choixErreur, setChoixErreur] = useState(false)
  const [choixProgramme, setChoixProgramme] = useState<'a_echeance' | 'immediat' | null>(null)

  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; data: Payload }>({
    kind: 'loading',
  })

  const load = useCallback(async () => {
    try {
      const res = await secureFetch('/api/me/organisation/offre')
      if (!res.ok) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', data: (await res.json()) as Payload })
    } catch (err) {
      console.error('[entreprise/offre] load failed', err)
      setState({ kind: 'error' })
    }
  }, [secureFetch])

  /** Charge le catalogue achetable à l'ouverture du sélecteur, une seule fois. */
  const ouvrirOffres = useCallback(async () => {
    setOffresOuvertes(true)
    if (offres.kind === 'ready' || offres.kind === 'loading') return
    setOffres({ kind: 'loading' })
    try {
      const res = await secureFetch('/api/billing/offers')
      if (!res.ok) {
        setOffres({ kind: 'error' })
        return
      }
      setOffres({ kind: 'ready', data: (await res.json()) as Offres })
    } catch (err) {
      console.error('[entreprise/offre] offres', err)
      setOffres({ kind: 'error' })
    }
  }, [secureFetch, offres.kind])

  useEffect(() => { void load() }, [load])

  /**
   * Ouvre le portail client Stripe.
   *
   * La route décide, pas cet écran : elle revérifie le verrou, le rôle
   * administrateur et l'existence d'un dossier de facturation, et répond 503 ou
   * 403 le cas échéant. Ce bouton n'est même pas rendu tant que le verrou est
   * fermé — mais c'est un CONFORT, jamais la garde.
   */
  const ouvrirPortail = useCallback(async () => {
    setPortailEnCours(true)
    setPortailErreur(false)
    try {
      const res = await secureFetch('/api/billing/portal', { method: 'POST' })
      const payload = (await res.json().catch(() => ({}))) as { url?: string }
      if (!res.ok || !payload.url) {
        setPortailErreur(true)
        return
      }
      window.location.href = payload.url
    } catch (err) {
      console.error('[entreprise/offre] portail', err)
      setPortailErreur(true)
    } finally {
      setPortailEnCours(false)
    }
  }, [secureFetch])

  /**
   * Souscrire, ou changer d'offre — c'est la MÊME intention, et deux routes.
   *
   * L'écran ne tranche pas : il regarde s'il existe déjà un abonnement. Le
   * SERVEUR retranche de toute façon — `checkout` refuse en 409 une
   * organisation déjà abonnée, `change-plan` refuse en 409 une organisation qui
   * ne l'est pas. Ce choix n'est qu'un confort ; la garde est ailleurs.
   *
   * Une MONTÉE prend effet tout de suite, une DESCENTE à l'échéance : la
   * réponse le dit, et l'écran le répète — sans quoi l'organisation croirait
   * qu'il ne s'est rien passé.
   */
  const choisirOffre = useCallback(
    async (packageId: string, dejaAbonne: boolean) => {
      setChoixEnCours(packageId)
      setChoixErreur(false)
      setChoixProgramme(null)
      try {
        const route = dejaAbonne ? '/api/billing/change-plan' : '/api/billing/checkout'
        const res = await secureFetch(route, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-locale': locale },
          body: JSON.stringify({ package_id: packageId }),
        })
        const payload = (await res.json().catch(() => ({}))) as {
          url?: string
          effet?: 'immediat' | 'a_echeance'
        }
        if (!res.ok) {
          setChoixErreur(true)
          return
        }
        // Souscription : on part chez Stripe. Aucune donnée de carte ne passe
        // par cet écran — c'est tout l'intérêt du paiement hébergé.
        if (payload.url) {
          window.location.href = payload.url
          return
        }
        // Changement d'offre : rien à quitter. On dit ce qui a été décidé, puis
        // on relit l'offre RÉELLE plutôt que de l'inventer côté client.
        setChoixProgramme(payload.effet ?? 'immediat')
        await load()
      } catch (err) {
        console.error('[entreprise/offre] choix offre', err)
        setChoixErreur(true)
      } finally {
        setChoixEnCours(null)
      }
    },
    [secureFetch, locale, load],
  )

  if (state.kind === 'loading') {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#64748b' }}>{t('loading')}</div>
  }
  if (state.kind === 'error') {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#991B1B' }}>{t('error_load')}</div>
  }
  if (!state.data.available) {
    return <div style={{ padding: 24, fontFamily: fontJakarta, color: '#64748b' }}>{t('unavailable')}</div>
  }

  const { package: pkg, limits, usage, package_valid_until: validUntil } = state.data

  /**
   * LE VERROU décide de ce que cet écran PROPOSE.
   *
   * `=== true` et non une simple vérité : un payload sans le champ (version
   * antérieure de la route, réponse tronquée) doit compter comme FERMÉ. On
   * n'ouvre jamais un chemin de paiement par ignorance.
   *
   * Fermé  → une ligne de contact, comme aujourd'hui.
   * Ouvert → « Changer d'offre » et l'accès au portail, aux MÊMES emplacements.
   *          Le jour où ENABLE_BILLING passe à vrai, rien d'autre ne bouge.
   */
  const verrouOuvert = state.data.billing_enabled === true

  /**
   * Le dernier paiement a-t-il échoué ?
   *
   * Dérivé de `stripe_subscription_status`, commenté « AFFICHAGE UNIQUEMENT »
   * en base — et c'est tenu ici : ce booléen ne décide QUE d'un bandeau. Les
   * droits affichés plus bas viennent de `limits`, jamais de ce statut. Une
   * organisation en `past_due` garde ses accès pendant les relances, et le
   * bandeau explique exactement cela plutôt que de la laisser le découvrir.
   */
  const paiementEnEchec =
    state.data.subscription_status === 'past_due' || state.data.subscription_status === 'unpaid'

  // ── PRIX : `null` et `0` ne disent PAS la même chose ─────────────────────
  //  Cet écran les confondait — les deux affichaient « Gratuit ». L'ambiguïté
  //  était sans conséquence tant que rien n'encaissait ; elle deviendrait un
  //  bug d'argent dès qu'un tarif doit être dérivé de la ligne. Sémantique
  //  désormais verrouillée en base (packages.price_monthly, Lot 0 Stripe) :
  //    0    → offre GRATUITE et vendable ;
  //    null → aucun tarif défini, offre NON VENDABLE.
  //  Une offre par défaut est toujours à 0 (contrainte
  //  packages_default_must_be_free), donc `null` ici signale une offre du
  //  catalogue restée sans tarif — on le dit, on ne le maquille pas en gratuit.
  const price = pkg?.price_monthly ?? null
  const priceLabel =
    price == null
      ? t('price_undefined')
      : Number(price) === 0
        ? t('free')
        : `${new Intl.NumberFormat(locale, { style: 'currency', currency: pkg?.currency || 'EUR' }).format(Number(price))} ${t('per_month')}`

  /**
   * ┌─ QUEL PRIX FAIT FOI ────────────────────────────────────────────────────┐
   * │ ABONNÉE  → le montant RÉELLEMENT PRÉLEVÉ, lu sur `transactions`. Les    │
   * │            `Price` Stripe sont immuables : une organisation abonnée à   │
   * │            349 € y reste quand le catalogue passe à 399 €. Lui montrer  │
   * │            399 € serait lui annoncer un montant qu'on ne lui prend pas. │
   * │            Aucun prélèvement encore enregistré → ON LE DIT. Retomber    │
   * │            sur le prix catalogue rouvrirait le défaut par la bande.     │
   * │                                                                          │
   * │ NON ABONNÉE → le prix catalogue, et c'est la VÉRITÉ : elle est sur      │
   * │            l'offre par défaut, gratuite par contrainte de base. Rien    │
   * │            n'est prélevé, « Gratuit » n'est donc pas un repli.          │
   * └────────────────────────────────────────────────────────────────────────┘
   */
  const abonnee = state.data.has_subscription === true
  const preleve = state.data.billed ?? null

  const montantPreleve =
    preleve?.amount == null
      ? null
      : `${new Intl.NumberFormat(locale, { style: 'currency', currency: preleve.currency || 'EUR' }).format(Number(preleve.amount))} ${t('per_month')}`

  const validUntilLabel = validUntil
    ? t('valid_until', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(validUntil)) })
    : null

  return (
    // Pleine largeur, aligné gauche, padding 24px. Titre porté par la topbar.
    <div
      style={{
        fontFamily: fontJakarta,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        width: '100%',
        padding: '24px 26px 28px',
        boxSizing: 'border-box',
      }}
    >
      {/* ─── Retour de paiement ─────────────────────────────────────────────
          Un mot sur ce qui vient de se passer. Il ne PROUVE rien : l'offre
          réelle est affichée juste en dessous, et c'est elle qui fait foi. */}
      {retourPaiement === 'succes' && (
        <Bandeau ton="succes" titre={t('payment_success_title')} corps={t('payment_success_body')} />
      )}
      {retourPaiement === 'annule' && (
        <Bandeau ton="neutre" titre={t('payment_cancelled_title')} corps={t('payment_cancelled_body')} />
      )}

      {/* ─── Échec de paiement ──────────────────────────────────────────────
          Les accès sont MAINTENUS pendant les relances : le bandeau le dit,
          plutôt que de laisser l'organisation le découvrir en butant. */}
      {paiementEnEchec && (
        <Bandeau ton="alerte" titre={t('payment_failed_title')} corps={t('payment_failed_body')}>
          {verrouOuvert && (
            <button
              type="button"
              onClick={() => void ouvrirPortail()}
              disabled={portailEnCours}
              style={{
                marginTop: 12,
                padding: '9px 16px',
                background: '#92400E',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: portailEnCours ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {portailEnCours ? t('portal_opening') : t('open_portal')}
            </button>
          )}
        </Bandeau>
      )}

      {/* ─── Offre courante ─────────────────────────────────────────────────── */}
      <Card title={t('current_plan')}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>
            {/* name null (lookup dégradé) → repli sur le slug, jamais vide. */}
            {pkg?.name || pkg?.slug}
          </span>
          {/* ABONNÉE : le montant prélevé, jamais le prix catalogue. NON
              ABONNÉE : le prix catalogue, qui est alors la vérité. */}
          <span style={{ fontSize: 14, fontWeight: 600, color: '#475569' }}>
            {abonnee ? (montantPreleve ?? '—') : priceLabel}
          </span>
        </div>

        {/* Le montant prélevé s'annonce comme tel, et dit pourquoi il peut
            différer du catalogue. Un « — » sans explication ferait croire à une
            panne, alors qu'il signale simplement qu'aucun paiement n'a encore
            été confirmé. */}
        {abonnee && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
            {montantPreleve
              ? `${t('billed_label')} · ${t('billed_note')}`
              : t('billed_pending')}
          </p>
        )}
        {!abonnee && price != null && Number(price) !== 0 && (
          <p style={{ margin: '8px 0 0', fontSize: 12.5, color: '#64748b' }}>{t('catalog_note')}</p>
        )}

        {validUntilLabel && (
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#64748b' }}>{validUntilLabel}</p>
        )}

        {/* ── VERROU FERMÉ : une ligne de contact, pas un bouton mort ──────
            Le lancement est gratuit et la date d'ouverture n'est pas fixée. Un
            bouton grisé « Changer d'offre » serait pire que pas de bouton : il
            promet une porte qui n'existe pas. */}
        {!verrouOuvert && (
          <p style={{ margin: '14px 0 0', fontSize: 13, color: '#475569' }}>
            {t('contact_to_change')}
          </p>
        )}

        {/* ── VERROU OUVERT : les mêmes emplacements portent les chemins ────
            Aucune logique n'est redéployée ce jour-là — seule la variable
            d'environnement change, et ces deux actions apparaissent.
            Mobile-first : les boutons passent à la ligne plutôt que de
            déborder. */}
        {verrouOuvert && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            {/* Le sélecteur s'ouvre SUR PLACE. Un lien vers un écran dédié
                aurait été un lien vers une page qui n'existe pas — un écran
                mort est pire qu'une absence de bouton. */}
            <button
              type="button"
              onClick={() => (offresOuvertes ? setOffresOuvertes(false) : void ouvrirOffres())}
              aria-expanded={offresOuvertes}
              style={{
                padding: '9px 16px',
                background: 'var(--sk-accent, #0369a1)',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {offresOuvertes ? t('close') : t('change_plan')}
            </button>
            <button
              type="button"
              onClick={() => void ouvrirPortail()}
              disabled={portailEnCours}
              style={{
                padding: '9px 16px',
                background: '#fff',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: portailEnCours ? 'wait' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {portailEnCours ? t('portal_opening') : t('open_portal')}
            </button>
          </div>
        )}

        {portailErreur && (
          <p role="alert" style={{ margin: '10px 0 0', fontSize: 12.5, color: '#B91C1C' }}>
            {t('portal_failed')}
          </p>
        )}

        {/* L'issue reste la même des deux côtés du verrou, seul son libellé
            change — d'où deux clés dans un espace partagé plutôt qu'une phrase
            recopiée dans chaque écran. */}
        <p style={{ margin: '12px 0 0', fontSize: 12.5, color: '#64748b' }}>
          {verrouOuvert ? tCommerce('need_more_upgrade') : tCommerce('need_more_contact')}
        </p>
      </Card>

      {/* ─── Sélecteur d'offres ─────────────────────────────────────────────
          Rendu UNIQUEMENT verrou ouvert. Prix et quotas viennent du catalogue,
          jamais d'ici : les recopier les figerait au premier réglage. */}
      {verrouOuvert && offresOuvertes && (
        <Card title={t('offers_title')}>
          {offres.kind === 'loading' && (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{t('offers_loading')}</p>
          )}
          {offres.kind === 'error' && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: '#B91C1C' }}>
              {t('offers_failed')}
            </p>
          )}
          {offres.kind === 'ready' && offres.data.offers.length === 0 && (
            <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{t('offers_empty')}</p>
          )}
          {offres.kind === 'ready' && offres.data.offers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {offres.data.offers.map((o) => {
                const enCours = o.id === offres.data.current_package_id
                const prix =
                  o.price_monthly == null
                    ? t('price_undefined')
                    : Number(o.price_monthly) === 0
                      ? t('free')
                      : `${new Intl.NumberFormat(locale, { style: 'currency', currency: o.currency || 'EUR' }).format(Number(o.price_monthly))} ${t('per_month')}`
                return (
                  <div
                    key={o.id}
                    style={{
                      border: `1.5px solid ${enCours ? 'var(--sk-accent, #0369a1)' : '#e2e8f0'}`,
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 12,
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{o.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>{prix}</span>
                      </div>
                      <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {LIMITES_OFFRE.map(([code, labelKey]) => {
                          // Une feature ABSENTE du catalogue n'est pas affichée :
                          // on ne montre pas une limite qu'on ne connaît pas.
                          if (!(code in o.limits)) return null
                          const v = o.limits[code] ?? null
                          return (
                            <li key={code} style={{ fontSize: 12.5, color: '#64748b' }}>
                              {t(labelKey as 'limit_annonces_per_month')} :{' '}
                              <strong style={{ color: '#334155' }}>
                                {v == null ? t('unlimited') : v}
                              </strong>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                    {enCours ? (
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--sk-accent, #0369a1)', whiteSpace: 'nowrap' }}>
                        {t('offer_current')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void choisirOffre(o.id, offres.data.current_package_id !== null)}
                        disabled={choixEnCours !== null}
                        style={{
                          padding: '8px 14px',
                          background: 'var(--sk-accent, #0369a1)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          fontSize: 12.5,
                          fontWeight: 600,
                          cursor: choixEnCours !== null ? 'wait' : 'pointer',
                          fontFamily: 'inherit',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {choixEnCours === o.id ? t('offer_switching') : t('offer_choose')}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {choixErreur && (
            <p role="alert" style={{ margin: '12px 0 0', fontSize: 12.5, color: '#B91C1C' }}>
              {t('offer_failed')}
            </p>
          )}
          {choixProgramme && (
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: '#166534' }}>
              {choixProgramme === 'a_echeance' ? t('offer_scheduled') : t('offer_applied')}
            </p>
          )}
        </Card>
      )}

      {/* ─── Limites de l'offre (libellés du back-office) ───────────────────── */}
      <Card title={t('limits_title')}>
        <div>
          {LIMIT_ROWS.map(({ key, labelKey }) => {
            const v = limits?.[key] ?? null
            return (
              <Row
                key={key}
                label={t(labelKey as 'limit_annonces_per_month')}
                value={v == null ? t('unlimited') : v}
              />
            )
          })}
        </div>
      </Card>

      {/* ─── Consommation du mois ───────────────────────────────────────────── */}
      <Card title={t('usage_title')}>
        <div>
          <UsageRow
            label={t('usage_annonces')}
            used={usage?.publications ?? null}
            limit={limits?.publicationsPerMonth ?? null}
            unlimitedLabel={t('unlimited')}
          />
          <UsageRow
            label={t('usage_manual_unlocks')}
            used={usage?.manual_unlocks ?? null}
            limit={limits?.manualUnlocksPerMonth ?? null}
            unlimitedLabel={t('unlimited')}
          />
        </div>
      </Card>
    </div>
  )
}

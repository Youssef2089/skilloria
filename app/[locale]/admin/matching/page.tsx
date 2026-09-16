'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useSecureFetch } from '@/lib/secure-fetch'

/**
 * /admin/matching — LES DEUX SEUILS, ET CE QUE LE MOTEUR COÛTE.
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ═════════════════════════════════════════════
 *   Le score d'un reranker n'est pas calibré : aucun seuil ne peut être deviné,
 *   et aucun ne peut être traduit depuis l'ancienne échelle sur 10. Il faut LIRE
 *   la distribution réelle des runs, puis régler. Sans écran, ce réglage
 *   demanderait un développeur à chaque fois — il resterait donc à sa valeur
 *   initiale, c'est-à-dire personne notifié.
 *
 * ═══ CE QUI EST MONTRÉ À CÔTÉ DES CURSEURS, ET POURQUOI ═══════════════════
 *   La DISTRIBUTION observée : régler un seuil sans elle, c'est choisir un
 *   nombre au hasard. La COUVERTURE : elle dit si des experts éligibles n'ont
 *   pas été notés, c'est-à-dire écartés sans raison. La DÉPENSE du mois : un
 *   plafond qu'on ne voit pas est un plafond qu'on découvre atteint.
 *
 * ═══ CE QUE L'ÉCRAN NE FAIT PAS ═══════════════════════════════════════════
 *   Il ne recalcule rien et ne devine rien. Quand une lecture est indisponible,
 *   il le DIT — il n'affiche pas un tableau vide, qui se lirait « aucune
 *   donnée » alors que la vérité est « je n'ai pas pu lire ».
 */

type Reglage = {
  domain_id: string
  feed_threshold: number
  notify_threshold: number
  notify_enabled: boolean
  rerank_model: string
  rerank_batch_size: number
  updated_at: string | null
  domaine: { slug: string; name: string | null } | null
}

type LigneDistribution = {
  runs_observes: number
  seuil_median_applique: number | null
  notifies_moyen: number | null
  notifies_median: number | null
  part_notifiee_moyenne: number | null
  score_p50_moyen: number | null
  score_p90_moyen: number | null
  runs_zero_notifie: number
  runs_tout_notifie: number
}

type LigneDepense = {
  provider: string
  monthly_cap_usd: number
  depense_mois: number
  reste: number
  part_consommee: number | null
  au_plafond: boolean
}

/**
 * QUI FAIT MONTER LA FACTURE — une ligne par acteur déclencheur.
 *
 * Trois `acteur_type` possibles, et les deux derniers ne sont PAS des acteurs :
 *   `organization` / `profile` — un acteur nommé, avec son seuil et son drapeau ;
 *   `reste_non_detaille`       — les acteurs au-delà des dix plus gros, agrégés
 *                                et COMPTÉS : on dit combien ils sont ;
 *   `non_imputable`            — la dépense sans acteur. Elle est AFFICHÉE telle
 *                                quelle, jamais répartie sur les autres : une
 *                                proration inventée rendrait le tableau faux
 *                                tout en le rendant joli.
 *
 * La somme des lignes ÉGALE la dépense du mois. C'est vérifiable à l'œil sur
 * cet écran, et c'est ce qui le rend croyable.
 */
type LigneParActeur = {
  acteur_type: 'organization' | 'profile' | 'reste_non_detaille' | 'non_imputable' | string
  acteur_id: string | null
  acteur_nom: string | null
  depense_mois: number
  evenements: number
  acteurs_regroupes: number
  seuil_mensuel_usd: number | null
  en_alerte: boolean
}

type LigneCouverture = {
  runs_observes: number
  runs_complets: number
  runs_tronques: number
  experts_non_notes: number
  lots_rerank_en_echec: number
}

/** Une panne de rédaction, par cause et par surface. Jamais agrégée. */
type LignePanne = {
  cause: 'plafond' | 'modele_indisponible' | 'reponse_illisible' | string
  surface: 'candidature' | 'pitch' | string
  pannes: number
  derniere: string | null
}

/** Un depassement du plafond de relance, par origine. Jamais agrege non plus :
 *  « profil modifie » et « ouverture croisee » n'appellent pas la meme action. */
type LigneDepassement = {
  origine: 'profil_modifie' | 'ouverture_croisee' | 'disponibilite' | 'cv_reanalyse' | string
  depassements: number
  experts: number
}

/** Un run de mise en relation qui ne s-est pas acheve, par etat. Jamais agrege :
 *  « il sera rejoue » et « il ne le sera plus » n-appellent pas la meme action. */
type LigneInacheve = {
  etat: 'en_cours' | 'abandonne' | 'jamais_tente' | string
  publications: number
  plus_ancien: string | null
}

type Charge = {
  reglages: Reglage[]
  distribution: LigneDistribution[] | null
  depense: LigneDepense[] | null
  couverture: LigneCouverture[] | null
  pannes: LignePanne[] | null
  depassements: LigneDepassement[] | null
  inacheves: LigneInacheve[] | null
  par_acteur: LigneParActeur[] | null
  /** Les deux seuils d'alerte par acteur, pour être ÉDITÉS et non seulement lus. */
  seuils_acteur: Record<string, number> | null
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
  padding: '9px 11px',
  border: '1px solid var(--sk-border)',
  borderRadius: 9,
  fontSize: 14,
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
}
/** Champ court, pour un montant en dollars. */
const champArgent: React.CSSProperties = {
  width: 110,
  padding: '7px 9px',
  border: '1px solid var(--sk-border)',
  borderRadius: 8,
  fontSize: 13.5,
  background: 'var(--sk-surface)',
  color: 'var(--sk-text)',
  fontVariantNumeric: 'tabular-nums',
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

export default function AdminMatchingPage() {
  const t = useTranslations('admin_matching')
  const locale = useLocale()
  const secureFetch = useSecureFetch()

  const [charge, setCharge] = useState<Charge | null>(null)
  /**
   * LES DEUX RÉGLAGES D'ARGENT, en saisie libre.
   *
   * Ils étaient AFFICHÉS sans pouvoir être changés — le défaut que §D.7
   * condamne, et le pire endroit où le laisser : de l'argent. Les voir à côté
   * de la dépense déjà faite est ce qui permet de décider ; c'est pourquoi les
   * champs vivent DANS les blocs qui portent ces nombres, et non dans une
   * section « réglages » qu'il faudrait mettre en regard de tête.
   */
  const [plafonds, setPlafonds] = useState<Record<string, string>>({})
  const [seuilsActeur, setSeuilsActeur] = useState<Record<string, string>>({})
  const [argentEnCours, setArgentEnCours] = useState(false)
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [succes, setSucces] = useState<string | null>(null)
  const [brouillons, setBrouillons] = useState<Record<string, Partial<Reglage>>>({})
  const [enregistrement, setEnregistrement] = useState<string | null>(null)

  const lire = useCallback(async () => {
    setChargement(true)
    setErreur(null)
    try {
      const res = await secureFetch('/api/admin/matching-settings', { method: 'GET' })
      if (!res.ok) {
        setErreur(t('errors.load_failed'))
        return
      }
      const data = (await res.json()) as Charge
      setCharge(data)
      // Les champs sont pré-remplis depuis la LECTURE, jamais depuis une
      // constante : une valeur inventée ici serait écrite au premier
      // enregistrement, sur un réglage d'argent.
      setPlafonds(
        Object.fromEntries((data.depense ?? []).map((d) => [d.provider, String(d.monthly_cap_usd)])),
      )
      setSeuilsActeur(
        Object.fromEntries(Object.entries(data.seuils_acteur ?? {}).map(([k, v]) => [k, String(v)])),
      )
    } catch {
      setErreur(t('errors.load_failed'))
    } finally {
      setChargement(false)
    }
  }, [secureFetch, t])

  useEffect(() => {
    void lire()
  }, [lire])

  /**
   * ENREGISTRE LES DEUX RÉGLAGES D'ARGENT — en une seule demande.
   *
   * Le serveur refuse le corps ENTIER si une valeur est mauvaise : appliquer
   * les bonnes et refuser les autres laisserait un état à moitié écrit, que
   * cet écran afficherait sans savoir lequel des champs a pris.
   */
  const enregistrerArgent = async () => {
    setArgentEnCours(true)
    setErreur(null)
    setSucces(null)
    try {
      const res = await secureFetch('/api/admin/plafonds-ia', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plafonds: Object.fromEntries(Object.entries(plafonds).map(([k, v]) => [k, Number(v)])),
          seuils_acteur: Object.fromEntries(
            Object.entries(seuilsActeur).map(([k, v]) => [k, Number(v)]),
          ),
        }),
      })
      if (!res.ok) {
        setErreur(t('money.save_failed'))
        return
      }
      setSucces(t('money.saved'))
      await lire()
    } catch {
      setErreur(t('money.save_failed'))
    } finally {
      setArgentEnCours(false)
    }
  }

  const valeur = (r: Reglage, cle: keyof Reglage) => {
    const b = brouillons[r.domain_id]
    return b && cle in b ? (b[cle] as never) : (r[cle] as never)
  }

  const modifier = (domainId: string, cle: keyof Reglage, v: unknown) => {
    setBrouillons((p) => ({ ...p, [domainId]: { ...(p[domainId] ?? {}), [cle]: v } }))
    setSucces(null)
  }

  const enregistrer = async (r: Reglage) => {
    const b = brouillons[r.domain_id]
    if (!b || Object.keys(b).length === 0) return
    setEnregistrement(r.domain_id)
    setErreur(null)
    setSucces(null)
    try {
      const res = await secureFetch('/api/admin/matching-settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain_id: r.domain_id, ...b }),
      })
      const charge = (await res.json().catch(() => ({}))) as { code?: string }
      if (!res.ok) {
        // Un refus NOMMÉ : l'ordre des deux seuils a sa propre explication,
        // parce que c'est l'erreur qu'on fera le plus souvent.
        setErreur(charge.code === 'ordre_seuils' ? t('errors.ordre_seuils') : t('errors.save_failed'))
        return
      }
      setBrouillons((p) => {
        const suite = { ...p }
        delete suite[r.domain_id]
        return suite
      })
      setSucces(t('saved'))
      await lire()
    } catch {
      setErreur(t('errors.save_failed'))
    } finally {
      setEnregistrement(null)
    }
  }

  if (chargement) {
    return <div style={{ padding: 26, color: 'var(--sk-muted)' }}>{t('loading')}</div>
  }

  const distribution = charge?.distribution?.[0] ?? null
  const couverture = charge?.couverture?.[0] ?? null

  return (
    <div style={{ padding: '24px 26px', maxWidth: 980 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--sk-text)', marginBottom: 6 }}>
        {t('title')}
      </h1>
      <p style={{ fontSize: 13.5, color: 'var(--sk-muted)', lineHeight: 1.6, marginBottom: 20 }}>
        {t('intro')}
      </p>

      {erreur && (
        <div role="alert" style={{ ...carte, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b', fontSize: 13 }}>
          {erreur}
        </div>
      )}
      {succes && (
        <div role="status" style={{ ...carte, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534', fontSize: 13 }}>
          {succes}
        </div>
      )}

      {/* ── LA DÉPENSE ─────────────────────────────────────────────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('spend.title')}</div>
        {charge?.depense === null ? (
          // « Indisponible » n'est pas « zéro ». Afficher 0 $ sur une lecture
          // en échec ferait croire qu'on n'a rien dépensé.
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('spend.unavailable')}</div>
        ) : (charge?.depense ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('spend.none')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {(charge?.depense ?? []).map((d) => (
              <div key={d.provider} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
                <span style={{ fontWeight: 600, minWidth: 90, color: 'var(--sk-text)' }}>{d.provider}</span>
                <span style={{ color: d.au_plafond ? '#dc2626' : 'var(--sk-muted)' }}>
                  {t('spend.line', {
                    spent: Number(d.depense_mois).toFixed(2),
                    cap: Number(d.monthly_cap_usd).toFixed(2),
                  })}
                </span>
                {d.au_plafond && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>{t('spend.capped')}</span>
                )}
              </div>
            ))}
          </div>
        )}
        {/* ── LE PLAFOND, RÉGLABLE, ET À CÔTÉ DE LA DÉPENSE ─────────────
            Voir « 47 $ dépensés » et « plafond 200 $ » côte à côte est ce qui
            permet de décider. Le champ vit donc ICI, dans le bloc qui porte le
            nombre, et non dans une section « réglages » qu'il faudrait mettre
            en regard de tête.

            ⚠️ CELUI-CI BLOQUE, et l'écran le dit. Le baisser sous la dépense
            déjà engagée du mois arrête le moteur à la seconde. */}
        {(charge?.depense ?? []).length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--sk-border)' }}>
            <div style={{ ...etiquette, marginBottom: 10 }}>{t('money.cap_label')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
              {(charge?.depense ?? []).map((d) => (
                <label key={d.provider} style={{ fontSize: 13 }}>
                  <span style={etiquette}>{d.provider}</span>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={1}
                    value={plafonds[d.provider] ?? ''}
                    onChange={(e) => setPlafonds((p) => ({ ...p, [d.provider]: e.target.value }))}
                    style={champArgent}
                    disabled={argentEnCours}
                  />
                </label>
              ))}
            </div>
            <p
              style={{
                fontSize: 12.5,
                color: '#991b1b',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 8,
                padding: '9px 11px',
                lineHeight: 1.5,
                marginTop: 12,
              }}
            >
              <strong>{t('money.cap_blocks_label')}</strong> {t('money.cap_blocks_body')}
            </p>
          </div>
        )}
        <div style={aide}>{t('spend.help')}</div>
      </section>

      {/* ── QUI FAIT MONTER LA FACTURE ──────────────────────────────────
          Juste sous le plafond global, et pas ailleurs : le bloc du dessus dit
          COMBIEN on a dépensé, celui-ci dit QUI. Lus séparément, le premier
          alerte sans qu'on sache où regarder.

          UN DÉPASSEMENT ALERTE, IL NE BLOQUE PAS — décision produit arbitrée.
          Aucun bouton ici : cet écran constate, il ne sanctionne pas. */}
      <section style={carte}>
        <div style={titreBloc}>{t('spendByActor.title')}</div>
        {charge?.par_acteur === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('spendByActor.unavailable')}</div>
        ) : (charge?.par_acteur ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('spendByActor.none')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {(charge?.par_acteur ?? []).map((a, i) => {
              const agrege =
                a.acteur_type === 'reste_non_detaille' || a.acteur_type === 'non_imputable'
              return (
                <div
                  key={`${a.acteur_type}-${a.acteur_id ?? i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    fontSize: 13.5,
                    // Les deux lignes agrégées se distinguent à l'œil des acteurs
                    // nommés : ce ne sont pas des coupables, ce sont des restes.
                    color: agrege ? 'var(--sk-faint)' : 'var(--sk-text)',
                    fontStyle: agrege ? 'italic' : 'normal',
                  }}
                >
                  <span style={{ minWidth: 220, fontWeight: agrege ? 400 : 600 }}>
                    {a.acteur_type === 'non_imputable'
                      ? t('spendByActor.unattributed')
                      : a.acteur_type === 'reste_non_detaille'
                        ? t('spendByActor.others', { count: a.acteurs_regroupes })
                        : (a.acteur_nom ?? t('spendByActor.unnamed'))}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {t('spendByActor.line', {
                      spent: Number(a.depense_mois).toFixed(2),
                      events: a.evenements,
                    })}
                  </span>
                  {!agrege && (
                    <span style={{ fontSize: 12, color: 'var(--sk-faint)' }}>
                      {a.acteur_type === 'organization'
                        ? t('spendByActor.kindOrg')
                        : t('spendByActor.kindExpert')}
                    </span>
                  )}
                  {a.en_alerte && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#b45309' }}>
                      {t('spendByActor.alert', {
                        threshold: Number(a.seuil_mensuel_usd ?? 0).toFixed(2),
                      })}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <div style={aide}>{t('spendByActor.help')}</div>
        {/* L'angle mort est ÉCRIT, pas deviné. Une ligne « non imputable » sans
            explication se lit comme un bug ; expliquée, elle se lit comme une
            limite connue qui décroît d'elle-même. */}
        {/* ── LE SEUIL D'ALERTE, RÉGLABLE, ET À CÔTÉ DE CE QU'IL SIGNALE ──
            ⚠️ CELUI-CI N'ARRÊTE RIEN, et l'écran le dit aussi clairement que
            l'autre dit l'inverse. Une mauvaise valeur produit du BRUIT, pas un
            incident — et deux champs qui se ressemblent sans agir pareil sont
            un piège, exactement comme les durées (§P3.7). */}
        {charge?.seuils_acteur && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--sk-border)' }}>
            <div style={{ ...etiquette, marginBottom: 10 }}>{t('money.alert_label')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
              {Object.keys(charge.seuils_acteur).map((acteur) => (
                <label key={acteur} style={{ fontSize: 13 }}>
                  <span style={etiquette}>
                    {acteur === 'organization' ? t('spendByActor.kindOrg') : t('spendByActor.kindExpert')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    step={1}
                    value={seuilsActeur[acteur] ?? ''}
                    onChange={(e) => setSeuilsActeur((p) => ({ ...p, [acteur]: e.target.value }))}
                    style={champArgent}
                    disabled={argentEnCours}
                  />
                </label>
              ))}
            </div>
            <p
              style={{
                fontSize: 12.5,
                color: '#1e40af',
                background: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: 8,
                padding: '9px 11px',
                lineHeight: 1.5,
                marginTop: 12,
              }}
            >
              <strong>{t('money.alert_warns_label')}</strong> {t('money.alert_warns_body')}
            </p>
            <button
              type="button"
              onClick={() => void enregistrerArgent()}
              disabled={argentEnCours}
              style={{
                marginTop: 14,
                padding: '10px 20px',
                background: argentEnCours ? 'var(--sk-border)' : 'var(--sk-text)',
                color: argentEnCours ? 'var(--sk-faint)' : 'var(--sk-surface)',
                border: 'none',
                borderRadius: 8,
                fontSize: 13.5,
                fontWeight: 600,
                cursor: argentEnCours ? 'default' : 'pointer',
              }}
            >
              {argentEnCours ? t('money.saving') : t('money.save')}
            </button>
            <div style={aide}>{t('money.help')}</div>
          </div>
        )}
        <div style={aide}>{t('spendByActor.unattributedHelp')}</div>
      </section>

      {/* ── LES RÉSUMÉS QUI N'ONT PAS PU ÊTRE ÉCRITS ────────────────────
          Placé juste après la dépense, et pas ailleurs : la dépense Claude
          affichée au-dessus ne sert QUE la rédaction de ces résumés. « Ce que
          l'IA coûte » et « ce qu'elle n'a pas pu faire » se lisent ensemble. */}
      <section style={carte}>
        <div style={titreBloc}>{t('failures.title')}</div>
        {charge?.pannes === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('failures.unavailable')}</div>
        ) : (charge?.pannes ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('failures.none')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {(charge?.pannes ?? []).map((p) => (
              <div
                key={`${p.cause}:${p.surface}`}
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontSize: 13.5 }}
              >
                {/* Les trois causes restent DISTINCTES jusqu'ici : les additionner
                    reproduirait le compteur unique qu'on remplace. */}
                <span style={{ fontWeight: 600, color: 'var(--sk-text)' }}>
                  {t(`failures.cause.${p.cause}` as 'failures.cause.plafond')}
                </span>
                <span style={{ color: 'var(--sk-muted)' }}>
                  {t(`failures.surface.${p.surface}` as 'failures.surface.candidature')}
                </span>
                <span style={{ color: 'var(--sk-text)', fontWeight: 600 }}>{p.pannes}</span>
              </div>
            ))}
          </div>
        )}
        <div style={aide}>{t('failures.help')}</div>
      </section>

      {/* ── LES DEPASSEMENTS DU PLAFOND DE RELANCE ──────────────────────
          Le seuil n'a deliberement AUCUN champ sur cet ecran : un seuil
          anti-abus n'est pas un reglage commercial, et le rendre modifiable
          invite a le relever le jour ou il gene — c'est-a-dire le jour ou il
          sert. En echange il se LIT, ici, a cote du compteur de pannes. */}
      <section style={carte}>
        <div style={titreBloc}>{t('overruns.title')}</div>
        {charge?.depassements === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('overruns.unavailable')}</div>
        ) : (charge?.depassements ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('overruns.none')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {(charge?.depassements ?? []).map((d) => (
              <div
                key={d.origine}
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontSize: 13.5 }}
              >
                <span style={{ fontWeight: 600, color: 'var(--sk-text)' }}>
                  {t(`overruns.origine.${d.origine}` as 'overruns.origine.profil_modifie')}
                </span>
                <span style={{ color: 'var(--sk-text)', fontWeight: 600 }}>{d.depassements}</span>
                <span style={{ color: 'var(--sk-muted)' }}>
                  {t('overruns.experts', { count: d.experts })}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={aide}>{t('overruns.help')}</div>
      </section>

      {/* ── LES RUNS QUI NE SE SONT PAS ACHEVES ─────────────────────────
          Au-dela du plafond de tentatives, l-annonce cesse d-etre rejouee.
          Rien ne le disait : ni l-organisation qui ne recoit aucun candidat,
          ni l-expert qui ne voit aucune annonce. Un abandon silencieux est le
          plus couteux des defauts a diagnostiquer. */}
      <section style={carte}>
        <div style={titreBloc}>{t('unfinished.title')}</div>
        {charge?.inacheves === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('unfinished.unavailable')}</div>
        ) : (charge?.inacheves ?? []).length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('unfinished.none')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {(charge?.inacheves ?? []).map((r) => (
              <div
                key={r.etat}
                style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontSize: 13.5 }}
              >
                <span style={{ fontWeight: 600, color: r.etat === 'abandonne' ? '#b45309' : 'var(--sk-text)' }}>
                  {t(`unfinished.etat.${r.etat}` as 'unfinished.etat.abandonne')}
                </span>
                <span style={{ color: 'var(--sk-text)', fontWeight: 600 }}>{r.publications}</span>
                {r.plus_ancien && (
                  <span style={{ color: 'var(--sk-muted)' }}>
                    {t('unfinished.depuis', { date: new Date(r.plus_ancien).toLocaleDateString(locale) })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div style={aide}>{t('unfinished.help')}</div>
      </section>

      {/* ── LA DISTRIBUTION OBSERVÉE ───────────────────────────────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('distribution.title')}</div>
        {charge?.distribution === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('distribution.unavailable')}</div>
        ) : !distribution || distribution.runs_observes === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('distribution.empty')}</div>
        ) : (
          <div style={{ display: 'grid', gap: 6, fontSize: 13.5, color: 'var(--sk-text)' }}>
            <div>{t('distribution.runs', { count: distribution.runs_observes })}</div>
            <div>
              {t('distribution.percentiles', {
                p50: distribution.score_p50_moyen ?? '—',
                p90: distribution.score_p90_moyen ?? '—',
              })}
            </div>
            <div>{t('distribution.notified', { avg: distribution.notifies_moyen ?? '—' })}</div>
            <div>
              {t('distribution.extremes', {
                zero: distribution.runs_zero_notifie,
                all: distribution.runs_tout_notifie,
              })}
            </div>
          </div>
        )}
        <div style={aide}>{t('distribution.help')}</div>
      </section>

      {/* ── LA COUVERTURE ──────────────────────────────────────────────── */}
      <section style={carte}>
        <div style={titreBloc}>{t('coverage.title')}</div>
        {charge?.couverture === null ? (
          <div style={{ fontSize: 13, color: '#b45309' }}>{t('coverage.unavailable')}</div>
        ) : !couverture || couverture.runs_observes === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--sk-faint)' }}>{t('coverage.empty')}</div>
        ) : (
          <div
            style={{
              fontSize: 13.5,
              color: couverture.experts_non_notes > 0 ? '#dc2626' : 'var(--sk-text)',
              fontWeight: couverture.experts_non_notes > 0 ? 600 : 400,
            }}
          >
            {t('coverage.line', {
              complets: couverture.runs_complets,
              total: couverture.runs_observes,
              manquants: couverture.experts_non_notes,
            })}
          </div>
        )}
        <div style={aide}>{t('coverage.help')}</div>
      </section>

      {/* ── LES RÉGLAGES, PAR ÉCOSYSTÈME ───────────────────────────────── */}
      {(charge?.reglages ?? []).map((r) => {
        const modifie = !!brouillons[r.domain_id]
        return (
          <section key={r.domain_id} style={carte}>
            <div style={titreBloc}>
              {r.domaine?.name ?? r.domaine?.slug ?? r.domain_id}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
              <div>
                <label style={etiquette} htmlFor={`feed-${r.domain_id}`}>{t('fields.feed')}</label>
                <input
                  id={`feed-${r.domain_id}`}
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={String(valeur(r, 'feed_threshold'))}
                  onChange={(e) => modifier(r.domain_id, 'feed_threshold', Number(e.target.value))}
                  style={champ}
                />
                <div style={aide}>{t('fields.feed_help')}</div>
              </div>

              <div>
                <label style={etiquette} htmlFor={`notify-${r.domain_id}`}>{t('fields.notify')}</label>
                <input
                  id={`notify-${r.domain_id}`}
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  value={String(valeur(r, 'notify_threshold'))}
                  onChange={(e) => modifier(r.domain_id, 'notify_threshold', Number(e.target.value))}
                  style={champ}
                />
                <div style={aide}>{t('fields.notify_help')}</div>
              </div>

              <div>
                <label style={etiquette} htmlFor={`batch-${r.domain_id}`}>{t('fields.batch')}</label>
                <input
                  id={`batch-${r.domain_id}`}
                  type="number"
                  step="1"
                  min={1}
                  max={1000}
                  value={String(valeur(r, 'rerank_batch_size'))}
                  onChange={(e) => modifier(r.domain_id, 'rerank_batch_size', Number(e.target.value))}
                  style={champ}
                />
                <div style={aide}>{t('fields.batch_help')}</div>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={valeur(r, 'notify_enabled') as unknown as boolean}
                onChange={(e) => modifier(r.domain_id, 'notify_enabled', e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--sk-text)' }}>
                  {t('fields.notify_enabled')}
                </span>
                <span style={{ ...aide, display: 'block', marginTop: 2 }}>
                  {t('fields.notify_enabled_help')}
                </span>
              </span>
            </label>

            <div style={{ ...aide, marginTop: 12 }}>
              {t('fields.model', { model: r.rerank_model })}
            </div>

            <button
              type="button"
              disabled={!modifie || enregistrement === r.domain_id}
              onClick={() => void enregistrer(r)}
              style={{
                marginTop: 14,
                padding: '9px 18px',
                borderRadius: 9,
                border: 'none',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: modifie ? 'pointer' : 'default',
                background: modifie ? '#111827' : 'var(--sk-border)',
                color: modifie ? '#fff' : 'var(--sk-faint)',
              }}
            >
              {enregistrement === r.domain_id ? t('saving') : t('save')}
            </button>
          </section>
        )
      })}
    </div>
  )
}

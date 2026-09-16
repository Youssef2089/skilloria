import type { SupabaseClient } from '@supabase/supabase-js'
import {
  coutUsd,
  unitesBrutes,
  type ConsommationIA,
  type TarifModele,
} from '@/lib/ai-consommation'

/**
 * LE PLAFOND DE DÉPENSE — et ce qui se passe quand on l'atteint.
 *
 * LA RÈGLE, ET ELLE EST LE SUJET DE CE FICHIER
 *   Au plafond, la fonctionnalité SE DÉGRADE ET LE DIT. Elle ne disparaît pas en
 *   silence, et elle ne continue pas à dépenser.
 *
 *   Les deux échecs faciles, écartés l'un et l'autre :
 *     • continuer à appeler « juste cette fois » — un plafond qu'on dépasse
 *       n'est pas un plafond ;
 *     • s'arrêter sans un mot — l'annonce reste sans candidats, personne ne sait
 *       pourquoi, et on cherche un bug pendant deux jours.
 *
 *   Ce module rend donc toujours une RAISON NOMMABLE, que l'appelant écrit dans
 *   la trace du run. Un run arrêté au plafond est visible comme tel.
 *
 * POURQUOI DES ÉVÉNEMENTS ET PAS UN COMPTEUR
 *   Un compteur qu'on incrémente perd l'historique au premier doute. Avec les
 *   événements on peut toujours répondre à « pourquoi ce mois-là ? » sans avoir
 *   prévu la question.
 *
 * CE QUE CE MODULE NE FAIT PAS
 *   Il n'estime rien. Il enregistre ce qui a été CONSOMMÉ, après l'appel, avec
 *   les unités telles que le fournisseur les compte. Un plafond réglé sur des
 *   estimations dérive silencieusement.
 */

export type Fournisseur = 'rerank' | 'claude'

export type EtatDepense = {
  provider: Fournisseur
  plafond_usd: number
  depense_mois_usd: number
  reste_usd: number
  au_plafond: boolean
}

/**
 * Peut-on encore dépenser chez ce fournisseur ?
 *
 * FAIL-SAFE CHOISI : sur panne de lecture, on REFUSE. C'est l'inverse du repli
 * habituel de ce projet, et c'est voulu — les autres fail-safes protègent un
 * affichage, celui-ci protège de l'argent. Ne pas savoir combien on a dépensé
 * n'autorise pas à dépenser plus.
 */
export async function budgetDisponible(
  supabaseAdmin: SupabaseClient,
  provider: Fournisseur,
): Promise<{ ok: true; etat: EtatDepense } | { ok: false; raison: string }> {
  const { data, error } = await supabaseAdmin.rpc('ai_spend_status')
  if (error) {
    console.error('[budget] état de dépense illisible', { provider, message: error.message })
    return {
      ok: false,
      raison: `état de dépense illisible (${error.message}) — on refuse plutôt que de dépenser à l'aveugle`,
    }
  }
  const lignes = (data ?? []) as Array<{
    provider: string
    monthly_cap_usd: number | string
    depense_mois: number | string
    reste: number | string
    au_plafond: boolean
  }>
  const l = lignes.find((x) => x.provider === provider)
  if (!l) {
    return { ok: false, raison: `aucun plafond défini pour « ${provider} »` }
  }
  const etat: EtatDepense = {
    provider,
    plafond_usd: Number(l.monthly_cap_usd),
    depense_mois_usd: Number(l.depense_mois),
    reste_usd: Number(l.reste),
    au_plafond: l.au_plafond === true,
  }
  if (etat.au_plafond) {
    return {
      ok: false,
      raison: `plafond mensuel atteint (${etat.depense_mois_usd.toFixed(2)} $ / ${etat.plafond_usd.toFixed(2)} $)`,
    }
  }
  return { ok: true, etat }
}

/**
 * Enregistre une dépense RÉELLEMENT consommée.
 *
 * Best-effort assumé : si l'écriture échoue, l'appel au fournisseur a déjà eu
 * lieu et son coût est déjà engagé. Faire échouer le run ne rendrait pas
 * l'argent — mais le silence, lui, ferait dériver le plafond. On journalise donc
 * bruyamment, avec le montant, pour qu'un écart reste retrouvable.
 */
export async function enregistrerDepense(
  supabaseAdmin: SupabaseClient,
  args: {
    provider: Fournisseur
    domain_id?: string | null
    units: number
    cost_usd: number
    context?: Record<string, unknown>
  },
): Promise<void> {
  // ⚠️ NE LÈVE JAMAIS, SUR AUCUN CHEMIN.
  //   Un expert qui dépose son CV ne doit pas être bloqué parce qu'on n'a pas
  //   su compter une dépense. Le `try` couvre AUSSI ce que le `error` de
  //   PostgREST ne couvre pas : une panne réseau, un client mal formé, une
  //   exception synchrone du SDK. Même règle que le compteur de pannes de
  //   rédaction — le module se tait sur l'échec du parcours, jamais l'inverse.
  try {
    const { error } = await supabaseAdmin.from('ai_spend_events').insert({
      provider: args.provider,
      domain_id: args.domain_id ?? null,
      units: Math.max(0, Math.round(args.units)),
      cost_usd: Math.max(0, args.cost_usd),
      context: args.context ?? null,
    })
    if (error) {
      console.error('[budget] DÉPENSE NON ENREGISTRÉE — le plafond va dériver', {
        provider: args.provider,
        units: args.units,
        cost_usd: args.cost_usd,
        message: error.message,
      })
    }
  } catch (err) {
    console.error('[budget] DÉPENSE NON ENREGISTRÉE (exception) — le plafond va dériver', {
      provider: args.provider,
      units: args.units,
      cost_usd: args.cost_usd,
      cause: err instanceof Error ? err.message : String(err),
    })
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * LA GRILLE TARIFAIRE, ET L'ENREGISTREMENT QUI S'EN SERT
 *
 * ═══ POURQUOI UNE SECONDE FONCTION D'ENREGISTREMENT ═════════════════════════
 *   `enregistrerDepense` prend un coût DÉJÀ CALCULÉ. C'est ce qui a permis à
 *   deux points de dépense d'appliquer 3 $ / 15 $ — les prix de Sonnet 4.6 — à
 *   des appels Sonnet 5 (2 $ / 10 $) et, demain, Haiku (1 $ / 5 $).
 *
 *   `enregistrerDepenseIA` ne PREND PAS de coût : elle prend ce qui a été
 *   CONSOMMÉ et le modèle qui l'a consommé, puis lit le tarif en base. Le
 *   calcul ne peut plus diverger d'un appelant à l'autre, parce qu'il n'y a
 *   plus qu'un endroit où il se fait.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Les actions qui dépensent. Nommer ferme la liste, et l'écran les regroupe. */
export type ActionIA =
  | 'cv_parsing'
  | 'matching_pool'
  | 'candidature_assessment'
  | 'pitch'
  | 'expert_verification'
  | 'org_verification'
  | 'publication_quality'

/**
 * Le tarif d'un modèle, ou `null` s'il n'est pas dans la grille.
 *
 * Aucune mémoïsation : la lecture est une ligne par clé primaire, et un tarif
 * mis en cache continuerait d'appliquer l'ancien prix après une correction —
 * c'est-à-dire exactement le défaut qu'on ferme. Même raisonnement que
 * `lib/ai-quotas.ts`.
 */
async function chargerTarif(
  supabaseAdmin: SupabaseClient,
  model: string,
): Promise<TarifModele | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ai_model_tarifs')
      .select('model, usd_par_1m_entree, usd_par_1m_sortie, usd_par_unite')
      .eq('model', model)
      .maybeSingle()
    if (error || !data) return null
    const r = data as unknown as TarifModele
    return {
      model: r.model,
      usd_par_1m_entree: r.usd_par_1m_entree == null ? null : Number(r.usd_par_1m_entree),
      usd_par_1m_sortie: r.usd_par_1m_sortie == null ? null : Number(r.usd_par_1m_sortie),
      usd_par_unite: r.usd_par_unite == null ? null : Number(r.usd_par_unite),
    }
  } catch {
    return null
  }
}

/**
 * Enregistre ce qu'un appel a consommé, au tarif de SON modèle.
 *
 * ⚠️ UN TARIF INCONNU NE CASSE RIEN, ET NE SE TAIT PAS.
 *    On journalise la consommation BRUTE avec un coût NUL, un drapeau
 *    `tarif_manquant` dans le contexte, et une erreur bruyante. Trois raisons
 *    de ne pas refuser l'appel à la place :
 *      · l'appel a DÉJÀ eu lieu — le coût est engagé, refuser ne rend rien ;
 *      · casser le dépôt d'un CV parce qu'une ligne de configuration manque
 *        serait un défaut bien pire que celui qu'on corrige ;
 *      · les unités brutes sont conservées, donc le coût reste RECALCULABLE
 *        une fois le tarif posé.
 *    Le plafond, lui, cesse de compter cette dépense — d'où le drapeau, qui la
 *    rend retrouvable.
 *
 * NE LÈVE JAMAIS, sur aucun chemin.
 */
export async function enregistrerDepenseIA(
  supabaseAdmin: SupabaseClient,
  args: {
    provider: Fournisseur
    action: ActionIA
    consommation: ConsommationIA
    domain_id?: string | null
    context?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const tarif = await chargerTarif(supabaseAdmin, args.consommation.model)
    const cout = coutUsd(args.consommation, tarif)

    if (cout === null) {
      console.error(
        '[budget] TARIF INCONNU — dépense journalisée à 0, le plafond ne la compte pas',
        { model: args.consommation.model, action: args.action },
      )
    }

    await enregistrerDepense(supabaseAdmin, {
      provider: args.provider,
      domain_id: args.domain_id ?? null,
      units: unitesBrutes(args.consommation),
      cost_usd: cout ?? 0,
      context: {
        model: args.consommation.model,
        action: args.action,
        ...(cout === null ? { tarif_manquant: true } : {}),
        ...(args.consommation.forme === 'jetons'
          ? { jetons_entree: args.consommation.entree, jetons_sortie: args.consommation.sortie }
          : { unites: args.consommation.unites }),
        ...(args.context ?? {}),
      },
    })
  } catch (err) {
    console.error('[budget] DÉPENSE NON ENREGISTRÉE (exception) — le plafond va dériver', {
      action: args.action,
      cause: err instanceof Error ? err.message : String(err),
    })
  }
}

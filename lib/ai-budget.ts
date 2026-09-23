import type { SupabaseClient } from '@supabase/supabase-js'
import {
  coutUsd,
  unitesBrutes,
  type ConsommationIA,
  type TarifModele,
} from '@/lib/ai-consommation'
import { arretParPlafondActeur, type EtatActeur } from '@/lib/ai-plafonds'

/**
 * LES PLAFONDS DE DÉPENSE — et ce qui se passe quand on les atteint.
 *
 * ┌─ DEUX NIVEAUX, ET ILS N'ARRÊTENT PAS LA MÊME CHOSE ─────────────────────┐
 * │ ① LE PLAFOND PAR ACTEUR — il arrête ce que la PLATEFORME dépense d'elle- │
 * │    même pour cet acteur-là. Une organisation au plafond publie quand     │
 * │    même ; son annonce n'est simplement plus classée. Un expert au        │
 * │    plafond garde son compte utilisable. La règle de ce qui s'arrête vit  │
 * │    dans `lib/ai-plafonds.ts`, où son contrôle l'EXÉCUTE.                  │
 * │                                                                          │
 * │ ② LE PLAFOND GLOBAL — LE DERNIER GARDE-FOU. Lui arrête TOUT, parce       │
 * │    qu'il parle d'un budget qui n'existe plus. Il ne distingue pas : à ce │
 * │    stade il n'y a plus rien à distinguer.                                │
 * │                                                                          │
 * │ L'ORDRE EST LE PLUS SPÉCIFIQUE D'ABORD. Un acteur qui dérape doit être   │
 * │ arrêté par SON plafond, en nommant SON dépassement — pas par le global,  │
 * │ qui dirait « la plateforme est à court » et enverrait chercher ailleurs. │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ET L'ALERTE PAR ACTEUR RESTE EN DESSOUS, inchangée : elle SIGNALE, elle
 * n'empêche rien (§D.9). La base garantit qu'elle reste sous le plafond —
 * au-dessus, elle ne se déclencherait jamais.
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
 * L'ÉTAT DE DÉPENSE D'UN ACTEUR — sa dépense du mois, son plafond, son alerte.
 *
 * FAIL-SAFE : sur panne de lecture, on rend `null` et l'appelant REFUSE. Ne pas
 * savoir ce qu'un acteur a dépensé n'autorise pas à dépenser pour lui.
 *
 * ⚠️ `null` NE VEUT PAS DIRE « RIEN DÉPENSÉ ». La fonction de base rend
 *    toujours une ligne, même pour un acteur sans dépense ; zéro ligne ou une
 *    erreur signifient donc « je ne sais pas », et les deux se traitent pareil
 *    (§E.22 : une lecture en panne ne rend pas un verdict métier).
 */
async function etatDeLActeur(
  supabaseAdmin: SupabaseClient,
  acteur: ActeurIA,
): Promise<{ ok: true; etat: EtatActeur | null } | { ok: false; raison: string }> {
  // Un acteur non imputable n'a pas de plafond à lui : il n'y a personne à qui
  // l'imputer. Seul le plafond global le concerne — et c'est déclaré, pas subi.
  if (acteur.type === 'non_imputable') return { ok: true, etat: null }
  try {
    const { data, error } = await supabaseAdmin.rpc('ai_spend_acteur_etat', {
      p_acteur_type: acteur.type,
      p_acteur_id: acteur.id,
    })
    if (error) {
      console.error('[budget] état de l acteur illisible', {
        acteur: acteur.type,
        message: error.message,
      })
      return {
        ok: false,
        raison: `état de dépense de l'acteur illisible (${error.message}) — on refuse plutôt que de dépenser à l'aveugle`,
      }
    }
    // ⚠️ ON NE LIT QUE LE PLAFOND. La base rend aussi l'alerte et son état ;
    //    les transporter ici les rendrait DISPONIBLES dans un parcours, et une
    //    alerte devient un blocage parce qu'elle était à portée de main, pas
    //    parce que quelqu'un l'a décidé (§D.9, gardé par `diag-depense-ia`).
    const l = (data ?? [])[0] as
      | {
          depense_mois: number | string
          plafond_mensuel_usd: number | string
          au_plafond: boolean
        }
      | undefined
    if (!l) {
      return {
        ok: false,
        raison: `aucun réglage de plafond pour un acteur de type « ${acteur.type} »`,
      }
    }
    return {
      ok: true,
      etat: {
        depense_mois_usd: Number(l.depense_mois),
        plafond_mensuel_usd: Number(l.plafond_mensuel_usd),
        au_plafond: l.au_plafond === true,
      },
    }
  } catch (err) {
    return {
      ok: false,
      raison: `état de dépense de l'acteur illisible (${err instanceof Error ? err.message : String(err)})`,
    }
  }
}

/**
 * Peut-on encore dépenser chez ce fournisseur, POUR CET ACTEUR ?
 *
 * FAIL-SAFE CHOISI : sur panne de lecture, on REFUSE. C'est l'inverse du repli
 * habituel de ce projet, et c'est voulu — les autres fail-safes protègent un
 * affichage, celui-ci protège de l'argent. Ne pas savoir combien on a dépensé
 * n'autorise pas à dépenser plus.
 *
 * ⚠️ L'ACTEUR ET L'ACTION SONT OBLIGATOIRES, SANS DÉFAUT. Un défaut aurait
 *    reproduit le défaut qu'on ferme : un appel qui échappe au plafond par
 *    distraction, du côté qui ne bloque jamais. Même parade que `ActeurIA`
 *    dans `enregistrerDepenseIA` — et les deux appels d'un même point de
 *    dépense portent DÉSORMAIS le même acteur, ce qu'un contrôle vérifie.
 */
export async function budgetDisponible(
  supabaseAdmin: SupabaseClient,
  provider: Fournisseur,
  pour: { acteur: ActeurIA; action: ActionIA },
): Promise<{ ok: true; etat: EtatDepense } | { ok: false; raison: string }> {
  // ── ① LE PLAFOND DE L'ACTEUR, D'ABORD — le plus spécifique ──────────────
  const acteurEtat = await etatDeLActeur(supabaseAdmin, pour.acteur)
  if (!acteurEtat.ok) return { ok: false, raison: acteurEtat.raison }
  const arret = arretParPlafondActeur(pour.action, acteurEtat.etat)
  if (arret.arrete) {
    return {
      ok: false,
      raison: `plafond mensuel de l'acteur atteint (${arret.depense_mois_usd.toFixed(2)} $ / ${arret.plafond_mensuel_usd.toFixed(2)} $) — le compte reste utilisable, seul le classement s'arrête`,
    }
  }

  // ── ② LE PLAFOND GLOBAL — le dernier garde-fou ──────────────────────────
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
    /** L'acteur DÉCLENCHEUR — au plus un des deux, jamais les deux (cf. `ActeurIA`). */
    organization_id?: string | null
    profile_id?: string | null
    action?: ActionIA | null
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
      organization_id: args.organization_id ?? null,
      profile_id: args.profile_id ?? null,
      action: args.action ?? null,
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
 * QUI FAIT MONTER LA FACTURE — et pourquoi un seul acteur, jamais deux.
 *
 * L'acteur retenu est celui qui DÉCLENCHE la dépense, pas celui qui en profite.
 * Un jugement de candidature profite à l'organisation, mais c'est l'expert qui
 * l'a déclenché en postulant : il est porté au profil.
 *
 * ═══ POURQUOI UNE UNION, ET PAS DEUX CHAMPS OPTIONNELS ══════════════════════
 *   Deux champs optionnels laisseraient renseigner les deux. La somme par
 *   organisation et la somme par profil compteraient alors deux fois la même
 *   dépense, et leur total dépasserait la dépense réelle. La base porte la même
 *   règle (`ai_spend_un_seul_acteur`) — ici elle est portée par le TYPE, donc
 *   l'erreur ne compile pas au lieu d'échouer en production.
 *
 * ═══ L'ARGUMENT EST OBLIGATOIRE, ET IL N'A AUCUN DÉFAUT ═════════════════════
 *   Pas de `acteur?:`. Un huitième point de dépense écrit demain DOIT choisir —
 *   y compris choisir `non_imputable`, mais alors en écrivant la raison, qui
 *   part dans le contexte et se lit à l'écran. Un défaut silencieux aurait
 *   reproduit exactement le défaut qu'on ferme : une dépense qui n'appartient à
 *   personne sans que personne l'ait décidé.
 */
export type ActeurIA =
  | { type: 'organization'; id: string }
  | { type: 'profile'; id: string }
  | { type: 'non_imputable'; pourquoi: string }

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
      .select('model, usd_par_1m_entree, usd_par_1m_sortie, usd_par_unite, usd_par_recherche, usd_par_recherche_web')
      .eq('model', model)
      .maybeSingle()
    if (error || !data) return null
    const r = data as unknown as TarifModele
    return {
      model: r.model,
      usd_par_1m_entree: r.usd_par_1m_entree == null ? null : Number(r.usd_par_1m_entree),
      usd_par_1m_sortie: r.usd_par_1m_sortie == null ? null : Number(r.usd_par_1m_sortie),
      usd_par_unite: r.usd_par_unite == null ? null : Number(r.usd_par_unite),
      // ⚠️ LE PRIX D'UNE RECHERCHE, ET C'EST LUI QUI COMPTE DEPUIS §D.24. Le
      //    reranker était compté au DOCUMENT alors qu'il est facturé à la
      //    RECHERCHE ; l'écart dépendait de la taille du lot, donc d'un
      //    réglage.
      usd_par_recherche: r.usd_par_recherche == null ? null : Number(r.usd_par_recherche),
      usd_par_recherche_web:
        r.usd_par_recherche_web == null ? null : Number(r.usd_par_recherche_web),
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
    /** OBLIGATOIRE, sans défaut : cf. `ActeurIA`. */
    acteur: ActeurIA
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
      // Le type garantit qu'un seul des deux est renseigné ; ces deux lignes ne
      // font que le transcrire en colonnes.
      organization_id: args.acteur.type === 'organization' ? args.acteur.id : null,
      profile_id: args.acteur.type === 'profile' ? args.acteur.id : null,
      action: args.action,
      units: unitesBrutes(args.consommation),
      cost_usd: cout ?? 0,
      context: {
        model: args.consommation.model,
        action: args.action,
        ...(cout === null ? { tarif_manquant: true } : {}),
        // La raison d'un non-imputable est CONSERVÉE : c'est ce qui permet de
        // distinguer un angle mort assumé d'un oubli.
        ...(args.acteur.type === 'non_imputable'
          ? { non_imputable_pourquoi: args.acteur.pourquoi }
          : {}),
        // ⚠️ LA FORME EST ÉCRITE SUR CHAQUE LIGNE, et pas seulement ses
        //    chiffres. `units` mélange des jetons et des recherches — deux
        //    unités différentes dans une même colonne, ce qui est assumé —,
        //    et sans cette étiquette une ligne se lirait à l'envers (§E.24).
        forme: args.consommation.forme,
        ...(args.consommation.forme === 'jetons'
          ? {
              jetons_entree: args.consommation.entree,
              jetons_sortie: args.consommation.sortie,
              // Les recherches web du MÊME appel. Absentes quand il n'en a pas
              // fait ; comptées dans le coût, jamais dans `units`.
              ...(args.consommation.recherches_web
                ? { recherches_web: args.consommation.recherches_web }
                : {}),
            }
          : args.consommation.forme === 'recherches'
            ? {
                recherches: args.consommation.recherches,
                // ⚠️ D'OÙ VIENT LE NOMBRE, ET C'EST LA MOITIÉ QUI COMPTE.
                //    `fournisseur` : il l'a dit. `plancher` : il ne l'a pas dit,
                //    et on a compté le MINIMUM structurel — un appel coûte au
                //    moins une unité. Sans cette étiquette, les deux se
                //    liraient comme mesurés (§E.24), et une dépense
                //    sous-comptée passerait pour une dépense connue.
                unites_source: args.consommation.source,
              }
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

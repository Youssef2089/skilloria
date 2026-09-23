import { capaciteActive } from '@/lib/interrupteurs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { budgetDisponible, enregistrerDepenseIA, type ActeurIA } from '@/lib/ai-budget'

/**
 * LE RERANKER — un score par couple (requête, document), sans compétition.
 *
 * ═══ CE QUI CHANGE PAR RAPPORT À CLAUDE ═══════════════════════════════════
 *   Un reranker note CHAQUE couple indépendamment des autres. « Aucune
 *   compétition entre experts » cesse d'être une consigne écrite dans un prompt
 *   — que rien ne garantissait — pour devenir une propriété du moteur : deux
 *   experts notés dans deux lots différents obtiennent exactement les scores
 *   qu'ils auraient obtenus ensemble.
 *
 *   C'est pour cela qu'il n'y a plus de plafond de vivier. On ne choisit plus
 *   « les 100 premiers » : on note tout le monde.
 *
 * ═══ CE QUE LE SCORE N'EST PAS ═════════════════════════════════════════════
 *   Il vit dans [0,1] mais n'est PAS calibré. Il ne se lit pas comme une
 *   proportion, et deux requêtes différentes ne se comparent pas. Ce module ne
 *   le normalise donc jamais sur le lot : normaliser reviendrait à classer les
 *   experts les uns par rapport aux autres, c'est-à-dire à réintroduire la
 *   compétition que le moteur vient de supprimer.
 *
 * ═══ AUCUNE BIBLIOTHÈQUE ═══════════════════════════════════════════════════
 *   Appel HTTP direct. La règle « aucune dépendance ajoutée » n'a été levée que
 *   pour le FOURNISSEUR, pas pour son paquet npm.
 *
 * ═══ ÉCHEC PARTIEL : DIT, JAMAIS CACHÉ ═════════════════════════════════════
 *   Un lot en échec n'est pas un lot vide. Si on le traitait comme tel, des
 *   experts disparaîtraient du vivier sans qu'aucune règle ne les ait écartés —
 *   exactement ce que la règle figée interdit. Les lots en échec sont comptés,
 *   remontés, et le run est marqué INACHEVÉ pour être rejoué.
 */

const ENDPOINT = 'https://api.cohere.com/v2/rerank'

/*
 * LE COÛT UNITAIRE A QUITTÉ CE FICHIER.
 *
 *   Il y vivait en constante — « le seul endroit à corriger quand la grille du
 *   fournisseur change », disait son commentaire. C'était vrai POUR CE MODULE,
 *   et c'est précisément le problème : chaque module avait le sien, et celui
 *   de `ai-assessment` appliquait les prix de Sonnet 4.6 à des appels Sonnet 5.
 *
 *   Un tarif change quand LE FOURNISSEUR change ses prix, jamais quand on
 *   déploie. Il vit donc en base (`ai_model_tarifs`), et `enregistrerDepenseIA`
 *   lit celui du modèle RÉELLEMENT appelé — ici `args.model`, qui est réglable
 *   au back-office et peut donc changer sans que ce fichier bouge.
 *
 *   Ce qui NE change pas : on journalise les unités BRUTES, donc le coût reste
 *   recalculable quand la grille change (cf. ai_spend_events.units).
 */

/**
 * Délai d'attente d'un appel au fournisseur.
 *
 * Court devant le couperet de la fonction (60 s), long devant un appel normal
 * (quelques centaines de millisecondes). Un lot pendu rend la main au lieu de
 * consommer tout le budget de temps du run et de faire perdre les autres.
 */
const DELAI_FOURNISSEUR_MS = 10_000

/**
 * Nombre de lots notés EN MÊME TEMPS.
 *
 * ═══ POURQUOI PAS 1 (l'ancien comportement) ═══════════════════════════════
 *   La notation était strictement séquentielle. À 200 documents par lot,
 *   12 000 profils font 60 appels enchaînés : la fonction est tuée à 60 s bien
 *   avant la fin. La séquence était le mur.
 *
 * ═══ POURQUOI PAS 20 ══════════════════════════════════════════════════════
 *   Le fournisseur limite le débit. Au-delà d'une poignée d'appels simultanés,
 *   on récolte des 429 — que notre politique traite en UN seul nouvel essai.
 *   Une concurrence trop haute ne va donc pas plus vite : elle transforme des
 *   lots réussis en lots perdus, et le run reste inachevé.
 *
 * ═══ POURQUOI QUATRE ══════════════════════════════════════════════════════
 *   Quatre divise le temps mural par quatre — 60 appels d'une seconde passent
 *   d'une minute à quinze secondes, sous le couperet — tout en restant dans un
 *   régime où un fournisseur normalement dimensionné ne limite pas. C'est le
 *   plus petit nombre qui supprime le mur à l'échelle promise, et le plus grand
 *   qui n'invente pas de nouveau risque.
 *
 * ⚠️ CE NOMBRE NE TOUCHE PAS À L'INDÉPENDANCE DES NOTES. Chaque lot est un
 *    appel séparé, `top_n` vaut la taille du lot, et aucune note n'est calculée
 *    en fonction d'une autre. Changer l'ORDRE ou le PARALLÉLISME des appels ne
 *    change donc aucune note — c'est une propriété du découpage, pas une
 *    promesse de commentaire (cf. diag-moteur-reranking).
 */
const CONCURRENCE_LOTS = 4

export type DocumentANoter = { id: string; texte: string }

export type ResultatRerank = {
  /** Scores par id de document. Un id absent n'a PAS été noté. */
  scores: Map<string, number>
  /** Documents effectivement notés. */
  notes: number
  /** Lots partis en échec. Non nul ⇒ le run n'est pas achevé. */
  lots_en_echec: number
  /** Renseigné quand le moteur s'est arrêté : toujours une raison NOMMABLE. */
  arret?: string
  /**
   * LA MÊME RAISON, EN VALEUR — parce qu'`arret` est une phrase de JOURNAL.
   *
   * Depuis le 21/09/2026 un écran dépend de cet arrêt : quand le moteur ne
   * tourne pas, l'expert doit lire « la recherche n'a pas pu aboutir », et non
   * « aucune mission ne correspond à votre profil ». La première version lisait
   * `arret` AU MOTIF — une expression régulière sur du français. Reformuler la
   * phrase, corriger sa faute d'accent, la traduire : chacun de ces gestes
   * aurait rendu l'écran menteur sans que rien ne rougisse (§E.24).
   *
   * La phrase reste, pour le journal. Le code est ce qu'on lit.
   */
  arret_code?: ArretDeNotation
  model: string
}

/**
 * Les raisons pour lesquelles la notation ne produit AUCUN score.
 *
 * `aucun_document` n'est pas une panne : c'est un vivier vide, donc un
 * résultat. Les trois autres sont des empêchements, et ne doivent jamais être
 * présentées comme un résultat.
 */
export type ArretDeNotation =
  | 'interrupteur_ferme'
  | 'cle_absente'
  | 'aucun_document'
  | 'plafond_atteint'

type ReponseCohere = {
  results?: Array<{ index?: number; relevance_score?: number }>
  /**
   * ╔════════════════════════════════════════════════════════════════════════╗
   * ║ CE QUE LE FOURNISSEUR DIT AVOIR FACTURÉ. On le LIT — on ne l'estime pas.║
   * ╚════════════════════════════════════════════════════════════════════════╝
   *   Le compteur multipliait le nombre de DOCUMENTS par un prix au document.
   *   Cohere facture à l'unité de RECHERCHE, et il la renvoie lui-même dans
   *   chaque réponse. Deux raisons de la lire plutôt que de la recalculer :
   *
   *   ① un lot de N documents ne vaut pas toujours une seule unité — au-delà
   *      d'une certaine taille le fournisseur en compte plusieurs, et la règle
   *      est la SIENNE, pas la nôtre : la répliquer ici la ferait diverger en
   *      silence le jour où il la change (§E.13) ;
   *   ② un nombre déduit d'un réglage local (`rerank_batch_size`) n'est pas une
   *      mesure — et c'est exactement ce défaut-là qu'on ferme.
   *
   * ⚠️ TOUT EST OPTIONNEL PARCE QUE C'EST UNE RÉPONSE RÉSEAU, pas un contrat.
   *    Un champ absent ne doit pas faire échouer une notation réussie ; il fait
   *    tomber sur le PLANCHER, et le plancher se DÉCLARE (cf. `source`).
   */
  meta?: { billed_units?: { search_units?: number } }
}

/**
 * Le nombre d'unités de recherche facturées par un appel, et d'où il vient.
 *
 * `plancher` : le fournisseur ne l'a pas dit. On compte UNE unité — le minimum
 * structurel d'un appel abouti, jamais zéro : un appel qui a rendu des scores a
 * été facturé. Sous-compter à zéro rendrait une dépense réelle INVISIBLE, ce qui
 * est le défaut que ce lot ferme, en plus petit.
 */
function unitesFacturees(charge: ReponseCohere): {
  recherches: number
  source: 'fournisseur' | 'plancher'
} {
  const u = charge.meta?.billed_units?.search_units
  // Un zéro annoncé par le fournisseur est une réponse, pas une absence : il se
  // respecte. Seuls l'absence et l'illisible tombent sur le plancher.
  if (typeof u === 'number' && Number.isFinite(u) && u >= 0) {
    return { recherches: u, source: 'fournisseur' }
  }
  return { recherches: 1, source: 'plancher' }
}

/** Découpe en lots de taille fixe. Un lot vide n'est jamais envoyé. */
function enLots<T>(items: readonly T[], taille: number): T[][] {
  const lots: T[][] = []
  for (let i = 0; i < items.length; i += taille) lots.push(items.slice(i, i + taille))
  return lots.filter((l) => l.length > 0)
}

/**
 * Une panne de transport se retente ; un refus du fournisseur, non.
 *
 * La distinction porte sur le CODE, pas sur le message : un classement au
 * message a déjà laissé passer des erreurs réseau que le message n'annonçait
 * pas.
 */
function estTransitoire(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function noterUnLot(args: {
  cle: string
  model: string
  requete: string
  lot: readonly DocumentANoter[]
}): Promise<
  | {
      ok: true
      scores: Array<{ id: string; score: number }>
      /** Ce que CET appel a coûté, tel que le fournisseur l'a compté. */
      facture: { recherches: number; source: 'fournisseur' | 'plancher' }
    }
  | { ok: false; transitoire: boolean; detail: string }
> {
  let reponse: Response
  try {
    reponse = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${args.cle}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: args.model,
        query: args.requete,
        documents: args.lot.map((d) => d.texte),
        top_n: args.lot.length,
      }),
      // ── LE DÉLAI D'ATTENTE, POSÉ POUR DE VRAI ──────────────────────────
      //  Avant, cette fonction acceptait un `signal?: AbortSignal` que PERSONNE
      //  ne fournissait jamais. Le paramètre existait, la garde n'existait pas :
      //  c'est pire qu'une absence de garde, parce que le lecteur croit qu'il y
      //  en a une.
      //
      //  Un fournisseur lent doit rendre la main, pas bloquer jusqu'au couperet
      //  de la fonction : sans délai, un seul lot pendu consommait les soixante
      //  secondes et faisait perdre TOUS les autres.
      //
      //  Le délai est court devant le couperet, et long devant un appel normal
      //  (quelques centaines de millisecondes) : un lot lent est réessayé une
      //  fois, comme toute panne transitoire — un abandon de fetch lève, et
      //  atterrit donc dans le `catch` ci-dessous, classé transitoire.
      signal: AbortSignal.timeout(DELAI_FOURNISSEUR_MS),
    })
  } catch (err) {
    // Panne de transport : elle n'a pas de code HTTP, et c'est justement le cas
    // qu'un classement au message laissait passer.
    return {
      ok: false,
      transitoire: true,
      detail: err instanceof Error ? err.message : String(err),
    }
  }

  if (!reponse.ok) {
    const corps = await reponse.text().catch(() => '')
    return {
      ok: false,
      transitoire: estTransitoire(reponse.status),
      detail: `HTTP ${reponse.status} ${corps.slice(0, 200)}`,
    }
  }

  let charge: ReponseCohere
  try {
    charge = (await reponse.json()) as ReponseCohere
  } catch (err) {
    return { ok: false, transitoire: false, detail: `réponse illisible : ${String(err)}` }
  }

  const resultats = charge.results ?? []
  if (resultats.length === 0) {
    // Zéro résultat pour un lot non vide n'est pas « personne ne correspond » :
    // c'est une réponse incohérente. La traiter comme un résultat effacerait
    // tout un lot d'experts en silence.
    return { ok: false, transitoire: false, detail: 'réponse sans aucun score pour un lot non vide' }
  }

  const scores: Array<{ id: string; score: number }> = []
  for (const r of resultats) {
    const i = r.index
    const s = r.relevance_score
    if (typeof i !== 'number' || i < 0 || i >= args.lot.length) continue
    if (typeof s !== 'number' || !Number.isFinite(s)) continue
    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║ LA FRONTIÈRE. C'EST ICI, ET NULLE PART AILLEURS, QUE L'ÉCHELLE CHANGE.║
    // ╚══════════════════════════════════════════════════════════════════════╝
    //   Le fournisseur produit du [0,1] — c'est sa nature, on n'y touche pas.
    //   Le produit, lui, n'a qu'UNE échelle : 0 à 10, la même que les notes de
    //   jugement. Avant, les filtres vivaient en 0-1 et les notes en 0-10, sur
    //   la même page : « 1 » voulait dire PARFAIT d'un côté et MÉDIOCRE de
    //   l'autre, et rien ne le disait.
    //
    //   POURQUOI ICI. Une conversion d'unité se pose là où l'on franchit la
    //   frontière avec un système externe. La poser à l'AFFICHAGE laisserait
    //   deux représentations ; la poser à la COMPARAISON la mettrait sur quatre
    //   sites (index.ts ×2, run-for-expert.ts ×2), et en oublier un
    //   transformerait `score < 7` en `score < 0.7` — tout passe, ou rien ne
    //   passe, EN SILENCE.
    //
    //   ⚠️ AUCUN AUTRE `* 10` NI `/ 10` SUR UN SCORE N'EXISTE DANS LE PRODUIT,
    //      et `diag-echelle-des-notes.mjs` rougit si l'un apparaît. En ajouter
    //      un ailleurs, c'est rouvrir la double représentation que ce lot ferme.
    //
    //   On borne AVANT de multiplier : un score hors bornes violerait la
    //   contrainte de base et ferait échouer TOUT le lot d'écriture.
    scores.push({ id: args.lot[i].id, score: Math.max(0, Math.min(1, s)) * 10 })
  }
  return { ok: true, scores, facture: unitesFacturees(charge) }
}

/**
 * Note tous les documents, par lots, en tenant le budget.
 *
 * ORDRE DES GARDES, ET IL COMPTE :
 *   1. l'interrupteur (une fonctionnalité coupée ne doit rien coûter) ;
 *   2. la clé (une clé absente n'est pas une panne : c'est un déploiement
 *      incomplet, et le dire évite deux heures de recherche) ;
 *   3. le budget, RELU ENTRE LES LOTS — le vérifier une seule fois au début
 *      laisserait un run géant dépasser le plafond de dix fois.
 */
export async function rerankerTout(args: {
  supabaseAdmin: SupabaseClient
  domainId: string | null
  model: string
  tailleLot: number
  requete: string
  documents: readonly DocumentANoter[]
  /**
   * QUI PAIE CE RUN — et ce n'est pas le même selon le SENS.
   *
   *   annonce → experts : l'organisation a publié, elle déclenche la notation ;
   *   expert → annonces : l'expert s'est ouvert, il la déclenche.
   *
   * La notation est le poste le plus cher du moteur : la porter sur le mauvais
   * acteur inverserait le classement de l'écran. L'appelant connaît son sens ;
   * ce module ne le devine pas.
   */
  acteur: ActeurIA
  contexte?: Record<string, unknown>
  /**
   * Appelé après CHAQUE lot réussi, avec les notes de ce lot seul.
   *
   * C'est le point de reprise : l'appelant persiste ce qu'il vient de recevoir,
   * et n'aura pas à le repayer si le run est interrompu. Absent ⇒ aucune
   * mémoire, comportement d'avant.
   */
  memoriser?: (notes: ReadonlyArray<{ id: string; score: number }>) => Promise<void>
}): Promise<ResultatRerank> {
  const vide: ResultatRerank = {
    scores: new Map(),
    notes: 0,
    lots_en_echec: 0,
    model: args.model,
  }

  // Convention unique, fail-closed (cf. lib/interrupteurs.ts). Avant,
  // ENABLE_RERANKING=0 / =off / =FALSE laissait le reranking actif — et
  // DÉPENSER. Une dépense ne part jamais sur une faute de frappe.
  if (!capaciteActive('ENABLE_RERANKING')) {
    return {
      ...vide,
      arret: 'reranking désactivé par interrupteur (ENABLE_RERANKING=false)',
      arret_code: 'interrupteur_ferme',
    }
  }
  const cle = process.env.COHERE_API_KEY
  if (!cle) {
    console.error('[rerank] COHERE_API_KEY absente — aucun profil ne sera noté')
    return {
      ...vide,
      arret: 'clé du fournisseur de reranking absente de l environnement',
      arret_code: 'cle_absente',
    }
  }
  if (args.documents.length === 0) {
    return { ...vide, arret: 'aucun document à noter', arret_code: 'aucun_document' }
  }

  const scores = new Map<string, number>()
  let notes = 0
  let lotsEnEchec = 0
  let arret: string | undefined
  let arretCode: ArretDeNotation | undefined

  const lots = enLots(args.documents, args.tailleLot)

  // ── LES LOTS SONT NOTÉS PAR VAGUES, PLUS EN FILE ─────────────────────────
  //
  //  Le budget reste relu ENTRE LES VAGUES, jamais une seule fois au début :
  //  un run géant dépasserait le plafond de dix fois. Ce qui change, c'est
  //  qu'une vague de `CONCURRENCE_LOTS` lots part ensemble au lieu de
  //  s'enchaîner. À l'échelle promise, c'est la différence entre une minute et
  //  quinze secondes — donc entre un run tué par le couperet et un run fini.
  //
  //  ⚠️ L'INDÉPENDANCE DES NOTES SURVIT, ET C'EST STRUCTUREL. Chaque lot est
  //     un appel séparé, `top_n` vaut sa taille, et aucun score n'est calculé
  //     en fonction d'un autre. Grouper les appels autrement ne peut donc pas
  //     déplacer une note : l'ordre et le parallélisme n'entrent nulle part
  //     dans le calcul.
  for (const vague of enLots(lots, CONCURRENCE_LOTS)) {
    //  ⚠️ C'EST ICI QUE LE PLAFOND D'ACTEUR MORD, ET NULLE PART AILLEURS.
    //     Le classement est la seule dépense que la PLATEFORME déclenche
    //     d'elle-même (`lib/ai-plafonds.ts`) : une organisation au plafond
    //     publie quand même, son annonce n'est simplement plus classée, et un
    //     expert au plafond garde son compte entier.
    //     Le budget est RELU ENTRE LES LOTS — le vérifier une seule fois au
    //     début laisserait un run géant dépasser le plafond de dix fois.
    const budget = await budgetDisponible(args.supabaseAdmin, 'rerank', {
      acteur: args.acteur,
      action: 'matching_pool',
    })
    if (!budget.ok) {
      arret = budget.raison
      arretCode = 'plafond_atteint'
      break
    }

    const resultats = await Promise.all(
      vague.map(async (lot) => {
        let r = await noterUnLot({ cle, model: args.model, requete: args.requete, lot })
        if (!r.ok && r.transitoire) {
          // UN SEUL nouvel essai, et seulement sur une panne transitoire. En
          // rejouer davantage ferait payer plusieurs fois le même lot pour une
          // panne durable — la reprise du run inachevé est faite pour cela.
          console.warn('[rerank] lot en échec transitoire, second essai', { detail: r.detail })
          r = await noterUnLot({ cle, model: args.model, requete: args.requete, lot })
        }
        return { lot, r }
      }),
    )

    for (const { lot, r } of resultats) {
      if (!r.ok) {
        lotsEnEchec++
        console.error('[rerank] lot NON NOTÉ', {
          taille: lot.length,
          transitoire: r.transitoire,
          detail: r.detail,
        })
        // On ne s'arrête pas : les autres lots méritent d'être notés. Le
        // compteur dira que ce run est incomplet.
        continue
      }

      for (const s of r.scores) scores.set(s.id, s.score)
      notes += lot.length

      // Dépense enregistrée APRÈS l'appel, sur ce qui a réellement été consommé.
      await enregistrerDepenseIA(args.supabaseAdmin, {
        provider: 'rerank',
        action: 'matching_pool',
        acteur: args.acteur,
        // ⚠️ CE QU'ON PAIE, ET PLUS CE QU'ON A ENVOYÉ. Cette ligne portait
        //    `unites: lot.length` — le nombre de DOCUMENTS — multiplié par un
        //    prix au document. Le fournisseur facture à la RECHERCHE, et il
        //    renvoie le nombre d'unités : on le lit.
        consommation: {
          forme: 'recherches',
          model: args.model,
          recherches: r.facture.recherches,
          source: r.facture.source,
        },
        domain_id: args.domainId,
        context: { ...args.contexte },
      })

      // ── CE QUI EST NOTÉ NE SERA PAS RENOTÉ ────────────────────────────────
      //  C'est ce qui supprime le mur ; la parallélisation ne fait que le
      //  repousser. Sans cette trace, un run tué par le couperet repart de zéro
      //  au rejeu et REPAYE les lots déjà payés — jusqu'à l'abandon silencieux
      //  au bout de cinq tentatives.
      //  Best-effort : échouer à MÉMORISER une note ne doit pas faire perdre la
      //  note elle-même. Au pire, ce lot sera repayé une fois.
      if (args.memoriser) await args.memoriser(r.scores)
    }
  }

  return { scores, notes, lots_en_echec: lotsEnEchec, arret, arret_code: arretCode, model: args.model }
}

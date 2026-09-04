import type { SupabaseClient } from '@supabase/supabase-js'
import { budgetDisponible, enregistrerDepense } from '@/lib/ai-budget'

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

/**
 * Coût unitaire, en dollars, par document noté.
 *
 * ÉCRIT ICI ET NON DEVINÉ : le plafond mensuel s'appuie dessus, et un plafond
 * calculé sur une estimation fantaisiste ne protège de rien. Cette constante est
 * le seul endroit à corriger quand la grille du fournisseur change — et le coût
 * enregistré reste recalculable, puisqu'on journalise AUSSI le nombre d'unités
 * brutes (cf. ai_spend_events.units).
 */
const COUT_USD_PAR_DOCUMENT = 0.000002

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
  model: string
}

type ReponseCohere = {
  results?: Array<{ index?: number; relevance_score?: number }>
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
  signal?: AbortSignal
}): Promise<{ ok: true; scores: Array<{ id: string; score: number }> } | { ok: false; transitoire: boolean; detail: string }> {
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
      signal: args.signal,
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
    // Le fournisseur annonce [0,1] ; on borne quand même. Un score hors bornes
    // violerait la contrainte de base et ferait échouer TOUT le lot d'écriture.
    scores.push({ id: args.lot[i].id, score: Math.max(0, Math.min(1, s)) })
  }
  return { ok: true, scores }
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
  contexte?: Record<string, unknown>
}): Promise<ResultatRerank> {
  const vide: ResultatRerank = {
    scores: new Map(),
    notes: 0,
    lots_en_echec: 0,
    model: args.model,
  }

  if (process.env.ENABLE_RERANKING === 'false') {
    return { ...vide, arret: 'reranking désactivé par interrupteur (ENABLE_RERANKING=false)' }
  }
  const cle = process.env.COHERE_API_KEY
  if (!cle) {
    console.error('[rerank] COHERE_API_KEY absente — aucun profil ne sera noté')
    return { ...vide, arret: 'clé du fournisseur de reranking absente de l environnement' }
  }
  if (args.documents.length === 0) {
    return { ...vide, arret: 'aucun document à noter' }
  }

  const scores = new Map<string, number>()
  let notes = 0
  let lotsEnEchec = 0
  let arret: string | undefined

  const lots = enLots(args.documents, args.tailleLot)
  for (const lot of lots) {
    // Budget relu AVANT chaque lot. Au plafond, on s'arrête et on le DIT : le
    // run reste inachevé, donc visible, et sera rejoué le mois suivant ou après
    // relèvement du plafond.
    const budget = await budgetDisponible(args.supabaseAdmin, 'rerank')
    if (!budget.ok) {
      arret = budget.raison
      break
    }

    let resultat = await noterUnLot({ cle, model: args.model, requete: args.requete, lot })
    if (!resultat.ok && resultat.transitoire) {
      // UN SEUL nouvel essai, et seulement sur une panne transitoire. En
      // rejouer davantage ferait payer plusieurs fois le même lot pour une
      // panne durable — le rattrapage du run inachevé est fait pour cela.
      console.warn('[rerank] lot en échec transitoire, second essai', { detail: resultat.detail })
      resultat = await noterUnLot({ cle, model: args.model, requete: args.requete, lot })
    }

    if (!resultat.ok) {
      lotsEnEchec++
      console.error('[rerank] lot NON NOTÉ', {
        taille: lot.length,
        transitoire: resultat.transitoire,
        detail: resultat.detail,
      })
      // On ne s'arrête pas : les autres lots méritent d'être notés. Le compteur
      // dira que ce run est incomplet.
      continue
    }

    for (const s of resultat.scores) scores.set(s.id, s.score)
    notes += lot.length

    // Dépense enregistrée APRÈS l'appel, sur ce qui a réellement été consommé.
    await enregistrerDepense(args.supabaseAdmin, {
      provider: 'rerank',
      domain_id: args.domainId,
      units: lot.length,
      cost_usd: lot.length * COUT_USD_PAR_DOCUMENT,
      context: { model: args.model, ...args.contexte },
    })
  }

  return { scores, notes, lots_en_echec: lotsEnEchec, arret, model: args.model }
}

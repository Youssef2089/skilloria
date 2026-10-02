import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * LES RÉGLAGES DU MOTEUR — lus en base, jamais devinés.
 *
 * IL N'Y A AUCUNE VALEUR DE REPLI DANS CE FICHIER, et c'est délibéré.
 *   Un repli codé en dur serait un SECOND réglage, invisible, qui prendrait la
 *   main le jour où la ligne manque — c'est-à-dire le jour où l'on comprend le
 *   moins ce qui se passe. Ligne absente ⇒ on refuse, et on le dit.
 *
 * UN FILTRE, UN PALIER — ET LE MOT « SEUIL » N'EST NI L'UN NI L'AUTRE
 *   `feed`   : ce qui entre dans le flux de l'expert — ET CE QUI LE PRÉVIENT.
 *   `notify` : à partir de quelle note une annonce porte le palier « Correspondance forte ».
 *   Le filtre TRIE : il ne bloque rien et ne juge personne — d'où le mot FILTRE, et non
 *   « seuil », qui désignait quatre comportements incompatibles dans ce produit.
 *
 * ⚠️ AUCUN RÉGLAGE NE DÉCIDE PLUS SI L'EXPERT EST PRÉVENU (décision de Youssef, 02/10/2026, lot alertes) :
 *   une annonce qui s'affiche dans ses recommandations le prévient — dans la cloche, et par e-mail s'il l'a
 *   activé. `notify_enabled` (faux par défaut) et le filtre de notification (8/10) coupaient l'alerte d'une
 *   annonce AFFICHÉE avec « Correspondance forte » et la pastille rouge : l'expert la voyait, rien ne partait.
 *   La colonne `notify_enabled` reste en base, INERTE, et n'est plus lue ; `notify_threshold` ne règle plus que
 *   le PALIER affiché. Un réglage qui contredirait la règle n'existe donc plus — ni dans le code, ni à l'écran.
 *
 * POURQUOI LE MODÈLE VOYAGE AVEC EUX
 *   Changer de reranker change l'échelle. Le filtre et le palier deviennent alors faux,
 *   et les scores anciens ne sont plus comparables aux nouveaux. Les lire
 *   ensemble force à voir l'un quand on touche à l'autre.
 */

export type MatchingSettings = {
  feed_threshold: number
  /** Le PALIER « Correspondance forte » — il ne décide d'aucune notification (voir l'en-tête). */
  notify_threshold: number
  rerank_model: string
  rerank_batch_size: number
}

export type SettingsOutcome =
  | { ok: true; settings: MatchingSettings }
  | { ok: false; raison: 'absente' | 'illisible'; detail: string }

export async function loadMatchingSettings(
  supabaseAdmin: SupabaseClient,
  domainId: string,
): Promise<SettingsOutcome> {
  const { data, error } = await supabaseAdmin
    .from('matching_settings')
    .select('feed_threshold, notify_threshold, rerank_model, rerank_batch_size')
    .eq('domain_id', domainId)
    .maybeSingle()

  // DISTINCTION : une requête en ÉCHEC n'est pas une ligne ABSENTE. Les
  // confondre ferait dire « l'écosystème n'est pas configuré » sur une panne de
  // lecture, et enverrait chercher un réglage qui existe.
  if (error) {
    console.error('[matching] lecture des réglages en échec', { domainId, message: error.message })
    return { ok: false, raison: 'illisible', detail: error.message }
  }
  if (!data) {
    console.error('[matching] aucun réglage pour cet écosystème', { domainId })
    return {
      ok: false,
      raison: 'absente',
      detail: `matching_settings ne contient aucune ligne pour le domaine ${domainId}.`,
    }
  }

  const r = data as unknown as Record<string, unknown>
  const nombre = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null

  const feed = nombre(r.feed_threshold)
  const notify = nombre(r.notify_threshold)
  const batch = nombre(r.rerank_batch_size)
  const model = typeof r.rerank_model === 'string' && r.rerank_model.length > 0 ? r.rerank_model : null

  // La base porte déjà ces contraintes. On les revérifie ici parce qu'une
  // contrainte peut être relâchée un jour, et qu'un filtre hors bornes ne
  // produirait aucune erreur — juste un moteur qui écarte tout le monde, ou
  // personne.
  if (feed == null || notify == null || batch == null || !model) {
    return { ok: false, raison: 'illisible', detail: 'Réglage incomplet en base.' }
  }
  // ÉCHELLE 0-10, la seule du produit. Ce refus est aussi ce qui a rendu la
  // bascule sûre : pendant la fenêtre entre la migration et le déploiement,
  // c'est l'ANCIENNE version de ce test (`> 1`) qui faisait refuser le moteur
  // au lieu de le laisser filtrer dix fois trop large.
  if (feed < 0 || feed > 10 || notify < 0 || notify > 10) {
    return { ok: false, raison: 'illisible', detail: `Notes hors [0,10] : flux=${feed}, palier fort=${notify}.` }
  }
  if (notify < feed) {
    return {
      ok: false,
      raison: 'illisible',
      detail: `Le palier « Correspondance forte » (${notify}) est sous le filtre du flux (${feed}) : la base le refuse aussi (matching_settings_ordre_check).`,
    }
  }

  return {
    ok: true,
    settings: {
      feed_threshold: feed,
      notify_threshold: notify,
      rerank_model: model,
      rerank_batch_size: Math.max(1, Math.min(1000, Math.round(batch))),
    },
  }
}

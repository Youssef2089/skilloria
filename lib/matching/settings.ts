import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * LES RÉGLAGES DU MOTEUR — lus en base, jamais devinés.
 *
 * IL N'Y A AUCUNE VALEUR DE REPLI DANS CE FICHIER, et c'est délibéré.
 *   Un repli codé en dur serait un SECOND réglage, invisible, qui prendrait la
 *   main le jour où la ligne manque — c'est-à-dire le jour où l'on comprend le
 *   moins ce qui se passe. Ligne absente ⇒ on refuse, et on le dit.
 *
 * POURQUOI DEUX SEUILS
 *   `feed`   : ce qui entre dans le flux de l'expert.
 *   `notify` : ce qui déclenche une notification.
 *   Le levier est « montrer plus, notifier moins ». Ils étaient déjà deux, mais
 *   le premier vivait dans le prompt et n'était modifiable que par un
 *   développeur.
 *
 * POURQUOI LE MODÈLE VOYAGE AVEC EUX
 *   Changer de reranker change l'échelle. Les deux seuils deviennent alors faux,
 *   et les scores anciens ne sont plus comparables aux nouveaux. Les lire
 *   ensemble force à voir l'un quand on touche à l'autre.
 */

export type MatchingSettings = {
  feed_threshold: number
  notify_threshold: number
  notify_enabled: boolean
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
    .select('feed_threshold, notify_threshold, notify_enabled, rerank_model, rerank_batch_size')
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
  // contrainte peut être relâchée un jour, et qu'un seuil hors bornes ne
  // produirait aucune erreur — juste un moteur qui écarte tout le monde, ou
  // personne.
  if (feed == null || notify == null || batch == null || !model) {
    return { ok: false, raison: 'illisible', detail: 'Réglage incomplet en base.' }
  }
  if (feed < 0 || feed > 1 || notify < 0 || notify > 1) {
    return { ok: false, raison: 'illisible', detail: `Seuils hors [0,1] : feed=${feed}, notify=${notify}.` }
  }
  if (notify < feed) {
    return {
      ok: false,
      raison: 'illisible',
      detail: `Le seuil de notification (${notify}) est sous celui du flux (${feed}) : on notifierait pour une annonce invisible.`,
    }
  }

  return {
    ok: true,
    settings: {
      feed_threshold: feed,
      notify_threshold: notify,
      notify_enabled: r.notify_enabled === true,
      rerank_model: model,
      rerank_batch_size: Math.max(1, Math.min(1000, Math.round(batch))),
    },
  }
}

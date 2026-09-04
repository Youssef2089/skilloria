import type { SupabaseClient } from '@supabase/supabase-js'

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
}

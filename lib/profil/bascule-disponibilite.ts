/**
 * LA BASCULE DE DISPONIBILITÉ — ce que chaque voie peut basculer, et la valeur que chaque champ admet.
 *
 * ═══ POURQUOI CE MODULE (lot T.4, 28/09/2026) ═══════════════════════════════
 *   Les tableaux de bord freelance et CDI écrivaient `profiles` DEPUIS LE NAVIGATEUR, par la
 *   politique `profiles_self_update` : quatre bascules (disponibilité, ouverture croisée) sans
 *   pièce ni ligne au grand livre — une porte latérale (§D.26). Elles passent désormais par
 *   UN geste serveur, `POST /api/profile/disponibilite`, qui écrit `disponibilite_basculee`.
 *   Ce module est la seule définition des champs et des valeurs : la route la lit pour VALIDER,
 *   les écrans pour TYPER leur appel — jamais pour juger (§E.15 : la règle vit au serveur).
 *   Un seul module pour les deux tableaux jumeaux : ils ne peuvent pas dériver (§E.20, §D.14).
 */

export type VoieExpert = 'expert_freelance' | 'expert_cdi'

/** Les champs qu'une voie bascule, et les valeurs admises (miroir des contraintes CHECK de `profiles`). */
export const CHAMPS_DE_BASCULE = {
  expert_freelance: {
    availability_status: ['available', 'do_not_disturb'],
    open_to_cdi: [true, false],
  },
  expert_cdi: {
    cdi_status: ['employed', 'open_to_work'],
    open_to_freelance: [true, false],
  },
} as const

export type ChampDeBascule =
  | keyof (typeof CHAMPS_DE_BASCULE)['expert_freelance']
  | keyof (typeof CHAMPS_DE_BASCULE)['expert_cdi']

export type ValeurDeBascule = string | boolean

/** Les issues du geste, fermées. `inchange` n'est pas une erreur : rien à écrire, rien à journaliser. */
export type IssueDeBascule =
  | { ok: true; issue: 'basculee' | 'inchange'; valeur: ValeurDeBascule }
  | { ok: false; code: string }

/**
 * L'appel du geste, partagé par les deux tableaux de bord. `fetcher` est `useSecureFetch()` :
 * jeton, sous-domaine, session unique. Une réponse illisible n'est pas un succès (§E.30).
 */
export async function basculerDisponibilite(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  champ: ChampDeBascule,
  valeur: ValeurDeBascule,
): Promise<IssueDeBascule> {
  let res: Response
  try {
    res = await fetcher('/api/profile/disponibilite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ champ, valeur }),
    })
  } catch {
    return { ok: false, code: 'network_error' }
  }
  const corps = (await res.json().catch(() => null)) as
    | { issue?: string; valeur?: ValeurDeBascule; code?: string }
    | null
  if (res.ok && corps && (corps.issue === 'basculee' || corps.issue === 'inchange') && corps.valeur !== undefined) {
    return { ok: true, issue: corps.issue, valeur: corps.valeur }
  }
  // `journal_error` : la bascule EST FAITE en base, seule la trace manque (et le serveur l'a dit
  // dans ses journaux). Revenir en arrière à l'écran afficherait un état faux.
  if (corps?.code === 'journal_error' && corps.valeur !== undefined) {
    return { ok: true, issue: 'basculee', valeur: corps.valeur }
  }
  return { ok: false, code: corps?.code ?? `http_${res.status}` }
}

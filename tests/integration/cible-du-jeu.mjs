// tests/integration/cible-du-jeu.mjs — OÙ LE GÉNÉRATEUR A LE DROIT D'ÉCRIRE : JAMAIS EN PRODUCTION (lot DevOps CI).
//
// Le grand jeu (tests/integration/generateur-jeu.mjs) crée des milliers de comptes. Il remplit la base jetable de la nuit,
// et servira à remplir l'UAT ; il ne doit JAMAIS toucher la production. La règle, pure, exécutée par
// `diag-integration-continue` sur des environnements fabriqués :
//   · un environnement que la BARRIÈRE lit comme la production (`cibleDeConstruction(env) === 'production'`,
//     lib/configuration/variables.ts, §D.51) : refus ;
//   · une base LOCALE (127.0.0.1, localhost) : autorisée — le runner, le poste ;
//   · une base DISTANTE (une UAT) : autorisée seulement si (1) son identifiant de projet est donné EXPLICITEMENT par
//     `JEU_CIBLE_AUTORISEE` et (2) l'identifiant de la PRODUCTION est déclaré (`SUPABASE_REF_PRODUCTION`) et DIFFÉRENT.
//     Production non déclarée : refus — on ne sait pas si c'est elle (une garde qui ne sait pas reste fermée).
// Jamais une valeur dans un message : des motifs.

/** L'identifiant de projet Supabase d'une adresse de base (`db.<ref>.supabase.co`, ou l'utilisateur `postgres.<ref>`). */
export function refDeLaBase(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const parHote = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)?.[1]
  const parUtilisateur = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1]
  return parHote ?? parUtilisateur ?? null
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} urlBase
 * @param {(env: Record<string, string | undefined>) => string} cibleDeConstruction — la lecture de la barrière
 * @returns {{ autorisee: true, cible: 'locale' | 'distante', ref?: string } | { autorisee: false, motif: string }}
 */
export function cibleDuJeu(env, urlBase, cibleDeConstruction) {
  if (cibleDeConstruction(env) === 'production') return { autorisee: false, motif: 'environnement_de_production' }
  let hote
  try { hote = new URL(urlBase).hostname } catch { return { autorisee: false, motif: 'adresse_illisible' } }
  if (['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hote)) return { autorisee: true, cible: 'locale' }
  const ref = refDeLaBase(urlBase)
  if (!ref) return { autorisee: false, motif: 'projet_non_identifie' }
  const production = (env.SUPABASE_REF_PRODUCTION ?? '').trim()
  if (!production) return { autorisee: false, motif: 'production_non_declaree' }
  if (ref === production) return { autorisee: false, motif: 'cible_de_production' }
  if ((env.JEU_CIBLE_AUTORISEE ?? '').trim() !== ref) return { autorisee: false, motif: 'cible_non_autorisee_explicitement' }
  return { autorisee: true, cible: 'distante', ref }
}

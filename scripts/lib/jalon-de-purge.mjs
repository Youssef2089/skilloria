// scripts/lib/jalon-de-purge.mjs — OÙ VIT L'ÉTAPE 4 DE LA PURGE, lu une fois.
//
// Depuis la migration `journal_purges` (§D.26), l'anonymisation de `users` et
// le JALON `anonymized_at` ne s'écrivent plus dans `lib/account-purge.ts` : ils
// partent par la RPC `anonymiser_compte()`, avec la ligne du grand livre, dans
// une transaction. Quatre diagnostics gardaient cette étape en lisant le
// TypeScript ; déplacer le traitement a déplacé leurs gardes (§E.65). Ils lisent
// désormais la PROPRIÉTÉ là où elle vit — l'appel côté code, la DERNIÈRE
// définition côté SQL — par ce seul module, au lieu de quatre copies d'un motif.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const sansCommentairesSql = (src) => src.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')

/** Le corps de la DERNIÈRE définition de `anonymiser_compte()`, toutes migrations confondues ('' si absente). */
export function corpsAnonymiserCompte(root) {
  const dir = join(root, 'supabase/migrations')
  let corps = ''
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const src = sansCommentairesSql(readFileSync(join(dir, f), 'utf8').split('\r\n').join('\n'))
    const i = src.indexOf('create or replace function public.anonymiser_compte(')
    if (i < 0) continue
    const fin = src.indexOf('$fn$;', src.indexOf('as $fn$', i) + 7)
    corps = src.slice(i, fin < 0 ? undefined : fin + 5)
  }
  return corps
}

/**
 * LA PROPRIÉTÉ, en une question : l'étape 4 écrit-elle `status = 'archived'` ET
 * le jalon `anonymized_at` dans le MÊME UPDATE, gardé par le jalon lui-même ?
 */
export function jalonDansLeMemeUpdate(corps) {
  const m = /update public\.users u\s*set([\s\S]*?)where u\.id = p_user_id\s*and u\.anonymized_at is null/.exec(corps)
  return !!m && /status\s*= 'archived'/.test(m[1]) && /anonymized_at\s*= now\(\)/.test(m[1])
}

/** Position de l'appel de la RPC dans un source TypeScript (-1 si absent). */
export function appelAnonymiserCompte(src) {
  return src.indexOf(".rpc('anonymiser_compte'")
}

/**
 * diag-ce-qui-change.mjs — UNE VRAIE MODIFICATION LAISSE TOUJOURS SA LIGNE AU GRAND LIVRE ; UNE NON-MODIFICATION N'EN
 * LAISSE PAS (ARRÊT 22, §D.33 ; relecture indépendante du 01/10/2026, points 4 et 16).
 *
 * `lib/profil/changements.ts` décide, pour « Profil modifié », « Nom modifié », « Fiche d'organisation modifiée »,
 * « Annonce modifiée », « Écosystème modifié », « Liste des métiers modifiée », ce qui a VRAIMENT changé. La relecture a
 * trouvé qu'il convertissait toute chaîne de chiffres en nombre : « 01000 » et « 1000 » (un code postal), « 0612345678 »
 * et « 612345678 » (un téléphone) étaient égaux — la base changeait, aucune ligne ne s'écrivait. Et réordonner ses
 * expériences — l'ordre que les organisations voient — n'écrivait rien.
 *
 * EXÉCUTÉ, PAS LU (§E.33) : le module est importé et chaque règle passe sur des cas fabriqués, dans les deux sens (ce
 * qui doit être vu comme changé, ce qui ne doit pas l'être).
 *
 * CE QU'IL NE VOIT PAS : la valeur que la base RELIT réellement (une colonne date rendue « 2020-01-01 » face à un envoi
 * « 2020-01 ») — le doute y penche vers « modifié », jamais vers le silence ; c'est voulu.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let C
try {
  C = await import(pathToFileURL(join(ROOT, 'lib/profil/changements.ts')).href)
} catch (err) {
  console.error('✘ lib/profil/changements.ts ne se charge pas — le contrôle n’a pas tourné', err)
  process.exit(2)
}
let echecs = 0
const ok = (cond, label) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}`) }
}
console.log('\n═══ Ce qui change vraiment ═══\n')

// ── Point 4 : une chaîne n'est jamais convertie en nombre ──
ok(!C.memeValeur('01000', '1000'), 'un code postal « 01000 » → « 1000 » EST une modification')
ok(!C.memeValeur('0612345678', '612345678'), 'un téléphone « 0612345678 » → « 612345678 » EST une modification')
ok(!C.memeValeur('+33612345678', '0612345678'), 'le même numéro écrit autrement EST une modification (le doute écrit)')
ok(C.memeValeur(500, '500') && C.memeValeur('500', 500), 'un nombre relu et sa forme texte exacte sont la même valeur (500 / « 500 »)')
ok(!C.memeValeur(500, '0500') && !C.memeValeur(1000, '01000'), 'un nombre et une chaîne à zéro de tête ne sont PAS la même valeur')
ok(C.memeValeur(null, '') && C.memeValeur(undefined, '   ') && C.memeValeur(null, undefined), 'null, undefined et la chaîne vide sont une même absence')
ok(!C.memeValeur(null, 0) && !C.memeValeur('', '0'), 'zéro n’est pas une absence')
ok(C.memeValeur(' Paris ', 'Paris') && !C.memeValeur('Paris', 'paris'), 'une chaîne se compare rognée, casse comprise')
ok(C.memeValeur(['a', 'b'], ['a', 'b']) && !C.memeValeur(['a', 'b'], ['b', 'a']), 'un tableau se compare dans son ordre')
ok(C.memeValeur({ a: 1, b: null }, { a: '1' }) && !C.memeValeur({ a: '01' }, { a: '1' }), 'un objet se compare clé par clé, avec les mêmes règles')
ok(JSON.stringify(C.clesModifiees({ postal_code: '01000', city: 'Bourg', tjm_min: 500 }, { postal_code: '1000', city: 'Bourg', tjm_min: 500 })) === '["postal_code"]',
  'clesModifiees nomme le code postal modifié, et lui seul')
ok(JSON.stringify(C.clesModifiees({ a: 1 }, null)) === '["a"]', 'une relecture en panne (null) compte tout comme modifié')

// ── Point 16 : réordonner ses expériences EST une modification ──
const e1 = { role: 'Architecte', start_date: '2020-01-01' }
const e2 = { role: 'Développeur', start_date: '2018-01-01' }
const lues = [{ ...e1, id: 'x', sort_order: 0 }, { ...e2, id: 'y', sort_order: 1 }]
ok(!C.listeModifiee(lues, [e1, e2], true), 'les mêmes expériences, dans le même ordre : aucune modification')
ok(C.listeModifiee(lues, [e2, e1], true), 'les mêmes expériences RÉORDONNÉES : une modification (décision de Youssef)')
ok(!C.listeModifiee([lues[1], lues[0]], [e1, e2], true), 'l’ordre lu est celui du rang (sort_order), pas celui de la lecture')
ok(C.listeModifiee(lues, [e1, { ...e2, role: 'Développeur senior' }], true), 'une expérience modifiée : une modification')
const f1 = { school: 'ENS', degree: 'Master' }
const f2 = { school: 'IUT', degree: 'DUT' }
ok(!C.listeModifiee([{ ...f1, id: 'a' }, { ...f2, id: 'b' }], [f2, f1]), 'les formations (aucun rang en base) : un autre ordre n’est pas une modification')
ok(C.listeModifiee([{ ...f1, id: 'a' }, { ...f1, id: 'b' }], [f1, f2]), 'deux lignes identiques ne masquent pas une ligne changée (ensemble avec multiplicité)')
ok(C.listeModifiee([{ language: 'fr', level: 'C1' }], [{ language: 'fr', level: 'C2' }]), 'une langue dont le niveau change : une modification')

console.log(`\n${echecs === 0 ? '✅ Une vraie modification se voit ; une non-modification ne s’écrit pas.' : `❌ ${echecs} contrôle(s) rouge(s).`}`)
process.exit(echecs === 0 ? 0 : 1)

// scripts/diag-erreurs-avalees.mjs — RECENSEMENT des erreurs de requête
// converties en « pas de résultat ».
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE SCRIPT
//   La vérification expert échouait depuis la migration, et personne ne le
//   savait : sa requête citait une colonne supprimée, PostgREST rendait une
//   erreur, le code la transformait en `null`, et l'appelant concluait
//   « profil introuvable ». Le profil existait pourtant. Trois quarts de
//   journée de diagnostic possibles pour une colonne renommée.
//
//   Le motif n'est pas propre à ce fichier. Chaque fois qu'une erreur de
//   requête devient une ABSENCE DE DONNÉE, on remplace une panne bruyante par
//   un comportement plausible et faux — le pire des deux mondes, parce que
//   personne ne cherche.
//
// CE QUE CE SCRIPT COMPTE — trois formes, par gravité décroissante
//
//   ① ERREUR NON LUE      `const { data } = await supabase...`
//      L'erreur n'est même pas récupérée. Une requête peut échouer
//      intégralement sans qu'une seule ligne de code s'en aperçoive.
//
//   ② ERREUR IGNORÉE      `const { data, error } = ...` puis `error` jamais
//      relu. Récupérée, puis oubliée : le pire, car le code a l'air prudent.
//
//   ③ ERREUR CONVERTIE    `if (error) { … return null | [] | false }`
//      Le cas de la vérification expert. Souvent DÉLIBÉRÉ et légitime — un
//      compteur best-effort n'a pas à faire échouer une page. Ce n'est donc
//      pas une liste de bugs : c'est une liste d'endroits où il faut avoir
//      DÉCIDÉ, et où le message doit dire « la requête a échoué », jamais
//      « il n'y a rien ».
//
// CE QUE CE SCRIPT N'EST PAS
//   Ni un contrôle qui échoue, ni un cliquet. Il RECENSE et rend 0. Décider
//   quoi corriger est un autre chantier, et il appartient à Youssef.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-erreurs-avalees.mjs           → le décompte
//   node scripts/diag-erreurs-avalees.mjs --detail  → chaque emplacement
//
// AUCUN accès base, AUCUN réseau.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RACINES = ['app', 'lib']

const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === '.next') continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) parcourir(p)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(p)
  }
}
for (const r of RACINES) parcourir(join(ROOT, r))

/** Une déstructuration de résultat Supabase, sur une ou plusieurs lignes. */
const DESTRUCTURATION = /const\s*\{([^}]*)\}\s*=\s*await\s+([A-Za-z_$][\w$.]*)\s*\n?\s*\./g

/** Le corps d'une fonction autour d'une position — approximation par accolades. */
function fenetre(src, pos, lignesApres = 25) {
  const lignes = src.slice(pos).split('\n').slice(0, lignesApres)
  return lignes.join('\n')
}

const RETOUR_MUET = /return\s+(null|\[\]|false|undefined|\{\s*\}|0)\b/

const trouvailles = []

for (const f of fichiers) {
  const src = readFileSync(f, 'utf8')
  const rel = relative(ROOT, f).replace(/\\/g, '/')

  for (const m of src.matchAll(DESTRUCTURATION)) {
    const champs = m[1]
    const objet = m[2]
    // On ne s'intéresse qu'aux appels de base. `auth.supabaseAdmin`, `supabase`,
    // `admin`, `client`… : le nom varie, le motif non.
    if (!/supabase|admin|client|db/i.test(objet)) continue

    const ligne = src.slice(0, m.index).split('\n').length
    const suite = fenetre(src, m.index)
    // Nom réel de la variable d'erreur : `error` ou `error: xxxErr`.
    const alias = /\berror\s*:\s*([A-Za-z_$][\w$]*)/.exec(champs)?.[1]
    const nomErreur = alias ?? (/\berror\b/.test(champs) ? 'error' : null)

    if (!nomErreur) {
      trouvailles.push({ rel, ligne, forme: 'non lue', extrait: m[0].replace(/\s+/g, ' ').slice(0, 80) })
      continue
    }

    // Après la déstructuration : l'erreur est-elle relue ?
    const apres = suite.slice(m[0].length)
    const relue = new RegExp(`\\b${nomErreur}\\b`).test(apres)
    if (!relue) {
      trouvailles.push({ rel, ligne, forme: 'ignorée', extrait: `{ …, ${nomErreur} } jamais relu` })
      continue
    }

    // Relue : est-elle convertie en absence de donnée, sans lever ?
    const bloc = new RegExp(`if\\s*\\(\\s*!?${nomErreur}[\\s\\S]{0,300}?\\}`).exec(apres)?.[0] ?? ''
    if (RETOUR_MUET.test(bloc) && !/throw/.test(bloc)) {
      trouvailles.push({
        rel, ligne, forme: 'convertie',
        extrait: bloc.replace(/\s+/g, ' ').slice(0, 90),
      })
    }
  }
}

const par = (forme) => trouvailles.filter((t) => t.forme === forme)

if (process.argv.includes('--detail')) {
  for (const forme of ['non lue', 'ignorée', 'convertie']) {
    const liste = par(forme)
    console.log(`\n═══ ERREUR ${forme.toUpperCase()} — ${liste.length} ═══\n`)
    for (const t of liste) console.log(`  ${t.rel}:${t.ligne}\n     ${t.extrait}`)
  }
  console.log()
  process.exit(0)
}

const fichiersTouches = new Set(trouvailles.map((t) => t.rel)).size
console.log('\n═══ ERREURS DE REQUÊTE CONVERTIES EN « PAS DE RÉSULTAT » ═══\n')
console.log(`  ① non lue    (l'erreur n'est même pas récupérée)   : ${par('non lue').length}`)
console.log(`  ② ignorée    (récupérée puis jamais relue)          : ${par('ignorée').length}`)
console.log(`  ③ convertie  (if (error) → return null / [] / false): ${par('convertie').length}`)
console.log(`\n  TOTAL : ${trouvailles.length} emplacement(s) sur ${fichiersTouches} fichier(s)`)
console.log('\n  Recensement, pas un contrôle : `--detail` liste les emplacements.')
console.log('  Les formes ② et ③ sont souvent DÉLIBÉRÉES et légitimes ; ce qui ne')
console.log('  l\'est jamais, c\'est un message qui dit « rien trouvé » quand la')
console.log('  requête a échoué.\n')
process.exit(0)

#!/usr/bin/env node
// scripts/diag-requete-staging.mjs — LA REQUÊTE DE STAGING NE DÉCRIT QUE LE PROCHAIN PUSH ET CE QUI NE
// CHANGE PAS ; UNE LIGNE PÉRIMÉE EST UNE FAUSSE ALERTE, ET ELLE ROUGIT ICI AVANT D'ÊTRE COLLÉE LÀ-BAS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (ménage du déploiement, 28/09/2026)
//   `supabase/verifications/staging-avant-push.sql` avait été écrite pour l'état
//   d'AVANT des pushs déjà faits. La phase B déployée, quinze de ses lignes
//   sortaient en ÉCART alors que tout était normal — et une alerte fausse
//   apprend à ignorer les vraies (§E.52). Sa liste des tables journalisées,
//   tenue à la main, avait en outre perdu trois tables (§E.61).
//
// LA PROPRIÉTÉ
//   A. la requête ne fait que LIRE : aucun mot d'écriture ni de DDL hors des
//      chaînes, aucun appel à une fonction de `public` (elle pourrait écrire) ;
//   B. chaque ligne est étiquetée `état :`, `prochain push :` ou `invariant :` ;
//      une seule ligne d'état, la ⓪, et les numéros sont uniques ;
//   C. l'état déclaré en ⓪ est UNE migration du dépôt (résolue par suffixe, §G.3) ;
//      les migrations qui la suivent sont « en attente » ;
//   D. la liste `prochain_push_retire` est EXACTEMENT l'ensemble des
//      `drop function f(types)` en attente — ni une de plus (périmée), ni une de moins ;
//   E. la liste `prochain_push_cree` est EXACTEMENT ce que les migrations en attente
//      créent de NOUVEAU : noms de fonctions, tables, index et contraintes inconnus des
//      migrations appliquées (§E.60) — les contraintes depuis le 29/09/2026 (sous_domaine_reglable :
//      la première contrainte posée par un push passait sous le contrôle) ;
//   F. une ligne `invariant :` ne cite aucun objet que le push retire ou crée, et
//      les tables qu'elle nomme (`tablename in (…)`) existent en état final.
//   G. les deux invariants de §E.73 tiennent par construction : la liste des colonnes de
//      handle_new_user est ÉGALE aux insertions de sa dernière définition ; une colonne attendue
//      absente n'existe pas en état final.
// CE QU'IL NE VOIT PAS, ET LE DIT : l'état RÉEL de staging — c'est la ⓪ qui le
//   compare, au moment où Youssef colle la requête ; une colonne, une politique ou
//   une colonne ou une politique créée par le push (fonctions, tables, index et contraintes sont suivis) ;
//   une nouvelle SIGNATURE d'un nom de fonction déjà connu.
//
//   node scripts/diag-requete-staging.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rejouerMigrations } from './lib/schema-migrations.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOSSIER = join(ROOT, 'supabase', 'migrations')
const REQUETE = 'supabase/verifications/staging-avant-push.sql'
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const lire = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const sansCommentaires = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const sansChaines = (s) => s.replace(/'(?:[^']|'')*'/g, "''")

const ALIAS = [
  [/\btimestamptz\b/g, 'timestamp with time zone'],
  [/\bvarchar\b/g, 'character varying'],
  [/\bint4?\b/g, 'integer'],
  [/\bint8\b/g, 'bigint'],
  [/\bbool\b/g, 'boolean'],
  [/"/g, ''],
]
const canon = (t) => ALIAS.reduce((s, [a, b]) => s.replace(a, b), t.toLowerCase()).replace(/\s+/g, ' ').trim()
const signature = (nom, types) => `${nom.toLowerCase()}(${types.split(',').map(canon).filter(Boolean).join(', ')})`

const requete = sansCommentaires(lire(join(ROOT, REQUETE)))
console.log('\n═══ La requête de staging : le prochain push, et ce qui ne change pas ═══\n')

// ── A. LECTURE SEULE ──
const code = sansChaines(requete)
const ecrit = code.match(/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|call|copy|vacuum|perform|execute|lock|comment|refresh|set)\b/gi) ?? []
ok(ecrit.length === 0, 'A. la requête ne fait que lire — aucun mot d’écriture ni de DDL hors des chaînes', ecrit.join(', ') || undefined)
const appels = code.match(/\bpublic\s*\.\s*\w+\s*\(/gi) ?? []
ok(appels.length === 0, 'A. aucun appel à une fonction de public (elle pourrait écrire)', appels.join(', ') || undefined)

// ── B. LES LIGNES, ÉTIQUETÉES ──
const lignes = [...requete.matchAll(/\(\s*(\d+),\s*'((?:[^']|'')*)',\s*/g)].map((m) => ({ n: Number(m[1]), label: m[2], i: m.index }))
lignes.forEach((l, k) => { l.bloc = requete.slice(l.i, k + 1 < lignes.length ? lignes[k + 1].i : requete.lastIndexOf(') as v(')) })
const ETIQUETTES = /^(état|prochain push|invariant) : /
const sansEtiquette = lignes.filter((l) => !ETIQUETTES.test(l.label))
ok(lignes.length >= 5 && sansEtiquette.length === 0,
  `B. ${lignes.length} lignes, chacune étiquetée état / prochain push / invariant`,
  sansEtiquette.map((l) => `ligne ${l.n} : « ${l.label.slice(0, 60)} »`).join(' · ') || undefined)
const etats = lignes.filter((l) => l.label.startsWith('état : '))
ok(etats.length === 1 && etats[0].n === 0, 'B. une seule ligne d’état, la ⓪')
ok(new Set(lignes.map((l) => l.n)).size === lignes.length, 'B. les numéros de ligne sont uniques')

// ── C. L'ÉTAT DÉCLARÉ, RÉSOLU PAR SUFFIXE ──
const declare = /^\(\s*0,\s*'(?:[^']|'')*',\s*'([a-z0-9_]+)'/.exec(etats[0]?.bloc ?? '')?.[1]
const toutes = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort()
const trouvees = declare ? toutes.filter((f) => f.endsWith(`_${declare}.sql`)) : []
ok(trouvees.length === 1, `C. l’état déclaré (« ${declare ?? '?'} ») est UNE migration du dépôt`,
  trouvees.length ? `ambigu : ${trouvees.join(', ')}` : 'aucune migration ne porte ce suffixe')
if (trouvees.length !== 1) { console.log(`\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC`); process.exit(1) }
const appliquees = toutes.filter((f) => f <= trouvees[0])
const attente = toutes.filter((f) => f > trouvees[0])
console.log(`  ··   ${appliquees.length} migrations appliquées d’après la ⓪, ${attente.length} en attente${attente.length ? ` : ${attente.join(', ')}` : ''}`)
const sqlDe = (f) => sansCommentaires(lire(join(DOSSIER, f)))

// ── D. CE QUE LE PUSH RETIRE ──
const blocRetire = /prochain_push_retire\s*\(\s*signature\s*\)\s*as\s*\(([\s\S]*?)\)\s*,\s*\n/.exec(requete)?.[1] ?? ''
const retire = new Set([...blocRetire.matchAll(/'public\.(\w+)\(([^)]*)\)'/g)].map((m) => signature(m[1], m[2])))
const drops = new Set()
for (const f of attente) {
  for (const m of sqlDe(f).matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?\s*\(([^)]*)\)/gi)) drops.add(signature(m[1], m[2]))
}
const retirePerimees = [...retire].filter((s) => !drops.has(s))
const retireManquantes = [...drops].filter((s) => !retire.has(s))
ok(blocRetire !== '' && retirePerimees.length === 0,
  `D. chaque signature de prochain_push_retire est supprimée par une migration en attente (${retire.size})`,
  retirePerimees.length ? `PÉRIMÉE(S) — aucune migration en attente ne la supprime : ${retirePerimees.join(' · ')}` : undefined)
ok(retireManquantes.length === 0,
  `D. chaque drop function en attente est dans prochain_push_retire (${drops.size})`,
  retireManquantes.length ? `NON PRÉPARÉE(S) : ${retireManquantes.join(' · ')}` : undefined)

// ── E. CE QUE LE PUSH CRÉE ──
const blocCree = /prochain_push_cree\s*\(\s*genre\s*,\s*nom\s*\)\s*as\s*\(([\s\S]*?)\)\s*\n\s*select/.exec(requete)?.[1] ?? ''
const cree = new Set([...blocCree.matchAll(/\(\s*'(fonction|table|index|contrainte)'\s*,\s*'(\w+)'\s*\)/g)].map((m) => `${m[1]}:${m[2].toLowerCase()}`))
const connus = { fonction: new Set(), table: new Set(), index: new Set(), contrainte: new Set() }
const MOTIFS = {
  fonction: /create\s+(?:or\s+replace\s+)?function\s+(?:"?public"?\.)?"?(\w+)"?\s*\(/gi,
  table: /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?/gi,
  index: /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?\s+on\b/gi,
  // ⚠️ LES DEUX FORMES (ARRÊT 19) : `add constraint X` ET la contrainte DÉCLARÉE dans un `create table`
  //    (`constraint "X" check (…)`). La seconde manquait : une contrainte de la baseline recréée par une migration
  //    passait pour NOUVELLE (et la ligne ② aurait dit ÉCART sur un état normal), et les contraintes d'une table
  //    neuve échappaient au contrôle.
  contrainte: /(?:add\s+)?constraint\s+"?(\w+)"?\s+(?:check|unique|primary\s+key|foreign\s+key|exclude)\b/gi,
}
for (const f of appliquees) for (const [g, re] of Object.entries(MOTIFS)) for (const m of sqlDe(f).matchAll(re)) connus[g].add(m[1].toLowerCase())
const nouveaux = new Set()
for (const f of attente) for (const [g, re] of Object.entries(MOTIFS)) for (const m of sqlDe(f).matchAll(re)) if (!connus[g].has(m[1].toLowerCase())) nouveaux.add(`${g}:${m[1].toLowerCase()}`)
const creePerimes = [...cree].filter((c) => !nouveaux.has(c))
const creeManquants = [...nouveaux].filter((c) => !cree.has(c))
ok(blocCree !== '' && creePerimes.length === 0,
  `E. chaque entrée de prochain_push_cree est créée, NOUVELLE, par une migration en attente (${cree.size})`,
  creePerimes.length ? `PÉRIMÉE(S) : ${creePerimes.join(' · ')}` : undefined)
ok(creeManquants.length === 0,
  `E. chaque fonction, table, index ou contrainte NOUVEAU en attente est dans prochain_push_cree (${nouveaux.size})`,
  creeManquants.length ? `NON PRÉPARÉ(S) — un nom déjà pris sauterait en silence (§E.60) : ${creeManquants.join(' · ')}` : undefined)

// ── F. LES INVARIANTS NE DÉPENDENT PAS DU PUSH ──
const invariants = lignes.filter((l) => l.label.startsWith('invariant : '))
const nomsDuPush = new Set([...[...retire].map((s) => s.split('(')[0]), ...[...cree].map((c) => c.split(':')[1])])
// Une liste d'APPARTENANCE (`tablename in (…)`, ligne ⑧) n'est pas une dépendance : une table absente avant le push
// y compte zéro ligne, l'invariant est vrai des deux côtés. `diag-portes-laterales` EXIGE d'ailleurs qu'une table
// journalisée neuve (travaux_ia, ARRÊT 19) y figure dès son push. On retire donc ces listes avant de chercher.
const sansListesDAppartenance = (bloc) => bloc.replace(/\btablename\s+in\s*\(([^)]*)\)/gi, 'tablename in ()')
const citeLePush = invariants.flatMap((l) => [...sansListesDAppartenance(l.bloc).matchAll(/'(?:public\.)?(\w+)(?:\([^)]*\))?'/g)]
  .filter((m) => nomsDuPush.has(m[1].toLowerCase())).map((m) => `ligne ${l.n} : ${m[1]}`))
ok(citeLePush.length === 0, `F. aucune ligne invariante ne cite un objet que le push retire ou crée (${invariants.length} invariants)`,
  citeLePush.join(' · ') || undefined)
const { schema } = rejouerMigrations()
const tablesAbsentes = invariants.flatMap((l) => [...l.bloc.matchAll(/tablename\s+in\s*\(([^)]*)\)/gi)]
  .flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1])).filter((t) => !schema.has(t)).map((t) => `ligne ${l.n} : ${t}`))
ok(tablesAbsentes.length === 0, 'F. chaque table nommée par un invariant existe en état final', tablesAbsentes.join(' · ') || undefined)

// ── F bis. UNE SIGNATURE DE LA LISTE SE COMPARE PAR IDENTIFIANT, JAMAIS PAR TEXTE (push 3, 28/09/2026) ──
//  La ligne ③ comparait « p.oid::regprocedure::text » — « admin_cron_run_now(text,uuid) », sans schéma ni
//  espace — au texte de la liste, « public.admin_cron_run_now(text, uuid) » : ÉCART à tort, la surcharge que
//  le push supprimait n'était pas reconnue. Toute référence à « r.signature » passe par « to_regprocedure() ».
{
  const refs = (code.match(/\br\.signature\b/g) ?? []).length
  const resolues = (requete.match(/to_regprocedure\(r\.signature\)/g) ?? []).length
  ok(refs === resolues && !/regprocedure::text/i.test(code),
    `F bis. chaque signature de prochain_push_retire est résolue par to_regprocedure() — jamais comparée en texte (${resolues}/${refs})`,
    'un texte rendu par Postgres ne ressemble pas à la liste : l’exclusion ne reconnaîtrait rien (§E.67)')
}

// ── G. LES DEUX INVARIANTS DE §E.73, TENUS PAR CONSTRUCTION ──
//  La liste des colonnes de handle_new_user est ÉGALE aux insertions de sa DERNIÈRE définition (§E.34) :
//  une colonne de plus ou de moins, et la ligne mentirait — dans un sens ou dans l'autre.
const { fonctions } = rejouerMigrations()
const ecrites = new Map()
for (const m of (fonctions.get('handle_new_user')?.corps ?? '').matchAll(/insert\s+into\s+public\.(\w+)\s*\(([^)]*)\)/gi)) {
  ecrites.set(m[1], new Set(m[2].split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)))
}
const ligneHnu = invariants.find((l) => /handle_new_user/.test(l.label))
const listees = new Map()
for (const m of (ligneHnu?.bloc ?? '').matchAll(/c\.table_name\s*=\s*'(\w+)'\s+and\s+c\.column_name\s+in\s*\(([^)]*)\)/gi)) {
  listees.set(m[1], new Set([...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1])))
}
const ecartsHnu = []
for (const t of new Set([...ecrites.keys(), ...listees.keys()])) {
  const a = ecrites.get(t) ?? new Set()
  const b = listees.get(t) ?? new Set()
  for (const c of a) if (!b.has(c)) ecartsHnu.push(`${t}.${c} écrite, non listée`)
  for (const c of b) if (!a.has(c)) ecartsHnu.push(`${t}.${c} listée, non écrite`)
}
const total = [...ecrites.values()].reduce((n, s) => n + s.size, 0)
const attenduHnu = /^\(\s*\d+,\s*'(?:[^']|'')*',\s*'(\d+)'/.exec(ligneHnu?.bloc ?? '')?.[1]
ok(ligneHnu && ecrites.size >= 2 && ecartsHnu.length === 0 && attenduHnu === String(total),
  `G. la ligne des colonnes de handle_new_user est ÉGALE à ses insertions (${[...ecrites].map(([t, s]) => `${t} ${s.size}`).join(' + ')}, attendu ${attenduHnu ?? '?'})`,
  ecartsHnu.join(' · ') || (attenduHnu !== String(total) ? `attendu ${attenduHnu}, insertions ${total}` : 'ligne introuvable'))
//  Une colonne attendue ABSENTE (attendu '0') ne doit pas exister en état final : recréée par une
//  migration, la ligne deviendrait une fausse alerte.
const vivantes = invariants.filter((l) => /^\(\s*\d+,\s*'(?:[^']|'')*',\s*'0'/.test(l.bloc))
  .flatMap((l) => [...l.bloc.matchAll(/c\.table_name\s*=\s*'(\w+)'\s+and\s+c\.column_name\s*=\s*'(\w+)'/gi)]
    .filter((m) => schema.get(m[1])?.colonnes.has(m[2])).map((m) => `ligne ${l.n} : ${m[1]}.${m[2]} existe`))
ok(vivantes.length === 0, 'G. une colonne qu’un invariant attend absente n’existe pas en état final', vivantes.join(' · ') || undefined)

console.log(failures === 0
  ? '\n✅ La requête de staging décrit le prochain push et des invariants — aucune ligne périmée.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — la requête collée sur staging donnerait une fausse alerte, ou raterait une vraie`)
process.exit(failures === 0 ? 0 : 1)

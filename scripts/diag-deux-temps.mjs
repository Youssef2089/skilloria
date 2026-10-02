/**
 * diag-deux-temps.mjs — AUCUN DÉPLOIEMENT NE FAIT ÉCHOUER UN GESTE DU CODE EN LIGNE (§E.72, décision de Youssef).
 *
 * LA RÈGLE : entre le `db push` et le `git push`, le site en ligne tourne avec l'ANCIEN code sur la NOUVELLE base. Une
 * migration passée AVANT le déploiement (ou INDIFFÉRENT) ne doit donc rien refuser de ce que l'ancien code écrit : ce
 * qui restreint — une garde, une contrainte, un droit retiré, une signature supprimée, une clé ôtée d'une liste
 * blanche, un refus d'action — part dans un lot SUIVANT, dont les migrations disent « APRÈS le déploiement ». Et une
 * migration APRÈS se pousse quand le code DU LOT est en ligne : elle ne doit rien refuser de ce que CE code écrit.
 *
 * LE CAS QUI L'A FAIT ÉCRIRE (relecture indépendante du 01/10/2026, FEU ROUGE) : le refus GL006 des actions retirées
 * (ARRÊT 22), le déclencheur LG001 des langues et le retrait de l'écriture des photos par le navigateur (recette S1)
 * étaient tous dans le lot A — un message, une langue tapée, une première photo auraient échoué pendant la fenêtre.
 * Et la désactivation de la spécialité « Autre », une REPRISE DE DONNÉES : l'ancien /api/profile rend 400 sur une
 * spécialité inactive qu'une page chargée avant le push enverrait encore. Personne n'avait repassé les migrations de
 * S1 à la règle à la fusion.
 *
 * LE CAS QUI L'A FAIT COMPLÉTER (relecteur, 02/10/2026 — lot zones de travail, point 8) : pour une SECONDE livraison
 * (le lot B, toutes ses migrations APRÈS), il ne vérifiait que l'ORDRE (C) ; ce qu'elles restreignent n'était lu par
 * personne — le rouge de `profil/langues_liste_fermee` (ARRÊT 25) l'a montré : un test du premier temps contredisait
 * la garde du second.
 *
 * CE QU'IL FAIT :
 *   A. Les migrations EN ATTENTE sont celles qui suivent l'état ⓪ de la requête d'avant-push ; chacune dit son ORDRE
 *      DE PASSAGE dans son en-tête (AVANT, APRÈS, INDIFFÉRENT) ;
 *   B. PREMIER TEMPS (AVANT ou INDIFFÉRENT) : il REFUSE, sur un objet que la migration ne crée pas elle-même, un
 *      déclencheur, une contrainte ajoutée, une colonne passée NOT NULL, une politique retirée, une fonction supprimée,
 *      un droit retiré (service_role, anon/authenticated), une désactivation ou une suppression de lignes au push ;
 *      partout : le refus GL006, une clé retirée d'une liste blanche du grand livre.
 *      Une EXCEPTION s'écrit avec sa raison (§G.8) ET SA PREUVE, vérifiée ici sur le CODE EN LIGNE — le commit déclaré
 *      dans `CODE_EN_LIGNE`, dont la dernière migration doit être l'état ⓪ (sinon la déclaration est périmée) :
 *        · `aucun_ecrivain` : aucune ligne du code en ligne, NI de ce lot, n'écrit la table (écritures directes et
 *          fonctions SQL appelées par `.rpc`) ;
 *        · `refus_nomme` : dans le fichier en ligne, l'écriture que la migration peut refuser est la PREMIÈRE du geste,
 *          et son refus est lu par la fonction nommée qui le rend en code d'erreur — rien n'est écrit à moitié ;
 *        · `colonnes_neuves` (lot « critères des annonces », 03/10/2026) : une contrainte qui ne garde que des colonnes
 *          que la MÊME migration crée (nullables ou à défaut vide) ne refuse rien à qui ne les écrit pas — la migration
 *          les crée toutes, chaque contrainte ajoutée sur la table en nomme au moins une, AUCUN écrivain de la table dans
 *          le code en ligne (fichiers et fonctions SQL appelées par `.rpc`) ne nomme l'une d'elles, et le test nommé
 *          existe et les nomme (il prouve qu'une écriture « à l'ancienne » passe) ;
 *   B bis. SECOND TEMPS (APRÈS) : chaque restriction est DÉCLARÉE dans `SECOND_TEMPS` avec ses ÉCRIVAINS (les fichiers
 *      du code du lot qui écrivent ce qu'elle restreint) et le TEST qui prouve que ce qu'ils écrivent passe. Pour une
 *      restriction sur une table, la liste des écrivains est RECALCULÉE et doit être EXACTEMENT la liste déclarée (un
 *      écrivain oublié, ou parti, rougit) ; le test doit exister et nommer l'objet restreint ;
 *   C. une migration APRÈS est horodatée après TOUTES les migrations AVANT en attente (le push les applique dans
 *      l'ordre des noms).
 *
 * CE QU'IL NE VOIT PAS, ET IL FAUT LE LIRE :
 *   · que les VALEURS écrites passent la restriction : il prouve QUI écrit, pas CE QU'il écrit — ça, seul le test
 *     nommé le prouve, et seulement pour les cas qu'il fabrique ;
 *   · une écriture dont la table n'est pas un littéral (`.from(variable)`), un écrivain hors de app/, lib/,
 *     components/, ou une fonction SQL qui en appelle une autre (une profondeur seulement) ;
 *   · une restriction qui ne porte pas sur une table (une politique de Storage, GL006, une clé de liste blanche, un
 *     droit sur une fonction) : ses écrivains sont DÉCLARÉS, pas recalculés — le contrôle vérifie qu'ils existent ;
 *   · une fonction REDÉFINIE dont le nouveau corps lève là où l'ancien ne levait pas ; une reprise de données qui
 *     change une valeur que l'ancien code compare (un code au lieu d'un nom) ; ce que le code nouveau suppose de la
 *     base. Ces cas se jugent en lisant l'ancien code (le commit déployé) contre la migration.
 *
 *   node scripts/diag-deux-temps.mjs                 → l'état ⓪ de la requête d'avant-push
 *   node scripts/diag-deux-temps.mjs --etat=<suffixe> → simule un autre état ⓪ (une épreuve ; les exceptions du
 *                                                      premier temps ne sont alors pas prouvées sur un commit)
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const sansCommentairesTs = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}

// ── LE CODE EN LIGNE : le commit déployé sur staging, et l'état de base qui va avec (sa dernière migration). ──
// Le lot B est en ligne (02/10/2026) : sa dernière migration est l'état ⓪ de la requête d'avant-push.
// Le lot « zones de travail » (ARRÊT 26) est en ligne (03/10/2026) : sa dernière migration est l'état ⓪.
const CODE_EN_LIGNE = { commit: 'e27fa56', derniere_migration: 'specialite_ecriture_et_avis_une_fois' }

// ── LES EXCEPTIONS DU PREMIER TEMPS — une raison ET une preuve chacune (§G.8). Clé : `<suffixe>::<motif>`. ──
// Le gel ne fait que descendre : une exception dont la migration n'est plus en attente rougit (« morte »).
// (Les deux exceptions de l'ARRÊT 26 — zones_couverture_suit_le_referentiel, specialite_reactivation_hors_autre — sont
// mortes avec leur déploiement : leurs migrations ne sont plus en attente.)
const EXCEPTIONS = {
  'annonce_criteres_communs::constraint:publications': {
    raison: 'LÉGITIME — les cinq contraintes (modes de travail, temps de travail, répartition hybride, durée, offre sans durée) ne gardent que des colonnes que la migration CRÉE, nullables ou à défaut vide, et chacune accepte ce défaut : le code en ligne, qui ne les nomme pas, écrit toujours le défaut — rien de ce qu’il écrit ne peut être refusé.',
    preuve: {
      type: 'colonnes_neuves',
      table: 'publications',
      colonnes: ['work_modes', 'jours_sur_site', 'jours_teletravail', 'temps_travail', 'duree_valeur', 'duree_unite'],
      test: 'supabase/tests/database/annonces/criteres_communs.test.sql',
    },
  },
  'annonce_criteres_communs::constraint:profiles': {
    raison: 'LÉGITIME — la contrainte du temps de travail ne garde que la colonne que la migration CRÉE (défaut vide, accepté) : le code en ligne, qui ne la nomme pas, écrit toujours le défaut.',
    preuve: {
      type: 'colonnes_neuves',
      table: 'profiles',
      colonnes: ['temps_travail'],
      test: 'supabase/tests/database/annonces/criteres_communs.test.sql',
    },
  },
}

// ── LE SECOND TEMPS — chaque restriction d'une migration APRÈS, déclarée. Clé : `<suffixe>::<motif>`. ──
// { raison, ecrivains: [fichiers du code du lot qui écrivent ce qu'elle restreint], test: 'supabase/tests/…' }
// Vide : ce lot n'a aucune migration APRÈS. (Épreuve : `--etat=journal_photo_et_cv` rejoue le lot B, et le contrôle
// exige les déclarations de ses quatre migrations — c'est ce qu'il aurait demandé.)
const SECOND_TEMPS = {}

const argEtat = process.argv.find((a) => a.startsWith('--etat='))?.slice('--etat='.length) ?? null
const dossier = 'supabase/migrations'
const toutes = readdirSync(join(ROOT, dossier)).filter((f) => f.endsWith('.sql')).sort()
const requete = sansCommentaires(lire('supabase/verifications/staging-avant-push.sql'))
const etat = argEtat ?? /\(\s*0,\s*'(?:[^']|'')*',\s*'([a-z0-9_]+)'/.exec(requete)?.[1]
const iEtat = toutes.findIndex((f) => etat && f.endsWith(`_${etat}.sql`))
if (iEtat < 0) {
  console.error(`✘ l'état ⓪ (${etat ?? 'introuvable'}) n'est pas une migration du dépôt — le contrôle ne tourne pas`)
  process.exit(2)
}
const attente = toutes.slice(iEtat + 1)
console.log(`\n═══ Les deux temps — ${attente.length} migration(s) en attente après « ${etat} »${argEtat ? ' (ÉPREUVE : état simulé)' : ''} ═══\n`)

// ── Le code : en ligne (un commit) ou du lot (l'arbre de travail) ──
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\r\n').join('\n')
const RACINES_CODE = ['app', 'lib', 'components']
function fichiersDuLot() {
  const out = []
  const parcourir = (d) => {
    if (!existsSync(join(ROOT, d))) return
    for (const e of readdirSync(join(ROOT, d))) {
      const p = `${d}/${e}`
      if (statSync(join(ROOT, p)).isDirectory()) { if (e !== 'node_modules') parcourir(p) }
      else if (/\.(ts|tsx)$/.test(e)) out.push(p)
    }
  }
  RACINES_CODE.forEach(parcourir)
  return out
}
/** Un lecteur de code : `contenant(motif)` liste les fichiers qui contiennent un littéral, `lire(p)` les lit. */
function lecteurDuLot() {
  const fichiers = fichiersDuLot()
  const cache = new Map()
  const lireF = (p) => { if (!cache.has(p)) cache.set(p, lire(p)); return cache.get(p) }
  return { nom: 'le code du lot', lire: lireF, contenant: (litteral) => fichiers.filter((p) => lireF(p).includes(litteral)) }
}
function lecteurDuCommit(commit) {
  const cache = new Map()
  const lireF = (p) => { if (!cache.has(p)) cache.set(p, git(['show', `${commit}:${p}`])); return cache.get(p) }
  const contenant = (litteral) => {
    try {
      return git(['grep', '-l', '-F', '-e', litteral, commit, '--', ...RACINES_CODE]).split('\n').filter(Boolean)
        .map((l) => l.slice(commit.length + 1)).filter((p) => /\.(ts|tsx)$/.test(p))
    } catch (e) {
      if (e.status === 1) return [] // git grep : aucune correspondance
      throw e
    }
  }
  return { nom: `le code en ligne (${commit})`, lire: lireF, contenant }
}

/**
 * Les fonctions SQL qui écrivent une table, dans leur DERNIÈRE définition parmi les migrations données — directement,
 * ou en appelant une fonction qui l'écrit (fermeture : `terminer_analyse_cv` → `ecrire_analyse_cv` → profile_languages).
 */
function fonctionsQuiEcrivent(table, migrations) {
  const corps = new Map()
  for (const f of migrations) {
    const sql = sansCommentaires(lire(`${dossier}/${f}`))
    for (const m of sql.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/g)) corps.set(m[1], m[3])
  }
  const ecrit = new RegExp(`(?:insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?${table}\\b`, 'i')
  const ecrivent = new Set([...corps].filter(([, c]) => ecrit.test(c)).map(([fn]) => fn))
  for (let change = true; change;) {
    change = false
    for (const [fn, c] of corps) {
      if (ecrivent.has(fn)) continue
      if ([...ecrivent].some((g) => new RegExp(`\\bpublic\\.${g}\\(|\\b${g}\\(`).test(c))) { ecrivent.add(fn); change = true }
    }
  }
  return [...ecrivent]
}

/**
 * Les fichiers qui écrivent une table : une chaîne `.from('t')` suivie d'une écriture (insert, update, upsert, delete)
 * avant la chaîne suivante, ou un appel `.rpc('fn')` d'une fonction SQL qui l'écrit. Commentaires retirés (§E.7).
 */
function ecrivainsDe(table, lecteur, migrations) {
  const sortie = new Set()
  for (const p of lecteur.contenant(`from('${table}')`)) {
    const src = sansCommentairesTs(lecteur.lire(p))
    let i = src.indexOf(`.from('${table}')`)
    while (i >= 0) {
      const suite = src.slice(i + 1, i + 500)
      const fin = suite.search(/\.from\(|\n\s*\n/)
      if (/\.(insert|update|upsert|delete)\(/.test(fin >= 0 ? suite.slice(0, fin) : suite)) { sortie.add(p); break }
      i = src.indexOf(`.from('${table}')`, i + 1)
    }
  }
  for (const fn of fonctionsQuiEcrivent(table, migrations)) {
    for (const p of lecteur.contenant(`rpc('${fn}'`)) {
      if (new RegExp(`\\.rpc\\('${fn}'`).test(sansCommentairesTs(lecteur.lire(p)))) sortie.add(`${p} (via ${fn})`)
    }
  }
  return [...sortie].sort()
}

// ── A. l'ordre de passage de chaque migration en attente ──
const ordres = {}
for (const f of attente) {
  const tete = lire(`${dossier}/${f}`).slice(0, 3000)
  const m = /ORDRE DE PASSAGE\s*:\s*(AVANT|APRÈS|INDIFFÉRENT)/.exec(tete)
  ordres[f] = m?.[1] ?? null
}
const sansOrdre = attente.filter((f) => !ordres[f])
ok(sansOrdre.length === 0, 'A. chaque migration en attente dit son ORDRE DE PASSAGE (AVANT, APRÈS, INDIFFÉRENT)', sansOrdre.join(', '))

// ── Ce qu'une migration RESTREINT, sur un objet qu'elle ne crée pas : la liste des motifs, avec leur table ──
/** Les listes blanches du grand livre, telles que la dernière migration avant `f` les laisse. */
function listesAvant(f) {
  const r = {}
  for (const g of toutes.filter((x) => x < f)) {
    const sql = sansCommentaires(lire(`${dossier}/${g}`))
    for (const m of sql.matchAll(/update public\.grand_livre_actions\s+set cles_detail = (array\[[\s\S]*?\])(?:::text\[\])?\s+where code = '([a-z_]+)'/g)) {
      r[m[2]] = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    }
  }
  return r
}
function restrictions(f) {
  const sql = sansCommentaires(lire(`${dossier}/${f}`))
  const creees = new Set([...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]))
  const fonctionsNeuves = new Set([...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map((m) => m[1])
    .filter((fn) => !toutes.filter((x) => x < f).some((g) => new RegExp(`function public\\.${fn}\\(`).test(lire(`${dossier}/${g}`)))))
  const r = []
  const poser = (motif, quoi, table = null) => r.push({ motif, quoi, table })
  for (const m of sql.matchAll(/create (?:constraint )?trigger\s+\w+[\s\S]*?\bon\s+(?:public\.)?(\w+)/g)) if (!creees.has(m[1])) poser(`trigger:${m[1]}`, `un déclencheur sur ${m[1]}`, m[1])
  for (const m of sql.matchAll(/alter table (?:only )?(?:if exists )?public\.(\w+)\s+add constraint/g)) if (!creees.has(m[1])) poser(`constraint:${m[1]}`, `une contrainte ajoutée sur ${m[1]}`, m[1])
  for (const m of sql.matchAll(/alter table (?:only )?public\.(\w+)[^;]*alter column[^;]*set not null/g)) if (!creees.has(m[1])) poser(`notnull:${m[1]}`, `une colonne de ${m[1]} passée NOT NULL`, m[1])
  for (const m of sql.matchAll(/drop policy (?:if exists )?"?(\w+)"?/g)) poser(`policy:${m[1]}`, `la politique ${m[1]} retirée`)
  for (const m of sql.matchAll(/drop function (?:if exists )?public\.(\w+)/g)) poser(`dropfn:${m[1]}`, `la fonction ${m[1]} supprimée (§E.72)`)
  for (const m of sql.matchAll(/revoke[^;]*?\bon (?:function |table )?public\.(\w+)[^;]*?\bfrom ([^;]*);/g)) {
    if (creees.has(m[1]) || fonctionsNeuves.has(m[1])) continue
    if (/service_role/.test(m[2])) poser(`revoke-service:${m[1]}`, `un droit de service_role retiré sur ${m[1]}`)
    else poser(`revoke:${m[1]}`, `un droit retiré sur ${m[1]} (${m[2].trim()})`)
  }
  // Les DONNÉES changées AU PUSH : les instructions de premier niveau, les blocs `do`, et le corps des fonctions que
  // ces blocs EXÉCUTENT (une reprise). Le corps d'une fonction seulement redéfinie s'exécute à l'appel, comme avant.
  const corps = new Map([...sql.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/g)].map((m) => [m[1], m[3]]))
  const blocsDo = [...sql.matchAll(/\bdo\s+\$(\w*)\$([\s\S]*?)\$\1\$/g)].map((m) => m[2])
  // Une MENTION n'est pas un appel (§E.78) : les chaînes ('…'::regprocedure) sont retirées avant de chercher.
  const executees = new Set(blocsDo.map((b) => b.replace(/'(?:[^']|'')*'/g, "''")).flatMap((b) => [...b.matchAll(/public\.(\w+)\(/g)].map((m) => m[1])).filter((fn) => corps.has(fn)))
  const premierNiveau = sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ')
  const auPush = [premierNiveau, ...blocsDo, ...[...executees].map((fn) => corps.get(fn))].join('\n;\n')
  for (const m of auPush.matchAll(/update public\.(\w+)[^;]*?set\s+active\s*=\s*false/g)) if (!creees.has(m[1])) poser(`desactive:${m[1]}`, `des lignes de ${m[1]} désactivées au push`, m[1])
  for (const m of auPush.matchAll(/delete from public\.(\w+)/g)) if (!creees.has(m[1])) poser(`delete:${m[1]}`, `des lignes de ${m[1]} supprimées au push`, m[1])
  if (/errcode = 'GL006'/.test(sql)) poser('gl006', 'le refus GL006 d’une action')
  const avant = listesAvant(f)
  for (const m of sql.matchAll(/update public\.grand_livre_actions\s+set cles_detail = (array\[[\s\S]*?\])(?:::text\[\])?\s+where code = '([a-z_]+)'/g)) {
    const neuves = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    const perdues = (avant[m[2]] ?? []).filter((c) => !neuves.includes(c))
    if (perdues.length) poser(`cles:${m[2]}`, `des clés retirées de la liste blanche de ${m[2]} : ${perdues.join(', ')}`)
  }
  return r
}

// ── Le code en ligne : le commit déclaré, s'il correspond à l'état ⓪ (hors épreuve) ──
let enLigne = null
if (!argEtat) {
  try {
    const dernieres = git(['ls-tree', '--name-only', CODE_EN_LIGNE.commit, `${dossier}/`]).split('\n').filter((l) => l.endsWith('.sql')).sort()
    const derniere = (dernieres.at(-1) ?? '').replace(/^.*\/\d+_/, '').replace(/\.sql$/, '')
    ok(derniere === CODE_EN_LIGNE.derniere_migration && derniere === etat,
      `B. le code en ligne déclaré (${CODE_EN_LIGNE.commit}) va avec l'état ⓪ — sa dernière migration est « ${derniere} »`,
      `déclaré « ${CODE_EN_LIGNE.derniere_migration} », état ⓪ « ${etat} » : CODE_EN_LIGNE est périmé — le remettre au commit déployé`)
    enLigne = lecteurDuCommit(CODE_EN_LIGNE.commit)
  } catch (e) {
    console.error(`✘ le commit en ligne ${CODE_EN_LIGNE.commit} est illisible (${e.message.split('\n')[0]}) — le contrôle ne tourne pas`)
    process.exit(2)
  }
}
const lot = lecteurDuLot()
const migrationsEnLigne = toutes.slice(0, iEtat + 1)

/** Vérifie la preuve d'une exception ; rend la liste des manquements (vide = prouvée). */
function prouver(preuve, migrationFichier) {
  if (!enLigne) return ['épreuve : aucun commit en ligne pour prouver l’exception']
  if (preuve.type === 'colonnes_neuves') {
    const fautes = []
    const sql = sansCommentaires(lire(`${dossier}/${migrationFichier}`))
    for (const c of preuve.colonnes) {
      // Nullable (`<type>`), ou à défaut vide (`<type> not null default '{}'`) — rien d'autre : un défaut qui ne serait
      // pas vide pourrait ne pas passer la contrainte.
      if (!new RegExp(`add column if not exists ${c}\\s+[a-z0-9]+(?:\\[\\])?(?:\\s+not null default '\\{\\}')?\\s*[,;]`).test(sql)) {
        fautes.push(`la colonne ${preuve.table}.${c} n’est pas créée par la migration (nullable ou à défaut vide)`)
      }
    }
    const ajoutees = [...sql.matchAll(new RegExp(`alter table public\\.${preuve.table}\\s+add constraint (\\w+)\\s+check \\(([\\s\\S]*?)\\);`, 'g'))]
    if (ajoutees.length === 0) fautes.push(`aucune contrainte ajoutée sur ${preuve.table} n’est lue`)
    for (const [, nom, expr] of ajoutees) {
      if (!preuve.colonnes.some((c) => new RegExp(`\\b${c}\\b`).test(expr))) fautes.push(`la contrainte ${nom} ne garde aucune colonne neuve`)
    }
    // Les écrivains en ligne de la table — fichiers et fonctions SQL — ne nomment aucune des colonnes neuves.
    for (const e of ecrivainsDe(preuve.table, enLigne, migrationsEnLigne)) {
      const fichier = e.replace(/ \(via \w+\)$/, '')
      const src = sansCommentairesTs(enLigne.lire(fichier))
      const nommees = preuve.colonnes.filter((c) => new RegExp(`\\b${c}\\b`).test(src))
      if (nommees.length) fautes.push(`${e} (en ligne) nomme ${nommees.join(', ')}`)
    }
    const corpsEnLigne = new Map()
    for (const g of migrationsEnLigne) {
      for (const m of sansCommentaires(lire(`${dossier}/${g}`)).matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/g)) corpsEnLigne.set(m[1], m[3])
    }
    for (const fn of fonctionsQuiEcrivent(preuve.table, migrationsEnLigne)) {
      const nommees = preuve.colonnes.filter((c) => new RegExp(`\\b${c}\\b`).test(corpsEnLigne.get(fn) ?? ''))
      if (nommees.length) fautes.push(`la fonction en ligne ${fn} écrit ${preuve.table} et nomme ${nommees.join(', ')}`)
    }
    if (!preuve.test || !existsSync(join(ROOT, preuve.test))) fautes.push(`le test « ${preuve.test ?? '?'} » n’existe pas`)
    else {
      const t = lire(preuve.test)
      const absentes = preuve.colonnes.filter((c) => !t.includes(c))
      if (absentes.length) fautes.push(`le test ${preuve.test} ne nomme pas ${absentes.join(', ')}`)
    }
    return fautes
  }
  if (preuve.type === 'aucun_ecrivain') {
    const enLigneE = ecrivainsDe(preuve.table, enLigne, migrationsEnLigne)
    const duLot = ecrivainsDe(preuve.table, lot, toutes)
    return [
      ...enLigneE.map((e) => `${preuve.table} est écrite par le code en ligne : ${e}`),
      ...duLot.map((e) => `${preuve.table} est écrite par le code du lot : ${e}`),
    ]
  }
  if (preuve.type === 'refus_nomme') {
    const src = sansCommentairesTs(enLigne.lire(preuve.fichier))
    const iEcr = src.search(preuve.ecriture)
    const iRefus = src.search(preuve.refus)
    const iSuiv = src.search(preuve.ecrituresSuivantes)
    const fautes = []
    if (iEcr < 0) fautes.push(`l’écriture restreinte est introuvable dans ${preuve.fichier} en ligne`)
    if (iRefus < 0 || iRefus < iEcr) fautes.push('le refus nommé ne suit pas l’écriture restreinte')
    if (iSuiv >= 0 && iSuiv < iEcr) fautes.push('une autre écriture précède l’écriture restreinte : le refus laisserait un geste à moitié écrit')
    if (iRefus >= 0 && iSuiv >= 0 && iSuiv < iRefus) fautes.push('une autre écriture se glisse entre l’écriture restreinte et son refus')
    if (!preuve.nomDuRefus.motif.test(enLigne.lire(preuve.nomDuRefus.fichier))) fautes.push(`le nom du refus n’est plus reconnu par ${preuve.nomDuRefus.fichier} en ligne`)
    return fautes
  }
  return [`type de preuve inconnu : ${preuve.type}`]
}

const exceptionsVues = new Set()
const secondVues = new Set()
let premierTemps = 0
for (const f of attente) {
  const suffixe = f.replace(/^\d+_/, '').replace(/\.sql$/, '')
  const r = restrictions(f)
  if (ordres[f] === 'APRÈS') {
    // ── B bis. le second temps : chaque restriction déclarée, ses écrivains recalculés, son test nommé ──
    const fautes = []
    for (const x of r) {
      const cle = `${suffixe}::${x.motif}`
      const d = SECOND_TEMPS[cle]
      if (!d) { fautes.push(`NON DÉCLARÉE : ${x.quoi} — qui l’écrit dans le code du lot, et quel test le prouve ?`); continue }
      secondVues.add(cle)
      if (!/^LÉGITIME — .{30,}/.test(d.raison ?? '')) fautes.push(`${cle} : la raison ne commence pas par LÉGITIME, ou ne dit rien`)
      if (!d.test || !existsSync(join(ROOT, d.test))) fautes.push(`${cle} : le test « ${d.test ?? '?'} » n’existe pas`)
      else if (!lire(d.test).includes(x.table ?? x.motif.split(':')[1] ?? '')) fautes.push(`${cle} : le test ${d.test} ne nomme pas ${x.table ?? x.motif}`)
      const declares = [...(d.ecrivains ?? [])].sort()
      if (x.table) {
        const calcules = ecrivainsDe(x.table, lot, toutes)
        const oublies = calcules.filter((e) => !declares.includes(e))
        const partis = declares.filter((e) => !calcules.includes(e))
        if (oublies.length) fautes.push(`${cle} : écrivain(s) de ${x.table} non relu(s) : ${oublies.join(', ')}`)
        if (partis.length) fautes.push(`${cle} : écrivain(s) déclaré(s) qui n’écrivent plus ${x.table} : ${partis.join(', ')}`)
      } else {
        const absents = declares.filter((e) => !existsSync(join(ROOT, e.replace(/ \(via \w+\)$/, ''))))
        if (absents.length) fautes.push(`${cle} : écrivain(s) déclaré(s) introuvable(s) : ${absents.join(', ')}`)
        if (declares.length === 0) fautes.push(`${cle} : aucun écrivain déclaré (non recalculable : il faut les nommer)`)
      }
    }
    ok(fautes.length === 0, `B bis. ${f} (APRÈS) : chaque restriction est déclarée, ses écrivains relus, son test nommé (${r.length})`, fautes.join(' · '))
    continue
  }
  premierTemps++
  const fautes = []
  for (const x of r) {
    const cle = `${suffixe}::${x.motif}`
    const e = EXCEPTIONS[cle]
    if (!e) { fautes.push(x.quoi); continue }
    exceptionsVues.add(cle)
    const manquements = prouver(e.preuve, f)
    if (manquements.length) fautes.push(`exception ${cle} NON PROUVÉE sur ${enLigne?.nom ?? 'aucun commit'} : ${manquements.join(' ; ')}`)
  }
  ok(fautes.length === 0, `B. ${f} (${ordres[f] ?? '?'}) ne refuse rien de ce que le code en ligne écrit`, fautes.join(' · '))
}
const mortes = Object.keys(EXCEPTIONS).filter((k) => !exceptionsVues.has(k))
ok(argEtat !== null || mortes.length === 0, `B. ${Object.keys(EXCEPTIONS).length} exception(s), chacune vue, raisonnée et prouvée — aucune morte`, mortes.join(', '))
ok(Object.values(EXCEPTIONS).every((e) => /^LÉGITIME — .{30,}/.test(e.raison) && e.preuve?.type), 'B. chaque exception commence par LÉGITIME, dit sa raison et porte sa preuve (§G.8)')
const mortesSecond = Object.keys(SECOND_TEMPS).filter((k) => !secondVues.has(k))
ok(argEtat !== null || mortesSecond.length === 0, `B bis. ${Object.keys(SECOND_TEMPS).length} déclaration(s) du second temps, chacune vue — aucune morte`, mortesSecond.join(', '))

// ── C. le second temps part après le premier ──
const dernierPremier = attente.filter((f) => ordres[f] !== 'APRÈS').at(-1) ?? ''
const apresTot = attente.filter((f) => ordres[f] === 'APRÈS' && f < dernierPremier)
ok(apresTot.length === 0, `C. chaque migration APRÈS est horodatée après la dernière AVANT (${dernierPremier || 'aucune'})`, apresTot.join(', '))

console.log(`\n${echecs === 0 ? '✅' : '❌'} ${premierTemps} migration(s) du premier temps lues, ${attente.length - premierTemps} du second${echecs ? ` — ${echecs} contrôle(s) rouge(s)` : ' — aucun geste du code en ligne ne peut échouer par elles'}.`)
process.exit(echecs === 0 ? 0 : 1)

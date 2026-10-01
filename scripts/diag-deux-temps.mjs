/**
 * diag-deux-temps.mjs — AUCUN DÉPLOIEMENT NE FAIT ÉCHOUER UN GESTE DU CODE EN LIGNE (§E.72, décision de Youssef).
 *
 * LA RÈGLE : entre le `db push` et le `git push`, le site en ligne tourne avec l'ANCIEN code sur la NOUVELLE base. Une
 * migration passée AVANT le déploiement (ou INDIFFÉRENT) ne doit donc rien refuser de ce que l'ancien code écrit : ce
 * qui restreint — une garde, une contrainte, un droit retiré, une signature supprimée, une clé ôtée d'une liste
 * blanche, un refus d'action — part dans un lot SUIVANT, dont les migrations disent « APRÈS le déploiement ».
 *
 * LE CAS QUI L'A FAIT ÉCRIRE (relecture indépendante du 01/10/2026, FEU ROUGE) : le refus GL006 des actions retirées
 * (ARRÊT 22), le déclencheur LG001 des langues et le retrait de l'écriture des photos par le navigateur (recette S1)
 * étaient tous dans le lot A — un message, une langue tapée, une première photo auraient échoué pendant la fenêtre.
 * Et la désactivation de la spécialité « Autre », une REPRISE DE DONNÉES : l'ancien /api/profile rend 400 sur une
 * spécialité inactive qu'une page chargée avant le push enverrait encore. Personne n'avait repassé les migrations de
 * S1 à la règle à la fusion.
 *
 * CE QU'IL FAIT :
 *   A. Les migrations EN ATTENTE sont celles qui suivent l'état ⓪ de la requête d'avant-push ; chacune dit son ORDRE
 *      DE PASSAGE dans son en-tête (AVANT, APRÈS, INDIFFÉRENT) ;
 *   B. dans une migration AVANT ou INDIFFÉRENT, il REFUSE, sur un objet qu'elle ne crée pas elle-même : un déclencheur,
 *      une contrainte ajoutée, une colonne passée NOT NULL, une politique retirée, une fonction supprimée, un droit
 *      retiré à service_role, un droit retiré à anon/authenticated, une désactivation ou une suppression de lignes ;
 *      partout : le refus GL006, une clé retirée d'une liste blanche du grand livre. Une exception s'écrit avec sa
 *      raison (§G.8), et le contrôle la compte ;
 *   C. une migration APRÈS est horodatée après TOUTES les migrations AVANT en attente (le push les applique dans
 *      l'ordre des noms).
 *
 * CE QU'IL NE VOIT PAS, ET IL FAUT LE LIRE : une fonction REDÉFINIE dont le nouveau corps lève là où l'ancien ne levait
 * pas ; une reprise de données qui change une valeur que l'ancien code compare (un code au lieu d'un nom) ; ce que
 * le code nouveau suppose de la base. Ces cas se jugent en lisant l'ancien code (le commit déployé) contre la migration —
 * c'est ce que dit la section « Le lot A à la règle » de docs/reprise.md, migration par migration.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}

// ── LES EXCEPTIONS — une raison chacune (§G.8). Clé : `<suffixe de migration>::<motif>`. ──
// Le gel ne fait que descendre : les deux exceptions de `langues_liste_fermee` (le retrait re-dit sur
// remplacer_listes_profil, la fonte des doublons de langues) sont parties quand le lot A est devenu l'état de
// staging (⓪ journal_photo_et_cv) — leur migration n'est plus en attente.
const EXCEPTIONS = {}

const dossier = 'supabase/migrations'
const toutes = readdirSync(join(ROOT, dossier)).filter((f) => f.endsWith('.sql')).sort()
const requete = sansCommentaires(lire('supabase/verifications/staging-avant-push.sql'))
const etat = /\(\s*0,\s*'(?:[^']|'')*',\s*'([a-z0-9_]+)'/.exec(requete)?.[1]
const iEtat = toutes.findIndex((f) => etat && f.endsWith(`_${etat}.sql`))
if (iEtat < 0) {
  console.error(`✘ l'état ⓪ de la requête d'avant-push (${etat ?? 'introuvable'}) n'est pas une migration du dépôt — le contrôle ne tourne pas`)
  process.exit(2)
}
const attente = toutes.slice(iEtat + 1)
console.log(`\n═══ Les deux temps — ${attente.length} migration(s) en attente après « ${etat} » ═══\n`)

// ── A. l'ordre de passage de chaque migration en attente ──
const ordres = {}
for (const f of attente) {
  const tete = lire(`${dossier}/${f}`).slice(0, 3000)
  const m = /ORDRE DE PASSAGE\s*:\s*(AVANT|APRÈS|INDIFFÉRENT)/.exec(tete)
  ordres[f] = m?.[1] ?? null
}
const sansOrdre = attente.filter((f) => !ordres[f])
ok(sansOrdre.length === 0, 'A. chaque migration en attente dit son ORDRE DE PASSAGE (AVANT, APRÈS, INDIFFÉRENT)', sansOrdre.join(', '))

// ── B. ce qu'une migration du premier temps ne fait pas ──
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
const exceptionsVues = new Set()
let premierTemps = 0
for (const f of attente) {
  if (ordres[f] === 'APRÈS') continue
  premierTemps++
  const suffixe = f.replace(/^\d+_/, '').replace(/\.sql$/, '')
  const sql = sansCommentaires(lire(`${dossier}/${f}`))
  const creees = new Set([...sql.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((m) => m[1]))
  const fonctionsNeuves = new Set([...sql.matchAll(/create (?:or replace )?function public\.(\w+)\(/g)].map((m) => m[1])
    .filter((fn) => !toutes.filter((x) => x < f).some((g) => new RegExp(`function public\\.${fn}\\(`).test(lire(`${dossier}/${g}`)))))
  const fautes = []
  const signaler = (motif, quoi) => {
    const cle = `${suffixe}::${motif}`
    if (cle in EXCEPTIONS) { exceptionsVues.add(cle); return }
    fautes.push(quoi)
  }
  for (const m of sql.matchAll(/create (?:constraint )?trigger\s+\w+[\s\S]*?\bon\s+(?:public\.)?(\w+)/g)) if (!creees.has(m[1])) signaler(`trigger:${m[1]}`, `un déclencheur sur ${m[1]}`)
  for (const m of sql.matchAll(/alter table (?:only )?(?:if exists )?public\.(\w+)\s+add constraint/g)) if (!creees.has(m[1])) signaler(`constraint:${m[1]}`, `une contrainte ajoutée sur ${m[1]}`)
  for (const m of sql.matchAll(/alter table (?:only )?public\.(\w+)[^;]*alter column[^;]*set not null/g)) if (!creees.has(m[1])) signaler(`notnull:${m[1]}`, `une colonne de ${m[1]} passée NOT NULL`)
  for (const m of sql.matchAll(/drop policy (?:if exists )?"?(\w+)"?/g)) signaler(`policy:${m[1]}`, `la politique ${m[1]} retirée`)
  for (const m of sql.matchAll(/drop function (?:if exists )?public\.(\w+)/g)) signaler(`dropfn:${m[1]}`, `la fonction ${m[1]} supprimée (§E.72)`)
  for (const m of sql.matchAll(/revoke[^;]*?\bon (?:function |table )?public\.(\w+)[^;]*?\bfrom ([^;]*);/g)) {
    if (creees.has(m[1]) || fonctionsNeuves.has(m[1])) continue
    if (/service_role/.test(m[2])) signaler(`revoke-service:${m[1]}`, `un droit de service_role retiré sur ${m[1]}`)
    else signaler(`revoke:${m[1]}`, `un droit retiré sur ${m[1]} (${m[2].trim()})`)
  }
  // Les DONNÉES changées AU PUSH : les instructions de premier niveau, les blocs `do`, et le corps des fonctions que
  // ces blocs EXÉCUTENT (une reprise). Le corps d'une fonction seulement redéfinie s'exécute à l'appel, comme avant :
  // il n'est pas lu ici (voir « ce qu'il ne voit pas »).
  const corps = new Map([...sql.matchAll(/create (?:or replace )?function public\.(\w+)\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/g)].map((m) => [m[1], m[3]]))
  const blocsDo = [...sql.matchAll(/\bdo\s+\$(\w*)\$([\s\S]*?)\$\1\$/g)].map((m) => m[2])
  // Une MENTION n'est pas un appel (§E.78) : les chaînes ('…'::regprocedure) sont retirées avant de chercher.
  const executees = new Set(blocsDo.map((b) => b.replace(/'(?:[^']|'')*'/g, "''")).flatMap((b) => [...b.matchAll(/public\.(\w+)\(/g)].map((m) => m[1])).filter((fn) => corps.has(fn)))
  const premierNiveau = sql.replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ' ')
  const auPush = [premierNiveau, ...blocsDo, ...[...executees].map((fn) => corps.get(fn))].join('\n;\n')
  for (const m of auPush.matchAll(/update public\.(\w+)[^;]*?set\s+active\s*=\s*false/g)) if (!creees.has(m[1])) signaler(`desactive:${m[1]}`, `des lignes de ${m[1]} désactivées au push`)
  for (const m of auPush.matchAll(/delete from public\.(\w+)/g)) if (!creees.has(m[1])) signaler(`delete:${m[1]}`, `des lignes de ${m[1]} supprimées au push`)
  if (/errcode = 'GL006'/.test(sql)) signaler('gl006', 'le refus GL006 d’une action')
  const avant = listesAvant(f)
  for (const m of sql.matchAll(/update public\.grand_livre_actions\s+set cles_detail = (array\[[\s\S]*?\])(?:::text\[\])?\s+where code = '([a-z_]+)'/g)) {
    const neuves = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
    const perdues = (avant[m[2]] ?? []).filter((c) => !neuves.includes(c))
    if (perdues.length) signaler(`cles:${m[2]}`, `des clés retirées de la liste blanche de ${m[2]} : ${perdues.join(', ')}`)
  }
  ok(fautes.length === 0, `B. ${f} (${ordres[f] ?? '?'}) ne refuse rien de ce que le code en ligne écrit`, fautes.join(' · '))
}
const mortes = Object.keys(EXCEPTIONS).filter((k) => !exceptionsVues.has(k))
ok(mortes.length === 0, `B. ${Object.keys(EXCEPTIONS).length} exception(s), chacune vue et raisonnée — aucune morte`, mortes.join(', '))
ok(Object.values(EXCEPTIONS).every((r) => /^LÉGITIME — .{30,}/.test(r)), 'B. chaque exception commence par LÉGITIME et dit sa raison (§G.8)')

// ── C. le second temps part après le premier ──
const dernierPremier = attente.filter((f) => ordres[f] !== 'APRÈS').at(-1) ?? ''
const apresTot = attente.filter((f) => ordres[f] === 'APRÈS' && f < dernierPremier)
ok(apresTot.length === 0, `C. chaque migration APRÈS est horodatée après la dernière AVANT (${dernierPremier || 'aucune'})`, apresTot.join(', '))

console.log(`\n${echecs === 0 ? '✅' : '❌'} ${premierTemps} migration(s) du premier temps lues, ${attente.length - premierTemps} du second${echecs ? ` — ${echecs} contrôle(s) rouge(s)` : ' — aucun geste du code en ligne ne peut échouer par elles'}.`)
process.exit(echecs === 0 ? 0 : 1)

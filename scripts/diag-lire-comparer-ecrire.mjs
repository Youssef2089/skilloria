// scripts/diag-lire-comparer-ecrire.mjs — UN CONTROLE DE CLASSE, PAS TROIS
// CONTROLES DE CAS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE MOTIF
//   Lire une quantite, la comparer a une borne, puis ecrire. Sous deux
//   transactions simultanees, les deux lisent la meme valeur, les deux
//   concluent que l'ecriture est sure, et les deux ecrivent. Aucune
//   verification avant ecriture ne peut fermer ca : seule une contrainte en
//   base le peut.
//
//   Quatre defauts de cette famille ont ete fermes sur les derniers lots —
//   doublon de notification, place de devoilement incluse, plafond d'annonces
//   actives, zero administrateur. Trois diagnostics cibles les surveillent,
//   chacun a son endroit. Ce script-ci surveille la CLASSE : il cherche le
//   motif partout, pour que le CINQUIEME se voie avant d'etre ecrit.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMMENT LE MOTIF EST DETECTE — ET CE QUI A ETE ESSAYE PUIS JETE
//
//   SIGNATURE RETENUE : « une QUANTITE obtenue par une fonction de comptage,
//   COMPAREE, puis une ECRITURE dans la meme portee ».
//     const X = await count…/compte…/nombre…(…)   ← la quantite
//     … X <= n … / … { activeAdminCount: X } …     ← la comparaison
//     … .from('…').insert|update|upsert|delete …   ← l'ecriture
//       ou .rpc('…')
//
//   Elle traverse les fichiers : le comptage vit souvent dans un helper de
//   lib/ et l'ecriture dans une route de app/. C'est precisement ce qui rendait
//   le defaut « zero administrateur » invisible a une lecture locale.
//
//   MESURE, sur ce depot (345 fichiers app/ + lib/) :
//     · sur le code AVANT correction  → 5 signalements, dont les 4 sites reels
//       du defaut « zero administrateur » ;
//     · sur le code APRES correction  → 1 signalement, qui est un site reel
//       (voir CONNUS_NON_TRAITES).
//   Rappel demontre, bruit nul. Elle est donc gardee.
//
//   ⚠️ SIGNATURE ESSAYEE PUIS REJETEE : « un `count: 'exact'` sur une table,
//      puis une ecriture sur LA MEME table, dans le meme fichier ».
//      Mesuree elle aussi, et le resultat a tranche :
//        · 3 signalements, ZERO vrai positif —
//            admin/migrate-org-packages (comptage d'apercu, pas un plafond),
//            me/notifications (compte des non-lues, puis marquage comme lues),
//            profile (comptage de completude, puis remplacement du bloc) ;
//        · et surtout elle MANQUAIT le defaut « zero administrateur », le plus
//          grave des deux, parce que le comptage y est dans un autre fichier et
//          sur une AUTRE table (`users`) que celle qu'on ecrit.
//      Trois cris pour zero loup, et le loup pas vu. Un controle qui crie au
//      loup finit par ne plus etre lu : celui-la n'est pas livre.
//
//   CE QUE LA DETECTION NE PEUT PAS FAIRE, et il faut le dire :
//     · elle voit une FORME, pas un ENJEU. Rien dans la syntaxe ne distingue un
//       plafond commercial d'un comptage d'apercu — c'est pourquoi l'inventaire
//       ci-dessous est QUALIFIE A LA MAIN, une ligne par site, avec sa raison.
//     · une ecriture faite par une fonction metier (`await purgeAccount(...)`)
//       plutot que par un appel Supabase direct n'est pas vue. Exemple connu :
//       la boucle de purge de app/api/cron/purge-deletions. Elle est gardee
//       autrement (voir CONNUS_NON_TRAITES).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-lire-comparer-ecrire.mjs   → controles statiques.
//                                                  AUCUN acces base.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, et ne joint jamais la base.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ═══════════════════════════════════════════════════════════════════════════
// L'INVENTAIRE — qualifie a la main, parce que la syntaxe ne dit pas l'enjeu
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sites FERMES : la garantie y vit en base. Chaque entree nomme CE QUI la porte
 * — une RPC, ou le helper qui l'appelle — et le controle verifie que ce nom est
 * toujours la.
 *
 * ⚠️ UNE PREMIERE VERSION DE CE FICHIER SE TROMPAIT DE CRITERE, et il faut le
 *    dire : elle listait ces sites en exigeant qu'ils ne soient PLUS DETECTES.
 *    C'est faux. « Compter, comparer, puis ecrire » est aussi la forme d'un
 *    site CORRECTEMENT ferme : la garde applicative reste (elle donne le refus
 *    precis sans aller-retour), et l'ecriture passe desormais par une RPC.
 *    Les quatre premiers sites n'echappaient a la detection que parce que leur
 *    appel `.rpc(...)` avait demenage dans un helper de lib/ — par accident
 *    d'indirection, pas par conception. Le jour ou quelqu'un l'aurait remis en
 *    ligne dans la route, ce diagnostic aurait crie au loup sur du code juste.
 *
 *    LA DETECTION NE PEUT PAS VOIR UNE CONTRAINTE. Elle voit une forme. C'est
 *    donc l'inventaire qui dit ou vit la garantie, et le controle verifie que
 *    le lien n'a pas ete coupe — ce qui MORD davantage que l'absence de motif.
 */
const GARANTIES = {
  'app/api/publications/[id]/publish/route.ts': 'reserver_place_annonce',
  'app/api/me/organisation/members/[id]/route.ts': 'majMembreOrganisation',
  'app/api/me/organisation/leave/route.ts': 'majMembreOrganisation',
  'app/api/admin/user-org-role/route.ts': 'majMembreOrganisation',
  'app/api/me/account/delete/route.ts': 'programmer_suppression_compte',
  'app/api/cron/purge-deletions/route.ts': 'liberer_siege_plateforme',
}

/**
 * Sites CONNUS et DELIBEREMENT non fermes. Chaque entree porterait sa raison —
 * une liste sans raisons devient un tampon qu'on remplit sans lire.
 *
 * VIDE. Le dernier membre de la classe — la programmation de suppression du
 * dernier administrateur plateforme — a ete ferme par la migration
 * 20260915200020 (siege d'administrateur plateforme), et sa cause reelle, le
 * cron sans verrou de run, par 20260915200010.
 */
const CONNUS_NON_TRAITES = {}

// ═══════════════════════════════════════════════════════════════════════════
// LA DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/** Fins de ligne NORMALISEES — cf. les autres diagnostics du depot. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires. Ces fichiers DECRIVENT abondamment le motif pour
 * expliquer pourquoi il est refuse : un scan du texte brut se declencherait sur
 * de la prose. On lit le CODE.
 */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

const fichiers = []
const parcourir = (d) => {
  for (const e of readdirSync(join(ROOT, d))) {
    if (e === 'node_modules' || e === '.next') continue
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.tsx?$/.test(e)) fichiers.push(rel)
  }
}
parcourir('app')
parcourir('lib')

/** « J'obtiens une quantite. » */
const QUANTITE =
  /const\s+(\w+)\s*=\s*(?:await\s+)?(count\w*|compte\w*|nombre\w*|\w*Count|\w*Compte|\w*Nombre)\s*\(/g
/** « J'ecris. » */
const ECRITURE = /\.from\(\s*'[a-z_]+'\s*\)\s*\.(insert|update|upsert|delete)\b|\.rpc\(\s*'\w+'/
/** Fenetre de portee : au-dela, le lien de causalite n'est plus credible. */
const PORTEE = 2500

const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const detectes = new Map()
for (const f of fichiers) {
  const src = sansCommentaires(read(f))
  for (const m of src.matchAll(QUANTITE)) {
    const v = echappe(m[1])
    const apres = src.slice(m.index, m.index + PORTEE)
    // La quantite est-elle COMPAREE ? Directement, ou passee a un predicat
    // (`wouldRemoveLastAdmin({ activeAdminCount: X })`).
    const comparee = new RegExp(
      '(?:' +
        v + '\\s*(?:<=|>=|<|>|===|!==)' +
        '|(?:<=|>=|<|>)\\s*' + v + '\\b' +
        '|:\\s*' + v + '\\s*[,}])',
    )
    if (!comparee.test(apres)) continue
    if (!ECRITURE.test(apres)) continue
    if (!detectes.has(f)) detectes.set(f, [])
    detectes.get(f).push(`${m[1]} via ${m[2]}()`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LE VERDICT
// ═══════════════════════════════════════════════════════════════════════════

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}

console.log('=== diag-lire-comparer-ecrire — la classe, pas les cas ===')
console.log(`\n     ${fichiers.length} fichiers app/ + lib/ balayes.`)
console.log(`     ${detectes.size} site(s) portant le motif.\n`)

console.log('═══ A. CHAQUE SITE FERME APPELLE TOUJOURS SA GARANTIE ═══\n')
// On ne verifie PAS l'absence du motif — un site correctement ferme le porte
// encore. On verifie que le LIEN avec la garantie est intact : si quelqu'un
// retire l'appel a la RPC en gardant le comptage, ce controle rougit.
for (const [f, garantie] of Object.entries(GARANTIES)) {
  let src = null
  try { src = sansCommentaires(read(f)) } catch { /* fichier disparu */ }
  ok(
    src !== null && src.includes(garantie),
    `${f} — passe toujours par ${garantie}`,
    src === null
      ? 'fichier introuvable : mettez l\'inventaire a jour'
      : `l'appel a ${garantie} a disparu. Le comptage applicatif ne tient pas seul sous concurrence — c'est la base qui tranche.`,
  )
}

console.log('\n═══ B. AUCUN SITE NOUVEAU ═══\n')
const nouveaux = [...detectes.keys()].filter(
  (f) => !(f in CONNUS_NON_TRAITES) && !(f in GARANTIES),
)
ok(
  nouveaux.length === 0,
  'aucun lire-puis-comparer-puis-ecrire non qualifie',
  nouveaux.length
    ? `sites a qualifier :\n         · ${nouveaux
        .map((f) => `${f} — ${detectes.get(f).join(', ')}`)
        .join('\n         · ')}\n\n       Un site detecte n'est pas fautif d'office : la detection voit une\n       FORME, pas un ENJEU. Qualifiez-le — soit la garantie passe en base et\n       il rejoint GARANTIES avec le nom qui la porte, soit il rejoint\n       CONNUS_NON_TRAITES AVEC SA RAISON.`
    : '',
)

console.log('\n═══ C. CE QUI RESTE OUVERT, EN TOUTES LETTRES ═══\n')
const ouverts = Object.keys(CONNUS_NON_TRAITES)
if (ouverts.length === 0) {
  console.log('     AUCUN. La classe est entierement fermee :')
  console.log('     tout lire-puis-comparer-puis-ecrire de app/ et lib/ a une')
  console.log('     contrainte de base derriere lui.')
} else {
  // Ces sites ne font PAS echouer le controle : ils sont connus, qualifies, et
  // leur sort est une decision produit. Mais ils sont IMPRIMES a chaque
  // execution — un inventaire qu'on ne voit plus est un inventaire qui ment.
  for (const f of ouverts) {
    console.log(`     ⚠ ${f}`)
    console.log(`       ${CONNUS_NON_TRAITES[f].split('\n').join('\n       ')}\n`)
  }
  // Un site liste comme « connu » mais que la detection ne trouve plus a ete
  // corrige, ou la detection a regresse. Dans les deux cas l'inventaire ment.
  for (const f of ouverts) {
    ok(
      detectes.has(f),
      `${f} — toujours detecte, l'inventaire reste exact`,
      'ce site n\'est plus detecte : soit il a ete corrige (retirez-le de CONNUS_NON_TRAITES), soit la detection a regresse',
    )
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)

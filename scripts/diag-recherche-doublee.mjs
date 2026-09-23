// scripts/diag-recherche-doublee.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ DEUX RECHERCHES SIMULTANÉES SUR LE MÊME EXPERT : IMPOSSIBLE. LE SECOND   ║
// ║ ATTEND — ET UNE RECHERCHE DOUBLÉE N'A PAS ÉCHOUÉ.                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE DÉFAUT, ET IL SE PAYAIT DEUX FOIS ──────────────────────────────────┐
// │ Rien n'empêchait deux recherches simultanées sur le MÊME expert. Un      │
// │ double clic, ou une bascule de disponibilité pendant qu'un cron de       │
// │ relance tourne : le même vivier était noté deux fois, et PAYÉ deux fois. │
// │                                                                          │
// │ Le mécanisme existait pourtant — le bail des tâches de fond ferme        │
// │ exactement ce chevauchement — mais il était clé sur un NOM DE TÂCHE.     │
// │                                                                          │
// │ ET L'EXPERT LISAIT UN FAUX MESSAGE D'ÉCHEC. Son second clic consommait   │
// │ un jeton du plafond horaire, et lui répondait « Trop de recherches       │
// │ lancées coup sur coup. Patientez une minute avant de réessayer. » — un   │
// │ message d'échec pour quelque chose qui n'a pas échoué.                   │
// └──────────────────────────────────────────────────────────────────────────┘
//
// LES CINQ PROPRIÉTÉS DÉFENDUES :
//   ① UN SEUL MÉCANISME — une table, deux portées. Une seconde implémentation
//      serait un jumeau de VERROU : il ne sert que sous concurrence, donc son
//      écart ne se découvre jamais (§E.20).
//   ② LE RUN PREND LE BAIL AVANT TOUTE DÉPENSE, et le rend.
//   ③ FAIL-CLOSED — une panne de prise ne vaut JAMAIS autorisation.
//   ④ LE SECOND ATTEND, et il n'invente aucun cinquième état d'écran : §D.13
//      ferme l'union à quatre, et « une recherche est en cours » serait
//      précisément la branche qui pourrait rester affichée indéfiniment.
//   ⑤ LA LECTURE CONSULTATIVE NE GARDE RIEN — elle permet d'attendre avant de
//      dépenser, elle ne remplace pas la prise, qui est atomique.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   BALAYE   lib/                   le mécanisme, le moteur, le module de cron
//            app/api/               les appelants du moteur, et le chemin
//                                   direct qui attend
//            supabase/migrations/   la table, les fonctions, la reprise
//
//   EXCLU    components/            ⚠️ APRÈS MESURE : aucun composant ne prend
//                                   ni ne lit un bail — c'est une garantie
//                                   SERVEUR, et un client qui la tiendrait
//                                   serait déjà un autre défaut (§E.15).
//            app/[locale]/          idem : les écrans rendent une issue, ils
//                                   ne décident pas si un run a lieu.
//            node_modules/ .next/   pas du dépôt / généré
//            supabase/_archive/     retirées du tronc
//            docs/                  de la prose
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-recherche-doublee.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)
/** §E.3 — CRLF normalisé. */
const lire = (rel) => readFileSync(join(ROOT, rel), 'utf8').split('\r\n').join('\n')

/** §E.7 — commentaires retirés sans perdre de positions. */
function depouillerJs(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j === -1 ? src.length : j + 2
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
      continue
    }
    out += c
    i++
  }
  return out
}

/** §E.7 — commentaires SQL retirés. */
function depouillerSql(src) {
  let out = ''
  let i = 0
  while (i < src.length) {
    if (src[i] === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i)
      if (j === -1) j = src.length
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    out += src[i]
    i++
  }
  return out
}

/**
 * Le CORPS d'une fonction — liste de paramètres SAUTÉE, accolades comptées.
 *
 * ⚠️ LE PREMIER `{` APRÈS L'ANCRE N'EST PAS LE CORPS quand un paramètre est un
 *    type objet ; et une comparaison de positions dans le FICHIER ne dit rien
 *    de l'ordre DANS une fonction (§E.8). Ce contrôle a commencé par comparer
 *    la position de `prendreBail(` à celle du premier `from('profiles')` du
 *    fichier — qui appartient à une AUTRE fonction, cent lignes plus haut.
 */
function corpsDe(src, ancre) {
  const d = src.indexOf(ancre)
  if (d < 0) return ''
  const par = src.indexOf('(', d)
  if (par < 0) return ''
  let pp = 0
  let finPar = -1
  for (let i = par; i < src.length; i++) {
    if (src[i] === '(') pp++
    else if (src[i] === ')') {
      pp--
      if (pp === 0) { finPar = i; break }
    }
  }
  if (finPar < 0) return ''
  const ouvre = src.indexOf('{', finPar)
  if (ouvre < 0) return ''
  let prof = 0
  for (let i = ouvre; i < src.length; i++) {
    if (src[i] === '{') prof++
    else if (src[i] === '}') {
      prof--
      if (prof === 0) return src.slice(ouvre, i + 1)
    }
  }
  return src.slice(ouvre)
}

function fichiersSous(dossiers, exts = ['.ts', '.tsx']) {
  const out = []
  const marcher = (abs) => {
    for (const e of readdirSync(abs)) {
      const p = join(abs, e)
      if (statSync(p).isDirectory()) {
        if (e === 'node_modules' || e === '.next') continue
        marcher(p)
      } else if (exts.some((x) => e.endsWith(x))) {
        out.push(relative(ROOT, p).replace(/\\/g, '/'))
      }
    }
  }
  for (const d of dossiers) {
    const abs = join(ROOT, d)
    if (existsSync(abs)) marcher(abs)
  }
  return out
}

/** La migration d'un lot, par son SUFFIXE descriptif — jamais par son numéro (§G.3). */
function migration(suffixe) {
  const d = join(ROOT, 'supabase', 'migrations')
  const trouvees = readdirSync(d).filter((f) => f.endsWith(`_${suffixe}.sql`))
  if (trouvees.length !== 1) {
    console.error(`\n❌ ${trouvees.length} migration(s) *_${suffixe}.sql — il en faut exactement une\n`)
    process.exit(2)
  }
  return `supabase/migrations/${trouvees[0]}`
}

const BAIL = 'lib/bail.ts'
const bailNu = depouillerJs(lire(BAIL))
const RUN = 'lib/matching/run-for-expert.ts'
const runNu = depouillerJs(lire(RUN))
const SYNC = 'app/api/me/sync-matching/route.ts'
const syncNu = depouillerJs(lire(SYNC))
const SQL = depouillerSql(lire(migration('bail_par_portee')))

/* ═══════════════════════════════════════════════════════════════════════════
   0. LE DÉTECTEUR S'ÉPROUVE AVANT DE BALAYER (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */
section('0. Le détecteur retrouve le défaut, et se tait sur le correctif')

/** Un fichier appelle-t-il la base pour un bail, au lieu de passer par le module ? */
const appelleLaRpcDeBail = (src) =>
  /\.rpc\(\s*['"`](?:prendre_bail|rendre_bail|bail_tenu)/.test(depouillerJs(src))

const TEMOIN_RPC = `  await admin.rpc('prendre_bail', { p_portee: 'x', p_cle: y })`
const TEMOIN_MODULE = `  await prendreBail(admin, { portee: 'matching_expert', cle: id, maxDurationSec: 300 })`
const TEMOIN_COMMENTE = `  // autrefois : admin.rpc('prendre_bail', …)\n  const x = 1`

ok(appelleLaRpcDeBail(TEMOIN_RPC), 'il VOIT un appel direct à la RPC de bail')
ok(!appelleLaRpcDeBail(TEMOIN_MODULE), '… et il se TAIT sur un passage par le module')
ok(
  !appelleLaRpcDeBail(TEMOIN_COMMENTE),
  '… et un COMMENTAIRE qui la cite ne compte pas (§E.7)',
  'un commentaire n’a jamais pris un verrou',
)

/* ═══════════════════════════════════════════════════════════════════════════
   1. UN SEUL MÉCANISME — une table, deux portées
   ═══════════════════════════════════════════════════════════════════════════ */
section('1. Un seul mécanisme de bail dans tout le dépôt')

const SOURCES = fichiersSous(['lib', 'app/api'])
ok(SOURCES.length > 150, `${SOURCES.length} fichiers balayés`,
  'un balayage qui ne voit presque rien passerait pour vert sans rien vérifier')

const appelantsRpc = SOURCES.filter((f) => f !== BAIL && appelleLaRpcDeBail(lire(f)))
ok(
  appelantsRpc.length === 0,
  `un seul appelant de la RPC : ${appelantsRpc.join(' · ') || '—'}`,
  'un second appelant est un second endroit ou se tromper de portee ou de grace',
)

// Et une seule TABLE de baux : la précédente a été reprise puis retirée.
ok(
  /create table if not exists public\.baux/.test(SQL),
  'la table générique des baux est créée',
)
ok(
  /drop table if exists public\.cron_run_leases/.test(SQL),
  '… et la table d’origine est RETIRÉE',
  'la garder ferait deux verrous, dont un que plus rien ne tient a jour (§M1 ⑥)',
)
{
  // L'ORDRE EST LA GARANTIE : reprendre APRÈS le `drop` perdrait l'état des
  // baux en cours, et une seconde tâche pourrait partir en parallèle.
  const iReprise = SQL.indexOf('insert into public.baux')
  const iDrop = SQL.indexOf('drop table if exists public.cron_run_leases')
  ok(
    iReprise >= 0 && iDrop > iReprise,
    'les baux en cours sont REPRIS avant que leur table ne parte',
    'retirer d abord perdrait l etat des baux vivants — le chevauchement rouvert par son propre correctif',
  )
}
// Les deux fonctions de cron DÉLÈGUENT : sinon le jumeau revient par la porte
// que ce lot ferme.
ok(
  /select public\.prendre_bail\('cron'/.test(SQL) && /select public\.rendre_bail\('cron'/.test(SQL),
  'les fonctions de cron sont des ENVELOPPES',
  'deux implementations du meme verrou divergent sur la fenetre de grace',
)
ok(
  /raise exception 'postcondition NON TENUE/.test(SQL),
  'la migration porte une POSTCONDITION qui lève (§E.60)',
)

/* ═══════════════════════════════════════════════════════════════════════════
   2. LA GARANTIE EST EN BASE — une seule instruction
   ═══════════════════════════════════════════════════════════════════════════ */
section('2. La prise est atomique, et la clé primaire la rend telle')

ok(
  /on conflict \(portee, cle\) do update/.test(SQL),
  'la prise est un UPSERT en une seule instruction',
  'une lecture puis une ecriture laisse une fenetre : deux appels obtiendraient le bail tous les deux (§F)',
)
ok(
  /primary key \(portee, cle\)/.test(SQL),
  '… et la clé primaire (portee, cle) la rend possible',
)
ok(
  /where public\.baux\.finished_at is not null\s*\n\s*or public\.baux\.started_at < now\(\) - p_grace/.test(SQL),
  '… un bail n’est repris que rendu, ou expiré',
  'sans la clause d expiration, un processus tue coincerait sa cle pour toujours',
)

/* ═══════════════════════════════════════════════════════════════════════════
   3. LE RUN PREND LE BAIL — avant toute dépense, et il le rend
   ═══════════════════════════════════════════════════════════════════════════ */
section('3. Une recherche d’expert tient son bail')

ok(/prendreBail\(/.test(runNu), 'le run expert prend le bail')
ok(/portee: 'matching_expert'/.test(runNu), '… sur la portée de l’expert')
ok(/cle: profileId/.test(runNu), '… clé sur SON identifiant, pas sur autre chose')

{
  // ⚠️ L’ORDRE SE PROUVE PAR LA STRUCTURE, PAS PAR DES POSITIONS DE TEXTE.
  //    La première version comparait la position de `prendreBail(` à celle du
  //    premier `from('profiles')` du FICHIER — qui appartient à
  //    `raisonIneligibilite`, cent lignes plus haut, et n’a rien à voir
  //    (§E.8). Ce qui se défend est que le corps du run soit INATTEIGNABLE
  //    sans bail : il vit dans une fonction à part, appelée une seule fois,
  //    après un retour anticipé.
  const porte = corpsDe(runNu, 'export async function runMatchingForExpert')
  ok(porte.includes('prendreBail('), 'le corps de la porte est isolé',
    'un corps vide passerait tout ce qui suit sans rien mesurer (§E.33)')

  const iPrise = porte.indexOf('prendreBail(')
  const iRefus = porte.indexOf("if (bail !== 'pris')")
  const iTravail = porte.indexOf('executerRunExpert(')
  ok(
    iPrise >= 0 && iRefus > iPrise && iTravail > iRefus,
    'le refus est RENDU avant que le travail ne commence',
    'sans retour anticipe, le run serait atteignable sans bail',
  )
  // Et le travail n’a qu’UN appelant : une seconde porte contournerait le bail.
  // ⚠️ LA DÉCLARATION N’EST PAS UN APPEL (§E.34). Le motif comptait la
  //    déclaration de la fonction ET son appel : deux, donc rouge, sur du
  //    code strictement juste.
  const appels = [...runNu.matchAll(/(\w+\s+)?executerRunExpert\s*\(/g)].filter(
    (m) => (m[1] ?? '').trim() !== 'function',
  ).length
  ok(
    appels === 1,
    `le travail n’a qu’un appelant (${appels})`,
    'un second appel atteindrait le moteur sans passer par le bail',
  )
  // … et il ne prend PAS le bail lui-même : une double prise se bloquerait.
  const travail = corpsDe(runNu, 'async function executerRunExpert')
  ok(
    travail.length > 500 && !travail.includes('prendreBail('),
    'le travail ne reprend pas le bail qu’il tient déjà',
    'une seconde prise sur la meme cle echouerait, et le run s arreterait tout seul',
  )
}
ok(
  /finally \{[\s\S]{0,400}rendreBail\(/.test(runNu),
  'il le rend dans un `finally`',
  'rendu seulement en cas de succes, un run en echec bloquerait l expert jusqu a l expiration',
)
// FAIL-CLOSED : tout ce qui n'est pas « pris » arrête le run.
ok(
  /if \(bail !== 'pris'\)/.test(runNu),
  'tout ce qui n’est pas « pris » ARRÊTE le run',
  'tester `=== occupe` laisserait passer l erreur — un bail fail-open ne sert a rien le jour ou il compte',
)
ok(
  /empechement: \{ quoi: 'deja_en_cours' \}/.test(runNu),
  '… et il le DIT par un empêchement nommé',
  'un `empty_pool` nu se lirait « aucune mission ne correspond » — un resultat qu on n a pas',
)

/* ═══════════════════════════════════════════════════════════════════════════
   4. UNE RECHERCHE DOUBLÉE N'A PAS ÉCHOUÉ
   ═══════════════════════════════════════════════════════════════════════════ */
section('4. Le second attend, et l’écran ne dit pas « échec »')

const ISSUE = depouillerJs(lire('lib/matching/issue-de-recherche.ts'))
ok(
  /emp\?\.quoi === 'deja_en_cours'/.test(ISSUE),
  'l’issue traite explicitement « déjà en cours »',
  'sans branche, il tomberait dans « aucune mission » — un resultat qu on n a pas',
)
ok(
  /emp\?\.quoi === 'deja_en_cours'\) return \{ etat: 'echec', raison: 'trop_long' \}/.test(ISSUE),
  '… et elle rend `trop_long`, dont la phrase dit que le travail CONTINUE',
  'toute autre raison annoncerait une panne a un expert dont tout va bien',
)
// AUCUN CINQUIÈME ÉTAT : §D.13 ferme l'union à quatre.
{
  const etats = [...ISSUE.matchAll(/\{ etat: '([a-z_]+)'/g)].map((m) => m[1])
  const distincts = [...new Set(etats)].sort()
  ok(
    distincts.length === 4 && distincts.join(',') === 'aucune,echec,ineligible,trouvees',
    `quatre issues, et pas une de plus : ${distincts.join(', ')}`,
    'un etat « en cours » serait la branche « on ne sait pas encore » que §D.13 interdit',
  )
}

// LE CHEMIN DIRECT ATTEND — et il attend AVANT de consommer le plafond.
ok(/attendreBailLibre\(/.test(syncNu), 'le chemin direct ATTEND que le bail se libère')
{
  const iAttente = syncNu.indexOf('attendreBailLibre(')
  const iPlafond = syncNu.indexOf('consommerPlafondHoraire(supabaseAdmin')
  ok(
    iAttente >= 0 && iPlafond > iAttente,
    '… AVANT de consommer le plafond horaire',
    'consommer d abord, c est repondre « trop de recherches » a un simple double clic — le faux message d echec',
  )
}
// LE BUDGET D'ATTENTE EST DÉRIVÉ, sinon les deux attentes se disputent le
// même temps de réponse.
ok(
  /const ATTENTE_BAIL_MS = Math\.floor\(ATTENTE_MAX_MS \/ \d+\)/.test(syncNu),
  'le budget d’attente est DÉRIVÉ de celui de la réponse',
  'ecrit a cote, il se desaccorde au premier ajustement et l un mange le temps de l autre',
)

/* ═══════════════════════════════════════════════════════════════════════════
   5. LA LECTURE CONSULTATIVE NE GARDE RIEN
   ═══════════════════════════════════════════════════════════════════════════ */
section('5. `bailTenu` permet d’attendre — elle ne remplace pas la prise')

ok(
  /CONSULTATIF/.test(lire(BAIL)),
  'le module DIT que la lecture est consultative',
  'sans ça, quelqu un s en servira un jour comme d une garde',
)
ok(
  /return true\s*\n\s*\}\s*\n\s*return data === true/.test(bailNu),
  'une lecture en panne rend « OCCUPÉ », jamais « libre »',
  '« je ne sais pas » ne vaut jamais « la voie est libre » quand la suite est une depense (§E.22)',
)
// Et personne ne s'en sert comme d'une garde : le seul appelant attend.
{
  const gardeurs = SOURCES.filter(
    (f) => f !== BAIL && /if \(\s*await bailTenu\(/.test(depouillerJs(lire(f))),
  )
  ok(
    gardeurs.length === 0,
    `aucun appelant n’en fait une garde : ${gardeurs.join(' · ') || '—'}`,
    'entre cette lecture et l action, un autre detenteur peut prendre le bail',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. LES APPELANTS DE FOND NE FONT PAS ATTENDRE
   ═══════════════════════════════════════════════════════════════════════════ */
section('6. Les chemins de fond passent leur tour, ils n’attendent pas')

const APPELANTS = SOURCES.filter((f) => /runMatchingForExpert\(/.test(depouillerJs(lire(f))))
ok(APPELANTS.length >= 4, `${APPELANTS.length} appelants du moteur expert découverts`)
const attendeurs = APPELANTS.filter((f) => /attendreBailLibre\(/.test(depouillerJs(lire(f))))
ok(
  attendeurs.length === 1 && attendeurs[0] === SYNC,
  `un seul attend, et c’est celui qui répond à un écran : ${attendeurs.join(' · ') || '—'}`,
  'une tache de fond qui attend tient une fonction ouverte pour rien — elle rattrape au passage suivant',
)

note(`${APPELANTS.length} appelants : ${APPELANTS.join(', ')}`)

console.log(
  echecs === 0
    ? '\n✅ VERT — au plus une recherche par expert, le second attend, et rien n’a « échoué ».\n'
    : `\n❌ ROUGE — ${echecs} écart(s).\n`,
)
process.exit(echecs === 0 ? 0 : 1)

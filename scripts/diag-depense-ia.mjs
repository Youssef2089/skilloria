// scripts/diag-depense-ia.mjs — TOUT APPEL PAYANT SE COMPTE, ET REGARDE LE PLAFOND.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME
//   CINQ des SEPT points de depense n'enregistraient RIEN et ne consultaient
//   JAMAIS le plafond. Le « plafond Claude 100 $ » ne comptait donc que le
//   jugement de candidature et le pitch : l'analyse de CV, la verification
//   d'expert, la verification d'entreprise et la gate qualite d'annonce
//   depensaient hors de toute comptabilite ET hors de tout plafond.
//
//   AVANT DE REPARTIR PAR ACTEUR, LE TOTAL ETAIT DEJA FAUX.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI UN CONTROLE DE CLASSE, ET PAS CINQ CONTROLES DE CAS
//
//   Corriger les cinq ne suffit pas : le SIXIEME sera ecrit demain, par
//   quelqu'un qui n'aura pas lu cette histoire. Un controle qui tient une liste
//   de cinq fichiers reste vert sur le sixieme — et c'est exactement comme ca
//   que ces cinq-la sont apparus.
//
//   Ce diagnostic DECOUVRE donc tout fichier qui appelle un modele payant, et
//   exige de chacun deux choses :
//     ① qu'il consulte le plafond AVANT d'appeler ;
//     ② qu'il enregistre la depense APRES.
//
//   Une fonction PURE est dispensee de les faire elle-meme — c'est la regle du
//   projet : aucune fonction pure ne devient impure. Mais alors elle doit RENDRE
//   ce qu'elle a consomme, et son appelant doit faire les deux. Le controle suit
//   donc la chaine plutot que de lire un fichier isole.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-depense-ia.mjs
//
// AUCUN acces base, AUCUN reseau, AUCUNE variable d'environnement.
// LECTURE PURE : ce script n'ecrit JAMAIS.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES : le depot sort les fichiers en CRLF, et un retour
// chariot casse tout motif qui traverse un saut de ligne.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

let echecs = 0
const ok = (cond, libelle, indice) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else { echecs++; console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Commentaires retires — LIGNES d'abord, BLOCS ensuite (cf. §E.3 et §E.12). */
const sansCommentaires = (src) =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')

// ─────────────────────────────────────────────────────────────────────────────
// 1. DECOUVRIR LES APPELS PAYANTS — app/ ET lib/, jamais une liste
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UN APPEL, PAS UNE MENTION.
 *   `messages.create(` sur un client Anthropic, ou un POST vers l'API Cohere.
 *   Le nom d'un fournisseur CITE dans un commentaire ou un libelle ne depense
 *   rien — d'ou le depouillement, et d'ou des motifs qui exigent un APPEL.
 */
const APPEL_PAYANT = [
  { re: /\.messages\.create\s*\(/, quoi: 'Anthropic messages.create' },
  { re: /api\.cohere\.com/, quoi: 'API Cohere' },
]

const RACINES = ['app', 'lib']
const fichiers = []
;(function parcourir(d) {
  for (const e of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(rel)
  }
})(RACINES[0])
;(function parcourir(d) {
  for (const e of readdirSync(join(ROOT, d))) {
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.(ts|tsx)$/.test(e)) fichiers.push(rel)
  }
})(RACINES[1])

const depensiers = []
for (const f of fichiers) {
  const code = sansCommentaires(read(f))
  const motif = APPEL_PAYANT.find((m) => m.re.test(code))
  if (motif) depensiers.push({ fichier: f, quoi: motif.quoi, code })
}

section('A. Tout fichier qui appelle un modele payant est compte')

console.log(`       ${depensiers.length} fichier(s) sur ${fichiers.length} appellent un modele payant :`)
for (const d of depensiers) console.log(`         ${d.fichier}  (${d.quoi})`)
console.log('')

/**
 * QUI EST L'APPELANT D'UNE FONCTION PURE ?
 *   Un fichier pur ne fait ni l'un ni l'autre — il REND sa consommation. Le
 *   controle remonte alors a celui qui l'importe, et c'est LUI qu'on exige.
 *   Decouvert par balayage, jamais par une liste : une liste laisserait passer
 *   le sixieme.
 */
function appelantsDe(module) {
  const nom = module.replace(/^lib\//, '@/lib/').replace(/\.tsx?$/, '')
  const relatif = module.split('/').pop().replace(/\.tsx?$/, '')
  const out = []
  for (const f of fichiers) {
    if (f === module) continue
    const code = sansCommentaires(read(f))
    if (
      new RegExp(`from\\s+'${nom.replace(/[/@.]/g, '\\$&')}'`).test(code) ||
      new RegExp(`from\\s+'\\./${relatif}'`).test(code) ||
      new RegExp(`from\\s+'\\.\\./${relatif}'`).test(code)
    ) out.push(f)
  }
  return out
}

const CONSULTE = /\bbudgetDisponible\s*\(/
const ENREGISTRE = /\benregistrerDepenseIA\s*\(/
const REND_CONSOMMATION = /\bConsommationIA\b/

for (const d of depensiers) {
  const consulte = CONSULTE.test(d.code)
  const enregistre = ENREGISTRE.test(d.code)

  if (consulte && enregistre) {
    ok(true, `${d.fichier} — consulte le plafond ET enregistre`)
    continue
  }

  // FONCTION PURE : dispensee, a condition de RENDRE sa consommation et
  // d'avoir au moins un appelant qui fait les deux.
  if (REND_CONSOMMATION.test(d.code)) {
    const appelants = appelantsDe(d.fichier)
    const complets = appelants.filter((a) => {
      const c = sansCommentaires(read(a))
      return CONSULTE.test(c) && ENREGISTRE.test(c)
    })
    ok(
      complets.length > 0,
      `${d.fichier} — PUR : rend sa consommation, ${complets.length} appelant(s) la comptent`,
      appelants.length === 0
        ? 'aucun appelant trouve : la consommation rendue n’est comptee nulle part'
        : `appelants sans comptage : ${appelants.filter((a) => !complets.includes(a)).join(', ')}`,
    )
    continue
  }

  // Ni l'un, ni l'autre, ni pur : c'est le defaut nominal.
  ok(false, `${d.fichier} — appelle un modele payant sans le compter`,
    `${consulte ? '' : 'ne consulte PAS le plafond. '}${enregistre ? '' : 'n’enregistre PAS la depense. '}` +
      'Soit il fait les deux, soit il rend une ConsommationIA et son appelant les fait.')
}

section('B. Le tarif suit le modele appele')

// LE DEFAUT CORRIGE : 3 $ / 15 $ — les prix de Sonnet 4.6 — etaient appliques a
// TOUS les appels Claude, dont Sonnet 5 (2/10) et, demain, Haiku (1/5).
{
  const enDur = []
  for (const f of fichiers) {
    const code = sansCommentaires(read(f))
    if (/\b(COUT_USD|PRIX_USD|USD_PAR_1M|COST_USD_PER)\w*\s*=\s*[\d.]/.test(code)) enDur.push(f)
  }
  ok(enDur.length === 0, 'aucun tarif codé en dur dans app/ ni lib/',
    enDur.length ? `trouve dans : ${enDur.join(', ')}` : undefined)

  const budget = sansCommentaires(read('lib/ai-budget.ts'))
  ok(/from\s+'ai_model_tarifs'|\.from\('ai_model_tarifs'\)/.test(budget),
    'le tarif est LU en base (ai_model_tarifs)',
    'un tarif en constante diverge du modele des qu’on change de modele')
  ok(/tarif_manquant/.test(budget),
    'un tarif inconnu est SIGNALE, pas remplace par zero en silence',
    'un cout nul silencieux ferait deriver le plafond sans que rien ne le dise')

  // CHAQUE MODELE APPELE DOIT AVOIR UN TARIF. C'est ce qui empeche « tarif
  // manquant » d'arriver en production plutot que de s'y constater.
  const modeles = new Set()
  for (const f of fichiers) {
    const code = sansCommentaires(read(f))
    for (const m of code.matchAll(/'(claude-[a-z0-9.-]+)'/g)) modeles.add(m[1])
  }
  const migrations = readdirSync(join(ROOT, 'supabase', 'migrations')).filter((x) => x.endsWith('.sql'))
  const grille = migrations.map((m) => read(`supabase/migrations/${m}`)).join('\n')
  const sansTarif = [...modeles].filter((m) => !grille.includes(`'${m}'`))
  ok(sansTarif.length === 0,
    `les ${modeles.size} modele(s) Claude cites dans le code ont un tarif seede`,
    sansTarif.length ? `sans tarif : ${sansTarif.join(', ')} — leur depense serait comptee ZERO` : undefined)
}

section('C. Un echec d’enregistrement ne casse aucun parcours')

{
  const budget = read('lib/ai-budget.ts')
  const code = sansCommentaires(budget)

  // ANCRE sur le CORPS de chaque fonction, pas sur le fichier : une regex
  // lachee trouverait le `try` de l'autre fonction et resterait verte.
  for (const nom of ['enregistrerDepense', 'enregistrerDepenseIA']) {
    const i = code.search(new RegExp(`export async function ${nom}\\b`))
    if (i === -1) { ok(false, `${nom} introuvable`); continue }
    const fin = code.indexOf('\nexport ', i + 1)
    const corps = code.slice(i, fin === -1 ? code.length : fin)
    ok(/try\s*\{/.test(corps) && /catch\s*\(/.test(corps),
      `${nom} — entoure d’un try/catch : ne leve sur AUCUN chemin`,
      'un expert qui depose son CV ne doit pas etre bloque parce qu’on n’a pas su compter une depense')
    ok(!/\bthrow\b/.test(corps), `${nom} — ne relance jamais`,
      'relancer transformerait un defaut de comptabilite en echec de parcours')
  }

  // chargerTarif aussi : une panne de lecture du tarif ne doit rien casser.
  const iT = code.search(/async function chargerTarif\b/)
  const corpsT = iT === -1 ? '' : code.slice(iT, code.indexOf('\n}', iT) + 2)
  ok(iT !== -1 && /catch\s*\{/.test(corpsT),
    'chargerTarif — une panne de lecture rend null, elle ne leve pas')
}

section('D. Le fail-closed du plafond est preserve')

{
  const code = sansCommentaires(read('lib/ai-budget.ts'))
  const i = code.search(/export async function budgetDisponible\b/)
  const corps = code.slice(i, code.indexOf('\nexport ', i + 1))
  // C'est l'EXCEPTION assumee au fail-open du reste du projet : ne pas savoir
  // combien on a depense n'autorise pas a depenser plus. Ne pas l'uniformiser
  // par souci de coherence.
  ok(/ok: false/.test(corps) && /illisible/.test(corps),
    'une lecture de depense en echec REFUSE (fail-closed)',
    'un fail-open ici laisserait depenser a l’aveugle — c’est l’argent qu’il protege')
  ok(!/ok: true/.test(corps.split('if (error)')[1]?.split('}')[0] ?? ''),
    'aucun chemin ne rend « autorise » sur une erreur de lecture')
}

section('E. Le detecteur lui-meme est eprouve')

{
  const cas = [
    ['const r = await client.messages.create({ model })', true, 'un appel Anthropic'],
    ["await fetch('https://api.cohere.com/v2/rerank')", true, 'un appel Cohere'],
    ["const doc = 'voir client.messages.create pour le detail'", false, 'une MENTION dans une chaine'],
    ['const x = 1', false, 'du code ordinaire'],
  ]
  for (const [src, attendu, quoi] of cas) {
    const trouve = APPEL_PAYANT.some((m) => m.re.test(sansCommentaires(src)))
    ok(trouve === attendu, `${attendu ? 'detecte' : 'ignore'} : ${quoi}`,
      attendu ? 'le detecteur laisserait passer un point de depense muet'
              : 'faux positif : un controle qui crie a tort finit ignore')
  }
  // Un appel CITE en commentaire ne depense rien.
  ok(!APPEL_PAYANT.some((m) => m.re.test(sansCommentaires('// on appelle client.messages.create ici'))),
    'ignore : un appel cite dans un commentaire',
    'un anti-pattern doit pouvoir etre DOCUMENTE')
}

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)

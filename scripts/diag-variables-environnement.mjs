#!/usr/bin/env node
// scripts/diag-variables-environnement.mjs — LE CODE NE LIT AUCUNE VARIABLE QUE L'INVENTAIRE NE CONNAÎT PAS,
// ET UN DÉPLOIEMENT DIT, AU DÉMARRAGE, CELLES QUI LUI MANQUENT (§E.86).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI (29/09/2026) : l'inscription expert s'arrêtait à l'envoi du SMS sur staging. La cause la plus simple
//   — une clé Vonage absente de Preview — ne se disait nulle part : la liste des variables vivait dans la
//   documentation, que rien ne confrontait au code, et aucun démarrage ne la vérifiait.
//
// CE QU'IL FAIT
//   A. chaque `process.env.X` lu par le code (app/, lib/, components/, context/, i18n/, proxy.ts,
//      instrumentation.ts, next.config.ts — commentaires exclus), et chaque lecture DYNAMIQUE résolue
//      (`process.env[capacite]` → les noms du type `Capacite`), est DANS l'inventaire
//      (lib/configuration/variables.ts) ; chaque entrée de l'inventaire est encore lue ;
//   B. chaque variable EXIGÉE est nommée par la procédure de mise en production ;
//   C. `variablesManquantes` EXÉCUTÉE sur des environnements fabriqués : tout posé → rien ; une clé Vonage
//      absente → nommée ; le repli (`ouBien`) tient ; un secret trop court, un interrupteur ≠ 'true', une
//      variable du poste local posée sur Vercel → nommés ;
//   D. `instrumentation.ts` le dit au démarrage d'un environnement déployé — nommé, jamais une valeur ;
//   E. la supervision le dit en BLOQUANT, avec le nom, dans les quatre langues.
//
// CE QU'IL NE VOIT PAS : les valeurs réellement posées sur Vercel (le démarrage et la supervision les disent),
//   et les réglages qui ne sont pas des variables (SMTP de Supabase, compte Vonage, Vault) — nommés dans
//   l'inventaire et dans la procédure, contrôlables seulement par l'essai.
//
//   node scripts/diag-variables-environnement.mjs   → statique et exécuté, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

/** Retire les commentaires d'un source sans toucher aux chaînes. */
function sansCommentaires(src) {
  let out = '', i = 0, etat = null
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (etat === 'ligne') { if (c === '\n') { etat = null; out += c } else out += ' '; i++; continue }
    if (etat === 'bloc') { if (c === '*' && d === '/') { etat = null; out += '  '; i += 2 } else { out += c === '\n' ? c : ' '; i++ } continue }
    if (etat) { out += c; if (c === '\\') { out += d ?? ''; i += 2; continue } if (c === etat) etat = null; i++; continue }
    if (c === '/' && d === '/') { etat = 'ligne'; out += '  '; i += 2; continue }
    if (c === '/' && d === '*') { etat = 'bloc'; out += '  '; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') etat = c
    out += c; i++
  }
  return out
}
const fichiers = (d, o = []) => {
  if (!existsSync(join(ROOT, d))) return o
  for (const e of readdirSync(join(ROOT, d))) {
    const p = `${d}/${e}`
    if (statSync(join(ROOT, p)).isDirectory()) fichiers(p, o); else if (/\.(ts|tsx|mjs|js)$/.test(e)) o.push(p)
  }
  return o
}

const { VARIABLES, variablesManquantes, variablesExigeesManquantes } =
  await import(pathToFileURL(join(ROOT, 'lib/configuration/variables.ts')).href)
const inventaire = new Map(VARIABLES.map((v) => [v.nom, v]))

// ── A. LE CODE ET L'INVENTAIRE ───────────────────────────────────────────────
section('A. Chaque variable lue par le code est dans l’inventaire, et réciproquement')
const sources = [
  ...['app', 'lib', 'components', 'context', 'i18n'].flatMap((d) => fichiers(d)),
  ...['proxy.ts', 'instrumentation.ts', 'next.config.ts'].filter((f) => existsSync(join(ROOT, f))),
]
const lues = new Map() // nom → fichiers
const dynamiques = []
for (const f of sources) {
  const c = sansCommentaires(read(f))
  for (const m of c.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) (lues.get(m[1]) ?? lues.set(m[1], new Set()).get(m[1])).add(f)
  for (const m of c.matchAll(/process\.env\[\s*(['"`]?)([^\]'"`]+)\1\s*\]/g)) {
    if (m[1]) (lues.get(m[2]) ?? lues.set(m[2], new Set()).get(m[2])).add(f)
    else dynamiques.push({ f, expr: m[2].trim() })
  }
}
// La seule lecture dynamique admise : `process.env[capacite]` (lib/interrupteurs.ts), résolue par son type.
const typeCapacite = /export type Capacite =([\s\S]*?)\n\n/.exec(read('lib/interrupteurs.ts'))?.[1] ?? ''
const capacites = [...typeCapacite.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1])
const dynamiquesInconnues = dynamiques.filter((d) => !(d.f === 'lib/interrupteurs.ts' && d.expr === 'capacite'))
ok(capacites.length >= 4 && dynamiquesInconnues.length === 0,
  `A. une seule lecture dynamique, résolue par son type (${capacites.length} interrupteurs : ${capacites.join(', ')})`,
  dynamiquesInconnues.map((d) => `${d.f} : process.env[${d.expr}]`).join(' · ') || 'type Capacite illisible')
for (const c of capacites) (lues.get(c) ?? lues.set(c, new Set()).get(c)).add('lib/interrupteurs.ts')
const horsInventaire = [...lues.keys()].filter((n) => !inventaire.has(n))
ok(horsInventaire.length === 0 && lues.size >= 20,
  `A. chaque variable lue par le code (${lues.size}) est dans lib/configuration/variables.ts`,
  horsInventaire.map((n) => `${n} (${[...lues.get(n)].join(', ')})`).join(' · ') || `balayage trop court : ${lues.size}`)
const plusLues = VARIABLES.filter((v) => !lues.has(v.nom)).map((v) => v.nom)
ok(plusLues.length === 0, 'A. chaque variable de l’inventaire est encore lue par le code', plusLues.join(', ') || undefined)

// ── B. LA PROCÉDURE ──────────────────────────────────────────────────────────
section('B. Chaque variable exigée est nommée par la procédure de mise en production')
const procedure = read('docs/mise-en-production.md')
const absentesDoc = VARIABLES.filter((v) => v.exigence === 'deploye' && !procedure.includes(`\`${v.nom}\``)).map((v) => v.nom)
ok(absentesDoc.length === 0, `B. ${VARIABLES.filter((v) => v.exigence === 'deploye').length} variables exigées, toutes nommées dans docs/mise-en-production.md`,
  absentesDoc.join(', ') || undefined)

// ── C. EXÉCUTÉ ───────────────────────────────────────────────────────────────
section('C. variablesManquantes, exécutée sur des environnements fabriqués')
const complet = {}
for (const v of VARIABLES) {
  if (v.exigence === 'plateforme' || v.exigence === 'poste_local') continue
  complet[v.nom] = v.valeurAttendue ?? 'x'.repeat(Math.max(v.longueurMin ?? 0, 40))
}
// Une adresse dont l'HÔTE doit valoir une autre variable (recette staging : l'origine du site est la racine)
// se fabrique cohérente — sinon « tout posé » serait faux dès la fabrique.
for (const v of VARIABLES) if (v.hoteEgalA) complet[v.nom] = `https://${complet[v.hoteEgalA]}`
const sans = (env, ...noms) => { const e = { ...env }; for (const n of noms) delete e[n]; return e }
const noms = (l) => l.map((m) => `${m.nom}:${m.motif}`)
ok(variablesManquantes(complet).length === 0, 'C. tout posé : rien ne manque')
const sansVonage = variablesExigeesManquantes(sans(complet, 'VONAGE_API_KEY'))
ok(sansVonage.length === 1 && sansVonage[0].nom === 'VONAGE_API_KEY' && sansVonage[0].motif === 'absente',
  'C. la clé Vonage absente est NOMMÉE, et elle seule', JSON.stringify(noms(sansVonage)))
const repli = variablesExigeesManquantes({ ...sans(complet, 'PHONE_OTP_HMAC_SECRET', 'REAUTH_HMAC_SECRET'), SUPABASE_JWT_SECRET: 'y'.repeat(40) })
ok(repli.length === 0, 'C. le repli SUPABASE_JWT_SECRET tient lieu des secrets de jetons (le code lit « A ?? B »)', JSON.stringify(noms(repli)))
const court = variablesExigeesManquantes({ ...complet, INSCRIPTION_HMAC_SECRET: 'trop-court' })
ok(court.length === 1 && court[0].motif === 'trop_courte', 'C. un secret plus court que ce que le code exige est nommé (trop_courte)', JSON.stringify(noms(court)))
const interrupteur = variablesExigeesManquantes({ ...complet, ENABLE_RERANKING: 'TRUE' })
ok(interrupteur.length === 1 && interrupteur[0].motif === 'valeur_inattendue', 'C. un interrupteur exigé qui ne vaut pas exactement « true » est nommé (§E.9)', JSON.stringify(noms(interrupteur)))
const local = variablesManquantes({ ...complet, DEV_DOMAIN_SLUG: 'alpha' })
ok(local.length === 1 && local[0].motif === 'posee_hors_du_poste_local', 'C. DEV_DOMAIN_SLUG posée sur un déploiement est signalée', JSON.stringify(noms(local)))
const horsRacine = variablesExigeesManquantes({ ...complet, NEXT_PUBLIC_SITE_URL: `https://eco.${complet.NEXT_PUBLIC_DOMAINE_RACINE}` })
ok(horsRacine.length === 1 && horsRacine[0].nom === 'NEXT_PUBLIC_SITE_URL' && horsRacine[0].motif === 'hote_hors_racine',
  'C. l’adresse du site qui nomme un écosystème est signalée (hote_hors_racine) — elle vaut la racine', JSON.stringify(noms(horsRacine)))
const optionnelle = variablesManquantes(sans(complet, 'STRIPE_SECRET_KEY'))
ok(optionnelle.length === 1 && optionnelle[0].exigence === 'optionnelle' && variablesExigeesManquantes(sans(complet, 'STRIPE_SECRET_KEY')).length === 0,
  'C. une variable optionnelle absente est signalée, sans être comptée exigée')

// ── D. LE DÉMARRAGE ──────────────────────────────────────────────────────────
section('D. Le démarrage d’un environnement déployé le dit, nommé')
const instr = existsSync(join(ROOT, 'instrumentation.ts')) ? sansCommentaires(read('instrumentation.ts')) : ''
ok(/export async function register\(\)/.test(instr), 'D. instrumentation.ts, à la racine, exporte register() (appelé une fois par instance serveur)')
ok(/if \(!process\.env\.VERCEL_ENV\) return/.test(instr) && /process\.env\.NEXT_RUNTIME !== 'nodejs'/.test(instr),
  'D. il ne parle que sur un environnement DÉPLOYÉ, dans le moteur Node')
ok(/variablesManquantes\(process\.env\)/.test(instr) && /code: 'variable_manquante'/.test(instr) && /nom: m\.nom/.test(instr)
   && /exigence === 'deploye'\) console\.error/.test(instr),
  'D. chaque manque part avec le code variable_manquante et son NOM — en erreur s’il est exigé')
ok(!/process\.env\[m\.nom\]|env\[m\.nom\]|valeur/.test(instr), 'D. aucune valeur n’est journalisée')

// ── E. LA SUPERVISION ────────────────────────────────────────────────────────
section('E. La supervision le dit en BLOQUANT')
const route = sansCommentaires(read('app/api/admin/supervision/route.ts'))
const problemes = sansCommentaires(read('lib/supervision/problemes.ts'))
ok(/variablesManquantes: variablesExigeesManquantes\(process\.env\)\.map\(\(m\) => m\.nom\)/.test(route)
   && /for \(const nom of s\.variablesManquantes\) \{\s*out\.push\(\{ cle: 'variable_manquante', gravite: 'bloquant'[^\n]*nom \}\)/.test(problemes),
  'E. chaque variable exigée qui manque devient une ligne BLOQUANTE, nommée')
const langues = ['fr', 'en', 'es', 'de'].filter((l) => {
  const v = JSON.parse(read(`messages/${l}.json`))?.admin_back_office?.supervision?.problem?.variable_manquante
  return typeof v !== 'string' || !v.includes('{nom}')
})
ok(langues.length === 0, 'E. la phrase existe dans les quatre langues, et elle NOMME la variable', langues.join(', ') || undefined)

console.log(failures === 0
  ? '\n✅ Le code ne lit aucune variable inconnue de l’inventaire ; un déploiement dit, au démarrage et en supervision, celles qui lui manquent.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une variable lue échappe à l’inventaire, ou un manque ne se dit pas`)
process.exit(failures === 0 ? 0 : 1)

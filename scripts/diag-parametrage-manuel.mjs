// scripts/diag-parametrage-manuel.mjs — CE QUI SE POSE A LA MAIN
//                                       ET QUE LA PROCEDURE NE NOMME PAS
//                                       N'EXISTE POUR PERSONNE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE CONTROLE
//
//   Les migrations posent huit taches pg_cron. Quatre d'entre elles passent par
//   `trigger_purge_cron`, qui lit DEUX secrets dans Supabase Vault :
//   `cron_secret` et `purge_cron_base_url`. Ces secrets ne peuvent pas etre
//   versionnes — ils different par environnement. Ils sont donc poses A LA
//   MAIN, et la seule chose qui les rattache au depot est une PROCEDURE ecrite,
//   `docs/mise-en-production.md`.
//
//   C'est la classe de §E.10 : un reglage qui n'est pas dans le depot n'existe
//   pas. Sauf qu'ici on ne PEUT pas le versionner. Le seul substitut honnete
//   est qu'il soit NOMME dans la procedure — et que ce lien soit GARDE, parce
//   que rien d'autre ne le tient.
//
//   Ce qui arrive sans ce controle, et ce n'est pas une hypothese : une
//   cinquieme tache branchee sur `trigger_purge_cron`, ou un troisieme secret
//   lu par une fonction planifiee, s'ajoute sans une ligne de procedure. Sur
//   une production neuve, la tache LEVE. Le journal de la base le dit ; aucun
//   ecran ne le dit. Et deux des quatre taches concernees portent une
//   OBLIGATION LEGALE — RGPD art. 17, et la purge CNIL a deux ans.
//
//   Le defaut ne se voit jamais sur une base de developpement : les secrets y
//   sont deja poses. Il attend le jour de la mise en production, et il attend
//   la personne qui n'a pas ecrit la migration.
//
// CE QUE CE CONTROLE VERIFIE
//   (1) Toute fonction lisant `vault.decrypted_secrets` le fait sous un nom de
//       secret LITTERAL — un nom construit ne serait documentable par personne.
//   (2) Toute tache planifiee dont la commande atteint une telle fonction est
//       rattachee aux secrets qu'elle lit.
//   (3) Chacun de ces secrets est NOMME dans la procedure de mise en production.
//   (4) Le nombre de taches annonce PAR la procedure est le nombre reel — un
//       chiffre dans une prose vieillit sans que rien ne le dise (§E.16), et
//       celui-la sert a valider l'installation (« vous devez voir huit taches »).
//   (5) La variable d'environnement dont un secret est le MIROIR est elle aussi
//       nommee. `cron_secret` sans `CRON_SECRET` en face, ce sont deux valeurs
//       qu'on fait poser sans point de comparaison.
//   (6) Toute ADRESSE DE REDIRECTION que le code demande a Supabase figure dans
//       la procedure. Supabase REFUSE toute adresse absente de sa liste — et le
//       refus tombe sur l'utilisateur, pas sur nous : « requested path is
//       invalid », au moment d'un lien recu par e-mail. Le defaut trouve en
//       ecrivant ce controle : la procedure ne nommait que `/auth/callback`,
//       alors que le code demande AUSSI `/nouveau-mot-de-passe` — donc toute
//       reinitialisation de mot de passe, ET chaque invitation d'administrateur,
//       tombaient dans le vide sur une production neuve.
//
// CE QU'IL NE VERIFIE PAS, ET IL LE DIT
//   Il ne dit pas que le secret est POSE, ni qu'il est JUSTE : cela demande la
//   base, et un controle qui exige la base ne tourne pas (§E.3). L'etape
//   « Verifier que les taches planifiees tournent » existe pour ca, et elle
//   demande une execution reelle.
//
// PIEGE §E.7 — LA PROSE NE FAIT PAS LA DEPENDANCE.
//   L'en-tete de `20260823000000_purges_rgpd_pg_cron.sql` NOMME les deux
//   secrets, en commentaire. Un controle qui chercherait `cron_secret` dans le
//   texte brut de la migration resterait vert meme si la fonction cessait de le
//   lire. Le cote DEPENDANCE est donc lu sur du SQL EXECUTABLE UNIQUEMENT.
//   Le cote PROCEDURE, lui, est de la prose par nature : c'en est le point.
//
//   node scripts/diag-secrets-taches-planifiees.mjs
//   Aucune base, aucun reseau, aucun identifiant. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n'a pas tourne.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Fins de ligne NORMALISEES. Le depot sort les fichiers en CRLF : un motif qui
 * traverse une fin de ligne serait vert chez son auteur et rouge ailleurs
 * (§E.3). Un diagnostic dont le resultat depend de la machine qui l'execute ne
 * dit pas si le code est juste : il dit d'ou il vient.
 */
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires SQL SANS PERDRE DE LIGNES — les blocs sont remplaces
 * par des espaces, les fins de ligne conservees. Un anti-pattern doit pouvoir
 * etre DOCUMENTE (§E.7), et un retrait qui perd des lignes fait glisser tout ce
 * qu'on rapporte ensuite (faux positif deja paye sur diag-echec-silencieux).
 */
const sansCommentaires = (sql) =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    echecs++
    console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

// ═══════════════════════════════════════════════════════════════════════════
// LECTURE DES MIGRATIONS — SQL EXECUTABLE UNIQUEMENT
// ═══════════════════════════════════════════════════════════════════════════

const DOSSIER_MIGRATIONS = 'supabase/migrations'
const PROCEDURE = 'docs/mise-en-production.md'

if (!existsSync(join(ROOT, DOSSIER_MIGRATIONS))) {
  console.error(`✖ ${DOSSIER_MIGRATIONS} introuvable — ce controle n'a pas tourne.`)
  process.exit(2)
}
if (!existsSync(join(ROOT, PROCEDURE))) {
  console.error(`✖ ${PROCEDURE} introuvable. La procedure est la SEULE trace des`)
  console.error("  secrets non versionnables : son absence n'est pas un controle en")
  console.error("  echec, c'est un controle qui ne peut rien affirmer.")
  process.exit(2)
}

const migrations = readdirSync(join(ROOT, DOSSIER_MIGRATIONS))
  .filter((f) => f.endsWith('.sql'))
  .sort()

const sqlParFichier = new Map()
for (const f of migrations) {
  sqlParFichier.set(f, sansCommentaires(lire(`${DOSSIER_MIGRATIONS}/${f}`)))
}
const sqlTotal = [...sqlParFichier.values()].join('\n')

// ─── (1) LES FONCTIONS QUI LISENT LE COFFRE-FORT ────────────────────────────
// On decoupe par CORPS DE FONCTION pour rattacher chaque lecture de secret a SA
// fonction, et non au fichier : un fichier peut en porter plusieurs, et le
// rattachement a la maille du fichier est exactement le defaut de §E.8.

section('A. Qui lit le coffre-fort, et sous quel nom')

/** nom de fonction → Set des noms de secrets lus */
const secretsParFonction = new Map()
/** lectures dont le nom de secret n'est pas un litteral — DECLAREES, pas jugees */
const lecturesNonAnalysables = []

{
  const reFonction =
    /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\([\s\S]*?\)\s*returns[\s\S]*?\bas\s+(\$[a-z0-9_]*\$)([\s\S]*?)\2/gi
  let m
  while ((m = reFonction.exec(sqlTotal))) {
    const nom = m[1].toLowerCase()
    const corps = m[3]
    if (!/vault\.decrypted_secrets/i.test(corps)) continue

    const noms = new Set(secretsParFonction.get(nom) ?? [])
    const reLecture = /vault\.decrypted_secrets[\s\S]{0,240}?\bname\s*=\s*('([^']+)'|[^\s;)]+)/gi
    let l
    let vues = 0
    while ((l = reLecture.exec(corps))) {
      vues++
      if (l[2]) noms.add(l[2])
      else lecturesNonAnalysables.push(`${nom}() → nom de secret non litteral : ${l[1]}`)
    }
    const occurrences = (corps.match(/vault\.decrypted_secrets/gi) ?? []).length
    if (occurrences > vues) {
      lecturesNonAnalysables.push(
        `${nom}() → ${occurrences - vues} lecture(s) sans clause « name » litterale`,
      )
    }
    secretsParFonction.set(nom, noms)
  }
}

for (const [fn, noms] of [...secretsParFonction].sort()) {
  note(`${fn}() lit : ${[...noms].sort().join(', ') || '(aucun nom litteral)'}`)
}

ok(
  secretsParFonction.size > 0,
  'au moins une fonction lit le coffre-fort (sinon ce controle ne garde rien)',
  "aucune lecture de vault.decrypted_secrets : si le montage a change, ce controle se relit, il ne se supprime pas",
)

// Un nom de secret construit ne serait documentable par personne : la procedure
// ne pourrait pas dire quoi creer. On le REFUSE, on ne l'ignore pas.
ok(
  lecturesNonAnalysables.length === 0,
  'tout nom de secret lu est un LITTERAL (donc nommable dans une procedure)',
  lecturesNonAnalysables.join(' · '),
)

// ─── (2) LES TACHES PLANIFIEES, ET CE DONT ELLES DEPENDENT ──────────────────

section('B. Les taches planifiees et leur dependance')

/** nom de tache → { periode, commande, fichier } */
const taches = new Map()
for (const [f, sql] of sqlParFichier) {
  const re = /cron\.schedule\(\s*'([a-z0-9_]+)'\s*,\s*'([^']*)'\s*,\s*(\$[a-z0-9_]*\$)([\s\S]*?)\3/gi
  let m
  while ((m = re.exec(sql))) {
    taches.set(m[1], { periode: m[2], commande: m[4].trim(), fichier: f })
  }
}

/**
 * Une tache peut avoir ete DEPLANIFIEE pour de bon. Ici, `cron.unschedule` ne
 * sert que de garde d'idempotence juste avant `cron.schedule` — mais on ne le
 * SUPPOSE pas : une deplanification posee dans une migration PLUS RECENTE que
 * la planification, et non suivie d'une replanification dans le meme fichier,
 * retire la tache du compte.
 */
for (const [f, sql] of sqlParFichier) {
  const re = /cron\.unschedule\(\s*'([a-z0-9_]+)'/gi
  let m
  while ((m = re.exec(sql))) {
    const t = taches.get(m[1])
    if (t && t.fichier < f && !new RegExp(`cron\\.schedule\\(\\s*'${m[1]}'`, 'i').test(sql)) {
      taches.delete(m[1])
    }
  }
}

/** nom de tache → Set des secrets dont elle depend */
const secretsParTache = new Map()
const commandesNonAnalysables = []
for (const [nom, t] of taches) {
  const appels = [...t.commande.matchAll(/(?:public\.)?([a-z0-9_]+)\s*\(/gi)].map((x) =>
    x[1].toLowerCase(),
  )
  const requis = new Set()
  for (const a of appels) for (const s of secretsParFonction.get(a) ?? []) requis.add(s)
  secretsParTache.set(nom, requis)
  if (appels.length === 0 && !/^\s*(delete|update|insert|select)\b/i.test(t.commande)) {
    commandesNonAnalysables.push(`${nom} → commande non reconnue : ${t.commande.slice(0, 60)}`)
  }
}

const dependantes = [...secretsParTache].filter(([, s]) => s.size > 0)
for (const [nom, t] of [...taches].sort()) {
  const s = [...(secretsParTache.get(nom) ?? [])].sort()
  note(`${nom.padEnd(34)} ${t.periode.padEnd(14)} ${s.length ? '→ ' + s.join(', ') : '(SQL seul)'}`)
}

ok(
  commandesNonAnalysables.length === 0,
  'toute commande planifiee est analysable (appel de fonction, ou SQL direct)',
  commandesNonAnalysables.join(' · '),
)

ok(
  taches.size > 0,
  `des taches planifiees existent (${taches.size} trouvee(s))`,
  'aucun cron.schedule : le montage a change, ce controle se relit',
)

// ─── (3) CHAQUE SECRET EST NOMME DANS LA PROCEDURE ──────────────────────────

section('C. La procedure nomme ce dont les taches dependent')

const procedure = lire(PROCEDURE)

const tousLesSecrets = new Set()
for (const [, s] of secretsParTache) for (const n of s) tousLesSecrets.add(n)

ok(
  tousLesSecrets.size > 0,
  "au moins une tache depend d'un secret (sinon ce controle ne garde rien)",
  'plus aucune tache ne lit le coffre-fort : ce controle se relit, il ne se supprime pas',
)

for (const secret of [...tousLesSecrets].sort()) {
  const porteuses = dependantes.filter(([, s]) => s.has(secret)).map(([n]) => n)
  ok(
    procedure.includes(secret),
    `« ${secret} » est nomme dans ${PROCEDURE}`,
    `${porteuses.length} tache(s) en dependent (${porteuses.join(', ')}) et leveraient sur une base neuve. ` +
      "Un secret non versionnable que la procedure ne nomme pas n'existe pour personne (§E.10).",
  )
}

// (5) LE MIROIR. `cron_secret` n'a de sens que compare a `CRON_SECRET` : deux
//     valeurs qui doivent etre identiques, posees a deux endroits differents.
//     Nommer l'une sans l'autre fait poser une valeur sans point de comparaison.
if (tousLesSecrets.has('cron_secret')) {
  ok(
    /\bCRON_SECRET\b/.test(procedure),
    'la variable miroir « CRON_SECRET » est nommee dans la procedure',
    'le secret du coffre-fort doit etre le miroir exact de la variable Vercel',
  )

  const RACINE_CRON = 'app/api/cron'
  if (existsSync(join(ROOT, RACINE_CRON))) {
    const routes = []
    const parcourir = (d) => {
      for (const e of readdirSync(join(ROOT, d))) {
        const rel = `${d}/${e}`
        if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
        else if (e === 'route.ts') routes.push(rel)
      }
    }
    parcourir(RACINE_CRON)
    const lisent = routes.filter((r) => /\bCRON_SECRET\b/.test(sansCommentaires(lire(r))))
    ok(
      lisent.length > 0,
      `le miroir a bien un autre bout : ${lisent.length}/${routes.length} route(s) /api/cron lisent CRON_SECRET`,
      'si plus aucune route ne la lit, le secret du coffre-fort ne sert plus a rien et la procedure fait poser une valeur morte',
    )
  }
}

// ─── (4) LE CHIFFRE DE LA PROCEDURE EST LE CHIFFRE REEL ─────────────────────

section('D. Le chiffre annonce par la procedure')

// La procedure dit « Vous devez voir **huit** taches ». Ce chiffre SERT a
// valider l'installation : faux, il fait accepter une installation incomplete.
// Famille §E.16 — un chiffre juste a sa date, que rien ne relit.
const MOTS = {
  une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6,
  sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
}
const annonces = []
for (const m of procedure.matchAll(/\*\*([a-zA-Zéèêà]+)\*\*\s+t[âa]ches/gi)) {
  const v = MOTS[m[1].toLowerCase()]
  if (v) annonces.push({ brut: m[1], valeur: v })
}
for (const m of procedure.matchAll(/\*\*(\d+)\*\*\s+t[âa]ches/gi)) {
  annonces.push({ brut: m[1], valeur: Number(m[1]) })
}

ok(
  annonces.length > 0,
  'la procedure annonce un nombre de taches a verifier',
  "sans ce chiffre, l'etape de verification ne dit jamais quand elle est satisfaite",
)
for (const a of annonces) {
  ok(
    a.valeur === taches.size,
    `le nombre annonce (« ${a.brut} ») est le nombre reel (${taches.size})`,
    'un chiffre dans une prose vieillit sans que rien ne le dise (§E.16) — et celui-ci fait valider une installation incomplete',
  )
}

// ─── (6) LES ADRESSES DE REDIRECTION DEMANDEES A SUPABASE ───────────────────

section('E. Les adresses de redirection que le code demande a Supabase')

// CE QU'ON LIT, ET POURQUOI CETTE REGLE-LA.
//   `redirectTo` / `emailRedirectTo` existent sous DEUX formes dans ce depot, et
//   les confondre ferait crier ce controle a tort — donc le desactiverait :
//     · une adresse ABSOLUE (construite sur `window.location.origin` ou sur
//       l'origine serveur) : elle part chez Supabase, qui la REFUSE si elle
//       n'est pas dans sa liste ;
//     · un chemin RELATIF (`logout({ redirectTo: '/' })`) : c'est un `router.push`
//       interne, Supabase ne le voit jamais.
//   La regle retenue est donc la forme, pas le nom : seule une adresse absolue
//   est une adresse de redirection Supabase.
//
// BALAYAGE : app/ + lib/ + components/. Un composant client porte parfaitement
//   une regle serveur (§E.15), et c'est meme le cas ici — les deux adresses
//   vivent dans des ecrans `'use client'`.
{
  const RACINES = ['app', 'lib', 'components']
  const sources = []
  const parcourirTs = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`
      if (statSync(join(ROOT, rel)).isDirectory()) parcourirTs(rel)
      else if (/\.(ts|tsx)$/.test(e)) sources.push(rel)
    }
  }
  for (const r of RACINES) parcourirTs(r)

  const sansCommentairesTs = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
      .split('\n')
      .map((l) => (l.trimStart().startsWith('//') ? '' : l))
      .join('\n')

  /** chemin normalise → fichiers qui le demandent */
  const chemins = new Map()
  for (const f of sources) {
    const code = sansCommentairesTs(lire(f))
    const re = /\b(?:email_?[rR]edirect_?[tT]o|redirectTo)\s*[:=]\s*`([^`]+)`/g
    let m
    while ((m = re.exec(code))) {
      const brut = m[1]
      // ABSOLUE seulement : origine interpolee, ou schema explicite.
      if (!/\$\{[^}]*(origin|base|BASE|siteUrl|SITE)[^}]*\}|^https?:\/\//.test(brut)) continue
      // On garde le CHEMIN, et on neutralise la locale : la procedure demande
      // une ligne par langue, c'est le chemin qui doit y figurer.
      const chemin = brut
        .replace(/^[^/]*/, '')
        // `${locale}` et `${params.locale}` sont la MEME chose : deux ecritures
        // du meme segment. Les distinguer ferait compter deux chemins la ou il
        // n'y en a qu'un, et demanderait a la procedure de nommer une variable.
        .replace(/\$\{[^}]*locale[^}]*\}/gi, '<locale>')
        .replace(/\$\{[^}]*\}/g, '<var>')
      if (!chemin.startsWith('/')) continue
      if (!chemins.has(chemin)) chemins.set(chemin, [])
      chemins.get(chemin).push(f)
    }
  }

  ok(
    chemins.size > 0,
    `des adresses de redirection sont demandees a Supabase (${chemins.size} chemin(s) distinct(s))`,
    "aucune trouvee : si le montage a change, ce controle se relit, il ne se supprime pas",
  )

  for (const [chemin, fichiers] of [...chemins].sort()) {
    // Le chemin SANS sa locale : c'est lui que la procedure doit nommer.
    const fixe = chemin.replace('/<locale>', '')
    note(`${chemin.padEnd(28)} ← ${fichiers.length} fichier(s) : ${fichiers.join(', ')}`)
    ok(
      procedure.includes(fixe),
      `« ${fixe} » figure dans la liste des Redirect URLs de ${PROCEDURE}`,
      'Supabase REFUSE toute adresse absente de sa liste. Le refus tombe sur ' +
        "l'utilisateur, au moment d'un lien recu par e-mail, et ne laisse aucune " +
        'trace chez nous.',
    )
  }
}

// ─── CE QUE CE CONTROLE NE SAIT PAS ─────────────────────────────────────────

section('F. Ce que ce controle ne verifie pas')

note("il ne dit PAS que les secrets sont poses, ni qu'ils sont justes : cela")
note("demande la base. L'etape « Verifier que les taches planifiees tournent » le fait,")
note(`${dependantes.length} tache(s) sur ${taches.size} leveraient sans les secrets du coffre-fort.`)

console.log('')
if (echecs > 0) {
  console.log(`✘ ${echecs} CONTROLE(S) EN ECHEC`)
  process.exit(1)
}
console.log("✅ Chaque tache qui depend d'un secret trouve ce secret dans la procedure.")
process.exit(0)

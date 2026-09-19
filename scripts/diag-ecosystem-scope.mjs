// scripts/diag-ecosystem-scope.mjs — CLOISONNEMENT PAR ECOSYSTEME (lot 1)
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   LE CLOISONNEMENT S'OUBLIE PAR OMISSION, JAMAIS PAR ERREUR VISIBLE.
//   Une requete a laquelle il manque le filtre ne leve rien, ne casse aucun
//   test, n'affiche aucun symptome : elle renvoie simplement TROP de lignes.
//   C'est ainsi que quatre ecrans ont pu etre ecrits sans filtrer, alors que la
//   colonne etait la, obligatoire, et remplie a chaque ecriture.
//
//   Ce script est donc la seule chose qui SIGNALE qu'un filtre manque.
//
//   Il ne se contente pas de verifier une liste ecrite a la main : il DECOUVRE
//   les routes qui interrogent les tables cloisonnees et exige que chacune soit
//   DECLAREE ci-dessous. Une route ajoutee demain, qui lirait `publications`
//   sans etre declaree, fait echouer ce diagnostic — meme si personne n'a pense
//   au cloisonnement en l'ecrivant. C'est tout l'objet de l'inventaire.
//
//   FILTRER LES LISTES NE SUFFIT PAS. Un lien garde en favori — le detail d'une
//   annonce, une candidature — donnerait acces depuis n'importe quel
//   ecosysteme. Le filtre est donc pose DANS la recherche par identifiant, pas
//   apres elle : l'objet devient INTROUVABLE, et la route emprunte son 404.
//   Jamais 403 : dire « cet objet existe, mais ailleurs » serait deja une fuite.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-ecosystem-scope.mjs        → controles statiques.
//                                                  AUCUN acces base.
//   node --env-file=.env.local scripts/diag-ecosystem-scope.mjs --db
//                                                → + PREUVE DE NEUTRALITE sur
//                                                  les donnees reelles.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, dans aucun mode.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

// ─── L'INVENTAIRE ────────────────────────────────────────────────────────────
// Chaque route touchant une table cloisonnee doit figurer ici, avec son mode :
//   'scoped'  : elle filtre sur l'ecosysteme actif (liste OU acces par id) ;
//   'expert'  : surface EXPERT — un expert est mono-ecosysteme A VIE, et sa
//               garde d'appartenance (profil, match) cloisonne deja ;
//   'exempt'  : hors cloisonnement, avec une raison ecrite.
const SCOPED_TABLES = ['publications', 'candidatures', 'conversations']

const INVENTORY = {
  // ── Organisation : LISTES ──────────────────────────────────────────────
  'publications/route.ts': 'scoped',
  'me/candidatures-org/route.ts': 'scoped',
  'me/badges/route.ts': 'scoped',
  'me/conversations/route.ts': 'scoped',
  // ── Organisation : ACCES PAR IDENTIFIANT ───────────────────────────────
  'publications/[id]/route.ts': 'scoped',
  'publications/[id]/candidatures/route.ts': 'scoped',
  'publications/[id]/close/route.ts': 'scoped',
  'publications/[id]/publish/route.ts': 'scoped',
  'candidatures/[id]/reject/route.ts': 'scoped',
  'candidatures/[id]/select/route.ts': 'scoped',
  'candidatures/[id]/unlock/route.ts': 'scoped',
  // Pitch redige a la demande : elle lit la candidature ET son annonce, donc
  // elle porte le filtre comme les autres acces par identifiant.
  'candidatures/[id]/pitch/route.ts': 'scoped',
  'me/candidatures/[id]/view/route.ts': 'scoped',

  // ── Surfaces EXPERT ────────────────────────────────────────────────────
  // Un expert est lie a UN ecosysteme a vie : son ecosysteme actif est
  // toujours celui de son compte. La garde d'appartenance (profil, match)
  // cloisonne donc deja, et le moteur de mise en relation ne cree de match qu'a
  // l'interieur d'un ecosysteme.
  //
  // OU CELA SE JOUE, ET L'ADRESSE A CHANGE : le cloisonnement du moteur vivait
  // dans lib/matching/shared.ts ; depuis la reecriture du moteur il est porte
  // par lib/matching/pool.ts (sens annonce -> experts) et
  // lib/matching/run-for-expert.ts (sens inverse). Le fait n'a pas bouge,
  // l'adresse si — et une adresse perimee envoie le prochain lecteur verifier
  // au mauvais endroit. Ces deux modules sont desormais DECLARES ci-dessous
  // (LIB_INVENTORY), et leur filtre est verifie, plus seulement affirme.
  'me/missions/[id]/route.ts': 'expert',
  'me/candidatures/route.ts': 'expert',
  'me/collaboration/quota/route.ts': 'expert',
  // Depot de candidature par l'expert : la candidature herite du domain_id du
  // PROFIL (candidatures/route.ts), donc de l'ecosysteme unique de l'expert.
  'candidatures/route.ts': 'expert',

  // ── Conversation : deux cotes ──────────────────────────────────────────
  // La conversation est atteinte par la candidature, elle-meme deja
  // cloisonnee des deux cotes (org via l'annonce, expert via son profil).
  // Un filtre ici serait redondant sans rien ajouter.
  'conversations/[id]/messages/route.ts': 'exempt',
}

// ─── L'INVENTAIRE DES MODULES `lib/` ─────────────────────────────────────────
//
// POURQUOI IL A FALLU L'AJOUTER
//   Le balayage ne regardait que `app/api/**`. Or la moitie des requetes sur les
//   tables cloisonnees vit dans `lib/` : le moteur de mise en relation, le flux
//   expert, le depechage des notifications, le devoilement. Ce diagnostic etait
//   donc VERT pour ces chemins-la — non parce qu'ils etaient conformes, mais
//   parce qu'il ne regardait pas ou ils sont.
//
//   Un angle mort dans le controle qui defend le cloisonnement est plus
//   dangereux que l'absence de controle : il donne une assurance.
//
// LES DEUX MODES, ET LA DIFFERENCE EST REELLE
//   'ligne' : le module lit une LISTE d'une table cloisonnee. Il porte donc
//             lui-meme le filtre, pris sur le `domain_id` de la ligne PIVOT
//             (l'annonce, le profil) et non sur le contexte d'appel — un moteur
//             declenche par une tache planifiee n'a aucun contexte d'appel.
//             VERIFIE : le fichier doit contenir un `.eq('domain_id', …)`.
//
//   'cle'   : le module ne lit QUE par identifiants fournis par l'appelant
//             (`id`, `publication_id`, `candidature_id`, `profile_id`), deja
//             cloisonnes en amont. Y poser un filtre d'ecosysteme serait
//             redondant, et surtout exigerait un contexte que le module n'a pas.
//             VERIFIE : chaque lecture d'une table cloisonnee est clavetee.
const LIB_INVENTORY = {
  // ── Moteur de mise en relation ─────────────────────────────────────────
  // Il lit UNE annonce par identifiant ; tout le reste du run derive de son
  // `domain_id`. C'est le pivot, et il n'y en a qu'un.
  'lib/matching/index.ts': 'cle',
  // Le vivier, lui, est une LISTE : il porte le filtre.
  'lib/matching/pool.ts': 'ligne',
  // Le sens inverse liste des ANNONCES pour un expert : meme obligation.
  'lib/matching/run-for-expert.ts': 'ligne',
  // La reconciliation ne lit que le scope qu'on lui fixe (une annonce ou un
  // profil), jamais une liste libre.
  'lib/matching/reconcile.ts': 'cle',

  // ── Flux et surfaces expert ────────────────────────────────────────────
  // Part de `matches` claveté sur le profil, et joint l'annonce. Un expert est
  // mono-ecosysteme a vie : la cle porte le cloisonnement.
  'lib/missions/feed.ts': 'cle',

  // ── Surfaces organisation ──────────────────────────────────────────────
  // Recoit des identifiants d'annonces deja filtres par la route appelante.
  'lib/candidature-org-dto.ts': 'cle',
  'lib/candidatures/lifecycle-batch.ts': 'cle',
  'lib/unlock.ts': 'cle',

  // ── Administration plateforme ──────────────────────────────────────────
  // Comptage d'usage d'une BRANCHE — pour l'ecran ET pour la barriere de
  // suppression, par la meme lecture (§E.36). Il est cleve sur une branche
  // dont l'appelant a deja resolu l'ecosysteme, et sa seule surface est
  // l'administration PLATEFORME, qui voit tous les ecosystemes par
  // construction (§D.3 : admin -> scope 'platform').
  // Ce sont trois COMPTAGES (`head: true`) clavetes sur `branch_id`, pas un
  // acces par cle primaire : le controle a raison de refuser 'cle'. Et ils ne
  // portent pas de filtre `domain_id` — ils n'en ont pas besoin et ne doivent
  // pas en porter : la seule surface est l'administration PLATEFORME, dont le
  // scope est 'platform' par construction (§D.3), et la branche elle-meme
  // appartient a UN ecosysteme que l'appelant a deja resolu. Un filtre ici
  // masquerait des usages reels et ferait supprimer une branche utilisee.
  'lib/admin/usage-branche.ts': 'exempt',

  // ── Notifications ──────────────────────────────────────────────────────
  // Ne lit que les entites citees par des notifications deja destinees a un
  // utilisateur precis.
  'lib/notifications/dispatch.ts': 'cle',
}

// ─── LES ROUTES QUI PASSENT PAR UN MODULE `ligne` ────────────────────────────
//
// Elles ne citent AUCUNE table cloisonnee : elles confient un identifiant au
// moteur, qui se cloisonne par la ligne. Invisibles au balayage textuel, elles
// sont pourtant le chemin par lequel des dizaines de milliers de lignes sont
// lues. Elles sont donc declarees ICI, explicitement.
const ROUTES_VIA_MOTEUR = {
  // Tache planifiee : aucun contexte d'appel, donc aucun ecosysteme actif. Le
  // cloisonnement ne PEUT venir que de la ligne.
  'cron/match-retry/route.ts': 'moteur',
  // Relance d'un expert arrivee a echeance : meme absence de contexte d'appel,
  // donc meme cloisonnement par la ligne (le domain_id du profil).
  'cron/expert-relance/route.ts': 'moteur',
  // Declencheurs cote expert : l'expert est mono-ecosysteme a vie.
  'me/sync-matching/route.ts': 'moteur',
  'profile/cdi-upload-cv/route.ts': 'moteur',
  'profile/upload-cv/route.ts': 'moteur',
  // Enregistrement du profil : il ne cite aucune table cloisonnee, et pourtant
  // il declenche le moteur dans un after(). C'est precisement la route que le
  // balayage textuel ne pouvait pas voir.
  'profile/route.ts': 'moteur',
}

// ─── DETECTION ───────────────────────────────────────────────────────────────
//
// Une table cloisonnee est atteinte de DEUX facons, et n'en voir qu'une laissait
// passer le flux expert entier :
//   • `.from('publications')`      — la lecture directe ;
//   • `publications!inner(…)`      — la JOINTURE PostgREST. Elle lit exactement
//     les memes lignes, et `lib/missions/feed.ts` n'utilise QUE cette forme.
function atteintTableCloisonnee(src) {
  return SCOPED_TABLES.some(
    (t) => src.includes(`.from('${t}')`) || src.includes(`${t}!inner(`) || src.includes(`${t}(id`),
  )
}

/** Les imports `@/lib/...` et relatifs d'un fichier, resolus en chemins de depot. */
function importsDe(cheminRelatif, src) {
  const out = []
  for (const m of src.matchAll(/from '([^']+)'|import\('([^']+)'\)/g)) {
    const spec = m[1] ?? m[2]
    if (!spec) continue
    let p = null
    if (spec.startsWith('@/lib/')) p = `${spec.slice(2)}.ts`
    else if (spec.startsWith('./') || spec.startsWith('../')) {
      const base = dirname(cheminRelatif)
      p = `${join(base, spec).split('\\').join('/')}.ts`
    }
    if (!p) continue
    p = p.replace(/[.]ts[.]ts$/, '.ts')
    // Un specificateur peut viser un DOSSIER : `@/lib/matching` est
    // `lib/matching/index.ts`. Ne pas le resoudre laissait la decouverte
    // transitive trouver zero route — verte, et aveugle.
    out.push(existeFichier(p) ? p : p.replace(/[.]ts$/, '/index.ts'))
  }
  return out
}

/** Tous les modules `lib/` atteints depuis un fichier, transitivement. */
function moduesAtteints(depart, vus = new Set()) {
  const src = lireSiExiste(depart)
  if (src == null) return vus
  for (const imp of importsDe(depart, src)) {
    if (!imp.startsWith('lib/')) continue
    if (vus.has(imp)) continue
    vus.add(imp)
    moduesAtteints(imp, vus)
  }
  return vus
}

function existeFichier(rel) {
  try { statSync(join(ROOT, rel)); return true } catch { return false }
}

function lireSiExiste(rel) {
  try {
    return readFileSync(join(ROOT, rel), 'utf8')
  } catch {
    // Un index de dossier (`./pool` → `lib/matching/pool.ts`) resout deja ;
    // ce qui reste introuvable est un paquet externe, hors sujet ici.
    return null
  }
}
// ─── DECOUVERTE ──────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e === 'route.ts') out.push(p)
  }
  return out
}

const API_DIR = join(ROOT, 'app', 'api')
const routes = walk(API_DIR)
  .map((p) => relative(API_DIR, p).split('\\').join('/'))
  // Le back-office est PLATEFORME : un administrateur voit tous les
  // ecosystemes, il ne doit surtout pas etre cloisonne.
  .filter((r) => !r.startsWith('admin/'))
  .sort()

const touching = routes.filter((r) => atteintTableCloisonnee(read(join('app', 'api', r))))

// ═══ A. AUCUNE ROUTE N'ECHAPPE A L'INVENTAIRE ══════════════════════════════
section('A. Inventaire : aucune route non declaree')

ok(touching.length >= 15,
  `le balayage voit bien les routes concernees (${touching.length} routes touchent ${SCOPED_TABLES.join(', ')})`,
  'un balayage qui ne trouve presque rien passerait pour vert sans rien verifier')

const undeclared = touching.filter((r) => !(r in INVENTORY))
ok(undeclared.length === 0,
  'toute route touchant une table cloisonnee est DECLAREE',
  undeclared.length
    ? `non declarees : ${undeclared.join(' · ')} — ajoutez-les a INVENTORY avec leur mode, ou cloisonnez-les`
    : undefined)

const stale = Object.keys(INVENTORY).filter((r) => !touching.includes(r))
ok(stale.length === 0,
  'aucune entree d’inventaire perimee',
  stale.length ? `declarees mais ne touchent plus ces tables : ${stale.join(' · ')}` : undefined)

// ═══ A2. LES MODULES `lib/` NON PLUS ═══════════════════════════════════════
section('A2. Inventaire : aucun module lib/ non declare')

function parcourirLib(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) parcourirLib(p, out)
    else if (e.endsWith('.ts')) out.push(p)
  }
  return out
}

const LIB_DIR = join(ROOT, 'lib')
const modulesLib = parcourirLib(LIB_DIR)
  .map((p) => `lib/${relative(LIB_DIR, p).split('\\').join('/')}`)
  .sort()

const libTouching = modulesLib.filter((m) => atteintTableCloisonnee(read(m)))

ok(libTouching.length >= 8,
  `le balayage voit les modules concernes (${libTouching.length} modules lib/ touchent ${SCOPED_TABLES.join(', ')})`,
  'un balayage qui ne trouve presque rien passerait pour vert sans rien verifier')

const libNonDeclares = libTouching.filter((m) => !(m in LIB_INVENTORY))
ok(libNonDeclares.length === 0,
  'tout module lib/ touchant une table cloisonnee est DECLARE',
  libNonDeclares.length
    ? `non declares : ${libNonDeclares.join(' · ')} — ajoutez-les a LIB_INVENTORY avec leur mode`
    : undefined)

const libPerimes = Object.keys(LIB_INVENTORY).filter((m) => !libTouching.includes(m))
ok(libPerimes.length === 0,
  'aucune entree lib/ perimee',
  libPerimes.length ? `declares mais ne touchent plus ces tables : ${libPerimes.join(' · ')}` : undefined)

// ═══ A2 bis. `components/` N'ATTEINT AUCUNE TABLE CLOISONNEE — ZERO, PAS ═════
// ═══           « DECLARE ». Et ce n'est pas la meme regle qu'en A1 / A2.   ═════
section('A2 bis. Aucun composant ne lit une table cloisonnee')

//   POURQUOI UNE REGLE PLUS DURE ICI, ET PAS UN INVENTAIRE DE PLUS.
//   Un composant s'execute dans le NAVIGATEUR, avec la cle anon. S'il lisait
//   `publications`, `candidatures` ou `conversations`, le filtre d'ecosysteme
//   serait pose PAR LE CLIENT — c'est-a-dire pas pose du tout : §D.3 rappelle
//   que `x-subdomain` est falsifiable, et que la garde recroise l'en-tete avec
//   `users.domain_id` AU SERVEUR. Il n'existe donc aucun mode legitime
//   (`scoped`, `expert`, `exempt`) pour un composant : la reponse est ZERO.
//
//   MESURE AU 18/09/2026 : zero. Cette section ne repare rien — elle GARDE un
//   etat deja sain, au moment ou c'est gratuit. §E.18 : le seul moment ou il
//   est bon marche de fermer un trou est celui ou l'on n'est pas encore tombe
//   dedans. Jusqu'ici ce diagnostic ignorait `components/` : il etait vert
//   PARCE QU'IL NE REGARDAIT PAS.

function parcourirComposants(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) parcourirComposants(p, out)
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(p)
  }
  return out
}

const COMPOSANTS_DIR = join(ROOT, 'components')
const composants = parcourirComposants(COMPOSANTS_DIR)
  .map((p) => `components/${relative(COMPOSANTS_DIR, p).split('\\').join('/')}`)
  .sort()

ok(composants.length > 50,
  `le balayage voit bien components/ (${composants.length} fichiers)`,
  'un balayage qui ne trouve presque rien passerait pour vert sans rien verifier')

const composantsFautifs = composants.filter((c) => atteintTableCloisonnee(read(c)))
ok(composantsFautifs.length === 0,
  'aucun composant ne lit une table cloisonnee directement',
  composantsFautifs.length
    ? `${composantsFautifs.join(' · ')} — le cloisonnement se pose au SERVEUR (§D.3). ` +
      'Passez par une route, qui filtre avec activeEcosystemId(auth).'
    : undefined)


// ═══ A3. LES MODULES `ligne` PORTENT VRAIMENT LEUR FILTRE ══════════════════
section('A3. Les modules qui LISTENT portent le filtre')

const sansFiltre = Object.entries(LIB_INVENTORY)
  .filter(([, mode]) => mode === 'ligne')
  .map(([m]) => m)
  .filter((m) => !read(m).includes(".eq('domain_id'"))
ok(sansFiltre.length === 0,
  'les modules declares "ligne" filtrent sur domain_id',
  sansFiltre.length
    ? `sans filtre : ${sansFiltre.join(' · ')} — une LISTE sans filtre traverse les ecosystemes`
    : undefined)

// Un module `cle` ne doit lire que par identifiant. Une lecture non clavetee y
// serait une liste deguisee, et le mode mentirait sur ce que le module fait.
const cleNonClavetes = []
for (const [m, mode] of Object.entries(LIB_INVENTORY)) {
  if (mode !== 'cle') continue
  const lignes = read(m).replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lignes.length; i++) {
    const t = SCOPED_TABLES.find((x) => lignes[i].includes(`.from('${x}')`))
    if (!t) continue
    // Une ECRITURE n'est pas une liste : un insert porte son propre
    // domain_id, un update est clavete sur la ligne qu'il modifie. Seule la
    // LECTURE peut traverser les ecosystemes, et c'est elle qu'on controle.
    const fenetre = lignes.slice(i, i + 14).join(String.fromCharCode(10))
    if (/[.](insert|upsert)[(]/.test(fenetre)) continue
    if (!/[.](eq|in)[(]'(id|publication_id|candidature_id|profile_id|conversation_id)'/.test(fenetre)) {
      cleNonClavetes.push(`${m}:${i + 1}`)
    }
  }
}
ok(cleNonClavetes.length === 0,
  'les modules declares "cle" ne lisent que par identifiant',
  cleNonClavetes.length
    ? `lecture non clavetee : ${cleNonClavetes.join(' · ')} — c'est une liste, pas un acces par cle`
    : undefined)

// ═══ A4. LES ROUTES QUI ATTEIGNENT LE MOTEUR ═══════════════════════════════
section('A4. Les routes qui passent par un module qui LISTE')

// Une route peut ne citer aucune table cloisonnee et pourtant en lire des
// dizaines de milliers de lignes, en confiant un identifiant au moteur. C'est
// le cas de /api/cron/match-retry : invisible au balayage textuel, et pourtant
// le chemin par lequel tout un vivier est charge.
const modulesListants = new Set(
  Object.entries(LIB_INVENTORY).filter(([, mode]) => mode === 'ligne').map(([m]) => m),
)

const routesViaMoteur = routes.filter((r) => {
  if (touching.includes(r)) return false // deja couvertes par l'inventaire A
  const atteints = moduesAtteints(`app/api/${r}`)
  return [...atteints].some((m) => modulesListants.has(m))
})

const viaMoteurNonDeclarees = routesViaMoteur.filter((r) => !(r in ROUTES_VIA_MOTEUR))
ok(viaMoteurNonDeclarees.length === 0,
  `les routes atteignant un module qui LISTE sont declarees (${routesViaMoteur.length} trouvee(s))`,
  viaMoteurNonDeclarees.length
    ? `non declarees : ${viaMoteurNonDeclarees.join(' · ')} — elles lisent une table cloisonnee sans la citer`
    : undefined)

const viaMoteurPerimees = Object.keys(ROUTES_VIA_MOTEUR).filter((r) => !routesViaMoteur.includes(r))
ok(viaMoteurPerimees.length === 0,
  'aucune declaration "moteur" perimee',
  viaMoteurPerimees.length ? `n'atteignent plus de module listant : ${viaMoteurPerimees.join(' · ')}` : undefined)

// ═══ B. LES ROUTES DECLAREES `scoped` FILTRENT VRAIMENT ════════════════════
section('B. Les routes cloisonnees filtrent sur l’ecosysteme ACTIF')

const scopedRoutes = Object.entries(INVENTORY).filter(([, m]) => m === 'scoped').map(([r]) => r)
const notFiltering = []
const notNamed = []
for (const r of scopedRoutes) {
  const src = read(join('app', 'api', r))
  if (!src.includes(".eq('domain_id'")) notFiltering.push(r)
  // Le marqueur NOMME : `auth.domain.id` en direct ne dit pas au relecteur
  // lequel des deux ecosystemes il regarde (celui du compte ou l'actif).
  if (!src.includes('activeEcosystemId(auth)')) notNamed.push(r)
}
ok(notFiltering.length === 0,
  `les ${scopedRoutes.length} routes declarees "scoped" posent bien un filtre domain_id`,
  notFiltering.length ? `sans filtre : ${notFiltering.join(' · ')}` : undefined)
ok(notNamed.length === 0,
  'le filtre passe par `activeEcosystemId(auth)`, jamais `auth.domain.id` en direct',
  notNamed.length ? `lecture directe : ${notNamed.join(' · ')}` : undefined)

// ═══ C. LES ACCES PAR IDENTIFIANT — 404, JAMAIS UNE LISTE VIDE ═════════════
section('C. Acces par identifiant : filtre DANS la recherche')

// Le filtre doit etre pose sur la meme requete que `.eq('id', …)`. Pose apres
// coup, il laisserait un chemin ou l'objet est charge avant d'etre refuse — et
// surtout, sur une ECRITURE, l'ecriture aurait deja eu lieu.
const BY_ID = scopedRoutes.filter((r) => r.includes('[id]'))
const badById = []
for (const r of BY_ID) {
  const src = read(join('app', 'api', r)).replace(/\r\n/g, '\n')
  // Chaque `.eq('id', …)` d'une requete sur une table cloisonnee doit etre
  // suivi, dans les 3 lignes, d'un `.eq('domain_id', …)`.
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/\.eq\('id',\s*\w+\)/.test(lines[i])) continue
    const window = lines.slice(Math.max(0, i - 14), i + 4).join('\n')
    if (!SCOPED_TABLES.some((t) => window.includes(`.from('${t}')`))) continue
    if (!lines.slice(i, i + 4).join('\n').includes(".eq('domain_id'")) {
      badById.push(`${r}:${i + 1}`)
    }
  }
}
ok(badById.length === 0,
  `les ${BY_ID.length} acces par identifiant filtrent DANS la recherche`,
  badById.length
    ? `filtre absent ou hors de la requete : ${badById.join(' · ')} — un lien garde en favori ouvrirait l’objet depuis un autre ecosysteme`
    : undefined)

// ═══ D. LE BACK-OFFICE N'EST PAS CLOISONNE ═════════════════════════════════
section('D. L’administrateur reste plateforme')

const adminRoutes = walk(API_DIR)
  .map((p) => relative(API_DIR, p).split('\\').join('/'))
  .filter((r) => r.startsWith('admin/'))
const adminScoped = adminRoutes.filter((r) => read(join('app', 'api', r)).includes('activeEcosystemId('))
ok(adminScoped.length === 0,
  'aucune route admin ne cloisonne par ecosysteme',
  adminScoped.length ? `cloisonnees a tort : ${adminScoped.join(' · ')} — un admin voit TOUS les ecosystemes` : undefined)

// ═══ E. LA DOCTRINE EST ECRITE, PAS SEULEMENT APPLIQUEE ════════════════════
section('E. La regle est ecrite dans le code')

const doctrine = read('lib/ecosystem-scope.ts')
ok(/S'OUBLIE PAR OMISSION/.test(doctrine),
  'lib/ecosystem-scope.ts porte la doctrine',
  'sans elle, le prochain lecteur verra douze `.eq()` sans savoir pourquoi ils sont la')
ok(/export function activeEcosystemId/.test(doctrine),
  'le nom du marqueur existe et est exporte')
ok(!/export function scopedToEcosystem/.test(doctrine),
  'aucune abstraction morte laissee derriere',
  'un helper exporte mais jamais appele est une regle que personne n’applique')

// ═══ F. PREUVE DE NEUTRALITE — LECTURE SEULE ═══════════════════════════════
if (process.argv.includes('--db')) {
  section('F. Preuve de neutralite en mono-ecosysteme (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    console.log('       node --env-file=.env.local scripts/diag-ecosystem-scope.mjs --db')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    // L'ARGUMENT : ajouter une egalite sur une colonne NOT NULL dont toutes les
    // valeurs sont deja celle qu'on compare ne peut retirer AUCUNE ligne. On le
    // verifie sur les donnees reelles, organisation par organisation.
    const { data: pubs, error } = await db
      .from('publications')
      .select('organization_id, domain_id')
    if (error) {
      console.log(`  KO   lecture des publications : ${error.message}`)
      failures++
    } else {
      const byOrg = new Map()
      let missing = 0
      for (const p of pubs ?? []) {
        if (!p.domain_id) { missing++; continue }
        if (!byOrg.has(p.organization_id)) byOrg.set(p.organization_id, new Set())
        byOrg.get(p.organization_id).add(p.domain_id)
      }
      const multi = [...byOrg.entries()].filter(([, s]) => s.size > 1)

      console.log(`\n       Annonces lues : ${(pubs ?? []).length}`)
      console.log(`       Organisations distinctes : ${byOrg.size}`)
      console.log(`       Sans ecosysteme (anomalie) : ${missing}`)
      console.log(`       Organisations sur PLUSIEURS ecosystemes : ${multi.length}`)

      ok(missing === 0, 'toute annonce porte un ecosysteme',
        missing ? `${missing} annonce(s) sans domain_id — la colonne est pourtant NOT NULL` : undefined)
      ok(multi.length === 0,
        'aucune organisation n’a d’annonces sur plusieurs ecosystemes',
        multi.length
          ? `${multi.length} organisation(s) concernee(s) : le filtre N'EST PLUS NEUTRE pour elles, ` +
            'il retirera des lignes de leur liste. Verifiez que c’est bien voulu avant de deployer.'
          : undefined)

      if (multi.length === 0) {
        console.log('\n       => Le filtre est NEUTRE sur ces donnees : aucune ligne ne peut')
        console.log('          disparaitre d’aucune liste. Le lot 1 ne change rien d’observable.')
      }

      // Meme demonstration cote candidatures.
      const { data: cands, error: cErr } = await db
        .from('candidatures')
        .select('publication_id, domain_id')
      if (cErr) {
        console.log(`  KO   lecture des candidatures : ${cErr.message}`)
        failures++
      } else {
        const domsByPub = new Map()
        for (const p of pubs ?? []) domsByPub.set(p.organization_id, p.domain_id)
        const candMissing = (cands ?? []).filter((c) => !c.domain_id).length
        ok(candMissing === 0, 'toute candidature porte un ecosysteme',
          candMissing ? `${candMissing} candidature(s) sans domain_id` : undefined)
        console.log(`       Candidatures lues : ${(cands ?? []).length}`)
      }
    }
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)

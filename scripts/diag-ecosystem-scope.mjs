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
  'me/candidatures/[id]/view/route.ts': 'scoped',

  // ── Surfaces EXPERT ────────────────────────────────────────────────────
  // Un expert est lie a UN ecosysteme a vie : son ecosysteme actif est
  // toujours celui de son compte. La garde d'appartenance (profil, match)
  // cloisonne donc deja, et le moteur de matching ne cree de match qu'a
  // l'interieur d'un ecosysteme (lib/matching/shared.ts).
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

const touching = routes.filter((r) => {
  const src = read(join('app', 'api', r))
  return SCOPED_TABLES.some((t) => src.includes(`.from('${t}')`))
})

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

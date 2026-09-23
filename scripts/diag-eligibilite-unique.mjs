// scripts/diag-eligibilite-unique.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ « ÉLIGIBLE » S'ÉCRIT UNE FOIS, ET LES DEUX SENS DU MOTEUR LA LISENT.     ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE CAS MESURÉ, LE 23/09/2026 ───────────────────────────────────────────┐
// │ Le moteur a DEUX sens, et chacun jugeait de son côté. TROIS conditions    │
// │ manquaient côté expert — compte SUSPENDU, en SUPPRESSION, ANONYMISÉ — et  │
// │ elles n'étaient même pas chargeables : le `select` ne demandait pas les    │
// │ colonnes.                                                                  │
// │                                                                            │
// │ LES DEUX FICHIERS AFFIRMAIENT LE CONTRAIRE, EN TOUTES LETTRES :            │
// │   « Exactement les mêmes conditions que côté vivier »                      │
// │   « la SEULE implémentation de la garde […] pas de seconde liste »         │
// │                                                                            │
// │ ATTEIGNABLE PAR DEUX CHEMINS qui ne passent pas par `requireAuth` : le     │
// │ cron de relance et l'approbation par un administrateur. Un expert          │
// │ suspendu était noté (dépense réelle) et NOTIFIÉ.                           │
// └────────────────────────────────────────────────────────────────────────────┘
//
// LES CINQ PROPRIÉTÉS DÉFENDUES :
//   ① UNE SEULE ÉCRITURE — aucun fichier du moteur ne pose un filtre ou un
//      test d'éligibilité de son cru. Le détecteur est construit À PARTIR de
//      la liste du module : une condition ajoutée demain étend le balayage
//      sans qu'on l'y inscrive (§E.61).
//   ② LES DEUX SENS PLIENT LA MÊME LISTE — l'un en SQL, l'autre en mémoire.
//   ③ LES COLONNES SONT DÉRIVÉES — un test sur une colonne que le `select` ne
//      charge pas ne lève rien : il lit `undefined` et conclut (§E.1).
//   ④ LES DEUX FORMES COÏNCIDENT — la forme SQL et le test en mémoire sont
//      ÉPROUVÉS l'un contre l'autre sur une matrice de lignes, sémantique NULL
//      de PostgreSQL comprise. C'est l'assertion qui empêche le jumeau de
//      diverger en silence (§E.20).
//   ⑤ LES COMPTES FERMÉS SONT EXCLUS PARTOUT, SANS EXCEPTION — leurs trois
//      conditions sont de portée `toujours`, jamais conditionnées à un public.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   ⚠️ DEUX PÉRIMÈTRES, ET LA DISTINCTION A ÉTÉ MESURÉE, PAS SUPPOSÉE.
//
//   BALAYE   lib/matching/          TOUTES les colonnes d'éligibilité. C'est le
//                                   moteur : toute condition qu'il pose sur un
//                                   profil EST une condition d'éligibilité.
//            app/api/               les colonnes de COMPTE seulement, et
//                                   QUALIFIÉES. C'est la moitié « sans
//                                   exception » de la décision : aucune route
//                                   ne décide d'elle-même qu'un compte fermé
//                                   est éligible.
//            messages/*.json        les quatre langues
//
//   EXCLU    les colonnes de PROFIL dans app/api/ — ⚠️ APRÈS MESURE :
//                                   `/api/profile/visibility` ÉCRIT `visible`,
//                                   `/api/profile` relit `cv_parsing_status`
//                                   pour savoir s'il doit déclencher une
//                                   recherche. Les interdire ferait rougir le
//                                   contrôle sur du code qui a raison — et un
//                                   contrôle qui rougit à tort cesse d'être lu
//                                   (§E.52).
//            lib/ hors matching/    même raison : ces colonnes y vivent
//                                   légitimement. Ce qui se défend est qu'aucun
//                                   chemin du MOTEUR n'en juge, pas que
//                                   personne n'y touche.
//            components/            une règle serveur en UI serait un autre
//                                   défaut, déjà gardé ailleurs (§E.15)
//            node_modules/ .next/   pas du dépôt / généré
//            supabase/_archive/     retirées du tronc
//            docs/                  de la prose
//
//   ⚠️ CE QU'IL NE VOIT PAS, ET C'EST DÉCLARÉ (§E.38) : une colonne de compte
//      lue en mémoire à travers un receveur inhabituel — ni `users`, ni `u`.
//      Le dépôt n'en porte aucun (mesuré), et élargir le receveur ferait
//      remordre les quatre `status` du moteur que ce contrôle vient d'écarter.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-eligibilite-unique.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')
const LOCALES = ['fr', 'en', 'es', 'de']

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

/* ═══════════════════════════════════════════════════════════════════════════
   0. LA RÈGLE S'IMPORTE, ET ELLE S'EXÉCUTE (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */
const REGLE = 'lib/matching/eligibilite.ts'
let E = null
try {
  E = await import(new URL(`../${REGLE}`, import.meta.url).href)
} catch (e) {
  console.error(`\n❌ ${REGLE} INIMPORTABLE : ${e.message}\n`)
  process.exit(2)
}

section('0. Le détecteur retrouve le défaut, et se tait sur le correctif')

/**
 * Un fichier POSE-T-IL un filtre ou un test sur une colonne d'éligibilité ?
 *
 * ⚠️ LE DÉTECTEUR EST CONSTRUIT DEPUIS LA LISTE DU MODULE, jamais depuis une
 *    liste écrite ici (§E.61). Une condition ajoutée demain étend le balayage
 *    toute seule — et c'est exactement le contraire qui a produit le défaut :
 *    trois conditions ont été ajoutées d'un seul côté parce que rien ne
 *    regardait l'autre.
 */
// ⚠️ UNE COLONNE DE COMPTE NE SE CHERCHE QUE **QUALIFIÉE**, ET LA PREMIÈRE
//    EXÉCUTION L'A PROUVÉ. `status` nu est le nom le plus commun du dépôt :
//    `matches.status`, `publications.status`, `organizations.status`,
//    `stripe_events.status`, `invitations.status`… Le détecteur a dénoncé
//    SOIXANTE ET UN fichiers, dont le sien, et il a même mordu sur SON PROPRE
//    TÉMOIN — `status` se trouve à l'intérieur de `availability_status`.
//    Un nom trop commun ne défend rien : il noie la seule occurrence qui compte
//    (§E.34, §E.40).
//    On exige donc `users.` devant une colonne de compte — la forme qu'un
//    filtre PostgREST doit prendre pour porter sur la relation jointe — et une
//    frontière de mot à gauche partout.
const COLONNES = [...E.COLONNES_PROFIL, ...E.COLONNES_COMPTE]
/** `true` si la colonne vit sur le compte : elle ne se cherche que qualifiée. */
const estColonneDeCompte = (col) => E.COLONNES_COMPTE.includes(col)
const motifsDe = (col) => {
  const prefixe = estColonneDeCompte(col) ? 'users\\.' : '(?:users\\.)?'
  const gauche = '(?<![A-Za-z0-9_])'
  return [
    // PostgREST : .eq('col', …) .neq('col', …) .is('col', …) .not('col', …)
    new RegExp(`\\.(?:eq|neq|is|not|gt|gte|lt|lte)\\(\\s*['"\`]${prefixe}${gauche}${col}['"\`]`),
    // PostgREST : .or('col.is.null,col.neq.x')
    new RegExp(`\\.or\\(\\s*['"\`][^'"\`]*${prefixe}${gauche}${col}\\.`),
    // Mémoire : p.col === … / !== … — et, pour une colonne de COMPTE, le
    // receveur doit être la relation `users` (ou son alias usuel `u`, produit
    // par `pickRel(p.users)`). Sans ça, `verdict.status === 'error'` et
    // `m.status === 'dismissed'` — qui n'ont rien à voir — faisaient rougir
    // quatre fichiers du moteur.
    estColonneDeCompte(col)
      ? new RegExp(`(?:users|u)\\??\\.${gauche}${col}(?![A-Za-z0-9_])\\s*(?:===|!==|==|!=)`)
      : new RegExp(`\\.${gauche}${col}(?![A-Za-z0-9_])\\s*(?:===|!==|==|!=)`),
  ]
}
const jugeEligibilite = (src) => {
  const nu = depouillerJs(src)
  const vues = []
  for (const col of COLONNES) {
    if (motifsDe(col).some((r) => r.test(nu))) vues.push(col)
  }
  return vues
}

const TEMOIN_SQL = `  q = q.eq('visible', true).neq('users.status', 'suspended')`
const TEMOIN_MEMOIRE = `  if (p.cdi_status === 'employed') return false`
const TEMOIN_OR = `  q = q.or('availability_status.is.null,availability_status.neq.do_not_disturb')`
const TEMOIN_SAIN = `  const x = profil.title ?? null\n  q = q.eq('domain_id', d)`
const TEMOIN_COMMENTAIRE = `  // un jour on fera .eq('visible', true) ici\n  const x = 1`

/** Le `status` d'un AUTRE objet — le cas qui a noyé la première exécution. */
const TEMOIN_STATUT_VOISIN = `  q = q.eq('status', 'dismissed').in('status', ['open', 'closed'])`
/** `status` À L'INTÉRIEUR d'un autre nom — il a mordu sur le témoin `or`. */
const TEMOIN_SOUS_CHAINE = `  q = q.eq('cv_parsing_status', 'done')`

ok(jugeEligibilite(TEMOIN_SQL).length === 2, 'il VOIT un filtre SQL d’éligibilité')
ok(jugeEligibilite(TEMOIN_MEMOIRE).length === 1, '… et un test en mémoire')
ok(jugeEligibilite(TEMOIN_OR).length === 1, '… et la forme `or` sur une colonne nullable')
ok(
  jugeEligibilite(TEMOIN_STATUT_VOISIN).length === 0,
  '… et le `status` d’un AUTRE objet ne compte pas',
  'status nu est le nom le plus commun du depot : matches, publications, organizations, invitations…',
)
ok(
  jugeEligibilite(TEMOIN_SOUS_CHAINE).join(',') === 'cv_parsing_status',
  '… et `status` à l’INTÉRIEUR d’un autre nom non plus',
  'sans frontiere de mot, il mordait jusque sur son propre temoin',
)
/** Le `status` d'un objet du moteur, en mémoire — quatre fichiers en portent. */
const TEMOIN_STATUT_MEMOIRE = `  if (verdict.status === 'error') return null\n  if (m.status !== 'dismissed') keep(m)`
/** Le `status` du COMPTE, en mémoire — celui-là doit mordre. */
const TEMOIN_COMPTE_MEMOIRE = `  const u = pickRel(p.users)\n  if (u.status === 'suspended') return false`

ok(
  jugeEligibilite(TEMOIN_STATUT_MEMOIRE).length === 0,
  '… et le `status` d’un objet du moteur, en mémoire, non plus',
  'verdict.status, match.status, run.status : quatre fichiers du moteur en portent',
)
ok(
  jugeEligibilite(TEMOIN_COMPTE_MEMOIRE).join(',') === 'status',
  '… mais le `status` du COMPTE, en mémoire, mord',
  'c est la forme exacte qu aurait prise une seconde garde ecrite a la main',
)
ok(jugeEligibilite(TEMOIN_SAIN).length === 0, '… et il se TAIT sur un filtre qui n’en est pas un')
ok(
  jugeEligibilite(TEMOIN_COMMENTAIRE).length === 0,
  '… et un COMMENTAIRE qui en décrit un ne compte pas (§E.7)',
  'un commentaire n’a jamais filtré une ligne',
)

/* ═══════════════════════════════════════════════════════════════════════════
   1. UNE SEULE ÉCRITURE DE LA RÈGLE
   ═══════════════════════════════════════════════════════════════════════════ */
section('1. Aucun chemin du moteur ne juge l’éligibilité de son côté')

// ⚠️ DEUX PÉRIMÈTRES, ET LA DISTINCTION EST MESURÉE — PAS UNE COMMODITÉ.
//
//   DANS `lib/matching/` : AUCUNE colonne d'éligibilité, de profil comme de
//   compte. C'est le moteur : toute condition qu'il pose est une condition
//   d'éligibilité, par définition.
//
//   DANS `app/api/` : seulement les colonnes de COMPTE, qualifiées. Les
//   colonnes de PROFIL y vivent légitimement — `/api/profile/visibility` ÉCRIT
//   `visible`, `/api/profile` relit `cv_parsing_status` pour savoir s'il doit
//   déclencher une recherche. Les interdire ferait rougir le contrôle sur du
//   code qui a raison, et un contrôle qui rougit à tort cesse d'être lu (§E.52).
//   Ce qui reste interdit partout, c'est qu'une route décide elle-même qu'un
//   compte fermé est éligible : c'est la moitié « sans exception » de la
//   décision, et elle ne souffre aucun cas légitime.
const MOTEUR = fichiersSous(['lib/matching'])
const ROUTES = fichiersSous(['app/api'])
ok(MOTEUR.length > 10, `${MOTEUR.length} fichiers du moteur balayés`,
  'un balayage qui ne voit presque rien passerait pour vert sans rien vérifier')
ok(ROUTES.length > 80, `${ROUTES.length} routes balayées pour les colonnes de compte`)

const juges = MOTEUR.filter((f) => f !== REGLE && jugeEligibilite(lire(f)).length > 0)
ok(
  juges.length === 0,
  `aucun second juge dans le moteur : ${juges.map((f) => `${f} (${jugeEligibilite(lire(f)).join(', ')})`).join(' · ') || '—'}`,
  'c’est exactement la forme du défaut : deux listes, l’une avec trois conditions de moins',
)

const jugesDeCompte = ROUTES.filter((f) =>
  jugeEligibilite(lire(f)).some((c) => E.COLONNES_COMPTE.includes(c)),
)
ok(
  jugesDeCompte.length === 0,
  `aucune route ne juge un compte fermé de son côté : ${jugesDeCompte.join(' · ') || '—'}`,
  'les suspendus et les comptes en suppression sont exclus du moteur PARTOUT, sans exception',
)

/* ═══════════════════════════════════════════════════════════════════════════
   2. LES DEUX SENS PLIENT LA MÊME LISTE
   ═══════════════════════════════════════════════════════════════════════════ */
section('2. Les deux sens lisent la règle, chacun dans sa forme')

const POOL = depouillerJs(lire('lib/matching/pool.ts'))
const EXPERT = depouillerJs(lire('lib/matching/run-for-expert.ts'))

ok(/appelsPostgrest\s*\(/.test(POOL), 'le vivier (annonce → experts) plie la forme SQL')
ok(/jugerEligibilite\s*\(/.test(EXPERT), 'le sens expert → annonces plie le test en mémoire')
ok(
  !/appelsPostgrest\s*\(/.test(EXPERT) && !/jugerEligibilite\s*\(/.test(POOL),
  '… et chacun ne prend QUE la forme qui lui convient',
  'un sens qui prendrait les deux formes en appliquerait une pour rien',
)

// Les deux portées de disponibilité sont demandées, et elles le sont AVEC le
// public concerné : `appelsPostgrest(kind, [kind])`.
ok(
  /appelsPostgrest\(publicNatif, \['toujours'\]\)/.test(POOL),
  'le vivier demande les conditions COMMUNES pour son public natif',
)
ok(
  /appelsPostgrest\(kind, \[kind\]\)/.test(POOL),
  '… et la disponibilité du public réellement chargé',
  'demander celle du public natif pour la cohorte croisée filtrerait sur la mauvaise colonne',
)

/* ═══════════════════════════════════════════════════════════════════════════
   3. LES COLONNES SONT DÉRIVÉES — un test sur une colonne absente conclut
   ═══════════════════════════════════════════════════════════════════════════ */
section('3. Les deux `select` sont construits depuis la règle')

for (const [nom, src] of [['vivier', POOL], ['expert', EXPERT]]) {
  ok(
    /COLONNES_PROFIL\.join\(/.test(src) && /COLONNES_COMPTE\.join\(/.test(src),
    `${nom} : les colonnes d’éligibilité sont DÉRIVÉES`,
    'listées à la main, elles se désaccordent de la règle à la première condition ajoutée',
  )
}
// Et elles ne sont PAS aussi écrites en dur DANS LE `select` — ce qui ferait
// deux listes dont une survivrait au changement de l’autre.
//
// ⚠️ ON DÉCOUPE LA DÉCLARATION, ON NE BALAIE PAS LE FICHIER. Ce test lisait
//    toutes les chaînes du fichier, et `.eq('status', 'dismissed')` — le
//    statut d’un MATCH, sans rapport — le faisait rougir des deux côtés. Une
//    assertion qui cherche hors du bloc qu’elle défend trouve autre chose
//    (§E.8).
const declarationSelect = (src) => {
  const d = src.indexOf('const SELECT_PROFIL =')
  if (d < 0) return ''
  const f = src.indexOf('\n\n', d)
  return f < 0 ? src.slice(d) : src.slice(d, f)
}
for (const [nom, src] of [['vivier', POOL], ['expert', EXPERT]]) {
  const decl = declarationSelect(src)
  ok(
    decl.includes('users!profiles_user_id_fkey'),
    `${nom} : la declaration du select est isolee`,
    'une declaration vide passerait les assertions suivantes sans rien mesurer (§E.33)',
  )
  // On retire les interpolations DÉRIVÉES : ce qui reste est écrit à la main.
  const aLaMain = decl.replace(/\$\{COLONNES_(?:PROFIL|COMPTE)[^}]*\}/g, '')
  const enDur = COLONNES.filter((c) =>
    new RegExp(`(?<![A-Za-z0-9_])${c}(?![A-Za-z0-9_])`).test(aLaMain),
  )
  ok(
    enDur.length === 0,
    `${nom} : aucune colonne d’éligibilité n’est AUSSI écrite en dur (${enDur.join(', ') || '—'})`,
    'une seconde écriture survit au jour où la première change',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. LES DEUX FORMES COÏNCIDENT — éprouvées l'une contre l'autre
   ═══════════════════════════════════════════════════════════════════════════

   ⚠️ C'EST L'ASSERTION QUI TIENT TOUT LE RESTE. « Une seule liste » ne suffit
      pas : chaque entrée porte DEUX expressions de la même condition, et rien
      n'oblige a priori à ce qu'elles disent la même chose. On les exécute donc
      toutes les deux sur les mêmes lignes — sémantique NULL de PostgreSQL
      comprise, qui est précisément là que les deux divergent naturellement. */
section('4. La forme SQL et le test en mémoire rendent le MÊME verdict')

/** Évalue un `AppelPostgrest` sur une ligne, avec la sémantique de PostgreSQL. */
function evaluerSql(appel, ligne) {
  const lireCol = (col) => {
    if (col.startsWith('users.')) {
      const u = Array.isArray(ligne.users) ? (ligne.users[0] ?? null) : (ligne.users ?? null)
      return u ? u[col.slice(6)] : undefined
    }
    return ligne[col]
  }
  switch (appel.methode) {
    case 'eq':
      return lireCol(appel.colonne) === appel.valeur
    case 'neq': {
      const v = lireCol(appel.colonne)
      // ⚠️ `colonne <> 'x'` vaut NULL quand la colonne est NULL → ligne ÉCARTÉE.
      if (v === null || v === undefined) return false
      return v !== appel.valeur
    }
    case 'is_null': {
      const v = lireCol(appel.colonne)
      return v === null || v === undefined
    }
    case 'not_null': {
      const v = lireCol(appel.colonne)
      return v !== null && v !== undefined
    }
    case 'or': {
      // `col.is.null,col.neq.valeur`
      return appel.expression.split(',').some((terme) => {
        const m = terme.match(/^(.+?)\.(is|neq|eq)\.(.+)$/)
        if (!m) return false
        const [, col, op, brut] = m
        const v = lireCol(col)
        if (op === 'is') return brut === 'null' ? v === null || v === undefined : v === brut
        if (op === 'eq') return String(v) === brut
        if (v === null || v === undefined) return false
        return String(v) !== brut
      })
    }
    default:
      return false
  }
}

/** Le verdict SQL complet sur une ligne, pour un public. */
function verdictSql(ligne, kind) {
  for (const appel of E.appelsPostgrest(kind, ['toujours', kind])) {
    if (!evaluerSql(appel, ligne)) return false
  }
  return true
}

const LIGNE_SAINE = {
  visible: true,
  cv_parsing_status: 'done',
  ai_consent_at: '2026-01-01T00:00:00Z',
  verification_status: 'approved',
  availability_status: 'available',
  cdi_status: 'searching',
  users: { status: 'active', deletion_scheduled_at: null, anonymized_at: null },
}

/**
 * La matrice : la ligne saine, puis UNE déviation par condition, puis les cas
 * NULL — qui sont ceux où SQL et mémoire divergent naturellement.
 */
const MATRICE = [
  ['ligne saine', LIGNE_SAINE],
  ['profil invisible', { ...LIGNE_SAINE, visible: false }],
  ['CV non analysé', { ...LIGNE_SAINE, cv_parsing_status: 'pending' }],
  ['CV jamais tenté (null)', { ...LIGNE_SAINE, cv_parsing_status: null }],
  ['consentement absent', { ...LIGNE_SAINE, ai_consent_at: null }],
  ['profil non approuvé', { ...LIGNE_SAINE, verification_status: 'pending' }],
  ['vérification jamais faite (null)', { ...LIGNE_SAINE, verification_status: null }],
  ['compte suspendu', { ...LIGNE_SAINE, users: { ...LIGNE_SAINE.users, status: 'suspended' } }],
  ['compte en suppression', { ...LIGNE_SAINE, users: { ...LIGNE_SAINE.users, deletion_scheduled_at: '2026-09-01T00:00:00Z' } }],
  ['compte anonymisé', { ...LIGNE_SAINE, users: { ...LIGNE_SAINE.users, anonymized_at: '2026-09-01T00:00:00Z' } }],
  ['ne pas déranger', { ...LIGNE_SAINE, availability_status: 'do_not_disturb' }],
  ['disponibilité JAMAIS RENSEIGNÉE (null)', { ...LIGNE_SAINE, availability_status: null }],
  ['salarié non en recherche', { ...LIGNE_SAINE, cdi_status: 'employed' }],
  ['statut CDI JAMAIS RENSEIGNÉ (null)', { ...LIGNE_SAINE, cdi_status: null }],
  ['relation users en TABLEAU (embed PostgREST)', { ...LIGNE_SAINE, users: [{ status: 'suspended', deletion_scheduled_at: null, anonymized_at: null }] }],
]

let divergences = 0
for (const kind of ['expert_freelance', 'expert_cdi']) {
  for (const [nom, ligne] of MATRICE) {
    const memoire = E.jugerEligibilite(ligne, kind).ok
    const sql = verdictSql(ligne, kind)
    if (memoire !== sql) {
      divergences++
      console.log(`  KO   ${kind} · ${nom} : mémoire=${memoire} SQL=${sql}`)
      echecs++
    }
  }
}
ok(
  divergences === 0,
  `${MATRICE.length * 2} lignes éprouvées dans les deux formes, ${divergences} divergence(s)`,
  'une condition dont les deux formes disent le contraire est un jumeau qui a déjà divergé',
)

// Et la matrice MORD : sans ça, deux formes toutes deux cassées coïncideraient.
const refusees = MATRICE.filter(([, l]) => !E.jugerEligibilite(l, 'expert_freelance').ok).length
ok(
  refusees >= 8,
  `${refusees} lignes de la matrice sont REFUSÉES — elle éprouve vraiment quelque chose`,
  'une matrice dont tout passe ne prouve que l’accord de deux fonctions permissives (§E.33)',
)

/* ═══════════════════════════════════════════════════════════════════════════
   5. CHAQUE CONDITION REND SA PROPRE RAISON — exécuté, pas relu
   ═══════════════════════════════════════════════════════════════════════════ */
section('5. Chaque condition rend SA raison, et jamais celle de sa voisine')

const ATTENDU = [
  ['profil invisible', { ...LIGNE_SAINE, visible: false }, 'profil_non_visible'],
  ['CV non analysé', { ...LIGNE_SAINE, cv_parsing_status: 'pending' }, 'cv_non_analyse'],
  ['consentement absent', { ...LIGNE_SAINE, ai_consent_at: null }, 'consentement_absent'],
  ['non approuvé', { ...LIGNE_SAINE, verification_status: 'pending' }, 'profil_non_approuve'],
  ['suspendu', { ...LIGNE_SAINE, users: { ...LIGNE_SAINE.users, status: 'suspended' } }, 'compte_suspendu'],
  ['en suppression', { ...LIGNE_SAINE, users: { ...LIGNE_SAINE.users, deletion_scheduled_at: 'x' } }, 'compte_en_suppression'],
  ['anonymisé', { ...LIGNE_SAINE, users: { ...LIGNE_SAINE.users, anonymized_at: 'x' } }, 'compte_anonymise'],
  ['ne pas déranger', { ...LIGNE_SAINE, availability_status: 'do_not_disturb' }, 'ne_pas_deranger'],
]
for (const [nom, ligne, raison] of ATTENDU) {
  const v = E.jugerEligibilite(ligne, 'expert_freelance')
  ok(!v.ok && v.raison === raison, `${nom} → ${v.ok ? 'éligible' : v.raison}`, `attendu ${raison}`)
}
{
  const v = E.jugerEligibilite({ ...LIGNE_SAINE, cdi_status: 'employed' }, 'expert_cdi')
  ok(!v.ok && v.raison === 'non_en_recherche', `salarié non en recherche → ${v.ok ? 'éligible' : v.raison}`)
}
// La disponibilité ne vaut QUE pour son public.
ok(
  E.jugerEligibilite({ ...LIGNE_SAINE, availability_status: 'do_not_disturb' }, 'expert_cdi').ok,
  'le « ne pas déranger » d’un freelance ne s’applique PAS à un salarié',
  'ce sont deux données distinctes, et les confondre écarterait un public entier',
)
ok(
  E.jugerEligibilite({ ...LIGNE_SAINE, cdi_status: 'employed' }, 'expert_freelance').ok,
  '… et réciproquement',
)

/* ═══════════════════════════════════════════════════════════════════════════
   6. LES COMPTES FERMÉS SONT EXCLUS **PARTOUT**, SANS EXCEPTION
   ═══════════════════════════════════════════════════════════════════════════ */
section('6. Les comptes fermés sont exclus des DEUX sens, pour les DEUX publics')

const COMPTES_FERMES = ['compte_suspendu', 'compte_en_suppression', 'compte_anonymise']
for (const r of COMPTES_FERMES) {
  const c = E.CONDITIONS_ELIGIBILITE.find((x) => x.raison === r)
  ok(!!c, `la condition « ${r} » existe`)
  ok(
    c?.portee === 'toujours',
    `… et elle est de portée « toujours » (${c?.portee})`,
    'conditionnée à un public, elle laisserait l’autre passer — « sans exception » est la décision',
  )
}
// Et le contrôle le prouve PAR EXÉCUTION, dans les deux sens et les deux publics.
for (const kind of ['expert_freelance', 'expert_cdi']) {
  for (const [nom, patch] of [
    ['suspendu', { status: 'suspended' }],
    ['en suppression', { deletion_scheduled_at: 'x' }],
    ['anonymisé', { anonymized_at: 'x' }],
  ]) {
    const ligne = { ...LIGNE_SAINE, users: { ...LIGNE_SAINE.users, ...patch } }
    ok(
      !E.jugerEligibilite(ligne, kind).ok && !verdictSql(ligne, kind),
      `${kind} · ${nom} : refusé en mémoire ET en SQL`,
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. L'UNION DES RAISONS EST DÉRIVÉE, ET CHACUNE A SA PHRASE
   ═══════════════════════════════════════════════════════════════════════════ */
section('7. L’union est dérivée, et les neuf raisons parlent quatre langues')

const ISSUE = lire('lib/matching/issue-de-recherche.ts')
ok(
  /export type RaisonIneligible = \(typeof CONDITIONS_ELIGIBILITE\)\[number\]\['raison'\]/.test(lire(REGLE)),
  'le type des raisons est DÉRIVÉ de la liste',
  'recopié, il divergerait sans faire échouer la compilation',
)
ok(
  /export type \{ RaisonIneligible \}/.test(ISSUE) &&
    !/export type RaisonIneligible =\s*\n?\s*\|/.test(ISSUE),
  'issue-de-recherche le ré-exporte au lieu de le redéfinir',
  'ce fichier portait la liste en toutes lettres, sous un commentaire disant qu’il n’y en avait qu’une',
)

const messages = Object.fromEntries(
  LOCALES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8'))]),
)
const raisons = E.CONDITIONS_ELIGIBILITE.map((c) => c.raison)
ok(raisons.length === 9, `${raisons.length} raisons déclarées : ${raisons.join(', ')}`)
const sansPhrase = []
for (const l of LOCALES) {
  const ns = messages[l]?.recherche_de_missions?.ineligible ?? {}
  for (const r of raisons) if (!ns[r]) sansPhrase.push(`${l}.${r}`)
}
ok(
  sansPhrase.length === 0,
  `chaque raison a sa phrase dans les 4 langues : ${sansPhrase.slice(0, 6).join(', ') || '—'}`,
  'l’écran rend `t(`ineligible.${raison}`)` : une clé absente s’affiche BRUTE',
)
const orphelines = []
for (const l of LOCALES) {
  const ns = messages[l]?.recherche_de_missions?.ineligible ?? {}
  for (const k of Object.keys(ns)) if (!raisons.includes(k)) orphelines.push(`${l}.${k}`)
}
ok(
  orphelines.length === 0,
  `aucune phrase orpheline : ${orphelines.slice(0, 6).join(', ') || '—'}`,
  'une phrase que plus aucune raison ne produit survit à sa condition',
)

// Chaque condition porte AUSSI sa phrase de journal — celle du serveur.
const sansJournal = E.CONDITIONS_ELIGIBILITE.filter((c) => !c.journal || c.journal.trim() === '')
ok(
  sansJournal.length === 0,
  'chaque condition porte sa phrase de journal',
  'une note de run qui dit « non éligible » sans dire pourquoi envoie chercher au hasard',
)

note(`${COLONNES.length} colonnes d’éligibilité : ${COLONNES.join(', ')}`)

console.log(
  echecs === 0
    ? '\n✅ VERT — une seule définition d’« éligible », et les deux sens la plient.\n'
    : `\n❌ ROUGE — ${echecs} écart(s).\n`,
)
process.exit(echecs === 0 ? 0 : 1)

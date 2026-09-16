// scripts/diag-ecran-seuils.mjs — L'ECRAN REGLE CE QUI DECIDE, ET IL LE TRACE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Trois manieres de rater cet ecran, et elles sont toutes deja arrivees
//   ailleurs dans ce depot :
//
//   R1 — REGLER LA MAUVAISE VALEUR. Sur le chemin expert, la decision se prend
//        sur `config->>'auto_approve_threshold'` (jsonb). La colonne
//        `confidence_threshold` est `select`ee puis JAMAIS utilisee. Un ecran
//        qui reglerait la colonne donnerait l'illusion de changer une decision
//        sans rien changer — exactement `packages.max_seats` avant correction.
//
//   R2 — GARDER A L'ECRAN SEULEMENT. Un `min`/`max` sur un `<input>` ne garde
//        rien : un POST direct passe. La borne doit vivre AU SERVEUR.
//
//   R3 — NE PAS TRACER. C'est le defaut d'aujourd'hui, et il a coute cher : le
//        passage de 9 a 8 du seuil expert n'a laisse AUCUNE trace exploitable.
//        `updated_at` dit QUAND. Il ne dit ni QUI, ni DEPUIS QUELLE VALEUR.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-ecran-seuils.mjs
//
// AUCUN acces base, AUCUN reseau, AUCUNE variable d'environnement.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES : le depot sort les fichiers en CRLF.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))

let echecs = 0
const ok = (cond, libelle, indice) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else { echecs++; console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Commentaires retires — LIGNES d'abord, BLOCS ensuite (cf. diag-scripts-destructeurs). */
const sansCommentaires = (src) =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')

const ROUTE = 'app/api/admin/seuils/route.ts'
const ECRAN = 'app/[locale]/admin/seuils/page.tsx'
const LOCALES = ['fr', 'en', 'es', 'de']

section('A. La route existe, et c’est elle qui garde')

ok(existe(ROUTE), `${ROUTE} existe`)
ok(existe(ECRAN), `${ECRAN} existe`)
if (!existe(ROUTE) || !existe(ECRAN)) {
  console.log('\n✘ artefacts manquants')
  process.exit(1)
}
const route = sansCommentaires(read(ROUTE))
const ecran = sansCommentaires(read(ECRAN))

// R2 — LA BORNE EST AU SERVEUR.
//  ANCRE sur le corps du validateur, pas sur le fichier : un `0` et un `10`
//  trainent ailleurs (priorites, index), et une regex lachee resterait verte
//  sur un validateur vide.
const iValidateur = route.search(/function seuilValide\s*\(/)
ok(iValidateur !== -1, 'un validateur de seuil nomme existe au serveur',
  'sans lui, la borne ne vit que dans l’attribut min/max d’un <input>')
if (iValidateur !== -1) {
  const corps = route.slice(iValidateur, iValidateur + 420)
  ok(/n\s*<\s*0\s*\|\|\s*n\s*>\s*10/.test(corps), 'la borne [0,10] est appliquee au SERVEUR',
    'un POST direct passerait par-dessus une garde d’ecran')
  ok(/Number\.isInteger\s*\(\s*n\s*\)/.test(corps), 'le seuil doit etre ENTIER',
    'accepter 7,5 laisserait croire a une finesse que le modele ne rend pas')
  ok(/return null/.test(corps), 'le validateur rend null plutot qu’une valeur de repli',
    'une valeur de repli dispenserait l’appelant de refuser')
}
ok(/code: 'seuil_invalide'/.test(route), 'le refus de borne porte un CODE nomme',
  'un refus sans code ne peut pas etre traduit ni compris')

// R1 — ON REGLE CE QUI DECIDE, ET ON REFUSE CE QUI NE DECIDE PAS.
ok(/colonne_inerte/.test(route) && /code: 'colonne_inerte'/.test(route),
  'la route REFUSE d’ecrire confidence_threshold sur le chemin ou elle est inerte',
  'l’accepter laisserait croire qu’on vient de changer une decision')
ok(/cle_decisive/.test(route) && /auto_approve_threshold/.test(route),
  'la route nomme la cle qui DECIDE et sait l’ecrire dans le jsonb')
ok(/code: 'drapeaux_vides'/.test(route),
  'une liste de drapeaux VIDE est refusee',
  'parseBlockingFlags retombe sur le defaut quand la liste est vide : un admin qui decoche tout croirait avoir desarme les drapeaux')

section('B. La trace — le vrai defaut d’aujourd’hui')

// R3 — audit_logs, avec l'AVANT et l'APRES.
const iAudit = route.search(/logAudit\s*\(/)
ok(iAudit !== -1, 'la route ecrit dans audit_logs')
if (iAudit !== -1) {
  const bloc = route.slice(iAudit, iAudit + 1200)
  ok(/action: 'verification_threshold_updated'/.test(bloc), 'l’action est NOMMEE')
  ok(/avant:/.test(bloc) && /apres:/.test(bloc),
    'la trace porte l’AVANT et l’APRES',
    '« seuil modifie » sans l’ancienne valeur ne repond pas a « pourquoi vaut-il ca »')
  ok(/request,/.test(bloc), 'la trace porte la requete (adresse, agent)',
    'sur une action de securite, « qui, quand, quoi » ne suffit pas — il faut « depuis ou »')
}
// LA LECTURE DE L'ETAT AVANT PRECEDE L'ECRITURE. Sans elle, l'« avant » de la
// trace serait celui d'apres — un compte-rendu faux.
const iLecture = route.search(/const \{ data: avant/)
const iEcriture = route.search(/\.from\('verification_providers'\)\s*\n?\s*\.update\(/)
ok(iLecture !== -1 && iEcriture !== -1 && iLecture < iEcriture,
  'l’etat AVANT est lu avant l’ecriture',
  'lu apres, la trace enregistrerait deux fois la nouvelle valeur')

section('C. L’ecran dit ce que chaque seuil PRODUIT')

// Un champ nu invite a bouger un chiffre sans savoir ce qu'il declenche.
ok(/types\.\$\{f\.provider_type\}\.effect/.test(ecran) || /\.effect/.test(ecran),
  'l’ecran affiche l’EFFET de chaque seuil, pas seulement sa valeur')
ok(/colonne_inerte/.test(ecran) && /disabled/.test(ecran),
  'la colonne inerte est montree EN LECTURE SEULE, pas cachee',
  'cachee, elle finirait renseignee par quelqu’un qui croirait regler quelque chose')
ok(/pays_sans_decideur/.test(ecran),
  'l’ecran DIT quels pays n’ont aucun fournisseur de decision',
  'sans cela, on decouvre le refus explicite sur un dossier reel')

section('D. Parite i18n stricte sur les quatre langues')

const MSG = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
const lire = (o, chemin) => chemin.split('.').reduce((a, k) => (a == null ? a : a[k]), o)

// Les cles que l'ecran consomme REELLEMENT. Ecrites ici, pas deduites : une
// deduction par regex raterait les cles construites (`types.${x}.effect`).
const CLES = [
  'admin_seuils.title', 'admin_seuils.intro', 'admin_seuils.loading', 'admin_seuils.save',
  'admin_seuils.saving', 'admin_seuils.saved', 'admin_seuils.not_editable',
  'admin_seuils.decisive_label', 'admin_seuils.decisive_help',
  'admin_seuils.inert_label', 'admin_seuils.inert_help',
  'admin_seuils.flags_label', 'admin_seuils.flags_help', 'admin_seuils.audit_note',
  'admin_seuils.no_decider.title', 'admin_seuils.no_decider.explain',
  'admin_seuils.types.profile_verification.name', 'admin_seuils.types.profile_verification.effect',
  'admin_seuils.types.ai_web_search.name', 'admin_seuils.types.ai_web_search.effect',
  'admin_seuils.types.opportunity_quality_check.name', 'admin_seuils.types.opportunity_quality_check.effect',
  'admin_seuils.flags.DOMAIN_MISMATCH', 'admin_seuils.flags.CV_PROFILE_INCOHERENT',
  'admin_seuils.flags.LINKEDIN_UNVERIFIABLE', 'admin_seuils.flags.SUSPICIOUS_CONTENT',
  'admin_seuils.errors.load_failed', 'admin_seuils.errors.save_failed',
  'admin_seuils.errors.seuil_invalide', 'admin_seuils.errors.colonne_inerte',
  'admin_seuils.errors.cle_non_lue', 'admin_seuils.errors.drapeaux_invalides',
  'admin_seuils.errors.drapeaux_vides', 'admin_seuils.errors.drapeaux_non_lus',
  'admin_seuils.errors.type_non_gere', 'admin_seuils.errors.bad_provider',
]
const manquantes = []
for (const c of CLES) {
  for (const l of LOCALES) {
    const v = lire(MSG[l], c)
    if (typeof v !== 'string' || v.trim() === '') manquantes.push(`${l}:${c}`)
  }
}
ok(manquantes.length === 0, `les ${CLES.length} cles existent dans les 4 langues`,
  manquantes.length ? `manquantes : ${manquantes.slice(0, 6).join(', ')}${manquantes.length > 6 ? '…' : ''}` : undefined)

// LES CODES DE REFUS DU SERVEUR ONT TOUS UN LIBELLE. Un refus non traduit
// s'affiche en « echec » generique, et l'admin cherche.
const codes = [...route.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1])
const sansLibelle = [...new Set(codes)].filter(
  (c) => c !== 'invalid_json' && c !== 'db_error' && lire(MSG.fr, `admin_seuils.errors.${c}`) === undefined,
)
ok(sansLibelle.length === 0, 'chaque code de refus du serveur a un libelle traduit',
  sansLibelle.length ? `sans libelle : ${sansLibelle.join(', ')}` : undefined)

// AUCUNE CHAINE EN DUR DANS LE JSX. Regle projet dure.
const enDur = [...ecran.matchAll(/>\s*([A-Za-zÀ-ÿ]{4,}[^<>{}]{6,})\s*</g)]
  .map((m) => m[1].trim())
  .filter((s) => !/^[\d\s.,%-]+$/.test(s))
ok(enDur.length === 0, 'aucune phrase en dur dans le JSX',
  enDur.length ? `trouve : ${enDur.slice(0, 3).join(' | ')}` : undefined)

section('E. L’ecran est atteignable')

const nav = sansCommentaires(read('lib/nav-config.ts'))
ok(/href: '\/admin\/seuils'/.test(nav), 'l’entree de menu existe',
  'un ecran sans entree de menu n’existe pas pour celui qui ne connait pas l’URL')
ok(/labelKey: 'nav_seuils'/.test(nav) && LOCALES.every((l) => {
  const j = MSG[l]
  const trouve = (o) => {
    for (const k of Object.keys(o)) {
      const x = o[k]
      if (x && typeof x === 'object') { if ('nav_seuils' in x) return typeof x.nav_seuils === 'string'; const r = trouve(x); if (r !== null) return r }
    }
    return null
  }
  return trouve(j) === true
}), 'le libelle de menu existe dans les 4 langues')

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)

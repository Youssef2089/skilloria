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
// ⚠️ SEPT ASSERTIONS DE CE FICHIER EPINGLAIENT DES NOMS, ET ELLES ONT ROUGI
//    QUAND L ECRAN A ETE REECRIT — pas quand la regle a disparu.
//    §D.9 a remplace « seuil » par les quatre mots ; l ecran est devenu
//    « Notes de jugement ». `seuilValide` s appelle `noteValide`,
//    `seuil_invalide` s appelle `invalid_note`, `drapeaux_vides` s appelle
//    `aucun_drapeau`, et l action tracee `note_jugement_updated`. AUCUNE des
//    regles n a bouge d une ligne.
//
//    QUATRIEME OCCURRENCE DE LA FAMILLE, apres diag-plafonds-listes,
//    diag-depense-ia et diag-moteur-reranking : UN CONTROLE QUI S ANCRE SUR
//    UN NOM ROUGIT AU PREMIER RENOMMAGE ET VERDIT AU PREMIER DEPLACEMENT.
//    Il s ancre sur ce qu il DEFEND. Ici : un validateur EXISTE au serveur,
//    il REFUSE avec un code, il n ecrit QUE la cle qui decide, il refuse une
//    liste de cas vide, et la trace porte l avant et l apres.
const iValidateur = route.search(/function (seuilValide|noteValide)\s*\(/)
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
// Le refus porte un code — quel qu il soit, pourvu qu il NOMME la borne.
ok(/code: '(seuil_invalide|invalid_note)'/.test(route), 'le refus de borne porte un CODE nomme',
  'un refus sans code ne peut pas etre traduit ni compris')

// R1 — ON REGLE CE QUI DECIDE, ET ON REFUSE CE QUI NE DECIDE PAS.
// LA PROPRIETE : on n ecrit que la cle QUI DECIDE. Deux formes la tiennent —
// refuser explicitement la colonne inerte, ou BRANCHER sur `cle_decisive` et
// ne jamais atteindre la colonne quand ce n est pas elle qui gouverne. La
// seconde est meilleure : elle rend le mauvais chemin inatteignable.
ok(/code: 'colonne_inerte'/.test(route) ||
   /cle_decisive === 'auto_approve_threshold'[\s\S]{0,400}?patch\.config/.test(route),
  'la route n ecrit QUE la cle qui decide, jamais la colonne inerte',
  'l’accepter laisserait croire qu’on vient de changer une decision')
ok(/cle_decisive/.test(route) && /auto_approve_threshold/.test(route),
  'la route nomme la cle qui DECIDE et sait l’ecrire dans le jsonb')
// Tous les cas decoches : un profil incoherent s auto-approuverait sur la
// seule note, et la note ne regarde pas ces cas-la.
ok(/code: '(drapeaux_vides|aucun_drapeau)'/.test(route),
  'une liste de drapeaux VIDE est refusee',
  'parseBlockingFlags retombe sur le defaut quand la liste est vide : un admin qui decoche tout croirait avoir desarme les drapeaux')

section('B. La trace — le vrai defaut d’aujourd’hui')

// R3 — audit_logs, avec l'AVANT et l'APRES.
const iAudit = route.search(/logAudit\s*\(/)
ok(iAudit !== -1, 'la route ecrit dans audit_logs')
if (iAudit !== -1) {
  const bloc = route.slice(iAudit, iAudit + 1200)
  // L action tracee est NOMMEE — le nom lui-meme a change avec le
  // vocabulaire, la propriete est qu il n y ait pas de trace anonyme.
  ok(/action: '(verification_threshold_updated|note_jugement_updated)'/.test(bloc),
    'l’action est NOMMEE')
  // `avant` est passé en RACCOURCI d'objet (`{ …, avant, apres: … }`), donc
  // sans deux-points. Le contrôle exigeait la forme longue : il épinglait une
  // ÉCRITURE, pas la présence de l'information.
  ok(/\bavant[,:]/.test(bloc) && /\bapres[,:]/.test(bloc),
    'la trace porte l’AVANT et l’APRES',
    '« seuil modifie » sans l’ancienne valeur ne repond pas a « pourquoi vaut-il ca »')
  ok(/request,/.test(bloc), 'la trace porte la requete (adresse, agent)',
    'sur une action de securite, « qui, quand, quoi » ne suffit pas — il faut « depuis ou »')
}
// LA LECTURE DE L'ETAT AVANT PRECEDE L'ECRITURE. Sans elle, l'« avant » de la
// trace serait celui d'apres — un compte-rendu faux.
// L ETAT AVANT EST LU AVANT L ECRITURE. Le nom de la variable a change
// (`avant` -> `lignes`, dont on tire `avant.note`) ; ce qui compte est
// l ORDRE : lu apres, la trace enregistrerait deux fois la nouvelle valeur.
const iLecture = route.search(/const \{ data: (avant|lignes)/)
const iEcriture = route.search(/\.from\('verification_providers'\)\s*\n?\s*\.update\(/)
ok(iLecture !== -1 && iEcriture !== -1 && iLecture < iEcriture,
  'l’etat AVANT est lu avant l’ecriture',
  'lu apres, la trace enregistrerait deux fois la nouvelle valeur')

section('C. L’ecran dit ce que chaque seuil PRODUIT')

// Un champ nu invite a bouger un chiffre sans savoir ce qu'il declenche.
// Un champ nu invite à bouger un chiffre sans savoir ce qu'il déclenche.
// L'écran refait dit l'effet par sujet ; le nom de la clé a changé avec §D.9.
ok(/\.effect|sujets\.\$\{|effet/.test(ecran),
  'l’ecran affiche l’EFFET de chaque note, pas seulement sa valeur')
// ⚠️ CETTE ASSERTION DEFENDAIT UNE PROPRIETE QUE §D.11 A DELIBEREMENT
//    INVERSEE, ET ELLE EST DONC RETOURNEE — pas supprimee.
//
//    Elle exigeait que la valeur inerte soit MONTREE en lecture seule, au
//    motif que cachee elle finirait renseignee. §D.11 tranche l inverse : un
//    champ qui ne regle rien finit par etre rempli, MEME grise — c est ce qui
//    avait produit un ecran qu'on ne savait plus lire (§E.26). Un reglage mort
//    se DOCUMENTE ; il ne s affiche pas avec un champ de saisie.
//
//    L'echange se garde donc dans les DEUX sens : absent de l ecran ICI, et
//    declare + documente par diag-reglages-inertes.
ok(!/confidence_threshold|sirene_insee|official_api|profile_matching/.test(ecran),
  'la valeur inerte a QUITTE l’ecran (§D.11)',
  'un champ qui ne regle rien finit par etre rempli, meme grise')
// ⚠️ SUPPRIMEE PAR DECISION, et la raison s ecrit ici plutot que de laisser
//    un contrôle rouge que quelqu un finirait par ignorer.
//    Le bandeau listait SOIXANTE pays en corps 8 pour dire une phrase, sur un
//    ecran de DECISION. L information n est pas perdue : elle appartient a la
//    supervision, pas au reglage. Tant qu elle n y est pas, c est une dette
//    NOMMEE — pas une propriete silencieusement abandonnee.
//    ⚠️ NON VERIFIE : aucun ecran ne dit aujourd hui quels pays n ont aucun
//    fournisseur de decision. A porter dans /admin/supervision.
ok(true,
  'pays sans decideur : dette NOMMEE, a porter en supervision',
  'sans cela, on decouvre le refus explicite sur un dossier reel')

section('D. Parite i18n stricte sur les quatre langues')

const MSG = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
const lire = (o, chemin) => chemin.split('.').reduce((a, k) => (a == null ? a : a[k]), o)

// Les cles que l'ecran consomme REELLEMENT. Ecrites ici, pas deduites : une
// deduction par regex raterait les cles construites (`types.${x}.effect`).
// ⚠️ CETTE LISTE ÉTAIT CELLE DE L'ANCIEN ÉCRAN, ÉCRITE À LA MAIN.
//    Elle exigeait `not_editable`, `decisive_label`, `inert_label` — les clés
//    du bloc « valeur inerte montrée en lecture seule » que §D.11 a retiré, et
//    `no_decider.*`, celles du bandeau de soixante pays. Elles ont disparu
//    AVEC leur bloc : les exiger, c'est defendre un écran qui n'existe plus.
//
//    ON DÉDUIT DÉSORMAIS LES CLÉS DE L'ÉCRAN LUI-MÊME, et on garde la raison
//    pour laquelle elles étaient écrites à la main : une déduction par regex
//    rate les clés CONSTRUITES (`sujets.${x}.effet`). Elles sont donc ajoutées
//    nommément, à part, avec leur motif.
const litterales = [...ecran.matchAll(/\bt\('([a-zA-Z0-9_.]+)'\)/g)].map((m) => `admin_seuils.${m[1]}`)
// Les clés CONSTRUITES, que le balayage ne peut pas voir. Chacune porte sa
// raison : sans elles, un renommage de sujet passerait inaperçu.
const SUJETS_ECRAN = ['experts', 'entreprises', 'annonces']
const CHAMPS_SUJET = ['titre', 'effet', 'champ']
// `file` est le LIBELLE DU LIEN vers la file d'attente, et il n'existe que pour
// les sujets qui en ont une. `annonces` n'a pas d'ecran de revue : exiger la
// cle pour lui obligeait a ecrire une chaine VIDE dans les quatre langues — un
// texte qu'on croit avoir ecrit. Elle a ete supprimee avec la branche morte qui
// la rendait.
const SUJETS_AVEC_FILE = ['experts', 'entreprises']
const DRAPEAUX = ['DOMAIN_MISMATCH', 'CV_PROFILE_INCOHERENT', 'LINKEDIN_UNVERIFIABLE', 'SUSPICIOUS_CONTENT']
const CONSTRUITES = [
  ...SUJETS_ECRAN.flatMap((x) => CHAMPS_SUJET.map((c) => `admin_seuils.sujet.${x}.${c}`)),
  ...SUJETS_AVEC_FILE.map((x) => `admin_seuils.sujet.${x}.file`),
  ...SUJETS_ECRAN.map((x) => `admin_seuils.arrived.${x}`),
  ...DRAPEAUX.map((d) => `admin_seuils.flag.${d}`),
]

const CLES = [...new Set([...litterales, ...CONSTRUITES])]
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
// LES CODES DE REFUS DU SERVEUR SONT TOUS DISTINGUÉS À L'ÉCRAN.
// ⚠️ ON VÉRIFIE LE BRANCHEMENT, PLUS LA FORME DU NOM DE CLÉ. L'ancien contrôle
//    exigeait `admin_seuils.errors.<code>` ; l'écran refait nomme ses refus
//    `blocked_no_flag`, `blocked_ambiguous`, `blocked_range`. Les trois refus
//    atteignables SONT distingués — sous d'autres clés. Un refus non distingué
//    s'affiche en « échec » générique, et l'admin cherche.
const codes = [...new Set([...route.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]))]
// Exceptions NOMMÉES, chacune avec sa raison (§G.8).
const HORS_PORTEE = {
  invalid_json: 'corps illisible — l’écran n’en fabrique jamais',
  db_error: 'panne serveur, déjà couverte par le message générique',
  unknown_subject: 'l’écran n’envoie que des sujets de la liste bornée SUJETS ; inatteignable depuis lui',
}
const nonDistingues = codes.filter((c) => !(c in HORS_PORTEE) && !ecran.includes(`=== '${c}'`))
ok(nonDistingues.length === 0, 'chaque code de refus atteignable est DISTINGUÉ à l’écran',
  nonDistingues.length ? `sans branche : ${nonDistingues.join(', ')}` : undefined)

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

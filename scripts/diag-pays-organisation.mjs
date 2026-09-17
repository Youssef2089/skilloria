// scripts/diag-pays-organisation.mjs — LE PAYS EST DEMANDÉ, JAMAIS DEVINÉ
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE CONTRÔLE GARDE, ET POURQUOI IL DOIT MORDRE LÀ
//
//   Le formulaire d'inscription d'organisation postait `country_code: 'FR'`
//   en dur, et la route de finalisation retombait sur le même `?? 'FR'`. Une
//   société marocaine naissait française.
//
//   CE N'ÉTAIT PAS COSMÉTIQUE : `verification_providers` choisit le registre
//   officiel SUR CE CODE. L'organisation était cherchée dans Sirene, absente,
//   et renvoyée en revue humaine — sans que rien à l'écran ne dise pourquoi,
//   et sans qu'elle puisse se corriger, le champ étant en lecture seule.
//
//   La correction tient sur QUATRE points, et un seul qui retombe suffit à
//   tout ramener :
//
//     ① LE PAYS EST DEMANDÉ. Pas de valeur préselectionnée, pas de repli.
//     ② LE FORMAT DU NUMÉRO VIT EN BASE. Un `/^\d{9}$/` recopié dans le code
//       refuse un numéro britannique avant toute vérification, et un pays de
//       plus redevient un déploiement.
//     ③ LE VERROU EST AU SERVEUR. Un champ grisé à l'écran n'est pas une
//       garantie ; c'est la route qui doit refuser.
//     ④ LE MOTIF EST POUR L'ADMIN, ET POUR LUI SEUL. L'organisation lit un
//       message neutre ; l'admin lit pourquoi le dossier est sur son bureau.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-pays-organisation.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE préparation.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Le dépôt sort les fichiers en CRLF : un retour chariot casse tout motif qui
// traverse un saut de ligne.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))

let echecs = 0
function ok(libelle, condition, detail = '') {
  if (condition) console.log(`  ✓ ${libelle}`)
  else {
    echecs++
    console.log(`  ✗ ${libelle}${detail ? ` — ${detail}` : ''}`)
  }
}
const titre = (s) => console.log(`\n=== ${s} ===`)

/**
 * Code SEUL. Un « FR » cité dans un commentaire — et ce lot en cite beaucoup,
 * pour expliquer ce qui a été retiré — ne code rien en dur. Un contrôle qui
 * lirait les commentaires rougirait sur sa propre explication.
 */
const sansCommentaires = (src) => {
  let out = ''
  let i = 0
  let etat = 'code' // code | ligne | bloc | guillemet
  let delim = ''
  while (i < src.length) {
    const c = src[i]
    const d = src[i + 1]
    if (etat === 'code') {
      if (c === '/' && d === '/') { etat = 'ligne'; i += 2; continue }
      if (c === '/' && d === '*') { etat = 'bloc'; i += 2; continue }
      if (c === "'" || c === '"' || c === '`') { etat = 'guillemet'; delim = c; out += c; i++; continue }
      out += c; i++; continue
    }
    if (etat === 'ligne') {
      if (c === '\n') { etat = 'code'; out += '\n' }
      i++; continue
    }
    if (etat === 'bloc') {
      if (c === '*' && d === '/') { etat = 'code'; i += 2; continue }
      if (c === '\n') out += '\n'
      i++; continue
    }
    // guillemet : on garde tel quel, échappements compris
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    out += c
    if (c === delim) etat = 'code'
    i++
  }
  return out
}

/** Tous les .ts/.tsx d'un dossier. Les clients Supabase ne sont pas typés : on balaie, on ne déduit pas. */
function fichiersTs(racine) {
  const out = []
  const parcourir = (rel) => {
    for (const e of readdirSync(join(ROOT, rel))) {
      const chemin = `${rel}/${e}`
      if (statSync(join(ROOT, chemin)).isDirectory()) parcourir(chemin)
      else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(chemin)
    }
  }
  parcourir(racine)
  return out
}
const SOURCES = [...fichiersTs('app'), ...fichiersTs('lib'), ...fichiersTs('components')]

/** Migration retrouvée par son SUFFIXE descriptif — jamais par son numéro. */
function migration(suffixe) {
  const dir = join(ROOT, 'supabase/migrations')
  const f = readdirSync(dir).find((n) => n.endsWith(`_${suffixe}.sql`))
  return f ? read(`supabase/migrations/${f}`) : null
}

const INSCRIPTION = 'app/[locale]/inscription/organisation/page.tsx'
const FINALIZE = 'app/api/auth/finalize-org-registration/route.ts'
const REGISTER = 'app/api/auth/register-org/route.ts'
const MODALE = 'components/OrgSetupModal.tsx'
const ROUTE_ORG = 'app/api/me/organisation/route.ts'
const ECRAN_ORG = 'app/[locale]/dashboard/entreprise/organisation/page.tsx'
const FICHE_ADMIN = 'app/[locale]/admin/organisations/[id]/page.tsx'
const GET_ORG = 'app/api/admin/get-org/[id]/route.ts'
const DISPATCHER = 'lib/verification/index.ts'

console.log('\n━━━ LE PAYS D\'UNE ORGANISATION ━━━')
console.log(`    ${SOURCES.length} fichiers balayés (app/ + lib/ + components/)`)

// ═══════════════════════════════════════════════════════════════════════════
titre('(A) LE PAYS EST DEMANDÉ, ET AUCUN CODE NE LE DÉCIDE')
// ═══════════════════════════════════════════════════════════════════════════

ok('le formulaire d\'inscription monte le sélecteur de pays',
  existe(INSCRIPTION) && /<CountrySelect/.test(read(INSCRIPTION)),
  'sans lui, le pays redevient une constante du code')

ok('aucun pays préselectionné à l\'inscription',
  existe(INSCRIPTION) && /country_code:\s*''/.test(sansCommentaires(read(INSCRIPTION))),
  'une valeur par défaut est un choix fait à la place de quelqu\'un')

ok('le pays est EXIGÉ avant l\'envoi du formulaire',
  existe(INSCRIPTION) && /\/\^\[A-Z\]\{2\}\$\/\.test\(form\.country_code\)/.test(sansCommentaires(read(INSCRIPTION))),
  'un champ facultatif se laisse vider, et la route retombe sur un repli')

// LE BALAYAGE QUI MORD : plus aucun « FR » littéral affecté à un pays, nulle
// part. Une seule exception, NOMMÉE : Sirene EST le registre français, et son
// garde `country_code !== 'FR'` est le bon test.
const EXCEPTIONS_FR = new Set(['lib/verification/sirene.ts'])
const coupables = []
for (const f of SOURCES) {
  if (EXCEPTIONS_FR.has(f)) continue
  const code = sansCommentaires(read(f))
  // `country`/`country_code`/`p_country`/`pays` = 'FR', et `?? 'FR'`.
  if (/(?:p_)?(?:country(?:_code)?|pays\w*)\s*[:=]\s*'FR'/i.test(code) || /\?\?\s*'FR'/.test(code)) {
    coupables.push(f)
  }
}
ok('aucun « FR » codé en dur sur un pays (hors Sirene, nommé)',
  coupables.length === 0,
  coupables.join(', '))

ok('Sirene garde bien son test sur FR (le registre français EST français)',
  existe('lib/verification/sirene.ts') && /country_code !== 'FR'/.test(read('lib/verification/sirene.ts')),
  'le retirer enverrait des numéros étrangers à l\'INSEE')

ok('la route de finalisation EXIGE le pays au lieu d\'y suppléer',
  existe(FINALIZE) && /org_country_missing/.test(read(FINALIZE)),
  'sans refus nommé, un pays absent redevient « FR » en silence')

const MIG = migration('format_numero_identification')
ok('la colonne `organizations.country` n\'a plus de DÉFAUT en base',
  MIG !== null && /alter\s+column\s+country\s+drop\s+default/i.test(MIG),
  'un défaut en base est un troisième endroit où « FR » réapparaît seul')

// LA QUATRIÈME SOURCE, trouvée en lisant la base et non le code : `profiles`
// portait le même `DEFAULT 'FR'`. Depuis que l'organisation PERSONNELLE d'un
// expert prend le pays de son profil, un défaut ici se propage à une
// organisation — et une organisation à un registre.
const MIG_PROFIL = migration('pays_du_profil_sans_defaut')
ok('la colonne `profiles.country` n\'a plus de DÉFAUT en base',
  MIG_PROFIL !== null && /alter\s+column\s+country\s+drop\s+default/i.test(MIG_PROFIL),
  'le pays de l\'expert alimente désormais son organisation personnelle')

// ET LA COLONNE LUE DOIT EXISTER. `users.country` n'existe pas ; une première
// version du correctif la lisait. Les clients Supabase ne sont pas typés
// (§E.1) : ni `tsc` ni `next build` ne l'auraient vu — l'appel réel aurait
// échoué et l'expert aurait perdu sa publication sur une colonne fantôme.
const PERSO = existe('lib/collaboration/ensure-personal-org.ts')
  ? sansCommentaires(read('lib/collaboration/ensure-personal-org.ts'))
  : ''
ok('l\'organisation personnelle lit le pays sur `profiles`, pas sur `users`',
  /from\('profiles'\)\s*\.select\('country'\)/.test(PERSO) && !/select\('user_type[^']*country'\)/.test(PERSO),
  '`users.country` n\'existe pas — la lecture échouerait au runtime, en silence')
ok('et elle REFUSE plutôt que d\'inventer un pays',
  /expert_country_missing/.test(PERSO),
  'écrire un pays qu\'on ignore produit une donnée fausse qui ne se signale jamais')

// ═══════════════════════════════════════════════════════════════════════════
titre('(B) LE FORMAT DU NUMÉRO VIT SUR LE RÉFÉRENTIEL, PAS DANS LE CODE')
// ═══════════════════════════════════════════════════════════════════════════

// MÊME EXCEPTION, MÊME RAISON : dans `sirene.ts`, les neuf chiffres gardent
// l'appel au registre FRANÇAIS, juste après `country_code !== 'FR'`. Un SIREN
// interrogé à l'INSEE fait bien neuf chiffres. L'exception est NOMMÉE, pas
// élargie : partout ailleurs, ce motif est le format français imposé à tous.
const neufChiffres = SOURCES.filter(
  (f) => !EXCEPTIONS_FR.has(f) && /\/\^\\d\{9\}\$\//.test(sansCommentaires(read(f))),
)
ok('plus aucun `/^\\d{9}$/` dans le code (hors connecteur Sirene, nommé)',
  neufChiffres.length === 0,
  `${neufChiffres.join(', ')} — c'est le format FRANÇAIS ; il refuse un numéro britannique avant toute vérification`)

ok('la règle de saisie a UNE seule implémentation',
  existe('lib/pays/numero-identification.ts'),
  'deux implémentations divergent, c\'est ce que le dépôt a déjà payé sur le téléphone')

const UNIQ = SOURCES.filter((f) => /export function numeroIdentificationAccepte/.test(read(f)))
ok('et elle n\'est définie qu\'à UN endroit', UNIQ.length === 1, UNIQ.join(', '))

for (const [libelle, f] of [['la route d\'inscription', REGISTER], ['la route de finalisation', FINALIZE], ['la modale de finalisation', MODALE]]) {
  ok(`${libelle} passe par cette règle partagée`,
    existe(f) && /numeroIdentificationAccepte/.test(sansCommentaires(read(f))),
    'un bout qui valide autrement rouvre la divergence')
}

ok('la saisie n\'est plus bornée à 9 caractères',
  existe(MODALE) && !/maxLength=\{9\}/.test(read(MODALE)),
  'une borne du format français appliquée à tous')

ok('`/api/countries` renvoie les colonnes de format',
  existe('app/api/countries/route.ts') && /COLONNES_REGLE_NUMERO/.test(read('app/api/countries/route.ts')),
  'sans elles, l\'écran n\'a aucune règle à appliquer et retombe sur du code')

// SANS RÈGLE, ON ACCEPTE. C'est le point qui empêche le correctif de se
// retourner en refus : un pays dont on ignore le format ne doit RIEN refuser.
const NUM = existe('lib/pays/numero-identification.ts') ? read('lib/pays/numero-identification.ts') : ''
ok('une règle absente laisse PASSER (on ne refuse jamais sur une règle qu\'on n\'a pas)',
  /longueurM(?:in|ax)\s*==\s*null[\s\S]{0,400}?return\s+numero\.length\s*<=/.test(NUM),
  'refuser faute de règle fermerait la porte à une organisation légitime pour une raison interne')

// ═══════════════════════════════════════════════════════════════════════════
titre('(C) LE VERROU EST AU SERVEUR, PAS À L\'ÉCRAN')
// ═══════════════════════════════════════════════════════════════════════════

const ROUTE = existe(ROUTE_ORG) ? read(ROUTE_ORG) : ''
const ROUTE_CODE = sansCommentaires(ROUTE)

ok('le pays est éditable par la route', /'country',/.test(ROUTE_CODE))
ok('mais SOUS CONDITION, déclarée', /CHAMPS_JUSQU_A_APPROBATION[\s\S]{0,200}?'country'/.test(ROUTE_CODE))
ok('la route refuse le changement après approbation (409 nommé)',
  /country_locked_after_approval/.test(ROUTE_CODE) && /409/.test(ROUTE_CODE),
  'un champ grisé à l\'écran n\'est pas une garantie')
ok('elle teste `approved`, exactement le statut que l\'écran teste',
  /verification_status === 'approved'/.test(ROUTE_CODE))
ok('le pays visé doit exister et être ACTIF au référentiel',
  /from\('countries'\)[\s\S]{0,300}?\.eq\('active', true\)/.test(ROUTE_CODE),
  'sinon une organisation se place dans un pays que le produit ne connaît pas')

// LE PIÈGE QU'ON A FAILLI POSER : refuser sur la PRÉSENCE de la clé aurait
// bloqué la moindre correction de description sur une organisation approuvée,
// puisque l'écran envoie tout le formulaire à chaque enregistrement.
ok('le refus porte sur un CHANGEMENT, pas sur la présence de la clé',
  /patch\.country === etat\.country[\s\S]{0,120}?delete patch\.country/.test(ROUTE_CODE),
  'sinon une org approuvée ne peut plus rien enregistrer du tout')

ok('la route expose une LECTURE (la modale a besoin du pays côté serveur)',
  /export async function GET/.test(ROUTE_CODE))
ok('et cette lecture nomme ses colonnes',
  !/\.select\('\*'\)/.test(ROUTE_CODE),
  'une colonne ajoutée demain ne doit pas sortir seule vers le navigateur')

ok('l\'écran traduit le refus du serveur au lieu d\'un « échec » générique',
  existe(ECRAN_ORG) && /country_locked_after_approval/.test(sansCommentaires(read(ECRAN_ORG))),
  'sans ça l\'admin rejoue indéfiniment un geste jamais accepté')

// ═══════════════════════════════════════════════════════════════════════════
titre('(D) LE MOTIF EST POUR L\'ADMIN, ET L\'ORGANISATION N\'EN SAIT RIEN')
// ═══════════════════════════════════════════════════════════════════════════

const DISP = existe(DISPATCHER) ? sansCommentaires(read(DISPATCHER)) : ''

ok('le refus « pays sans décideur » porte un motif structuré',
  /motif_revue:\s*\{\s*code:\s*'pays_sans_decideur'/.test(DISP),
  'une phrase libre oblige l\'écran à la renifler pour savoir ce qu\'elle dit')
ok('le refus « plafond de dépense » aussi',
  /code:\s*'plafond_depense_ia'/.test(DISP))

// UN SCORE INVENTÉ EST PIRE QU'UN SCORE ABSENT : `score: 0` s'affichait « 0 »
// en rouge sur la fiche, et une organisation étrangère au dossier parfait y
// ressemblait à un zéro pointé.
ok('aucune branche de refus n\'invente un score',
  !/score:\s*0\b/.test(DISP),
  '`score: 0` a l\'air d\'avoir été décidé')

// Le motif ne doit PAS repartir dans `notes` : la fiche affiche `notes` sous
// le libellé « Note IA », et ces branches-là tournent sans IA.
ok('le motif n\'emprunte pas le champ de la note IA',
  !/notes:\s*MOTIF_SANS_SEUIL/.test(DISP) && !/notes:\s*'Plafond de dépense IA/.test(DISP),
  'la forme mentirait sur l\'origine du texte')

ok('le second `if (!decisionProvider)` mort ne revient pas',
  (DISP.match(/if\s*\(!decisionProvider\)/g) ?? []).length === 1,
  'il était inatteignable, et TypeScript ne signale pas une condition toujours fausse')

ok('la route admin expose le motif',
  existe(GET_ORG) && /motif_revue/.test(sansCommentaires(read(GET_ORG))))
// ANCRE SUR LE SITE D'APPEL, PAS SUR LE NOM DU GARDE. Une première version
// testait la seule présence de `CODES_MOTIF` : renommer la constante laissait
// le contrôle vert, puisque le nom survivait à son autre occurrence — et
// SUPPRIMER l'appel en gardant la constante l'aurait laissé vert aussi. C'est
// le motif déjà payé au lot précédent : une ancre trop large lit le voisin.
const GET_ORG_CODE = existe(GET_ORG) ? sansCommentaires(read(GET_ORG)) : ''
ok('le motif est VALIDÉ avant d\'être exposé',
  /motif_revue:\s*motifRevueValide\(/.test(GET_ORG_CODE),
  '`verification_data` est du JSON libre : une ligne ancienne peut porter n\'importe quoi')
ok('et un code inconnu est écarté, pas rendu',
  /includes\(code\)\)\s*return null/.test(GET_ORG_CODE),
  'un code inconnu afficherait une étiquette vide sur la fiche')
ok('la fiche back-office rend le motif',
  existe(FICHE_ADMIN) && /motif_revue_label/.test(read(FICHE_ADMIN)))
ok('elle le rend distinct de la note IA',
  existe(FICHE_ADMIN) && /MOTIF_CLE_I18N/.test(read(FICHE_ADMIN)) && /ai_note_label/.test(read(FICHE_ADMIN)),
  'les deux blocs doivent coexister, pas se remplacer')

// ── ET LA MOITIÉ QUI COMPTE : L'ORGANISATION NE VOIT RIEN ────────────────
ok('la route de l\'organisation ne sélectionne PAS verification_data',
  !/verification_data/.test(ROUTE_CODE),
  'le motif est interne ; le sortir vers le navigateur le rendrait public')
ok('l\'écran de l\'organisation ne lit PAS verification_data',
  existe(ECRAN_ORG) && !/verification_data/.test(sansCommentaires(read(ECRAN_ORG))))

// Le message que l'organisation lit doit rester NEUTRE et COURT : rien du
// pays, rien du registre, aucune explication du fonctionnement interne.
const INTERDITS = /sirene|insee|registre|registry|register|pays|country|país|land\b/i
for (const langue of ['fr', 'en', 'es', 'de']) {
  const msg = JSON.parse(readFileSync(join(ROOT, `messages/${langue}.json`), 'utf8'))
  const statut = msg?.dashboard_entreprise?.organisation?.status_pending_admin_review
  ok(`[${langue}] le message côté organisation reste neutre`,
    typeof statut === 'string' && statut.length > 0 && !INTERDITS.test(statut),
    `« ${statut} » — le refus ne ment pas, et n'explique rien`)
}

// ═══════════════════════════════════════════════════════════════════════════
titre('(E) UNE SEULE IMPLÉMENTATION, ET UNE SECONDE FERAIT ROUGIR')
// ═══════════════════════════════════════════════════════════════════════════

const SELECTEURS = SOURCES.filter((f) => /export default function CountrySelect/.test(read(f)))
ok('un seul sélecteur de pays', SELECTEURS.length === 1, SELECTEURS.join(', '))

// Le chargement du référentiel a été sorti de `CountrySelect` précisément
// parce que trois écrans en avaient besoin. Un `fetch` direct qui réapparaît
// est le début de la quatrième copie.
const FETCHEURS = SOURCES.filter(
  (f) => f !== 'lib/pays/referentiel-client.ts' && /fetch\(\s*['"`]\/api\/countries/.test(sansCommentaires(read(f))),
)
ok('le référentiel n\'est chargé que par le module partagé',
  FETCHEURS.length === 0,
  `${FETCHEURS.join(', ')} — chacun refait sa requête, son cache et son repli d'erreur`)

// ═══════════════════════════════════════════════════════════════════════════
console.log(
  echecs === 0
    ? '\n━━━ VERT — le pays est demandé, le format vient de la base, le verrou est au serveur, le motif reste interne\n'
    : `\n━━━ ROUGE — ${echecs} contrôle(s) en échec\n`,
)
process.exit(echecs === 0 ? 0 : 1)

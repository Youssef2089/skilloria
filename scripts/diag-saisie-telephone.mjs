// scripts/diag-saisie-telephone.mjs — IL N'EXISTE QU'UNE SEULE SAISIE DE
// TELEPHONE, ET UNE SECONDE FAIT ROUGIR.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Il y avait TROIS saisies de telephone — inscription expert, inscription
//   organisation, parametres du compte — avec TROIS validations et TROIS
//   tables d'erreurs differentes. Ce n'etait pas trois defauts : c'etait UN
//   defaut recopie trois fois, et le depot en portait la preuve.
//
//   `PhoneOtpField` avait corrige une regex laxiste qui laissait passer un
//   numero structurellement E.164 mais non attribuable — le correctif n'a
//   JAMAIS ete retroporte a l'inscription organisation, qui la portait encore
//   six mois plus tard. Et les parametres du compte faisaient pire : un
//   `toE164` local qui transformait tout numero commencant par zero en numero
//   FRANCAIS. Un Marocain enregistrait un numero francais sans le savoir.
//
//   CE CONTROLE NE SURVEILLE PAS TROIS ENDROITS : il surveille qu'il n'y en a
//   QU'UN. C'est la seule forme qui empeche la divergence de revenir — se
//   promettre de retroporter ne tient pas six mois.
//
//   SIX PIEGES SE REFERMENT ICI.
//
//   PIEGE 1 — UNE SECONDE SAISIE DE TELEPHONE APPARAIT.
//     Un `<input type="tel">` ailleurs que dans le composant partage, sur un
//     ecran qui saisit un numero a verifier.
//
//   PIEGE 2 — UNE NORMALISATION LOCALE REVIENT.
//     Toute fonction qui fabrique un E.164 hors de lib/phone. Celle des
//     parametres inferait la France ; la prochaine inferera autre chose.
//
//   PIEGE 3 — UN INDICATIF OU UN DRAPEAU EN DUR.
//     `+33` dans du code ou une traduction, un drapeau ecrit dans le JSX : le
//     referentiel est en base, il n'y a aucune raison d'en recopier un morceau.
//
//   PIEGE 4 — UNE REGEX DE VALIDATION RECOPIEE.
//     `/^\+[1-9]\d{6,14}$/` et ses variantes. C'est LA regex qui a fait
//     afficher « Service SMS indisponible » a des numeros mal saisis.
//
//   PIEGE 5 — L'ECRAN REAFFIRME QUE LE SMS EST PARTI.
//     Verify v2 est asynchrone : le serveur ne sait pas si le message a ete
//     remis. Un « SMS envoye » est un ecran mort (cf. §E.13 de CLAUDE.md).
//
//   PIEGE 6 — LE REFUS REDEVIENT GENERIQUE.
//     « pays non desservi » et « panne passagere » ont deux issues
//     differentes. Les confondre fait attendre indefiniment quelqu'un que rien
//     ne debloquera.
//
// CE QU'IL NE VERIFIE PAS — a dire honnetement
//   Il lit le CODE, pas un navigateur : il ne prouve pas qu'un Tunisien recoit
//   son SMS (Vonage le bloque, cf. §H) ni que l'autocompletion se comporte
//   bien. Il prouve qu'il n'existe qu'une implementation, et qu'aucune des six
//   regressions ci-dessus n'est passee.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-saisie-telephone.mjs   → controles statiques.
//                                              AUCUN acces base.
//
// LECTURE PURE : ce script n'ecrit JAMAIS, et ne joint jamais la base.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Fins de ligne NORMALISEES — cf. les autres diagnostics du depot. */
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/**
 * Retire les commentaires — LE POINT CENTRAL DE CE SCRIPT.
 *
 * Tous ces fichiers CITENT les anti-patterns pour expliquer pourquoi ils sont
 * refuses : « +33 », la regex laxiste, `toE164`, « SMS envoye ». Un controle
 * qui lirait le texte brut se declencherait sur la prose qui documente la
 * correction. On lit le CODE.
 */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Balayage app/ ET lib/ ET components/ — la divergence ne previent pas. */
const fichiers = []
const parcourir = (d) => {
  if (!existsSync(join(ROOT, d))) return
  for (const e of readdirSync(join(ROOT, d))) {
    if (e === 'node_modules' || e === '.next') continue
    const rel = `${d}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
    else if (/\.tsx?$/.test(e)) fichiers.push(rel)
  }
}
parcourir('app')
parcourir('lib')
parcourir('components')

console.log('=== diag-saisie-telephone — une seule implementation ===')
console.log(`\n     ${fichiers.length} fichiers app/ + lib/ + components/ balayes.`)

// ───────────────────────────────────────────────────────────────────────────
section('A. LE COMPOSANT PARTAGE EXISTE, ET IL FAIT CE QU\'IL DOIT')

const SAISIE = 'components/phone/SaisieTelephone.tsx'
ok(existsSync(join(ROOT, SAISIE)), `${SAISIE} existe`, 'sans lui il n\'y a plus de source unique')
const saisie = existsSync(join(ROOT, SAISIE)) ? sansCommentaires(read(SAISIE)) : ''

// Le referentiel vient de la BASE, via le selecteur partage.
ok(/CountrySelect/.test(saisie), 'la saisie utilise le selecteur de pays partage', 'un second selecteur recreerait la divergence qu\'on ferme')
ok(/composerE164\(/.test(saisie), 'le E.164 est COMPOSE par le code', 'si l\'utilisateur doit taper l\'indicatif, on revient au champ qui exige un « + » que rien n\'annonce')
ok(/exempleNational\(/.test(saisie), 'le placeholder vient du PAYS choisi', 'un format fige par langue prescrivait +34 a un Marocain lisant l\'espagnol')
ok(/reconnaitreNumeroColle\(/.test(saisie), 'un numero colle avec son indicatif bascule le selecteur', 'sinon l\'indicatif est lu comme le debut du numero, et le refus est incomprehensible')
ok(/chiffresEnLatin\(/.test(saisie), 'les chiffres non latins sont acceptes', 'un clavier arabophone produit ٠١٢٣ naturellement : les refuser est un mur invisible')

// ⑦ CHANGER DE PAYS NE VIDE PAS LE NUMERO. On lit le CORPS du gestionnaire,
//   pas un commentaire : c'est une frustration gratuite, et elle est invisible
//   a la relecture.
const corpsChangerPays = (saisie.match(/const changerPays = useCallback\(([\s\S]*?)\n  \)/) ?? [])[1] ?? ''
ok(corpsChangerPays.length > 0, 'le changement de pays est localise', 'structure modifiee — revoir ce controle')
ok(
  corpsChangerPays.length > 0 && !/setNational\(\s*['"]{2}\s*\)/.test(corpsChangerPays),
  'changer de pays NE VIDE PAS le numero deja saisi',
  'quelqu\'un qui revient corriger son indicatif a deja tape son numero',
)

// ───────────────────────────────────────────────────────────────────────────
section('B. IL N\'Y EN A QU\'UN — LE CONTROLE QUI COMPTE')

// PIEGE 1 — un `<input type="tel">` hors du composant partage.
//
// L'inventaire est QUALIFIE A LA MAIN : tous les champs telephone ne sont pas
// des saisies a verifier. Un champ de contact facultatif, ou le telephone
// d'affichage d'un profil, n'ont pas le meme contrat.
const CHAMPS_TEL_ADMIS = {
  'components/phone/SaisieTelephone.tsx': 'LA saisie partagee — la seule qui compose un E.164 a verifier',
  'components/contact/ContactForm.tsx':
    'champ FACULTATIF du formulaire de contact public : aucun OTP, aucun stockage sur un compte, aucune unicite. Y imposer un selecteur ajouterait une friction sur un formulaire qu\'on veut sans obstacle.',
  'app/[locale]/dashboard/freelance/profil/valider/page.tsx':
    'telephone de CONTACT du profil expert, distinct du numero VERIFIE du compte (users.phone). Il ne declenche aucun SMS.',
  'app/[locale]/dashboard/cdi/profil/valider/page.tsx':
    'idem, parcours CDI.',
}
const champsTel = fichiers.filter((f) => /type=["']tel["']/.test(sansCommentaires(read(f))))
const nonQualifies = champsTel.filter((f) => !(f in CHAMPS_TEL_ADMIS))
ok(
  nonQualifies.length === 0,
  `aucune saisie de telephone non qualifiee (${champsTel.length} champ(s) au total)`,
  nonQualifies.length
    ? `a qualifier :\n         · ${nonQualifies.join('\n         · ')}\n\n       Une saisie de numero A VERIFIER doit passer par SaisieTelephone.\n       Un champ d'une autre nature rejoint CHAMPS_TEL_ADMIS AVEC SA RAISON.`
    : '',
)
// Un fichier listé mais disparu ferait mentir l'inventaire.
for (const f of Object.keys(CHAMPS_TEL_ADMIS)) {
  ok(champsTel.includes(f), `${f} — toujours present, l'inventaire reste exact`, 'ce fichier ne porte plus de champ tel : retirez-le de CHAMPS_TEL_ADMIS')
}

// Les TROIS parcours passent par le composant OTP partage.
const PARCOURS = [
  'app/[locale]/inscription/[role]/page.tsx',
  'app/[locale]/inscription/organisation/page.tsx',
  'components/settings/SettingsView.tsx',
]
for (const p of PARCOURS) {
  const src = sansCommentaires(read(p))
  ok(/<PhoneOtpField/.test(src), `${p} — passe par PhoneOtpField`, 'un parcours qui reecrit le sien rouvre la divergence')
  // PIEGE 1 bis : aucun ne doit porter sa propre saisie.
  ok(!/type=["']tel["']/.test(src), `${p} — ne porte plus de champ telephone en propre`, '')
}

// ───────────────────────────────────────────────────────────────────────────
section('C. AUCUNE NORMALISATION NI VALIDATION LOCALE')

// PIEGE 2 — une fonction locale qui fabrique un E.164.
const SOURCE_UNIQUE = 'lib/phone.ts'
const fabricants = fichiers.filter((f) => {
  if (f === SOURCE_UNIQUE) return false
  const src = sansCommentaires(read(f))
  // Une concatenation d'un indicatif litteral avec une portion de chaine :
  // c'est EXACTEMENT la forme du `toE164` supprime.
  return /['"`]\+\d{1,4}['"`]\s*\+/.test(src)
})
ok(
  fabricants.length === 0,
  'aucune fabrication locale d\'E.164 hors de lib/phone',
  fabricants.length
    ? `fichiers fautifs : ${fabricants.join(', ')}\n       Le toE164 des parametres faisait \`'+33' + s.slice(1)\` : un Marocain\n       enregistrait un numero francais. lib/phone REFUSE cette inference.`
    : '',
)

// PIEGE 4 — la regex laxiste, sous toutes ses formes.
const regexLaxistes = fichiers.filter((f) => {
  if (f === SOURCE_UNIQUE) return false
  return /\\\+\[1-9\]\\d\{\d+,\d+\}/.test(sansCommentaires(read(f)))
})
ok(
  regexLaxistes.length === 0,
  'aucune regex de validation E.164 recopiee',
  regexLaxistes.length
    ? `fichiers fautifs : ${regexLaxistes.join(', ')}\n       Elle laisse passer un numero structurellement E.164 mais NON\n       ATTRIBUABLE : le bouton s'active, le serveur refuse, et l'ecran\n       affiche « Service SMS indisponible » pour une faute de saisie.`
    : '',
)

// PIEGE 3 — un indicatif en dur dans le code.
const indicatifsEnDur = fichiers.filter((f) => {
  if (f === SOURCE_UNIQUE) return false
  const src = sansCommentaires(read(f))
  return /['"`]\+33[\s'"`]/.test(src) || /🇫🇷/.test(src)
})
ok(
  indicatifsEnDur.length === 0,
  'aucun indicatif ni drapeau francais en dur dans le code',
  indicatifsEnDur.length
    ? `fichiers fautifs : ${indicatifsEnDur.join(', ')}\n       Le referentiel est en base (64 pays, indicatif + drapeau) : il n'y a\n       aucune raison d'en recopier un morceau.`
    : '',
)

// PIEGE 3 bis — et dans les TRADUCTIONS. Un « format attendu : +33XXXXXXXXX »
// prescrit un pays a qui lit une langue, ce qui n'a aucun sens.
const LOCALES = ['fr', 'en', 'es', 'de']
const dansTraductions = []
for (const loc of LOCALES) {
  const brut = read(`messages/${loc}.json`)
  const plat = JSON.parse(brut)
  const parcours = (o, chemin = '') => {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') parcours(v, `${chemin}${k}.`)
      else if (typeof v === 'string' && /\+33|\+34X|\+49X|🇫🇷/.test(v)) {
        dansTraductions.push(`${loc}:${chemin}${k}`)
      }
    }
  }
  parcours(plat)
}
ok(
  dansTraductions.length === 0,
  'aucun indicatif fige dans les traductions',
  dansTraductions.length
    ? `cles fautives : ${dansTraductions.join(', ')}\n       Les messages prescrivaient le format selon la LANGUE : +33 en\n       francais, +34 en espagnol, +49 en allemand. Un Marocain lisant\n       l'espagnol se voyait prescrire le format espagnol.`
    : '',
)

// ───────────────────────────────────────────────────────────────────────────
section('D. L\'ECRAN N\'AFFIRME PAS PLUS QUE CE QU\'ON SAIT')

const OTP = 'components/PhoneOtpField.tsx'
const otp = sansCommentaires(read(OTP))

// PIEGE 5 — le serveur doit dire qu'il ne sait pas.
for (const r of ['app/api/auth/public/send-phone-otp/route.ts', 'app/api/auth/send-phone-otp/route.ts']) {
  const src = sansCommentaires(read(r))
  ok(
    /livraison_confirmee:\s*false/.test(src),
    `${r} — annonce que la livraison n'est PAS confirmee`,
    'Verify v2 est asynchrone : un request_id dit que la demande est acceptee, pas que le SMS est parti',
  )
  // PIEGE 6, cote serveur : les refus passent par le module de lecture.
  ok(/lireRefusVonage\(/.test(src), `${r} — lit le motif reel de Vonage`, 'sans quoi tout retombe dans un « service indisponible » generique')
  // Et plus aucun aiguillage EN DUR sur le statut HTTP de Vonage.
  //
  //  UNE PREMIERE VERSION DE CE CONTROLE AVAIT TORT, et la mutation l'a montre :
  //  il interdisait toute occurrence de `code: 'vonage_error'`, y compris sur le
  //  chemin « fetch a leve » — un fournisseur INJOIGNABLE est bel et bien une
  //  panne generique, et c'est le seul cas ou « reessayez » est un conseil
  //  honnete. Le controle criait sur du code juste.
  //
  //  Ce qui compte n'est pas le litteral : c'est que la route ne DECIDE plus
  //  elle-meme a partir du statut. Ces branches-la existaient (`res.status ===
  //  422`, `=== 429`) et ecrasaient tout le reste en « service indisponible ».
  ok(
    !/res\.status\s*===\s*(422|429|400)/.test(src),
    `${r} — n'aiguille plus a la main sur le statut Vonage`,
    'ces branches ecrasaient tout motif non prevu en « service indisponible » ; c\'est le module qui lit desormais',
  )
}

// L'ecran dit « demande transmise » et ouvre une sortie.
ok(/demande_transmise/.test(otp), 'l\'ecran dit « demande transmise », pas « SMS envoye »', 'affirmer l\'envoi est un ecran mort : personne ne peut rien faire')
ok(/montrerSortie/.test(otp) && /lienAide/.test(otp), 'une SORTIE s\'ouvre quand le compteur expire', 'sans elle, l\'utilisateur regarde un compteur tourner')
// La sortie ne doit PAS s'afficher tant que le compteur tourne : proposer
// d'ecrire au support pendant les 60 premieres secondes est prematuré.
const defSortie = (otp.match(/const montrerSortie =([^\n]*)/) ?? [])[1] ?? ''
ok(
  /cooldownLeft === 0/.test(defSortie) && /demandeTransmise/.test(defSortie),
  'la sortie n\'apparait qu\'APRES le compteur, et seulement si une demande est partie',
  `condition lue : ${defSortie.trim()}`,
)

// PIEGE 6 — les deux refus sont distincts jusque dans l'ecran.
ok(
  /sms_pays_non_pris_en_charge/.test(otp) && /pays_non_pris_en_charge/.test(otp),
  'l\'ecran distingue « pays non desservi » de « panne passagere »',
  'le premier a une issue — nous ecrire ; le second n\'en a pas',
)

// ───────────────────────────────────────────────────────────────────────────
section('E. I18N : CHAQUE CODE DE REFUS A SA CLE, DANS LES 4 LANGUES')

// Les codes que le module de lecture peut rendre. On les lit DANS LE MODULE :
// une liste recopiee ici divergerait, exactement comme les tables d'erreurs
// qu'on vient de supprimer.
const REFUS = 'lib/otp/vonage-refus.ts'
const refusSrc = read(REFUS)
const typeCodes = (refusSrc.match(/export type CodeRefusOtp =([\s\S]*?)\n\n/) ?? [])[1] ?? ''
const codes = [...typeCodes.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
ok(codes.length >= 4, `codes de refus lus dans ${REFUS} : ${codes.join(', ')}`, 'type introuvable — revoir ce controle')

const CLES_PAR_NAMESPACE = {
  'signup_form.errors': (c) => c,
  'inscription_org.errors': (c) => c,
  'settings.phone': (c) => (c === 'rate_limited' ? 'error_rate_limited' : `error_${c}`),
}
for (const loc of LOCALES) {
  const data = JSON.parse(read(`messages/${loc}.json`))
  const get = (chemin) => chemin.split('.').reduce((a, k) => a?.[k], data)
  for (const [ns, nommer] of Object.entries(CLES_PAR_NAMESPACE)) {
    const objet = get(ns)
    const manquantes = codes.filter((c) => {
      // `vonage_invalid_request` est rendu a l'ecran comme `invalid_phone` :
      // c'est le meme conseil — corrigez le numero.
      const cle = nommer(c === 'vonage_invalid_request' ? 'invalid_phone' : c)
      const v = objet?.[cle]
      return typeof v !== 'string' || v.length === 0
    })
    ok(
      manquantes.length === 0,
      `${loc} · ${ns} — un message pour chaque code de refus`,
      manquantes.length ? `manquantes : ${manquantes.map((c) => nommer(c)).join(', ')}` : '',
    )
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTROLE(S) EN ECHEC\n`)
process.exit(failures === 0 ? 0 : 1)

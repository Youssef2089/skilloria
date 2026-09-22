// scripts/diag-ecran-qui-se-contredit.mjs — DEUX PHRASES SUR LE MEME ECRAN NE
//                                           DOIVENT PAS SE CONTREDIRE.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LES QUATRE CAS MESURES, LE 21/09/2026, SUR LE TABLEAU DE BORD EXPERT
//
//   ① « Profil complete a 100 % »   … et a cote : « Completer → »
//      et dessous : « Un profil complet genere 5x plus de propositions. »
//      Les trois textes sont ecrits pour un profil INACHEVE, et s affichent
//      sur un profil acheve. Le bouton demande de faire ce qui est fait.
//
//   ② « Votre profil n est plus visible »   ← le bandeau, en tete d ecran
//      ● Profil verifie                     ← la pastille, en VERT, dessous
//      LES DEUX SONT VRAIES. La verification dit qu un administrateur a
//      approuve le dossier ; la visibilite dit que de NOUVEAUX CHAMPS sont
//      devenus necessaires depuis. Cote a cote, l expert conclut que l un des
//      deux ment, et il n a aucun moyen de savoir lequel.
//
//   ③ « 5x plus de propositions » cote freelance, « 3x plus de recruteurs »
//      cote CDI. DEUX CHIFFRES DIFFERENTS POUR LA MEME PROMESSE, et aucune
//      mesure derriere ni d un cote ni de l autre. La regle de maintenance du
//      depot l ecrit pour la memoire — « une affirmation non verifiable ne
//      s ecrit pas » ; elle vaut a plus forte raison face a l utilisateur.
//
//   ④ « Score IA 7/10 » sur une annonce de SOUS-TRAITANCE. Le nombre est
//      JUSTE — c est la note de qualite du TEXTE de l annonce, produite a sa
//      publication. L etiquette, elle, ne dit pas ce qu elle note : sur
//      l ecran d un expert, « Score IA » se lit comme une note portee sur LUI,
//      c est-a-dire exactement ce que §D.6 interdit. Famille §E.24 : un
//      chiffre juste sous une etiquette fausse.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QUE CE CONTROLE NE VERIFIE PAS, ET IL LE DIT
//   Il ne relit pas les PHRASES. Aucune machine ne dira qu un texte en
//   contredit un autre — les quatre cas ci-dessus ont ete trouves par un
//   humain devant son ecran, et c est la seule facon. Ce qui est garde ici,
//   c est la MECANIQUE qui les a fermes : que les deux voies la partagent, et
//   qu elle ne disparaisse pas au prochain lot.
//
//   node scripts/diag-ecran-qui-se-contredit.mjs
//   Aucune base, aucun reseau, aucune ecriture. Lecture seule.
//   0 = vert · 1 = rouge · 2 = n a pas tourne.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const lire = (p) => {
  const abs = join(ROOT, p)
  if (!existsSync(abs)) {
    console.error(`\n❌ Fichier introuvable : ${p}`)
    process.exit(2)
  }
  return readFileSync(abs, 'utf8').split('\r\n').join('\n')
}

const sansCommentaires = (src) =>
  src
    .split('\n')
    .map((l) => {
      const nu = l.trimStart()
      if (nu.startsWith('//') || nu.startsWith('*') || nu.startsWith('/*')) return ''
      return l
    })
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

let echecs = 0
const ok = (cond, label, indice) => {
  if (!cond) echecs++
  console.log(`  ${cond ? 'ok  ' : 'KO  '} ${label}`)
  if (!cond && indice) console.log(`       → ${indice}`)
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)
const note = (s) => console.log(`  note ${s}`)

const LANGUES = ['fr', 'en', 'es', 'de']
const MSG = Object.fromEntries(
  LANGUES.map((l) => [l, JSON.parse(readFileSync(join(ROOT, 'messages', `${l}.json`), 'utf8'))]),
)
const cle = (j, chemin) => chemin.split('.').reduce((o, k) => (o == null ? undefined : o[k]), j)

// ══════════════════════════════════════════════════════════════════════════
section('① Un profil COMPLET ne se fait pas demander de le compléter')
// ══════════════════════════════════════════════════════════════════════════

const VOIES = [
  { nom: 'freelance', page: 'app/[locale]/dashboard/freelance/page.tsx', ns: 'dashboard_freelance.completion', pct: 'completionPct' },
  { nom: 'cdi', page: 'app/[locale]/dashboard/cdi/page.tsx', ns: 'dashboard_cdi.profile_completion', pct: 'completionPercent' },
]

for (const v of VOIES) {
  const src = sansCommentaires(lire(v.page))
  // ⚠️ ON LIT LE BRANCHEMENT, PAS LA PRÉSENCE DE LA CLÉ (§E.8). Une clé
  //    déclarée dans les messages et jamais lue ne change rien à l'écran.
  for (const suffixe of ['title_complete', 'cta_complete', 'hint_complete']) {
    const court = suffixe
    ok(new RegExp(`${v.pct} >= 100\\s*\\n?\\s*\\?[\\s\\S]{0,120}${court}`).test(src),
      `${v.nom} : « ${court} » est choisi PAR le pourcentage`,
      'une cle qui existe sans etre branchee ne change rien a l ecran')
  }
}

// Et les trois textes existent, dans les quatre langues.
for (const v of VOIES) {
  for (const suffixe of ['title_complete', 'cta_complete', 'hint_complete']) {
    const manquantes = LANGUES.filter((l) => typeof cle(MSG[l], `${v.ns}.${suffixe}`) !== 'string')
    ok(manquantes.length === 0,
      `${v.nom}.${suffixe} existe dans les quatre langues`,
      `manquante(s) : ${manquantes.join(', ')} — une cle absente s affiche EN CLAIR a l ecran`)
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('① bis  Le bandeau du profil masqué dit QUI a changé quoi')
// ══════════════════════════════════════════════════════════════════════════
//
//  ⚠️ CE CONTRÔLE EST ARRIVÉ APRÈS COUP, ET C'EST LA RAISON DE SON EXISTENCE.
//     Le défaut « le bandeau n'explique pas que c'est une ÉVOLUTION DU
//     PRODUIT » faisait partie du lot, et il est resté OUVERT alors que le
//     rapport annonçait « tout est livré ». Rien ne le voyait : le bandeau
//     disait quelque chose de vrai, dans un français correct, et aucun
//     contrôle ne lit une intention.
//
//  CE QU'ON PEUT VÉRIFIER, ET QU'ON VÉRIFIE : la VOIX. Un texte qui explique
//  un changement d'exigence doit dire QUI l'a fait — « nous ». À la voix
//  passive (« sont devenus nécessaires »), la raison n'est contestable par
//  personne, et l'expert reste avec sa seule question : qu'est-ce que j'ai
//  fait ?
{
  const NS = ['profile_validation', 'cdi_profile_validation']
  const NOUS = {
    fr: /\bnous\b/i,
    en: /\bwe\b/i,
    es: /\b(hemos|pedimos)\b/i,
    de: /\bwir\b/i,
  }
  const RIEN_DE_MAL = {
    fr: /rien fait de mal/i,
    en: /nothing wrong/i,
    es: /nada mal/i,
    de: /nichts falsch/i,
  }

  for (const l of LANGUES) {
    for (const ns of NS) {
      const titre = cle(MSG[l], `${ns}.sections.summary_matching.hidden_title`)
      const intro = cle(MSG[l], `${ns}.sections.summary_matching.hidden_intro`)
      const ensemble = `${titre ?? ''} ${intro ?? ''}`
      ok(NOUS[l].test(ensemble),
        `${l}/${ns.replace('_validation', '')} : le bandeau dit QUI a changé l exigence`,
        'a la voix passive, la raison n est contestable par personne — et l expert croit avoir fauté')
      ok(RIEN_DE_MAL[l].test(ensemble),
        `${l}/${ns.replace('_validation', '')} : et qu il n a rien fait de mal`,
        "c est la seule question qu il se pose devant « votre profil n est plus visible »")
    }
  }

  // Les deux voies disent LA MÊME CHOSE : c'est le même événement produit.
  for (const l of LANGUES) {
    const a = cle(MSG[l], 'profile_validation.sections.summary_matching.hidden_intro')
    const b = cle(MSG[l], 'cdi_profile_validation.sections.summary_matching.hidden_intro')
    ok(a === b, `${l} : les deux voies donnent le MÊME texte`,
      'deux formulations du meme evenement derivent (§E.20)')
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('② « Vérifié » et « visible » ne se contredisent plus')
// ══════════════════════════════════════════════════════════════════════════

{
  const pastille = sansCommentaires(lire('components/dashboard/VerificationStatusPill.tsx'))
  ok(/masque\s*=\s*false/.test(pastille) || /masque\?:\s*boolean/.test(pastille),
    'la pastille sait si le profil est masqué')
  ok(/state === 'approved' && masque/.test(pastille),
    'et elle ne dit « vérifié » tout court que si le profil est visible',
    'un point vert et le mot « verifie » a cote d un avertissement rouge : l expert conclut que l un des deux ment')
  ok(/approved_hidden/.test(pastille),
    'elle a son propre libellé — elle n en emprunte pas un autre')

  // Le libellé, dans les quatre langues.
  const manquantes = LANGUES.filter((l) => typeof cle(MSG[l], 'verification_status.approved_hidden') !== 'string')
  ok(manquantes.length === 0,
    'le libellé existe dans les quatre langues',
    `manquante(s) : ${manquantes.join(', ')}`)

  // ⚠️ `=== false`, jamais `!visible` (§E.22) : une lecture en panne rend
  //    `null`, et `!null` vaut `true` — on annoncerait « masqué » à quelqu'un
  //    dont on n'a pas pu lire l'état.
  const SURFACES = [
    'app/[locale]/dashboard/freelance/page.tsx',
    'app/[locale]/dashboard/cdi/page.tsx',
    'app/[locale]/dashboard/freelance/mon-profil/page.tsx',
    'app/[locale]/dashboard/cdi/mon-profil/page.tsx',
  ]
  for (const p of SURFACES) {
    const src = sansCommentaires(lire(p))
    const nom = p.split('/').slice(-2).join('/')
    ok(/masque=\{profilMasque\}/.test(src),
      `${nom} : passe le drapeau à la pastille`)
    ok(/const profilMasque = verifState === 'approved' && profile\?\.visible === false/.test(src),
      `${nom} : et le calcule sur \`=== false\`, pas sur \`!visible\``,
      'une lecture en panne rend null, et !null vaut true : on annoncerait « masque » sur un doute (§E.22)')
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('③ Aucun multiplicateur inventé dans une promesse')
// ══════════════════════════════════════════════════════════════════════════

{
  // Le motif vise ce qui se lit comme une promesse chiffrée : « 5x », « 3× »,
  // « 2 fois plus ». Il ne vise pas un pourcentage ni une durée, qui disent
  // des faits mesurables.
  const MULTIPLICATEUR = /\b\d+\s*[x×]\s*(plus|more|más|mas|mehr)/i
  const coupables = []
  for (const l of LANGUES) {
    for (const ns of ['dashboard_freelance.completion', 'dashboard_cdi.profile_completion']) {
      for (const [k, v] of Object.entries(cle(MSG[l], ns) ?? {})) {
        if (typeof v === 'string' && MULTIPLICATEUR.test(v)) coupables.push(`${l}:${ns}.${k}`)
      }
    }
  }
  ok(coupables.length === 0,
    'aucune promesse chiffrée dans les cartes de complétion',
    `${coupables.join(', ')} — « 5x » cote freelance et « 3x » cote CDI, deux chiffres pour la meme promesse, aucune mesure derriere`)

  // Et les deux voies disent LA MÊME CHOSE, à la nature de l'objet près.
  for (const l of LANGUES) {
    const f = cle(MSG[l], 'dashboard_freelance.completion.hint_complete')
    const c = cle(MSG[l], 'dashboard_cdi.profile_completion.hint_complete')
    ok(f === c, `${l} : les deux voies donnent le même texte de profil complet`,
      'la parite se verifie sur le TEXTE, pas sur la presence de la cle')
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('④ Une note dit CE QU ELLE NOTE')
// ══════════════════════════════════════════════════════════════════════════

{
  // §D.9 : c'est une NOTE — elle JUGE un dossier —, et son libellé doit dire
  // lequel. « Score IA » ne le dit pas, et sur l'écran d'un expert il se lit
  // comme une note portée sur lui (§D.6).
  for (const l of LANGUES) {
    const libelle = cle(MSG[l], 'publications.badges.ai_score')
    ok(typeof libelle === 'string' && !/score ia|ai score|puntuación ia|ki-score/i.test(libelle),
      `${l} : le badge d annonce ne s appelle plus « Score IA »`,
      `vu : ${JSON.stringify(libelle)} — un chiffre juste sous une etiquette qui ne dit pas ce qu il note (§E.24)`)
    const bulle = cle(MSG[l], 'publications.badges.ai_score_tooltip')
    ok(typeof bulle === 'string' && bulle.length > 60,
      `${l} : et son explication dit ce qui est noté`,
      'une note sans objet nomme se fait attribuer le premier objet a l ecran')
  }

  // La source du nombre n'a pas changé : c'est bien la note de l'ANNONCE.
  const carte = sansCommentaires(lire('components/dashboard/AnnonceCard.tsx'))
  ok(/annonce\.verification_score/.test(carte),
    'et le nombre reste celui de la qualité de l annonce',
    'changer le libelle sans changer la source ferait mentir le nouveau libelle')
  ok(!/relevance_score/.test(carte),
    'jamais la pertinence — elle ne se chiffre PAS à l expert (§D.6)')
}

// ══════════════════════════════════════════════════════════════════════════
section('Ce que ce contrôle ne vérifie pas')
// ══════════════════════════════════════════════════════════════════════════

note('il ne relit pas les PHRASES : aucune machine ne dira qu un texte en')
note('contredit un autre. Les quatre cas ont ete trouves par un humain devant')
note('son ecran, et c est la seule facon.')
note('ce qui est garde ici, c est la MECANIQUE qui les a fermes — que les deux')
note('voies la partagent, et qu elle ne disparaisse pas au prochain lot.')

console.log('')
if (echecs > 0) {
  console.log(`❌ ${echecs} CONTRÔLE(S) EN ÉCHEC\n`)
  process.exit(1)
}
console.log('✅ Aucune des quatre contradictions mesurées ne peut revenir en silence.\n')
process.exit(0)

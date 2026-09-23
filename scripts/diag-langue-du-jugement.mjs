// scripts/diag-langue-du-jugement.mjs
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ CHAQUE TEXTE DANS LA LANGUE DE CELUI QUI LE LIT — ÉCRIT UNE FOIS,        ║
// ║ CONSERVÉ, JAMAIS RÉÉCRIT.                                                ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ┌─ LE DÉFAUT, MESURÉ LE 23/09/2026 ───────────────────────────────────────┐
// │ Le jugement au dépôt produit DEUX textes pour DEUX lecteurs :            │
// │   · `reason`    — lu par l'EXPERT, dans son suivi de candidatures ;      │
// │   · `pitch_org` — lu par l'ORGANISATION, sur la carte du candidat.       │
// │                                                                          │
// │ Ils recevaient UNE seule langue, et elle valait `'fr'` EN DUR. Un expert │
// │ allemand lisait son explication en français ; une organisation           │
// │ espagnole recevait un résumé qu'elle ne pouvait pas lire. Le type ne     │
// │ portait qu'un champ `locale` : il n'y avait même pas de place pour la    │
// │ seconde.                                                                 │
// └──────────────────────────────────────────────────────────────────────────┘
//
// ═══ ET UNE ORGANISATION N'A PAS DE LANGUE ═══════════════════════════════
//   Elle a des MEMBRES, qui en ont chacun une. La règle existait déjà — le
//   membre ADMIN le plus ancien, celui à qui part l'e-mail d'approbation —
//   mais elle vivait dans une requête, au milieu d'une route, sous un
//   commentaire. La recopier en aurait fait un jumeau (§E.20).
//
// LES QUATRE PROPRIÉTÉS DÉFENDUES :
//   ① DEUX LANGUES, PAS UNE — le type les porte toutes les deux, et le prompt
//      les lit toutes les deux.
//   ② CHACUNE VIENT DE SON LECTEUR — l'expert de son compte, l'organisation de
//      son porte-parole. Aucune n'est écrite en dur.
//   ③ ÉCRIT UNE FOIS, CONSERVÉ — la langue est stockée AVEC le texte, et rien
//      ne régénère.
//   ④ AUCUNE DES DEUX NE FAIT ÉCHOUER LE DÉPÔT — refuser une candidature
//      parce qu'on n'a pas su dans quelle langue l'écrire serait absurde.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE PÉRIMÈTRE, ÉCRIT — ET CHAQUE EXCLUSION JUSTIFIÉE
//
//   BALAYE   lib/candidatures/      le jugement et le chemin de dépôt
//            lib/organisations/     le porte-parole
//            app/api/               les deux appelants du jugement
//
//   EXCLU    components/            ⚠️ APRÈS MESURE : les écrans AFFICHENT un
//                                   texte déjà écrit. Qu'ils le traduisent
//                                   serait un autre défaut — et c'est
//                                   précisément ce que « écrit une fois,
//                                   conservé » interdit ; vérifié ci-dessous.
//            messages/*.json        aucune clé : ces textes sont ÉCRITS par le
//                                   modèle, pas traduits par le produit.
//            supabase/              aucune langue en base : `ai_assessment` est
//                                   un jsonb, et le jugement le remplit.
//            node_modules/ .next/   pas du dépôt / généré
//            docs/                  de la prose
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-langue-du-jugement.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE écriture.
// 0 = vert · 1 = rouge · 2 = n'a pas tourné.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
// ⚠️ IMPORT STATIQUE (§E.57) : un `await import()` en milieu de fichier fait
//    planter Node à la sortie, sous Windows, quand stdout est redirigé.
import * as PORTE_PAROLE from '../lib/organisations/porte-parole.ts'

const MOI = fileURLToPath(import.meta.url)
const ROOT = join(dirname(MOI), '..')

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

const JUGEMENT = 'lib/candidatures/ai-assessment.ts'
const jugementNu = depouillerJs(lire(JUGEMENT))
const DEPOT = 'lib/candidatures/depot.ts'
const depotNu = depouillerJs(lire(DEPOT))
const PITCH = 'app/api/candidatures/[id]/pitch/route.ts'
const pitchNu = depouillerJs(lire(PITCH))

/* ═══════════════════════════════════════════════════════════════════════════
   0. LE MODULE PUR S'EXÉCUTE (§E.33)
   ═══════════════════════════════════════════════════════════════════════════ */
section('0. La normalisation d’une langue — exécutée, pas relue')

const cas = [
  ['fr', 'fr', 'une langue du produit passe telle quelle'],
  ['de', 'de', 'idem'],
  // ⚠️ 'fr-FR' NE DISTINGUE RIEN, et la mutation l a prouve : sans le
  //    decoupage a deux lettres, 'fr-fr' n est pas une langue du produit et
  //    tombe sur le DEFAUT — qui est 'fr'. Le meme resultat, pour une raison
  //    opposee (§E.33). Il faut une langue regionale dont la langue n est PAS
  //    le defaut.
  ['fr-FR', 'fr', 'une locale régionale se ramène à sa langue'],
  ['de-DE', 'de', 'et celle-là le PROUVE : sans découpage, elle tomberait sur le défaut'],
  ['en-GB', 'en', 'idem'],
  ['EN', 'en', 'la casse ne décide de rien'],
  ['  es  ', 'es', 'les espaces non plus'],
  ['it', 'fr', 'une langue HORS produit prend le défaut — jamais un vide'],
  [null, 'fr', 'une locale absente prend le défaut'],
  [undefined, 'fr', 'idem'],
  [42, 'fr', 'une valeur qui n’est pas un texte aussi'],
  ['', 'fr', 'une chaîne vide aussi'],
]
for (const [entree, attendu, pourquoi] of cas) {
  const rendu = PORTE_PAROLE.normaliserLangue(entree)
  ok(rendu === attendu, `${pourquoi} — ${JSON.stringify(entree)} → ${rendu}`, `attendu ${attendu}`)
}
ok(
  PORTE_PAROLE.LANGUE_PAR_DEFAUT === 'fr',
  'le défaut est le français, et c’est une DÉCISION',
  'un defaut vide laisserait le modele choisir la langue',
)

/* ═══════════════════════════════════════════════════════════════════════════
   1. DEUX LANGUES, PAS UNE
   ═══════════════════════════════════════════════════════════════════════════ */
section('1. Le jugement porte DEUX langues, et le prompt les lit toutes les deux')

ok(/locale: Langue/.test(jugementNu), 'l’entrée porte la langue de l’expert')
ok(/localeOrganisation: Langue/.test(jugementNu), '… et celle de l’organisation')
ok(
  /LANGUES\[e\.locale\]/.test(jugementNu) && /LANGUES\[e\.localeOrganisation\]/.test(jugementNu),
  'le prompt demande CHAQUE texte dans SA langue',
  'une seule langue dans le prompt, et l un des deux lecteurs recoit une phrase qu il ne lit pas',
)
{
  // Le bon champ au bon texte : `reason` à l'expert, `pitch_org` à l'organisation.
  const ligneReason = jugementNu.split('\n').find((l) => l.includes('"reason"')) ?? ''
  const lignePitch = jugementNu.split('\n').find((l) => l.includes('"pitch_org"')) ?? ''
  ok(ligneReason.length > 0 && lignePitch.length > 0, 'les deux consignes sont isolées',
    'deux lignes vides passeraient les assertions suivantes sans rien mesurer (§E.33)')
  ok(
    ligneReason.includes('LANGUES[e.locale]'),
    'l’explication prend la langue de l’EXPERT',
    'inversees, chacun recevrait le texte de l autre — et les deux seraient illisibles',
  )
  ok(
    lignePitch.includes('LANGUES[e.localeOrganisation]'),
    'le résumé prend la langue de l’ORGANISATION',
  )
}
// Et le prompt DIT que les deux peuvent différer : sans ça, le modèle
// harmonise — c'est ce que font les modèles quand une consigne surprend.
ok(
  /N'ONT PAS LA MÊME LANGUE/.test(lire(JUGEMENT)),
  'le prompt prévient que les deux langues peuvent différer',
  'un modele qui trouve la consigne etrange harmonise, et le defaut revient en silence',
)

/* ═══════════════════════════════════════════════════════════════════════════
   2. CHACUNE VIENT DE SON LECTEUR — aucune n'est écrite en dur
   ═══════════════════════════════════════════════════════════════════════════ */
section('2. Chaque langue vient de son lecteur')

ok(
  !/locale: '(?:fr|en|es|de)'/.test(depotNu),
  'aucune langue n’est écrite EN DUR au dépôt',
  'c est exactement ce qui etait la : locale: fr, pour les deux textes et pour tout le monde',
)
ok(/locale: langueExpert/.test(depotNu), 'l’explication prend la langue lue sur le COMPTE de l’expert')
ok(
  /localeOrganisation: langueOrg/.test(depotNu),
  '… et le résumé celle du porte-parole de l’organisation',
)
ok(
  /langueDeLOrganisation\(/.test(depotNu),
  'la langue de l’organisation vient de la règle partagée',
)
// LE `select` CHARGE LA LANGUE : sans elle, le test lit `undefined` (§E.1).
ok(
  /inner\(user_type, locale,/.test(depotNu),
  'le `select` du dépôt charge la locale de l’expert',
  'une colonne non chargee rend undefined, et normaliserLangue tombe sur le defaut — en silence',
)

/* ═══════════════════════════════════════════════════════════════════════════
   3. UNE SEULE RÈGLE POUR « QUI PARLE POUR UNE ORGANISATION »
   ═══════════════════════════════════════════════════════════════════════════ */
section('3. Le porte-parole d’une organisation est défini une fois')

const REGLE = 'lib/organisations/porte-parole.ts'
const regleNu = depouillerJs(lire(REGLE))
ok(/PORTE_PAROLE = \{/.test(regleNu), 'le critère est déclaré en DONNÉES')
ok(
  /valeurRole: 'admin'/.test(regleNu) && /valeurStatut: 'active'/.test(regleNu),
  '… un admin, ACTIF',
  'un admin inactif ne parle plus pour personne',
)
ok(
  /colonneAnciennete: 'joined_at'/.test(regleNu),
  '… et le plus ANCIEN',
  'sans ordre, on prend n importe lequel — donc un autre a chaque lecture',
)
// Personne d'autre ne rejuge « qui parle » : le seul autre lecteur connu, la
// route d'approbation d'organisation, est DÉCLARÉ ci-dessous.
{
  const SOURCES = fichiersSous(['lib', 'app/api'])
  // ⚠️ ON DÉCOUPE LA REQUÊTE, PAS LE FICHIER. Le détecteur cherchait les
  //    trois marqueurs n'importe où dans le fichier, et il a dénoncé
  //    `get-user`, qui COMPTE les admins d’une organisation — une autre
  //    question — et dont le `joined_at` appartient à une requête voisine.
  //    Trois marqueurs dispersés ne font pas une règle (§E.8).
  const resoutLePorteParole = (src) => {
    const nu = depouillerJs(src)
    for (const m of nu.matchAll(/from\(\s*['"`]organization_members['"`]\s*\)/g)) {
      const fin = nu.indexOf('\n\n', m.index)
      const requete = nu.slice(m.index, fin < 0 ? nu.length : fin)
      if (
        /role_in_org['"`]\s*,\s*['"`]admin/.test(requete) &&
        /status['"`]\s*,\s*['"`]active/.test(requete) &&
        /order\(\s*['"`]joined_at/.test(requete)
      ) {
        return true
      }
    }
    return false
  }
  const rejugeurs = SOURCES.filter((f) => f !== REGLE && resoutLePorteParole(lire(f)))
  /**
   * ⚠️ TROIS EXEMPTIONS, ET CHACUNE PORTE SA RAISON (§G.8).
   *
   *    Les trois résolvent le MÊME porte-parole, pour une autre PROJECTION :
   *    elles ont besoin d’une adresse, d’un prénom ou d’un nom en plus de la
   *    langue. Leur faire appeler `langueDeLOrganisation` ajouterait une
   *    requête pour récupérer ce qu’elles lisent déjà.
   *
   *    CE QUI RESTE OUVERT, ET SE DIT : elles n’utilisent pas encore le
   *    critère partagé `PORTE_PAROLE`. Le jour où la règle change — le
   *    propriétaire plutôt que le doyen, par exemple — il faudra les quatre.
   *    Ce contrôle les LISTE : leur nombre ne peut que descendre.
   */
  const EXEMPTIONS = {
    'app/api/admin/approve-org/route.ts':
      'MEME regle, autre projection : email + prenom pour l e-mail d approbation',
    'app/api/admin/reject-org/route.ts':
      'MEME regle, autre projection : email + prenom pour l e-mail de refus',
    'app/api/admin/get-org/[id]/route.ts':
      'MEME regle, autre projection : le contact principal affiche sur la fiche admin',
  }
  const nonDeclares = rejugeurs.filter((f) => !(f in EXEMPTIONS))
  ok(
    nonDeclares.length === 0,
    `aucun rejugeur non déclaré : ${nonDeclares.join(' · ') || '—'}`,
    'deux regles « qui parle pour l org » divergent, et l e-mail part a quelqu un d autre que le resume',
  )
  for (const [f, raison] of Object.entries(EXEMPTIONS)) {
    ok(
      rejugeurs.includes(f),
      `exemption encore utile : ${f} — ${raison}`,
      'elle ne resout plus le porte-parole : retirez-la du gel plutot que de la garder',
    )
  }
  note(`${rejugeurs.length} lecteurs du porte-parole, tous déclarés`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. ÉCRIT UNE FOIS, CONSERVÉ — et la langue voyage avec le texte
   ═══════════════════════════════════════════════════════════════════════════ */
section('4. Écrit une fois, conservé, et sa langue avec lui')

ok(
  /reason_locale: Langue/.test(jugementNu) && /pitch_locale: Langue/.test(jugementNu),
  'le jugement REND la langue de chaque texte',
  'sans elle, rien ne dira plus tard dans quelle langue le texte est ecrit (§E.24)',
)
ok(
  /reason_locale: args\.entree\.locale/.test(jugementNu) &&
    /pitch_locale: args\.entree\.localeOrganisation/.test(jugementNu),
  '… celle qui a été DEMANDÉE, jamais une langue devinée du texte',
  'on sait ce qu on a demande ; on ne sait pas ce que le modele a rendu (§E.27)',
)
ok(
  /reason_locale: resultat\.jugement\.reason_locale/.test(depotNu) &&
    /pitch_locale: resultat\.jugement\.pitch_locale/.test(depotNu),
  'les deux langues sont ÉCRITES avec la candidature',
)
ok(
  /pitch_locale: locale/.test(pitchNu),
  'le pitch à la demande conserve la sienne aussi',
)
// RIEN NE RÉGÉNÈRE : le pitch déjà écrit n'est jamais réécrit.
ok(
  /if \(dejaEcrit\) return \{ ok: true, pitch: dejaEcrit, deja: true \}/.test(jugementNu),
  'un pitch déjà écrit n’est JAMAIS régénéré',
  'un texte qui change entre deux ouvertures ferait douter de ce qu on a lu la premiere fois',
)
// Et aucun écran ne traduit un texte déjà écrit.
{
  const ECRANS = fichiersSous(['components', 'app/[locale]'])
  const traducteurs = ECRANS.filter((f) => {
    const nu = depouillerJs(lire(f))
    return /(?:pitch_org|ai_assessment)/.test(nu) && /\bt\(\s*`?\$\{?(?:pitch|reason)/.test(nu)
  })
  ok(
    traducteurs.length === 0,
    `aucun écran ne traduit un texte déjà écrit : ${traducteurs.join(' · ') || '—'}`,
    'traduire a l affichage, c est reecrire — et « ecrit une fois, conserve » tombe',
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. AUCUNE LANGUE NE FAIT ÉCHOUER UN DÉPÔT
   ═══════════════════════════════════════════════════════════════════════════ */
section('5. Ne pas savoir dans quelle langue écrire ne refuse pas une candidature')

ok(
  !/throw/.test(regleNu),
  'le porte-parole ne lève JAMAIS',
  'refuser une candidature parce qu on n a pas su dans quelle langue l ecrire serait absurde',
)
ok(
  /console\.error\([\s\S]{0,200}ILLISIBLE/.test(lire(REGLE)),
  '… mais une lecture en panne se DIT',
  'une organisation anglophone qui recoit du francais n est pas une panne visible (§E.22)',
)
ok(
  /return LANGUE_PAR_DEFAUT/.test(regleNu),
  '… et elle rend le défaut, jamais `null`',
  'un null forcerait l appelant a decider, ou a laisser le modele choisir',
)

note(`langue par défaut : ${PORTE_PAROLE.LANGUE_PAR_DEFAUT}`)

console.log(
  echecs === 0
    ? '\n✅ VERT — chaque texte dans la langue de son lecteur, écrit une fois, conservé.\n'
    : `\n❌ ROUGE — ${echecs} écart(s).\n`,
)
process.exit(echecs === 0 ? 0 : 1)

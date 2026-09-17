// scripts/diag-configuration-absente.mjs — UNE CONFIGURATION ABSENTE SE DIT,
//                                           ELLE NE SE DEVINE PAS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE DEFAUT QU'ON FERME
//   Trois chemins de verification lisent leur seuil en base. Ils se
//   comportaient DIFFEREMMENT quand la ligne manque :
//
//     expert-verification       -> pending_admin_review, motif nomme.  ✔
//     publication-verification  -> pending_review, motif nomme.        ✔
//     verification/index        -> FALLBACK_DECISION_THRESHOLD = 7.    ✘
//
//   Le troisieme INVENTAIT un nombre et ne le disait pas. Une organisation
//   etait approuvee — ou renvoyee en revue — sur un seuil que personne n'avait
//   choisi, et qu'aucun ecran ne montrait.
//
//   Pire : l'en-tete du meme fichier annoncait « fallback threshold = 9 »
//   pendant que la constante valait 7. Il fallait lire les deux pour le voir.
//
// LA REGLE, DEJA ECRITE AILLEURS DANS CE DEPOT
//   « Aucun repli code en dur : un repli invisible est un SECOND reglage qui
//     prend la main le jour ou l'on comprend le moins ce qui se passe. Ligne
//     absente => on refuse, et on le dit. »  (lib/matching/settings.ts)
//
//   Ce diagnostic l'etend a la verification, et surtout : il EMPECHE LE REPLI
//   DE REVENIR. Le corriger une fois ne suffit pas — le prochain qui verra un
//   `?? 7` manquant le remettra « pour ne pas casser ».
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CE QU'IL LIT, ET CE QU'IL NE LIT PAS
//   Il lit LE CODE, commentaires retires. Un repli DOCUMENTE dans une phrase —
//   et ce fichier en documente plusieurs, en toutes lettres — ne doit pas faire
//   rougir le controle : c'est l'histoire du defaut, pas le defaut.
//
//   ⚠️ Et il depouille AUSSI les chaines de `comment on` : la PROSE d'un
//      commentaire SQL est une chaine executable pour l'analyseur, mais ce
//      n'est pas du code. Rien ici ne lit de SQL, la remarque vaut pour qui
//      etendrait ce controle aux migrations.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-configuration-absente.mjs
//
// AUCUN acces base, AUCUN reseau, AUCUNE variable d'environnement.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Fins de ligne NORMALISEES : le depot sort les fichiers en CRLF, et un retour
// chariot casse tout motif qui traverse un saut de ligne.
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const existe = (p) => existsSync(join(ROOT, p))

let echecs = 0
const ok = (cond, libelle, indice) => {
  if (cond) console.log(`  ok   ${libelle}`)
  else { echecs++; console.log(`  KO   ${libelle}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/**
 * Commentaires retires — LIGNES D'ABORD, BLOCS ENSUITE.
 * L'ordre inverse fait d'un `//` contenant une suite slash-etoile un ouvrant de
 * bloc, qui avale le code jusqu'au prochain fermant. Mesure faite sur ce depot :
 * jusqu'a 1575 caracteres effaces avant analyse, en silence.
 */
const sansCommentaires = (src) =>
  src.replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\/\*[\s\S]*?\*\//g, '')

// ─────────────────────────────────────────────────────────────────────────────
// LES TROIS CHEMINS, ET CE QU'ILS DOIVENT FAIRE D'UNE CONFIGURATION ABSENTE
// ─────────────────────────────────────────────────────────────────────────────
const CHEMINS = [
  {
    fichier: 'lib/verification/index.ts',
    quoi: 'verification d’entreprise',
    // La branche de refus, et l'etat qu'elle pose.
    refus: /if\s*\(\s*!\s*decisionProvider\s*\)/,
    statut: /verification_status:\s*'pending_admin_review'/,
    // Ce qui ne doit PAS etre atteint avant le refus.
    appelIA: /verifyAiCoherence\s*\(/,
  },
  {
    fichier: 'lib/verification/expert-verification.ts',
    quoi: 'verification d’expert',
    refus: /if\s*\(\s*!\s*config\s*\)/,
    statut: /verification_status:\s*'pending_admin_review'/,
    appelIA: /runExpertCoherenceCheck\s*\(/,
  },
  {
    fichier: 'lib/verification/publication-verification.ts',
    quoi: 'qualite d’annonce',
    // ANCRE SUR LA FORME DU REFUS, PAS SUR UN NOM DE VARIABLE.
    //
    //  Ce controle exigeait `if (!active)`. Le chemin rendait alors
    //  `{ threshold: 0, active: false }` — un nombre FABRIQUE pose a cote de
    //  son invalidant. Le remplacer par un type somme
    //  (`{ ok: true, threshold } | { ok: false, raison }`) a supprime le nombre
    //  invente, ET fait rougir ce controle : il lisait le NOM, pas le refus.
    //
    //  Un controle qui casse quand on ameliore le code est un controle qui
    //  freine. On accepte donc les deux formes — l'ancienne et le type somme —
    //  parce que ce qui compte est qu'une branche « configuration absente »
    //  EXISTE et pose un etat de revue, pas comment on l'a nommee.
    refus: /if\s*\(\s*!\s*(?:active|\w+\.ok)\s*\)/,
    statut: /status:\s*'pending_review'/,
    appelIA: /verifyAiPublicationQuality\s*\(/,
  },
]

section('A. Les trois chemins refusent, et refusent AVANT de depenser')

for (const c of CHEMINS) {
  if (!existe(c.fichier)) { ok(false, `${c.fichier} introuvable`); continue }
  const code = sansCommentaires(read(c.fichier))

  const iRefus = code.search(c.refus)
  ok(iRefus !== -1, `${c.quoi} — la branche « configuration absente » existe`,
    'sans elle, le chemin tranche sur une valeur que personne n’a choisie')
  if (iRefus === -1) continue

  // ANCRE SUR LE BLOC DE REFUS, pas sur le fichier. Une regex lachee sur tout
  // le fichier trouverait le meme motif dans la sortie NOMINALE, et resterait
  // verte alors que le refus, lui, aurait ete vide.
  const bloc = code.slice(iRefus, iRefus + 900)
  ok(c.statut.test(bloc), `${c.quoi} — le refus pose un etat de REVUE MANUELLE`,
    'un refus qui ne pose pas d’etat laisse l’objet dans les limbes')

  // Le refus doit PRECEDER l'appel au modele : on ne paie pas une decision
  // qu'on ne saura pas trancher.
  const iIA = code.search(c.appelIA)
  ok(iIA === -1 || iRefus < iIA, `${c.quoi} — le refus precede l’appel au modele`,
    'poser le refus apres l’appel, c’est payer pour une decision qu’on ne prendra pas')
}

section('B. Aucun seuil de repli code en dur')

// CE QU'ON CHERCHE : une constante nommee « fallback/default … threshold/seuil »
// a laquelle on affecte un NOMBRE, et un `?? <nombre>` sur une lecture de seuil.
// Les deux formes que le defaut a prises.
const MOTIFS_REPLI = [
  {
    re: /\b(?:const|let|var)\s+\w*(?:FALLBACK|DEFAUT|DEFAULT|REPLI)\w*(?:THRESHOLD|SEUIL)\w*\s*(?::[^=]+)?=\s*-?\d+(?:\.\d+)?/i,
    quoi: 'une constante de seuil par defaut',
  },
  {
    re: /\b\w*(?:threshold|seuil)\w*\s*\?\?\s*-?\d+(?:\.\d+)?/i,
    quoi: 'un `?? <nombre>` sur une lecture de seuil',
  },
  {
    re: /(?:confidence_threshold|auto_approve_threshold)[^\n;]{0,80}\?\?\s*-?\d+/i,
    quoi: 'un repli directement sur la colonne ou la cle de config',
  },
]

// PERIMETRE : app/ ET lib/. Un balayage qui ne regarde que lib/ laisse passer
// un repli ecrit dans une route — le piege deja paye deux fois ici.
const A_BALAYER = [
  'lib/verification/index.ts',
  'lib/verification/expert-verification.ts',
  'lib/verification/publication-verification.ts',
  'lib/verification/ai-fallback.ts',
  'lib/verification/ai-expert-verification.ts',
  'lib/verification/ai-publication-quality.ts',
  'lib/matching/settings.ts',
  'app/api/auth/finalize-org-registration/route.ts',
]

for (const f of A_BALAYER) {
  if (!existe(f)) { ok(false, `${f} introuvable`); continue }
  const code = sansCommentaires(read(f))
  const touches = MOTIFS_REPLI.filter((m) => m.re.test(code))
  ok(touches.length === 0, `${f.split('/').pop()} — aucun seuil de repli`,
    touches.length ? `trouve : ${touches.map((t) => t.quoi).join(' ; ')}` : undefined)
}

section('C. Le detecteur lui-meme est eprouve')

// UN DETECTEUR QU'ON NE TESTE PAS EST UNE OPINION. On lui donne des cas
// construits, et on exige qu'il trouve les vrais et ignore les faux.
{
  const doitTrouver = [
    ['const FALLBACK_DECISION_THRESHOLD = 7', 'la forme exacte du defaut corrige'],
    ['const DEFAULT_THRESHOLD = 9', 'une autre orthographe de la meme idee'],
    ['const seuil = row?.confidence_threshold ?? 7', 'le repli en position d’usage'],
    ['const t = provider?.auto_approve_threshold ?? 8', 'le repli sur la cle de config'],
  ]
  const doitIgnorer = [
    ['const threshold = decisionProvider.confidence_threshold', 'une lecture SANS repli'],
    ['const max_tokens = cfg.max_tokens ?? 2500', 'un repli sur autre chose qu’un seuil'],
    ['if (!config) return refus', 'un refus explicite'],
    ['const RELANCE_MAX_PAR_HEURE = 20', 'un plafond anti-abus, volontairement en code'],
  ]
  for (const [src, quoi] of doitTrouver) {
    ok(MOTIFS_REPLI.some((m) => m.re.test(src)), `detecte : ${quoi}`,
      'le detecteur laisserait revenir le repli')
  }
  for (const [src, quoi] of doitIgnorer) {
    ok(!MOTIFS_REPLI.some((m) => m.re.test(src)), `ignore : ${quoi}`,
      'faux positif : un controle qui crie a tort finit ignore')
  }
}

section('D. L’origine du site ne se devine pas non plus')

// MEME FAMILLE, AUTRE CHEMIN, ET IL FAISAIT PLUS DE DEGATS.
//   Huit endroits construisaient leurs liens d'e-mail sur
//   `process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'`. En production,
//   une variable oubliee envoyait a de VRAIS destinataires des liens vers
//   localhost — approbation d'expert, refus d'organisation, invitation, TOUTES
//   les notifications, et l'avertissement d'inactivite a 23 mois qui est une
//   obligation legale. L'envoi reussissait. Le lien etait mort. Rien n'alertait.
{
  const SOURCE_UNIQUE = 'lib/site-url.ts'

  // ① UNE SEULE ADRESSE DE REPLI DANS TOUT LE DEPOT, et elle est dans la source
  //    unique. Le balayage couvre app/ ET lib/ : un repli ecrit dans une route
  //    est le piege deja paye deux fois ici.
  const RACINES = ['app', 'lib', 'components']
  const { readdirSync, statSync } = await import('node:fs')
  const fichiers = []
  const parcourir = (d) => {
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`
      if (statSync(join(ROOT, rel)).isDirectory()) parcourir(rel)
      else if (/\.(ts|tsx)$/.test(e)) fichiers.push(rel)
    }
  }
  for (const r of RACINES) parcourir(r)

  const coupables = []
  for (const f of fichiers) {
    if (f === SOURCE_UNIQUE) continue
    const code = sansCommentaires(read(f))
    if (/localhost:3000/.test(code)) coupables.push(f)
  }
  ok(coupables.length === 0,
    `aucun repli « localhost » hors de ${SOURCE_UNIQUE} — ${fichiers.length} fichier(s) balayes`,
    coupables.length ? `trouve dans : ${coupables.join(', ')}` : undefined)

  // ② LA SOURCE UNIQUE DISTINGUE LES ENVIRONNEMENTS. Le repli est legitime hors
  //    production (aucun destinataire reel) et interdit en production.
  const src = sansCommentaires(read(SOURCE_UNIQUE))
  ok(/isProduction\s*\(\s*\)/.test(src), `${SOURCE_UNIQUE} distingue la production`,
    'sans cette distinction, le repli redevient universel')
  ok(/return\s+null/.test(src), `${SOURCE_UNIQUE} rend null plutot qu’une chaine de repli`,
    'une valeur par defaut dispense l’appelant de choisir — c’est ainsi que localhost est arrive en production')

  // ③ CHAQUE APPELANT GARDE. Un resolveur qui rend null ne sert a rien si
  //    l'appelant interpole `null` dans une URL — TypeScript ne le voit pas
  //    toujours, une template string avale n'importe quoi.
  const APPELANTS = [
    ['lib/notifications/dispatch.ts', 'toutes les notifications par e-mail'],
    ['app/api/cron/purge-inactive/route.ts', 'l’avertissement CNIL a 23 mois'],
    ['app/api/admin/approve-expert/route.ts', 'l’e-mail d’approbation d’expert'],
    ['app/api/admin/reject-expert/route.ts', 'l’e-mail de refus d’expert'],
    ['app/api/admin/approve-org/route.ts', 'l’e-mail d’approbation d’organisation'],
    ['app/api/admin/reject-org/route.ts', 'l’e-mail de refus d’organisation'],
    ['app/api/me/organisation/invitations/route.ts', 'l’invitation a rejoindre une organisation'],
    ['app/api/me/organisation/invitations/[id]/route.ts', 'la relance d’invitation'],
  ]
  for (const [f, quoi] of APPELANTS) {
    if (!existe(f)) { ok(false, `${f} introuvable`); continue }
    const code = sansCommentaires(read(f))
    // Une garde : un test de faussete sur l'origine, quelle que soit sa forme.
    const garde = /if\s*\(\s*!\s*(siteOrigin|origin)\b|&&\s*(siteOrigin|origin)\b|&&\s*!\s*(siteOrigin|origin)\b/.test(code)
    ok(garde, `${quoi} — l’appelant garde sur l’origine`,
      'sans garde, `null` est interpole dans l’URL et l’e-mail part quand meme')
  }
}

section('E. Le depouilleur ne ment pas sur ce qu’il montre')

// Ce fichier DOCUMENTE le repli qu'il interdit, en toutes lettres et avec sa
// valeur. Si le depouillement des commentaires cessait de fonctionner, le
// controle rougirait sur sa propre documentation — et quelqu'un le desactiverait.
{
  const moi = read('scripts/diag-configuration-absente.mjs')
  const depouille = sansCommentaires(moi)
  ok(!/FALLBACK_DECISION_THRESHOLD = 7/.test(depouille.split('doitTrouver')[0]),
    'la documentation du repli ne se lit pas comme du code',
    'le depouilleur laisse passer des commentaires : le controle se denoncerait lui-meme')
}

console.log(echecs === 0 ? '\n✔ TOUT VERT' : `\n✘ ${echecs} CONTROLE(S) EN ECHEC`)
process.exit(echecs === 0 ? 0 : 1)

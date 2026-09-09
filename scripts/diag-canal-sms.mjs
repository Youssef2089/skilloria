// scripts/diag-canal-sms.mjs — LE CANAL SMS EST FERMÉ, LES OTP SONT INTACTS
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEUX CONTRÔLES EN SENS INVERSE, ET IL FAUT LES DEUX
//
//   Ce fichier garde une décision produit et une garantie d'exploitation qui
//   tirent dans des directions opposées :
//
//     • LES SMS DE NOTIFICATION NE PARTENT PLUS. C'était un défaut ACTIF en
//       production : le dispatcher empruntait le canal sans aucune condition,
//       et le seul filtre était une préférence EN OPT-OUT — l'absence de ligne
//       valait « actif », sur un canal payant que plus aucun écran ne
//       permettait de couper. Chaque candidature déposée envoyait un SMS à tous
//       les membres de l'organisation au téléphone vérifié.
//
//     • LES SMS D'AUTHENTIFICATION DOIVENT RESTER JOIGNABLES. Sans ce
//       second contrôle, on est à un lot de casser l'inscription en croyant
//       nettoyer : quelqu'un lira « les SMS sont coupés » et retirera le
//       mauvais chemin.
//
//   Les deux chemins n'ont AUCUN point commun, et c'est ce qui rend la coupe
//   sûre :
//     notification → lib/sms/vonage.ts → rest.nexmo.com/sms/json
//     OTP          → routes d'auth     → api.nexmo.com/v2/verify
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-canal-sms.mjs
//
// AUCUN accès base, AUCUN réseau, AUCUNE préparation.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Normalisation des fins de ligne : le dépôt sort les fichiers en CRLF, et un
// retour chariot casse tout motif qui traverse un saut de ligne.
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

/** Code seul : un verbe CITÉ dans un commentaire n'envoie aucun SMS. */
const sansCommentaires = (src) =>
  src
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

/** Tous les fichiers .ts de app/ et lib/ — les clients Supabase ne sont pas typés, on balaie les deux. */
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
const SOURCES = [...fichiersTs('app'), ...fichiersTs('lib')]

console.log('\n━━━ LE CANAL SMS DES NOTIFICATIONS ━━━')
console.log(`    ${SOURCES.length} fichiers balayés (app/ + lib/)`)

// ═══════════════════════════════════════════════════════════════════════════
titre('(A) LE CANAL EST FERMÉ, ET FERMÉ PAR DÉFAUT')
// ═══════════════════════════════════════════════════════════════════════════

ok('la liste des canaux ouverts existe en UN seul endroit', existe('lib/notifications/canaux.ts'))
const CANAUX = existe('lib/notifications/canaux.ts') ? read('lib/notifications/canaux.ts') : ''

ok('le SMS n’est PAS dans les canaux ouverts',
  /CANAUX_OUVERTS: readonly NotificationChannel\[\] = \['email'\]/.test(CANAUX),
  'rouvrir « sms » ici réactive une dépense sortante sur tous les événements qui le déclarent')
ok('la règle est « fermé par défaut » (liste d’ouverts, pas liste de fermés)',
  /return CANAUX_OUVERTS\.includes\(channel\)/.test(CANAUX),
  'une liste de canaux FERMÉS laisserait passer le canal ajouté demain')

// ═══════════════════════════════════════════════════════════════════════════
titre('(B) LE DISPATCHER N’EMPRUNTE QUE LES CANAUX OUVERTS')
// ═══════════════════════════════════════════════════════════════════════════

const DISPATCH = sansCommentaires(read('lib/notifications/dispatch.ts'))

ok('le dispatcher passe par la liste des canaux ouverts',
  /for \(const canal of canauxOuvertsDe\(def\.channels\)\)/.test(DISPATCH))
// LE contrôle qui mord : plus aucun appel de canal écrit en dur.
ok('aucun canal n’est emprunté en dur',
  !/runChannel\([^)]*'sms'/.test(DISPATCH) && !/runChannel\([^)]*'email'/.test(DISPATCH),
  'un appel en dur contourne la liste : le canal repart sans que personne ne l’ait rouvert')

// ═══════════════════════════════════════════════════════════════════════════
titre('(C) AUCUN AUTRE CHEMIN N’ATTEINT L’ENVOYEUR DE NOTIFICATION')
// ═══════════════════════════════════════════════════════════════════════════

//   Le canal peut aussi revenir SANS toucher au dispatcher : il suffit qu'un
//   nouveau code appelle `sendSms` directement. On balaie donc app/ et lib/.
const appelants = []
for (const f of SOURCES) {
  if (f === 'lib/sms/vonage.ts') continue
  const code = sansCommentaires(read(f))
  if (/\bsendSms\s*\(/.test(code) || /from '@\/lib\/sms\/vonage'/.test(code)) appelants.push(f)
}
ok('un seul module atteint l’envoyeur de SMS de notification',
  appelants.length === 1 && appelants[0] === 'lib/notifications/dispatch.ts',
  `atteint par : ${appelants.join(', ') || 'personne'} — tout autre appelant contourne la fermeture`)

// Et personne ne vise l'API SMS directement, hors de l'envoyeur.
const urlDirecte = []
for (const f of SOURCES) {
  if (f === 'lib/sms/vonage.ts') continue
  if (/rest\.nexmo\.com/.test(sansCommentaires(read(f)))) urlDirecte.push(f)
}
ok('personne n’appelle l’API SMS en direct', urlDirecte.length === 0, urlDirecte.join(', '))

// ═══════════════════════════════════════════════════════════════════════════
titre('(D) AUCUN RÉGLAGE NE PROMET UN SMS QU’ON N’ENVERRA PAS')
// ═══════════════════════════════════════════════════════════════════════════

const CATALOG = sansCommentaires(read('lib/notifications/catalog.ts'))
const PREFS_ROUTE = sansCommentaires(read('app/api/me/notification-preferences/route.ts'))

ok('la disponibilité d’un canal exige qu’il soit ouvert',
  /if \(!canalOuvert\(channel\)\) return false/.test(CATALOG),
  'sans cela on accepte et on STOCKE une préférence SMS que rien n’honore')
ok('les réglages servis sont réduits aux canaux ouverts',
  /canauxOuvertsDe\(def\.channels\)/.test(PREFS_ROUTE),
  'l’écran rend ce que le serveur lui donne : servir une ligne SMS y remet un interrupteur inerte')

// ═══════════════════════════════════════════════════════════════════════════
titre('(E) EN SENS INVERSE — LES OTP RESTENT JOIGNABLES')
// ═══════════════════════════════════════════════════════════════════════════

//   Sans cette section, on est à un lot de casser l'inscription en croyant
//   nettoyer. Elle vérifie que le chemin d'authentification est ENTIER.
const ROUTES_OTP = [
  ['app/api/auth/public/send-phone-otp/route.ts', 'envoi OTP inscription (public)'],
  ['app/api/auth/send-phone-otp/route.ts', 'envoi OTP compte connecté'],
  ['app/api/auth/public/verify-phone-otp/route.ts', 'vérification OTP inscription (public)'],
  ['app/api/auth/verify-phone-otp/route.ts', 'vérification OTP compte connecté'],
  ['app/api/auth/public/cancel-phone-otp/route.ts', 'annulation OTP'],
]
for (const [f, quoi] of ROUTES_OTP) {
  ok(`${quoi} : la route existe`, existe(f), 'chemin d’authentification supprimé')
  if (!existe(f)) continue
  const code = sansCommentaires(read(f))
  ok(`${quoi} : vise bien l’API Verify (jamais l’API SMS)`,
    /api\.nexmo\.com\/v2\/verify/.test(code) && !/rest\.nexmo\.com/.test(code),
    'un OTP routé vers l’API SMS tomberait avec le canal fermé')
  ok(`${quoi} : n’emprunte NI le dispatcher NI l’envoyeur de notification`,
    !/dispatchNotificationsForUsers|sendSms|lib\/sms\/vonage/.test(code),
    'les deux chemins se croiseraient : fermer l’un casserait l’autre')
}
// L'envoi effectif du SMS d'OTP se fait par le workflow Vonage : il doit rester.
const ENVOI_OTP = sansCommentaires(read('app/api/auth/public/send-phone-otp/route.ts'))
ok('l’OTP demande bien un SMS au fournisseur',
  /workflow: \[\{ channel: 'sms', to: phoneVonage \}\]/.test(ENVOI_OTP),
  'sans ce workflow, plus aucun code n’arrive : l’inscription est cassée')
ok('l’appel d’envoi de l’OTP est bien effectué',
  /await fetch\(VONAGE_VERIFY_V2_BASE/.test(ENVOI_OTP))

// ═══════════════════════════════════════════════════════════════════════════
titre('(F) LE CODE DE LA V2 EST CONSERVÉ, PAS DÉMOLI')
// ═══════════════════════════════════════════════════════════════════════════

ok('l’envoyeur de SMS existe toujours', existe('lib/sms/vonage.ts'))
ok('le gabarit SMS existe toujours', existe('lib/sms/templates.ts'))
ok('runChannel sait toujours traiter le canal SMS',
  /channel === 'sms'/.test(DISPATCH),
  'la mécanique doit rester : on coupe l’emprunt du canal, on ne démolit pas la route')

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n━━━ ${echecs === 0 ? 'TOUT VERT' : `${echecs} ÉCHEC(S)`} ━━━\n`)
process.exit(echecs === 0 ? 0 : 1)

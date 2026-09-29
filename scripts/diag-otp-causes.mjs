#!/usr/bin/env node
// scripts/diag-otp-causes.mjs — CHAQUE ÉCHEC DU SMS DE VÉRIFICATION DIT SA CAUSE, ET « TEMPORAIREMENT » N'EST DIT
// QUE QUAND C'EST VRAI (§E.86).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI (29/09/2026) : sur staging, « Envoyer SMS » répondait « Service SMS temporairement indisponible ».
//   Six causes y menaient — une clé absente du déploiement (`missing_env`, inconnu de l'écran), des identifiants
//   refusés (401), un crédit épuisé (402, ou 403 `out-of-credit`), un compte suspendu, un 403 `forbidden`, et la
//   vraie panne — et une seule ligne de journal, sans cause.
//
// CE QU'IL FAIT
//   A. `lireRefusVonage` EXÉCUTÉ sur les réponses que la référence des erreurs de Vonage documente
//      (developer.vonage.com/en/api-errors, lue le 29/09/2026) : chacune rend sa CAUSE et le bon CODE d'écran ;
//      `vonage_error` (« temporairement ») n'est rendu QUE pour une panne 5xx, un fournisseur injoignable ou une
//      réponse illisible ; tout ce qui dépend de NOUS rend `sms_non_configure` ;
//   B. les quatre routes OTP passent par le module pour CHAQUE refus : clé absente, injoignable, refus lu,
//      réponse illisible, limiteur absent, jeton non signable — plus aucun `missing_env` ni `vonage_error` écrit
//      à la main, plus aucun « trop d'essais » pour un limiteur absent ;
//   C. l'écran : `sms_non_configure` a son message (à l'envoi ET à la vérification), et une panne n'est plus
//      dite « code invalide ».
//
// CE QU'IL NE VOIT PAS : ce que Vonage répond VRAIMENT sur le compte de staging — la ligne `[otp] … — <cause>`
//   des journaux Vercel le dit.
//
//   node scripts/diag-otp-causes.mjs   → statique et exécuté, aucun accès base ni réseau.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)
const sansCommentaires = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')

const M = await import(pathToFileURL(join(ROOT, 'lib/otp/vonage-refus.ts')).href)
const T = (fragment) => `https://developer.vonage.com/api-errors#${fragment}`

// ── A. LES RÉPONSES DE VONAGE, EXÉCUTÉES ─────────────────────────────────────
section('A. Chaque réponse documentée de Vonage rend sa cause et le bon code d’écran')
const CAS = [
  // [ statut, corps problem+json, cause attendue, code d'écran attendu ]
  [401, { type: T('unauthorized'), title: 'Invalid credentials supplied' }, 'vonage_identifiants_refuses', 'sms_non_configure'],
  [401, { type: T('invalid-api-key'), title: 'Invalid API Key' }, 'vonage_identifiants_refuses', 'sms_non_configure'],
  [401, null, 'vonage_identifiants_refuses', 'sms_non_configure'],
  [402, { type: T('low-balance'), title: 'Low balance' }, 'vonage_credit_insuffisant', 'sms_non_configure'],
  [403, { type: T('out-of-credit'), title: 'Out of credit' }, 'vonage_credit_insuffisant', 'sms_non_configure'],
  [403, { type: T('account-suspended'), title: 'Account suspended' }, 'vonage_compte_suspendu', 'sms_non_configure'],
  [403, { type: T('forbidden'), title: 'Forbidden', detail: 'Your account does not have permission to perform this action' }, 'vonage_acces_refuse', 'sms_non_configure'],
  [403, { title: 'Forbidden', detail: 'The destination country is restricted' }, 'vonage_destination_refusee', 'sms_pays_non_pris_en_charge'],
  [422, { type: T('fraud-check'), title: 'Fraud check' }, 'vonage_antifraude', 'sms_pays_non_pris_en_charge'],
  [409, { type: T('concurrent'), title: 'Conflict', detail: 'Concurrent verifications to the same number are not allowed' }, 'vonage_verification_en_cours', 'verification_en_cours'],
  [429, { type: T('throttled'), title: 'Rate Limit Hit' }, 'vonage_limite_de_debit', 'rate_limited'],
  [422, { type: T('invalid-params'), title: 'Invalid params', detail: 'The value of one or more parameters is invalid' }, 'vonage_parametres_refuses', 'vonage_invalid_request'],
  [500, { title: 'Internal Error' }, 'vonage_panne', 'vonage_error'],
  [503, null, 'vonage_panne', 'vonage_error'],
  [418, null, 'vonage_reponse_inconnue', 'vonage_error'],
]
for (const [status, corps, cause, code] of CAS) {
  const r = M.lireRefusVonage(status, corps)
  ok(r.cause === cause && r.code === code,
    `A. ${status} ${corps?.type ? `#${corps.type.split('#')[1]}` : (corps?.title ?? 'sans corps')} → ${cause} · ${code}`,
    `obtenu ${r.cause} · ${r.code}`)
}
const inj = M.vonageInjoignable(Object.assign(new Error('aborted'), { name: 'AbortError' }))
const res = M.vonageInjoignable(new TypeError('fetch failed'))
ok(inj.cause === 'vonage_delai_depasse' && res.cause === 'vonage_injoignable' && inj.code === 'vonage_error' && res.code === 'vonage_error',
  'A. délai dépassé et réseau : deux causes, « temporairement » (vrai)')
const abs = M.identifiantsVonageAbsents(), jet = M.jetonTelephoneNonSignable(new Error('x')), lim = M.limiteurIndisponible()
ok([abs, jet, lim].every((e) => e.code === 'sms_non_configure' && e.status === 503)
   && abs.cause === 'vonage_identifiants_absents' && jet.cause === 'jeton_telephone_non_signable' && lim.cause === 'limiteur_indisponible',
  'A. clé absente, jeton non signable, limiteur absent : « de notre côté », jamais « temporairement »')
// « temporairement » (vonage_error) : SEULEMENT la panne, le réseau, l'illisible, l'inconnu.
const src = read('lib/otp/vonage-refus.ts')
const causesDeclarees = [...(/export type CauseOtp =([\s\S]*?)\n\n/.exec(src)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
const couvertes = new Set([...CAS.map((c) => c[2]), inj.cause, res.cause, abs.cause, jet.cause, lim.cause, M.reponseVonageIllisible(200).cause])
const nonEprouvees = causesDeclarees.filter((c) => !couvertes.has(c))
ok(causesDeclarees.length >= 17 && nonEprouvees.length === 0, `A. chacune des ${causesDeclarees.length} causes déclarées est éprouvée ici`, nonEprouvees.join(', ') || 'type CauseOtp illisible')

// ── B. LES QUATRE ROUTES ─────────────────────────────────────────────────────
section('B. Les quatre routes OTP passent par le module pour chaque refus')
const ROUTES = {
  'app/api/auth/public/send-phone-otp/route.ts': { envoi: true },
  'app/api/auth/send-phone-otp/route.ts': { envoi: true },
  'app/api/auth/public/verify-phone-otp/route.ts': { envoi: false, public: true },
  'app/api/auth/verify-phone-otp/route.ts': { envoi: false },
}
for (const [f, o] of Object.entries(ROUTES)) {
  const c = sansCommentaires(read(f))
  const manques = []
  if (!/if \(!apiKey \|\| !apiSecret\) return reponseErreurOtp\([^)]*identifiantsVonageAbsents\(\)\)/.test(c)) manques.push('clé absente')
  if (!/catch \(err\) \{\s*return reponseErreurOtp\([^)]*vonageInjoignable\(err\)\)/.test(c)) manques.push('injoignable')
  if (!/reponseErreurOtp\([^)]*lireRefusVonage\(res\.status, payload\)\)/.test(c)) manques.push('refus lu')
  if (o.envoi && !/reponseErreurOtp\([^)]*reponseVonageIllisible\(res\.status\)\)/.test(c)) manques.push('réponse illisible')
  if (o.public && !/if \(!admin\) return reponseErreurOtp\([^)]*limiteurIndisponible\(\)\)/.test(c)) manques.push('limiteur absent')
  if (o.public && !/reponseErreurOtp\([^)]*jetonTelephoneNonSignable\(err\)\)/.test(c)) manques.push('jeton non signable')
  if (/code: 'missing_env'|code: 'vonage_error'/.test(c)) manques.push('un code écrit à la main')
  ok(manques.length === 0, `B. ${f}`, manques.join(', ') || undefined)
}
const journal = sansCommentaires(src)
ok(/console\.error\(`\[otp\] \$\{route\} — \$\{e\.cause\}`, \{ cause: e\.cause, code: e\.code/.test(journal)
   && /JSON\.stringify\(\{ error: 'OTP refused', code: e\.code \}\)/.test(journal),
  'B. chaque refus part dans les journaux avec sa CAUSE nommée ; la réponse publique ne porte que le code')
ok(/code_length: 6/.test(read('app/api/auth/send-phone-otp/route.ts')) && /code_length: 6/.test(read('app/api/auth/public/send-phone-otp/route.ts')),
  'B. les deux routes d’envoi demandent un code à 6 chiffres — les six cases de l’écran commun (§E.20)')

// ── C. L'ÉCRAN ───────────────────────────────────────────────────────────────
section('C. L’écran dit « de notre côté » quand c’est vrai, et « temporairement » seulement quand c’est vrai')
const champ = sansCommentaires(read('components/PhoneOtpField.tsx'))
ok(/case 'sms_non_configure':\s*case 'missing_env':\s*return labels\.non_configure/.test(champ),
  'C. l’envoi : sms_non_configure (et l’ancien missing_env) ont leur message')
ok(/if \(json\.code === 'sms_non_configure' \|\| json\.code === 'missing_env' \|\| json\.code === 'vonage_error'\) \{[\s\S]{0,200}?setPhoneError\(messagePour\(json\.code\)\)/.test(champ),
  'C. la vérification : une panne ou une configuration absente n’est plus dite « code invalide »')
const appelants = ['app/[locale]/inscription/[role]/page.tsx', 'app/[locale]/inscription/organisation/page.tsx', 'components/settings/SettingsView.tsx']
const sansLabel = appelants.filter((f) => !/non_configure: t\('(errors\.sms_non_configure|error_sms_non_configure)'\)/.test(read(f)))
ok(sansLabel.length === 0, 'C. les trois écrans qui envoient un SMS passent le message', sansLabel.join(', ') || undefined)

console.log(failures === 0
  ? '\n✅ Chaque échec du SMS dit sa cause au serveur ; l’écran dit « temporairement » seulement quand c’est vrai.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une cause se tait, ou l’écran ment sur sa durée`)
process.exit(failures === 0 ? 0 : 1)

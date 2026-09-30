#!/usr/bin/env node
// scripts/diag-identite-cv.mjs — UNE REQUÊTE N'AGIT QUE SOUS LE COMPTE AFFICHÉ ; LE NOM VIENT DU COMPTE, JAMAIS
// D'UN CV ; UNE ANALYSE S'ÉCRIT EN UNE FOIS OU PAS DU TOUT ; CHAQUE REFUS DIT SA RAISON (§E.87).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI (30/09/2026, staging) : un compte d'essai freelance, puis l'admin connecté dans le MÊME navigateur. Le
//   menu est resté sur « Mehdi » (lu une fois au montage) pendant que chaque requête partait sous l'admin :
//   « Bonjour Youssef », « Mon profil » refusé (« réservée aux experts freelance »), le CV refusé
//   (`wrong_user_type`) et affiché « une erreur est survenue ».
//
// CE QU'IL FAIT
//   A. LA SÉQUENCE DES DEUX COMPTES, EXÉCUTÉE sur `verdictCompte` (client ET serveur l'utilisent) ; et le
//      câblage : `useSecureFetch` n'envoie pas sous un autre compte et déclare le compte affiché ; `requireAuth`
//      refuse un jeton d'un autre compte ; la coquille, l'admin et les trois écrans du constat écoutent/lisent
//      la session par le compte affiché ; l'écran de connexion dit pourquoi ;
//   B. LE NOM : l'analyseur n'extrait aucun nom ; la route du CV n'écrit pas `users` ; la fonction d'écriture
//      de l'analyse ne cite pas `users` ;
//   C. L'ATOMICITÉ : la route n'écrit plus les listes ni le statut `done` elle-même — une seule fonction, qui
//      pose le statut EN DERNIER ; un échec rend `analyse_non_ecrite` ;
//   D. LES MESSAGES : chaque code que la route peut rendre a son message (quatre langues), l'écran n'a plus de
//      « une erreur est survenue », un code inconnu est CITÉ ; « Mon profil » dit la vraie raison de chaque
//      refus, en pleine largeur.
//
// CE QU'IL NE VOIT PAS : un navigateur réel (deux onglets, la diffusion de session de supabase-js) — l'essai
//   de Youssef le dit ; la transaction elle-même — `supabase/tests/database/profil/analyse_cv.test.sql` la prouve.
//
//   node scripts/diag-identite-cv.mjs   → statique et exécuté, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync } from 'node:fs'
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
  .split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')
const LANGUES = ['fr', 'en', 'es', 'de']
const messages = Object.fromEntries(LANGUES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
const lireCle = (o, chemin) => chemin.split('.').reduce((a, k) => a?.[k], o)

// ── A. DEUX COMPTES DANS LE MÊME NAVIGATEUR ──────────────────────────────────
section('A. Deux comptes dans le même navigateur : jamais un mélange')
const { verdictCompte, ENTETE_COMPTE_AFFICHE, CODE_COMPTE_DIFFERENT } =
  await import(pathToFileURL(join(ROOT, 'lib/identite/verdict.ts')).href)
const MEHDI = 'aaaaaaaa-0000-4000-8000-00000000000a', ADMIN = 'bbbbbbbb-0000-4000-8000-00000000000b'
// 1. L'onglet s'ouvre sur le compte d'essai : rien d'affiché encore, puis le menu affiche Mehdi.
ok(verdictCompte(null, MEHDI) === 'inconnu', '1. premier chargement : rien à comparer')
ok(verdictCompte(MEHDI, MEHDI) === 'meme', '2. le menu affiche Mehdi, la session est Mehdi : la requête part')
// 3. L'admin se connecte dans le MÊME navigateur : la session de l'adresse devient la sienne, pour tous les onglets.
ok(verdictCompte(MEHDI, ADMIN) === 'different', '3. le menu affiche Mehdi, la session est l’admin : REFUS (client et serveur)')
ok(verdictCompte(MEHDI, null) === 'different', '4. le menu affiche Mehdi, plus aucune session : REFUS')

const sf = sansCommentaires(read('lib/secure-fetch.ts'))
const iVerdict = sf.indexOf("if (verdictCompte(affiche, session?.user?.id) === 'different')")
const iFetch = sf.indexOf('const res = await fetch(input')
ok(iVerdict > 0 && iFetch > iVerdict && /ejecterCompteDifferent\(\)\s*return new Response\(/.test(sf.slice(iVerdict, iFetch)),
  'A. useSecureFetch n’ENVOIE PAS une requête sous un autre compte que celui affiché — il éjecte l’onglet')
ok(/if \(affiche\) headers\.set\(ENTETE_COMPTE_AFFICHE, affiche\)/.test(sf) && /payload\?\.code === CODE_COMPTE_DIFFERENT\) \{\s*ejecterCompteDifferent\(\)/.test(sf),
  'A. chaque requête déclare le compte affiché, et le refus du serveur éjecte aussi')
const ag = sansCommentaires(read('lib/auth-guard.ts'))
const iJeton = ag.indexOf("code: 'invalid_token'")
const iRefus = ag.indexOf('verdictCompte(compteAffiche, userInfo.user.id)')
const iSession = ag.indexOf('readSessionCookieToken(request)')
ok(ENTETE_COMPTE_AFFICHE === 'x-compte-affiche' && CODE_COMPTE_DIFFERENT === 'compte_different'
   && /const compteAffiche = request\.headers\.get\(ENTETE_COMPTE_AFFICHE\)/.test(ag)
   && iRefus > iJeton && iRefus < iSession
   && /=== 'different'\) \{[\s\S]{0,400}?throw new AuthError\(403, \{[^}]*code: CODE_COMPTE_DIFFERENT/.test(ag.slice(iRefus - 80)),
  'A. requireAuth REFUSE (403 compte_different) un jeton qui n’est pas celui du compte affiché, avant toute autre garde')
const shell = sansCommentaires(read('components/shell/DashboardShell.tsx'))
ok(/useGardeCompteAffiche\(idAffiche\)/.test(shell) && /const session = await sessionDuCompteAffiche\(\)/.test(shell) && /setIdAffiche\(session\.user\.id\)/.test(shell),
  'A. la coquille retient le compte qu’elle affiche et éjecte si un autre prend la main — le menu montre toujours le compte qui agit')
const admin = sansCommentaires(read('app/[locale]/admin/layout.tsx'))
ok(/useGardeCompteAffiche\(idAffiche\)/.test(admin) && /const session = await sessionDuCompteAffiche\(\)/.test(admin),
  'A. l’administration aussi')
const ecrans = ['app/[locale]/dashboard/freelance/page.tsx', 'app/[locale]/dashboard/freelance/mon-profil/page.tsx']
const sansGarde = ecrans.filter((f) => {
  const c = sansCommentaires(read(f))
  return !/const session = await sessionDuCompteAffiche\(\)\s*if \(session === 'ejecte'\) return/.test(c) || /supabase\.auth\.getSession\(\)/.test(c)
})
ok(sansGarde.length === 0, 'A. la salutation et « Mon profil » lisent l’identité par le compte affiché', sansGarde.join(', ') || undefined)
const ca = sansCommentaires(read('lib/identite/compte-affiche.ts'))
ok(/supabase\.auth\.onAuthStateChange/.test(ca) && /addEventListener\('visibilitychange'/.test(ca)
   && /signOut\(\{ scope: 'local' \}\)/.test(ca) && /connexion\?reason=\$\{CODE_COMPTE_DIFFERENT\}/.test(ca)
   && !/localStorage|sessionStorage|document\.cookie/.test(ca),
  'A. la garde écoute la session (et le retour sur l’onglet), déconnecte proprement, et ne garde AUCUNE copie dans le navigateur')
const connexion = sansCommentaires(read('app/[locale]/connexion/page.tsx'))
const sansTexte = LANGUES.filter((l) => !['compte_different_title', 'compte_different_message'].every((k) => typeof messages[l].session?.[k] === 'string'))
// Le motif reconnu ET son texte affiché (la mutation l’a dit : reconnaître le motif puis afficher le texte
// d’un autre restait vert).
ok(/reason === 'compte_different' \? 'compte_different'/.test(connexion)
   && /bannerKind === 'compte_different' \? tSession\('compte_different_title'\)/.test(connexion)
   && /bannerKind === 'compte_different' \? tSession\('compte_different_message'\)/.test(connexion)
   && sansTexte.length === 0,
  'A. l’écran de connexion dit pourquoi, dans les quatre langues', sansTexte.join(', ') || undefined)

// ── B. LE NOM VIENT DU COMPTE ────────────────────────────────────────────────
section('B. Le prénom et le nom viennent du compte, jamais d’un CV')
const parseur = sansCommentaires(read('lib/cv-parser.ts'))
ok(!/first_?name|last_?name|full_?name|prenom|nom_complet/i.test(parseur),
  'B. l’analyseur de CV n’extrait aucun nom de personne')
const route = sansCommentaires(read('app/api/profile/upload-cv/route.ts'))
ok(!/\.from\('users'\)\s*\.(update|upsert|insert)/.test(route) && !/first_name|last_name/.test(route),
  'B. la route du CV n’écrit pas le compte (users)')
const migrations = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
let corpsSql = ''
for (const f of migrations) {
  const sql = read(`supabase/migrations/${f}`)
  const m = /create or replace function public\.appliquer_analyse_cv\([\s\S]*?\$fn\$([\s\S]*?)\$fn\$/.exec(sql)
  if (m) corpsSql = m[1].split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
}
ok(corpsSql.length > 0 && !/public\.users\b|\busers\s+set\b/i.test(corpsSql),
  'B. la fonction qui écrit l’analyse ne touche pas users (la clé first_name d’un CV n’a nulle part où aller)')

// ── C. L'ANALYSE S'ÉCRIT EN UNE FOIS ─────────────────────────────────────────
section('C. Une analyse s’écrit en une fois, ou pas du tout')
const ecritures = [...route.matchAll(/\.from\('(profile_experiences|profile_educations|profile_languages)'\)\s*\.(delete|insert|update|upsert)/g)].map((m) => `${m[1]}.${m[2]}`)
ok(ecritures.length === 0, 'C. la route n’écrit plus les listes elle-même (plus de supprimer-puis-réinsérer en appels séparés)', ecritures.join(', ') || undefined)
ok(!/cv_parsing_status: 'done'/.test(route), 'C. la route ne pose plus le statut done elle-même')
ok(/await supabaseAdmin\.rpc\('appliquer_analyse_cv', \{/.test(route)
   && /if \(analyseErr\) \{[\s\S]{0,1400}?code: 'analyse_non_ecrite' \}, 500\)/.test(route),
  'C. une seule fonction écrit l’analyse ; son échec rend analyse_non_ecrite (rien n’a été modifié)')
const iListes = corpsSql.lastIndexOf('profile_languages')
const iDone = corpsSql.indexOf("cv_parsing_status = 'done'")
ok(iDone > iListes && iListes > 0, 'C. la fonction pose le statut done EN DERNIER, après les listes')

// ── D. LES MESSAGES ──────────────────────────────────────────────────────────
section('D. Chaque refus dit sa raison')
const { MESSAGE_PAR_CODE, cleMessageDepotCv } = await import(pathToFileURL(join(ROOT, 'lib/profil/refus-depot-cv.ts')).href)
const codesRoute = [...new Set([...route.matchAll(/code: '([a-z_]+)'/g)].map((m) => m[1]))]
const nonCouverts = codesRoute.filter((c) => !(c in MESSAGE_PAR_CODE))
ok(codesRoute.length >= 18 && nonCouverts.length === 0,
  `D. chacun des ${codesRoute.length} codes rendus par la route du CV a son message`, nonCouverts.join(', ') || undefined)
const cles = [...new Set(Object.values(MESSAGE_PAR_CODE)), 'inattendu', 'reseau']
const manquants = []
for (const l of LANGUES) for (const k of cles) if (typeof lireCle(messages[l], `profile_upload.errors.${k}`) !== 'string') manquants.push(`${l}:${k}`)
ok(manquants.length === 0, `D. chaque message existe dans les quatre langues (${cles.length} clés)`, manquants.join(', ') || undefined)
ok(cleMessageDepotCv('wrong_user_type') === 'mauvais_type' && cleMessageDepotCv('code_jamais_vu') === 'inattendu' && cleMessageDepotCv(undefined) === 'inattendu'
   && LANGUES.every((l) => (lireCle(messages[l], 'profile_upload.errors.inattendu') ?? '').includes('{code}')),
  'D. le refus du constat (wrong_user_type) dit sa raison ; un code inconnu est CITÉ')
const depot = sansCommentaires(read('app/[locale]/dashboard/freelance/profil/page.tsx'))
ok(!/errors\.generic/.test(depot) && /const cle = cleMessageDepotCv\(code\)/.test(depot),
  'D. l’écran de dépôt n’a plus de « une erreur est survenue »')
const mp = sansCommentaires(read('app/[locale]/dashboard/freelance/mon-profil/page.tsx'))
const refus = ['lecture_compte', 'compte_absent', 'lecture_profil', 'inattendu', 'pas_freelance_titre', 'pas_freelance']
const refusManquants = []
for (const l of LANGUES) for (const k of refus) if (typeof lireCle(messages[l], `profile_view.refus.${k}`) !== 'string') refusManquants.push(`${l}:${k}`)
ok(refusManquants.length === 0 && refus.every((k) => mp.includes(`t('refus.${k}'`)) && /setForbidden\(\(userRow\.user_type as string \| null\) \?\? 'inconnu'\)/.test(mp),
  '« Mon profil » dit la vraie raison de chaque refus — dont le TYPE du compte connecté', refusManquants.join(', ') || undefined)
// La PROPRIÉTÉ, pas une ancienne valeur (§E.34 — la mutation l’a dit : la version qui cherchait `maxWidth: 480`
// restait verte sur `maxWidth: 560, margin: '0 auto'`). Les deux panneaux, de `if (forbidden)` à la fin du bloc
// `if (errorMsg && !profile)` : aucune largeur bornée, aucun centrage, 24 px de marge.
const debutRefus = mp.indexOf('if (forbidden)')
const debutErreur = mp.indexOf('if (errorMsg && !profile)')
const blocRefus = debutRefus >= 0 && debutErreur > debutRefus ? mp.slice(debutRefus, mp.indexOf('\n  }\n', debutErreur) + 4) : ''
const centrage = /maxWidth|minWidth|margin:\s*'[^']*auto|margin(Inline|Left|Right):\s*'auto'|textAlign:\s*'center'|justifyContent:\s*'center'|alignItems:\s*'center'|placeItems|placeContent/.exec(blocRefus)
ok(blocRefus.length > 0 && !centrage && (blocRefus.match(/fontFamily: fontJakarta, padding: 24 \}/g) ?? []).length === 2,
  'D. ses panneaux de refus sont en pleine largeur, alignés à gauche',
  blocRefus ? (centrage ? `centrage ou largeur bornée : ${centrage[0]}` : 'la marge de 24 px manque à un panneau') : 'les panneaux de refus sont introuvables')

console.log(failures === 0
  ? '\n✅ Une requête n’agit que sous le compte affiché ; le nom vient du compte ; l’analyse s’écrit en une fois ; chaque refus dit sa raison.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC`)
process.exit(failures === 0 ? 0 : 1)

#!/usr/bin/env node
// scripts/diag-hotes-ecosysteme.mjs — L'ÉCOSYSTÈME SE LIT DANS L'ADRESSE, PAR LA MÊME RÈGLE EN PRODUCTION ET SUR
// STAGING ; SEULE LA RACINE DIFFÈRE. Une adresse qui n'en porte pas ne résout rien, et le dit.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (29/09/2026, §E.83)
//   Sur la Preview Vercel, le formulaire expert n'avait ni branche ni spécialité : l'hôte
//   `<déploiement>.vercel.app` a trois labels, et la règle « premier label » en tirait le NOM DU
//   DÉPLOIEMENT. 423 tests pgTAP verts : aucun ne passe par un HÔTE. Un premier correctif donnait
//   l'écosystème à la Preview par DEV_DOMAIN_SLUG — REFUSÉ par Youssef : staging se comporte EXACTEMENT
//   comme la production. La règle : `<écosystème>.<racine>`, la racine seule différant
//   (NEXT_PUBLIC_DOMAINE_RACINE : skilloria.io, staging.skilloria.io) ; DEV_DOMAIN_SLUG au poste local seul.
//
// LA PROPRIÉTÉ — éprouvée en EXÉCUTANT lib/subdomain.ts et lib/ecosystem-url.ts, environnement par
// environnement (variables posées et retirées), jamais en relisant leur texte :
//   A. production : `<éco>.skilloria.io` rend son slug ; la racine, l'alias `.vercel.app` et une adresse
//      de staging rendent null ; DEV_DOMAIN_SLUG n'y est jamais lue ;
//   B. staging : `<éco>.staging.skilloria.io` rend son slug — TOUT slug, sans réglage (un écosystème créé
//      dans l'admin y fonctionne aussitôt) ; la racine, une Preview aléatoire, une adresse de production
//      rendent null ; DEV_DOMAIN_SLUG n'y est jamais lue ;
//   C. une configuration absente LÈVE en nommant sa variable (la racine hors local, DEV_DOMAIN_SLUG en local) ;
//   D. le sélecteur reste dans son environnement, et l'aller-retour résolveur ↔ sélecteur ↔ adresse tient ;
//   E. une seule résolution ; aucune adresse d'environnement écrite dans le code de la règle ; les liens
//      d'e-mail passent par l'adresse de l'écosystème ; /api/taxonomy nomme chaque panne au serveur ;
//      aucun diagnostic à la console du navigateur sur les écrans publics.
// CE QU'IL NE VOIT PAS, ET LE DIT : les variables réellement posées sur Vercel, et les enregistrements DNS —
//   la réponse de /api/taxonomy sur une adresse de staging le dit (codes nommés), et les journaux Vercel.
//
//   node scripts/diag-hotes-ecosysteme.mjs   → statique + exécution pure, aucun accès base ni réseau.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const fichiers = (d, o = []) => {
  for (const e of readdirSync(join(ROOT, d))) {
    const p = `${d}/${e}`
    if (statSync(join(ROOT, p)).isDirectory()) fichiers(p, o); else if (/\.tsx?$/.test(e)) o.push(p)
  }
  return o
}

const { resolveSubdomainFromHost, adresseEcosysteme } = await import(pathToFileURL(join(ROOT, 'lib/subdomain.ts')).href)
const { swapEcosystemHost } = await import(pathToFileURL(join(ROOT, 'lib/ecosystem-url.ts')).href)

const VARS = ['VERCEL_ENV', 'NEXT_PUBLIC_DOMAINE_RACINE', 'DEV_DOMAIN_SLUG']
const avant = Object.fromEntries(VARS.map((k) => [k, process.env[k]]))
const dans = (env, fn) => {
  for (const k of VARS) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k] }
  try { return fn() } finally {
    for (const k of VARS) { if (avant[k] === undefined) delete process.env[k]; else process.env[k] = avant[k] }
  }
}
const rend = (env, hote) => dans(env, () => { try { return resolveSubdomainFromHost(hote) } catch (e) { return `LÈVE:${e.message}` } })

const PREVIEW = 'skilloria-git-feat-sprint-archi-orga-cheri.vercel.app'
// DEV_DOMAIN_SLUG est posée PARTOUT ci-dessous, exprès : aucun environnement déployé ne doit la lire.
const PROD = { VERCEL_ENV: 'production', NEXT_PUBLIC_DOMAINE_RACINE: 'skilloria.io', DEV_DOMAIN_SLUG: 'piege-dev' }
const STAGING = { VERCEL_ENV: 'preview', NEXT_PUBLIC_DOMAINE_RACINE: 'staging.skilloria.io', DEV_DOMAIN_SLUG: 'piege-dev' }
console.log('\n═══ L’écosystème se lit dans l’adresse — même règle en production et sur staging ═══\n')

// ── A. PRODUCTION ──
ok(rend(PROD, 'microsoft.skilloria.io') === 'microsoft', 'A. production : `<éco>.skilloria.io` rend son slug')
ok(rend(PROD, 'microsoft.skilloria.io:443') === 'microsoft', 'A. production : le port ne change rien')
ok(rend(PROD, 'skilloria.io') === null, 'A. production : la racine ne porte pas d’écosystème (null, jamais de repli)')
ok(rend(PROD, 'skilloria-chi.vercel.app') === null, 'A. production : l’alias `.vercel.app` rend null — DEV_DOMAIN_SLUG n’est pas lue')
ok(rend(PROD, 'microsoft.staging.skilloria.io') === null, 'A. production : une adresse de staging n’est pas servie par la production')

// ── B. STAGING : LA MÊME RÈGLE, UNE AUTRE RACINE ──
ok(rend(STAGING, 'microsoft.staging.skilloria.io') === 'microsoft', 'B. staging : `<éco>.staging.skilloria.io` rend son slug')
ok(rend(STAGING, 'nouvel-eco.staging.skilloria.io') === 'nouvel-eco',
  'B. staging : un écosystème créé dans l’admin fonctionne SANS RÉGLAGE — son adresse existe dès qu’il existe')
ok(rend(STAGING, PREVIEW) === null, `B. staging : l’adresse aléatoire « ${PREVIEW} » ne résout RIEN (le cas du 29/09/2026)`,
  `rendu : ${rend(STAGING, PREVIEW)} — une Preview ne reçoit pas d’écosystème par une variable (décision de Youssef)`)
ok(rend(STAGING, 'staging.skilloria.io') === null, 'B. staging : la racine elle-même ne porte pas d’écosystème')
ok(rend(STAGING, 'microsoft.skilloria.io') === null, 'B. staging : une adresse de PRODUCTION n’est pas servie par staging')
ok(rend(STAGING, 'a.b.staging.skilloria.io') === null, 'B. staging : deux labels devant la racine ne font pas un écosystème')

// ── C. UNE CONFIGURATION ABSENTE SE NOMME ──
const sansRacine = rend({ VERCEL_ENV: 'preview', NEXT_PUBLIC_DOMAINE_RACINE: undefined, DEV_DOMAIN_SLUG: 'piege-dev' }, 'microsoft.staging.skilloria.io')
ok(String(sansRacine).startsWith('LÈVE:') && /NEXT_PUBLIC_DOMAINE_RACINE/.test(sansRacine),
  'C. déployé sans racine : le résolveur LÈVE en nommant NEXT_PUBLIC_DOMAINE_RACINE — jamais une règle de repli')
ok(String(rend({ VERCEL_ENV: undefined, NEXT_PUBLIC_DOMAINE_RACINE: undefined, DEV_DOMAIN_SLUG: undefined }, 'localhost:3000')).startsWith('LÈVE:'),
  'C. localhost sans DEV_DOMAIN_SLUG : lève aussi')
ok(rend({ VERCEL_ENV: undefined, NEXT_PUBLIC_DOMAINE_RACINE: undefined, DEV_DOMAIN_SLUG: 'poste-local' }, 'localhost:3000') === 'poste-local',
  'C. le poste local, et lui seul, lit DEV_DOMAIN_SLUG')

// ── D. LE SÉLECTEUR RESTE DANS SON ENVIRONNEMENT ; L'ALLER-RETOUR TIENT ──
dans(STAGING, () => {
  ok(swapEcosystemHost('microsoft.staging.skilloria.io', 'sap') === 'sap.staging.skilloria.io',
    'D. staging : le sélecteur mène vers le voisin DE STAGING')
  ok(swapEcosystemHost('staging.skilloria.io', 'sap') === null && swapEcosystemHost(PREVIEW, 'sap') === null,
    'D. staging : aucune bascule depuis la racine ni depuis une Preview (elle menait en PRODUCTION, ou vers `sap.vercel.app`)')
  ok(swapEcosystemHost('microsoft.skilloria.io', 'sap') === null, 'D. staging : le sélecteur ne fabrique pas d’adresse de production')
  const aller = swapEcosystemHost('microsoft.staging.skilloria.io:3000', 'sap')
  ok(aller === 'sap.staging.skilloria.io:3000' && resolveSubdomainFromHost(aller) === 'sap'
     && resolveSubdomainFromHost(new URL(adresseEcosysteme('sap')).host) === 'sap',
    'D. staging : aller-retour — sélecteur → résolveur, adresse d’écosystème → résolveur')
})
dans(PROD, () => {
  ok(swapEcosystemHost('microsoft.skilloria.io', 'sap') === 'sap.skilloria.io' && adresseEcosysteme('sap') === 'https://sap.skilloria.io',
    'D. production : le sélecteur et l’adresse d’écosystème restent en production')
})
ok(dans({ VERCEL_ENV: undefined, NEXT_PUBLIC_DOMAINE_RACINE: undefined, DEV_DOMAIN_SLUG: 'poste-local' }, () => swapEcosystemHost('localhost:3000', 'sap')) === null,
  'D. poste local : aucune bascule par l’hôte')

// ── E. UNE RÈGLE, DES LIENS, DES CAUSES NOMMÉES ──
{
  const appelants = [...fichiers('app'), ...fichiers('lib'), 'proxy.ts']
    .filter((f) => /\bresolveSubdomainFromHost\(/.test(sansCom(read(f))))
  const permis = new Set(['lib/subdomain.ts', 'lib/inscription/ecosysteme.ts', 'proxy.ts'])
  ok(appelants.every((f) => permis.has(f)), 'E. le résolveur n’est appelé que par le proxy et ecosystemeDeLaRequete — une seule résolution pour les routes',
    appelants.filter((f) => !permis.has(f)).join(', ') || undefined)
  const regle = ['lib/subdomain.ts', 'lib/ecosystem-url.ts', 'lib/emails/domain-url.ts']
  const enDur = regle.filter((f) => /skilloria\.io|vercel\.app|'staging\./.test(sansCom(read(f))))
  ok(enDur.length === 0, 'E. aucune adresse d’environnement écrite dans le code de la règle — la racine vient de la seule variable',
    enDur.join(', ') || undefined)
  const sub = sansCom(read('lib/subdomain.ts'))
  const iDev = sub.indexOf('process.env.DEV_DOMAIN_SLUG')
  ok(iDev > 0 && /if \(isLocalHost\(hostname\)\) \{\s*const devSlug = process\.env\.DEV_DOMAIN_SLUG/.test(sub)
     && (sub.match(/process\.env\.DEV_DOMAIN_SLUG/g) ?? []).length === 1,
    'E. DEV_DOMAIN_SLUG n’est lue QUE dans la branche du poste local')
  const routesPubliques = ['app/api/taxonomy/route.ts', 'app/api/auth/public/register-expert/route.ts', 'app/api/auth/register-org/route.ts']
  const sansResolution = routesPubliques.filter((f) => !/\becosystemeDeLaRequete\(req(uest)?\)/.test(sansCom(read(f))))
  ok(sansResolution.length === 0, 'E. les routes publiques résolvent l’écosystème par l’HÔTE (ecosystemeDeLaRequete), jamais par x-subdomain',
    sansResolution.join(', ') || undefined)
  // LES LIENS D'E-MAIL : l'adresse de l'écosystème du destinataire, dans l'environnement courant.
  const liens = sansCom(read('lib/emails/domain-url.ts'))
  ok(/adresseEcosysteme\(params\.slug\)/.test(liens) && !/isProdSkilloria|APEX/.test(liens),
    'E. les liens d’e-mail sont l’adresse de l’écosystème (adresseEcosysteme) — plus de cas « production seulement »')
  const courriels = fichiers('app/api').filter((f) => /\bsiteOriginPourRequete\(/.test(sansCom(read(f))))
  const directs = courriels.filter((f) => !/\bexpertSiteOrigin\(/.test(sansCom(read(f))))
  ok(courriels.length >= 6 && directs.length === 0,
    `E. chaque route qui construit un lien d’e-mail passe par l’adresse de l’écosystème (${courriels.length})`,
    directs.length ? `origine de requête brute : ${directs.join(', ')}` : 'moins de six routes : le balayage a perdu des appelants')
  const inscriptions = ['app/api/auth/public/register-expert/route.ts', 'app/api/auth/register-org/route.ts']
  ok(inscriptions.every((f) => /redirectionConfirmation\(redirectRaw, domainSlug\)/.test(sansCom(read(f)))),
    'E. le lien de confirmation d’inscription est construit au serveur, sur l’adresse de l’écosystème résolu')
  // LA PANNE DIT SA CAUSE : chaque appel console.error(...) lu SEUL (parenthèses équilibrées, §E.8).
  const tax = sansCom(read('app/api/taxonomy/route.ts'))
  const codes = ['ecosysteme_non_configure', 'ecosysteme_non_resolu', 'ecosysteme_inconnu', 'ecosysteme_indisponible']
  const journalises = new Set()
  for (let i = tax.indexOf('console.error('); i >= 0; i = tax.indexOf('console.error(', i + 1)) {
    let prof = 0, j = i + 'console.error'.length
    for (; j < tax.length; j++) { if (tax[j] === '(') prof++; else if (tax[j] === ')' && --prof === 0) break }
    const appel = tax.slice(i, j + 1)
    for (const m of appel.matchAll(/\bcode:\s*'([a-z_]+)'/g)) journalises.add(m[1])
    if (/[{,]\s*code\s*[,}]/.test(appel)) {
      const precedente = tax.slice(0, i).split('\n').reverse().find((l) => /\bconst code = /.test(l)) ?? ''
      for (const m of precedente.matchAll(/'([a-z_]+)'/g)) journalises.add(m[1])
    }
  }
  const nonJournalises = codes.filter((c) => !journalises.has(c))
  ok(!/x-subdomain/.test(tax) && !/missing_domain_id/.test(tax) && nonJournalises.length === 0,
    'E. /api/taxonomy nomme chaque panne de résolution ET la journalise au serveur, avec son code',
    nonJournalises.length ? `sans journal : ${nonJournalises.join(', ')}` : 'x-subdomain ou missing_domain_id encore présent')
  // LE MESSAGE SE LIT (checklist 13-14) : une adresse sans écosystème ne se répare pas en rechargeant — l'écran
  // d'inscription le dit, dans les quatre langues, pour les DEUX codes qui la signifient, et pour eux seuls.
  const form = sansCom(read('app/[locale]/inscription/[role]/page.tsx'))
  const mappe = /code === 'ecosysteme_non_resolu' \|\| code === 'ecosysteme_inconnu' \? 'adresse' : 'indisponible'/.test(form)
    && /taxonomyError === 'adresse' \? t\('errors\.taxonomy_adresse_sans_ecosysteme'\) : t\('errors\.taxonomy_unavailable'\)/.test(form)
  const langues = ['fr', 'en', 'es', 'de'].filter((l) => {
    const v = JSON.parse(read(`messages/${l}.json`))?.signup_form?.errors?.taxonomy_adresse_sans_ecosysteme
    return typeof v !== 'string' || v.trim() === '' || /recharg|reload|recarg|neu laden/i.test(v)
  })
  ok(mappe && langues.length === 0,
    'E. l’inscription dit qu’une adresse sans écosystème se quitte (ecosysteme_non_resolu, ecosysteme_inconnu) — quatre langues, sans « rechargez »',
    !mappe ? 'le formulaire ne distingue plus l’adresse de l’indisponibilité' : `message absent ou non actionnable : ${langues.join(', ')}`)
  const ecrans = ['app/[locale]/inscription/[role]/page.tsx', 'app/[locale]/inscription/organisation/page.tsx',
    'app/[locale]/invitation/[token]/page.tsx', 'components/phone/SaisieTelephone.tsx', 'lib/pays/referentiel-client.ts']
  const bavards = ecrans.filter((f) => /\bconsole\.(error|log|warn|info|debug)\(/.test(sansCom(read(f))))
  ok(bavards.length === 0, 'E. aucun diagnostic à la console du navigateur sur les écrans publics d’inscription', bavards.join(', ') || undefined)
}

console.log(failures === 0
  ? '\n✅ Production et staging lisent l’écosystème dans l’adresse, par la même règle ; seule la racine diffère.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — un environnement suit une autre règle, ou une adresse sert un écosystème deviné`)
process.exit(failures === 0 ? 0 : 1)

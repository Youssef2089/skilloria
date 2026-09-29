#!/usr/bin/env node
// scripts/diag-hotes-ecosysteme.mjs — CHAQUE HÔTE OÙ LE PRODUIT EST SERVI RÉSOUT SON ÉCOSYSTÈME, OU DIT POURQUOI.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (29/09/2026, §E.83)
//   Sur la Preview Vercel, le formulaire expert n'avait ni branche ni spécialité : l'hôte
//   `<déploiement>.vercel.app` a trois labels, et la règle « premier label » en tirait le NOM DU
//   DÉPLOIEMENT. /api/taxonomy rendait 400, l'inscription expert était impossible. 423 tests pgTAP
//   verts : aucun ne passe par un HÔTE — la panne vivait entre la requête HTTP et la base. Et le
//   contrôle du sélecteur éprouvait des hôtes de production, de staging à sous-domaine et localhost —
//   jamais celui où Youssef essaie avant la production.
//
// LA PROPRIÉTÉ — éprouvée en EXÉCUTANT lib/subdomain.ts et lib/ecosystem-url.ts, environnement par
// environnement (VERCEL_ENV, DEV_DOMAIN_SLUG posés et retirés), jamais en relisant leur texte :
//   A. production : un sous-domaine rend son slug ; l'apex et l'alias `.vercel.app` rendent null ;
//   B. Preview : `<déploiement>.vercel.app` et l'hôte unique de staging reçoivent DEV_DOMAIN_SLUG ;
//      un sous-domaine de staging garde le sien ;
//   C. sans DEV_DOMAIN_SLUG, un hôte qui ne porte pas d'écosystème LÈVE, en nommant la variable ;
//   D. le sélecteur ne bascule jamais depuis un hôte qui ne porte pas d'écosystème ;
//   E. une seule résolution pour les routes publiques (ecosystemeDeLaRequete), et /api/taxonomy nomme
//      chaque panne au serveur ; aucun diagnostic à la console du navigateur sur les écrans publics.
// CE QU'IL NE VOIT PAS, ET LE DIT : la variable réellement posée sur Vercel — la réponse de
//   /api/taxonomy sur la Preview le dit (code ecosysteme_non_configure), et les journaux Vercel.
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

const { resolveSubdomainFromHost } = await import(pathToFileURL(join(ROOT, 'lib/subdomain.ts')).href)
const { swapEcosystemHost } = await import(pathToFileURL(join(ROOT, 'lib/ecosystem-url.ts')).href)

const avant = { VERCEL_ENV: process.env.VERCEL_ENV, DEV_DOMAIN_SLUG: process.env.DEV_DOMAIN_SLUG }
const dans = (env, fn) => {
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  try { return fn() } finally {
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
}
const rend = (env, hote) => dans(env, () => { try { return resolveSubdomainFromHost(hote) } catch (e) { return `LÈVE:${e.message}` } })

const PREVIEW = 'skilloria-git-feat-sprint-archi-orga-cheri.vercel.app'
console.log('\n═══ Chaque hôte résout son écosystème, ou dit pourquoi ═══\n')

// ── A. PRODUCTION ──
const PROD = { VERCEL_ENV: 'production', DEV_DOMAIN_SLUG: 'sonde-eco' }
ok(rend(PROD, 'microsoft.skilloria.io') === 'microsoft', 'A. production : un sous-domaine rend son slug')
ok(rend(PROD, 'skilloria.io') === null, 'A. production : l’apex ne porte pas d’écosystème (null, jamais de repli)')
ok(rend(PROD, 'skilloria-chi.vercel.app') === null, 'A. production : l’alias `.vercel.app` rend null — ni son nom de projet, ni la variable de Preview')

// ── B. PREVIEW ──
const PREV = { VERCEL_ENV: 'preview', DEV_DOMAIN_SLUG: 'sonde-eco' }
ok(rend(PREV, PREVIEW) === 'sonde-eco', `B. Preview : « ${PREVIEW} » reçoit DEV_DOMAIN_SLUG (le cas du 29/09/2026)`,
  `rendu : ${rend(PREV, PREVIEW)} — le premier label d’un hôte de Preview est le nom du déploiement, pas un écosystème`)
ok(rend(PREV, `${PREVIEW}:443`) === 'sonde-eco', 'B. Preview : le port ne change rien')
ok(rend(PREV, 'staging.skilloria.io') === 'sonde-eco', 'B. staging (hôte unique) : reçoit DEV_DOMAIN_SLUG, pas « staging »')
ok(rend(PREV, 'microsoft.staging.skilloria.io') === 'microsoft', 'B. staging à sous-domaine : garde son écosystème')

// ── C. LA VARIABLE ABSENTE SE NOMME ──
const SANS = { VERCEL_ENV: 'preview', DEV_DOMAIN_SLUG: undefined }
ok(String(rend(SANS, PREVIEW)).startsWith('LÈVE:') && /DEV_DOMAIN_SLUG/.test(rend(SANS, PREVIEW)),
  'C. Preview sans DEV_DOMAIN_SLUG : le résolveur LÈVE en nommant la variable — jamais un slug deviné')
ok(String(rend({ VERCEL_ENV: undefined, DEV_DOMAIN_SLUG: undefined }, 'localhost:3000')).startsWith('LÈVE:'),
  'C. localhost sans DEV_DOMAIN_SLUG : lève aussi')
ok(rend({ VERCEL_ENV: undefined, DEV_DOMAIN_SLUG: 'sonde-eco' }, 'localhost:3000') === 'sonde-eco', 'C. localhost avec la variable : son slug')

// ── D. LE SÉLECTEUR NE BASCULE PAS DEPUIS UN HÔTE SANS ÉCOSYSTÈME ──
ok(swapEcosystemHost(PREVIEW, 'sap') === null && swapEcosystemHost('skilloria-chi.vercel.app', 'sap') === null,
  'D. aucune bascule depuis `.vercel.app` (`sap.vercel.app` n’est pas à nous)')
ok(swapEcosystemHost('staging.skilloria.io', 'sap') === null,
  'D. aucune bascule depuis l’hôte unique de staging (elle mènerait en PRODUCTION)')
ok(swapEcosystemHost('microsoft.staging.skilloria.io', 'sap') === 'sap.staging.skilloria.io',
  'D. un sous-domaine de staging bascule vers son voisin de staging')

// ── E. UNE RÉSOLUTION, DES CAUSES NOMMÉES, RIEN DANS LA CONSOLE DU NAVIGATEUR ──
{
  const appelants = [...fichiers('app'), ...fichiers('lib'), 'proxy.ts']
    .filter((f) => /\bresolveSubdomainFromHost\(/.test(sansCom(read(f))))
  const permis = new Set(['lib/subdomain.ts', 'lib/inscription/ecosysteme.ts', 'proxy.ts'])
  ok(appelants.every((f) => permis.has(f)), 'E. le résolveur n’est appelé que par le proxy et ecosystemeDeLaRequete — une seule résolution pour les routes',
    appelants.filter((f) => !permis.has(f)).join(', ') || undefined)
  const routesPubliques = ['app/api/taxonomy/route.ts', 'app/api/auth/public/register-expert/route.ts', 'app/api/auth/register-org/route.ts']
  const sansResolution = routesPubliques.filter((f) => !/\becosystemeDeLaRequete\(req(uest)?\)/.test(sansCom(read(f))))
  ok(sansResolution.length === 0, 'E. les routes publiques résolvent l’écosystème par l’HÔTE (ecosystemeDeLaRequete), jamais par x-subdomain',
    sansResolution.join(', ') || undefined)
  const tax = sansCom(read('app/api/taxonomy/route.ts'))
  const codes = ['ecosysteme_non_configure', 'ecosysteme_non_resolu', 'ecosysteme_inconnu', 'ecosysteme_indisponible']
  // CHAQUE APPEL console.error(...) EST LU SEUL (parenthèses équilibrées) : un motif qui traverse le fichier
  // associait une journalisation à un code lu ailleurs — mutation « panne muette » passée au travers (§E.8).
  // Un appel qui journalise « { code, … } » en raccourci compte les codes de la ligne `const code = …` qui le précède.
  const journalises = new Set()
  for (let i = tax.indexOf('console.error('); i >= 0; i = tax.indexOf('console.error(', i + 1)) {
    let prof = 0, j = i + 'console.error'.length
    for (; j < tax.length; j++) { if (tax[j] === '(') prof++; else if (tax[j] === ')' && --prof === 0) break }
    const appel = tax.slice(i, j + 1)
    for (const m of appel.matchAll(/\bcode:\s*'([a-z_]+)'/g)) journalises.add(m[1])
    if (/[{,]\s*code\s*[,}]/.test(appel)) {
      const avant = tax.slice(0, i).split('\n').reverse().find((l) => /\bconst code = /.test(l)) ?? ''
      for (const m of avant.matchAll(/'([a-z_]+)'/g)) journalises.add(m[1])
    }
  }
  const nonJournalises = codes.filter((c) => !journalises.has(c))
  ok(!/x-subdomain/.test(tax) && !/missing_domain_id/.test(tax) && nonJournalises.length === 0,
    'E. /api/taxonomy nomme chaque panne de résolution ET la journalise au serveur, avec son code',
    nonJournalises.length ? `sans journal : ${nonJournalises.join(', ')}` : 'x-subdomain ou missing_domain_id encore présent')
  const ecrans = ['app/[locale]/inscription/[role]/page.tsx', 'app/[locale]/inscription/organisation/page.tsx',
    'app/[locale]/invitation/[token]/page.tsx', 'components/phone/SaisieTelephone.tsx', 'lib/pays/referentiel-client.ts']
  const bavards = ecrans.filter((f) => /\bconsole\.(error|log|warn|info|debug)\(/.test(sansCom(read(f))))
  ok(bavards.length === 0, 'E. aucun diagnostic à la console du navigateur sur les écrans publics d’inscription', bavards.join(', ') || undefined)
}

console.log(failures === 0
  ? '\n✅ Chaque hôte où le produit est servi — production, Preview, staging, local — résout son écosystème, ou nomme sa cause.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — un hôte sert un écosystème deviné, ou une panne se tait`)
process.exit(failures === 0 ? 0 : 1)

#!/usr/bin/env node
// scripts/diag-garde-adresse.mjs — L'ÉCOSYSTÈME D'UNE REQUÊTE SE LIT DANS SON ADRESSE, ET NULLE PART AILLEURS.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI IL EXISTE (29/09/2026, §E.85)
//   Après le déploiement de sous_domaine_reglable, l'admin se fermait au bout de trois secondes sur
//   `…/ecosysteme-indisponible?code=unknown_domain&slug=microsoft`. La garde des routes décidait sur
//   l'en-tête `x-subdomain`, une COPIE que le navigateur renvoyait, prise au rendu de la page : sur une
//   adresse sans écosystème actif, elle valait le pseudo-slug `'default'` de la configuration neutre, et
//   la garde déclarait « inconnu » ce que l'adresse ne nommait même pas ; `slug=microsoft` était celui du
//   COMPTE. 447 tests pgTAP et 114 contrôles ne l'ont pas vu : aucun n'exécutait la garde avec un hôte.
//
// CE QU'IL FAIT
//   A. LA SÉQUENCE, EXÉCUTÉE : les vraies fonctions (`sousDomaineDeLaRequete`, `resolveEcosystemAccess`,
//      `adresseEcosysteme`) sur une base en mémoire — connexion sur `alpha`, sous-domaine changé en `beta`,
//      l'onglet resté sur l'ancienne adresse, le retour sur la nouvelle avec une copie PÉRIMÉE dans le
//      navigateur, l'adresse aléatoire d'une Preview, un écosystème désactivé. Sans le correctif, le retour
//      sur la nouvelle adresse est refusé : le test rougit.
//   B. UNE SEULE SOURCE : `requireAuth`, la garde du tableau de bord et `getDomainConfig` passent l'adresse
//      (`sousDomaineDeLaRequete`) ; plus aucun code ne lit ni n'envoie `x-subdomain` ; le proxy n'en pose plus.
//   C. AUCUN RENVOI NE QUITTE L'ADRESSE : chaque renvoi vers l'écran de refus est un chemin RELATIF ; l'écran
//      construit sa sortie dans l'environnement (`adresseEcosysteme`), pour `unknown_domain` aussi.
//   D. L'ADMIN QUI RENOMME L'ÉCOSYSTÈME DE SA PROPRE ADRESSE n'est pas éjecté : l'écran propose la nouvelle.
//
// CE QU'IL NE VOIT PAS, ET LE DIT : un navigateur réel (le stockage de session par adresse, la protection
//   des Preview de Vercel qui renvoie vers l'adresse du déploiement) — c'est l'essai de Youssef qui le dit.
//
//   node scripts/diag-garde-adresse.mjs   → statique et exécuté en mémoire, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerHooks } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n')
let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

// L'alias `@/` du dépôt, résolu vers le fichier .ts (les modules sous test l'utilisent).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const base = join(ROOT, specifier.slice(2))
      const p = existsSync(`${base}.ts`) ? `${base}.ts` : join(base, 'index.ts')
      return nextResolve(pathToFileURL(p).href, context)
    }
    return nextResolve(specifier, context)
  },
})

const { sousDomaineDeLaRequete, adresseEcosysteme } = await import(pathToFileURL(join(ROOT, 'lib/subdomain.ts')).href)
const { resolveEcosystemAccess } = await import(pathToFileURL(join(ROOT, 'lib/ecosystem-guard.ts')).href)

// ── A. LA SÉQUENCE ───────────────────────────────────────────────────────────
section('A. La séquence : connexion, sous-domaine changé, retour sur la nouvelle adresse')

process.env.VERCEL_ENV = 'preview'
process.env.NEXT_PUBLIC_DOMAINE_RACINE = 'staging.skilloria.io'
delete process.env.DEV_DOMAIN_SLUG

// Une base en mémoire : la table `domains`, lue comme la garde la lit.
const D = '00000000-0000-4000-8000-00000000000d'
const base = { domains: [{ id: D, slug: 'alpha', active: true }] }
const admin = {
  from(table) {
    const filtres = []
    const q = {
      select() { return q },
      eq(col, val) { filtres.push([col, val]); return q },
      async maybeSingle() {
        const rows = (base[table] ?? []).filter((r) => filtres.every(([c, v]) => r[c] === v))
        return { data: rows[0] ? { ...rows[0] } : null, error: null }
      },
    }
    return q
  },
}
const compte = { userType: 'admin', userDomainId: D }
const ownDomain = () => ({ ...base.domains.find((d) => d.id === D) }) // lu frais en base, comme requireAuth le joint
/** Une requête du navigateur : son adresse, et la COPIE que l'ancien code renvoyait en en-tête. */
const requete = (hote, copie) => new Headers({ host: hote, ...(copie ? { 'x-subdomain': copie } : {}) })
const garde = async (entetes) => resolveEcosystemAccess({
  admin, sousDomaine: sousDomaineDeLaRequete(entetes), userType: compte.userType, userDomainId: compte.userDomainId,
  ownDomain: ownDomain(), logTag: 'diag-garde-adresse',
})

const e1 = await garde(requete('alpha.staging.skilloria.io', 'alpha'))
ok(e1.ok === true, '1. connexion sur alpha.staging.skilloria.io : l’administrateur passe')

base.domains[0].slug = 'beta' // le sous-domaine est changé dans l'écran Écosystèmes
const e3 = await garde(requete('alpha.staging.skilloria.io', 'alpha'))
ok(e3.ok === false && e3.denial.code === 'unknown_domain' && e3.denial.ownSlug === 'beta',
  '2. l’onglet resté sur l’ancienne adresse : unknown_domain, et le refus porte le NOUVEAU sous-domaine du compte',
  JSON.stringify(e3))
ok(adresseEcosysteme(e3.denial?.ownSlug) === 'https://beta.staging.skilloria.io',
  '   la sortie proposée reste sur staging : https://beta.staging.skilloria.io')

const e4 = await garde(requete('beta.staging.skilloria.io', 'alpha'))
ok(e4.ok === true,
  '3. RETOUR SUR LA NOUVELLE ADRESSE avec une copie périmée dans le navigateur : l’adresse décide, l’administrateur passe',
  `refusé (${e4.denial?.code}) — une COPIE du sous-domaine a décidé à la place de l’adresse`)
const e4b = await garde(requete('beta.staging.skilloria.io', 'default'))
ok(e4b.ok === true, '   la même, avec la copie « default » d’un rendu neutre : l’administrateur passe',
  `refusé (${e4b.denial?.code})`)

const e5 = await garde(requete('skilloria-git-feat-sprint-archi-orga-cheri.vercel.app', 'default'))
ok(e5.ok === false && e5.denial.code === 'unknown_domain' && adresseEcosysteme(e5.denial.ownSlug) === 'https://beta.staging.skilloria.io',
  '4. l’adresse aléatoire d’une Preview : unknown_domain (elle ne porte aucun écosystème), la sortie mène sur staging — jamais sur .vercel.app',
  JSON.stringify(e5))

base.domains[0].active = false
const e6 = await garde(requete('beta.staging.skilloria.io', 'default'))
ok(e6.ok === true,
  '5. écosystème DÉSACTIVÉ, page rendue neutre (copie « default ») : l’administrateur passe — c’est de là qu’on réactive',
  `refusé (${e6.denial?.code})`)
base.domains[0].active = true

// ── B. UNE SEULE SOURCE ──────────────────────────────────────────────────────
section('B. Une seule source : l’adresse')

/** Retire les commentaires d'un source TS sans toucher aux chaînes. */
function sansCommentaires(src) {
  let out = '', i = 0, etat = null
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (etat === 'ligne') { if (c === '\n') { etat = null; out += c } else out += ' '; i++; continue }
    if (etat === 'bloc') { if (c === '*' && d === '/') { etat = null; out += '  '; i += 2 } else { out += c === '\n' ? c : ' '; i++ } continue }
    if (etat) { out += c; if (c === '\\') { out += d ?? ''; i += 2; continue } if (c === etat) etat = null; i++; continue }
    if (c === '/' && d === '/') { etat = 'ligne'; out += '  '; i += 2; continue }
    if (c === '/' && d === '*') { etat = 'bloc'; out += '  '; i += 2; continue }
    if (c === "'" || c === '"' || c === '`') etat = c
    out += c; i++
  }
  return out
}
const fichiers = (d, o = []) => {
  if (!existsSync(join(ROOT, d))) return o
  for (const e of readdirSync(join(ROOT, d))) {
    const p = `${d}/${e}`
    if (statSync(join(ROOT, p)).isDirectory()) fichiers(p, o); else if (/\.(ts|tsx)$/.test(e)) o.push(p)
  }
  return o
}
const code = (f) => sansCommentaires(read(f))

ok(/const access = await resolveEcosystemAccess\(\{\s*admin: supabaseAdmin,\s*sousDomaine,/.test(code('lib/auth-guard.ts'))
   && /sousDomaine = sousDomaineDeLaRequete\(request\.headers\)/.test(code('lib/auth-guard.ts')),
  'B. requireAuth passe l’écosystème de l’ADRESSE de la requête à la garde')
ok(/sousDomaine = sousDomaineDeLaRequete\(hdrs\)/.test(code('lib/dashboard-routing-guard.ts'))
   && /resolveEcosystemAccess\(\{\s*admin: supabaseAdmin,\s*sousDomaine,/.test(code('lib/dashboard-routing-guard.ts')),
  'B. la garde du tableau de bord aussi')
ok(/const lu = sousDomaineDeLaRequete\(h\)/.test(code('lib/get-domain-config.ts')),
  'B. getDomainConfig aussi : la page, la garde et les routes lisent la même chose')
const sub = code('lib/subdomain.ts')
const corpsExtracteur = sub.slice(sub.indexOf('export function sousDomaineDeLaRequete'), sub.indexOf('export function adresseEcosysteme'))
ok(/return resolveSubdomainFromHost\(entetes\.get\('host'\) \?\? entetes\.get\('x-forwarded-host'\)\)/.test(corpsExtracteur)
   && !/x-subdomain/.test(corpsExtracteur),
  'B. l’extracteur lit l’hôte, jamais un en-tête posé par le navigateur')
const lecteurs = [...fichiers('app'), ...fichiers('lib'), ...fichiers('components'), ...fichiers('context'), 'proxy.ts']
  .filter((f) => /['"`]x-subdomain['"`]/.test(code(f)))
ok(lecteurs.length === 0, 'B. plus aucun code ne lit, n’envoie ni ne pose l’en-tête x-subdomain', lecteurs.join(', ') || undefined)

// ── C. AUCUN RENVOI NE QUITTE L'ADRESSE ──────────────────────────────────────
section('C. Aucun renvoi ne quitte l’adresse où se trouve le visiteur')

const renvois = []
for (const f of lecteurs.length ? [] : [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]) {
  const c = code(f)
  for (const m of c.matchAll(/(redirect|router\.replace|router\.push)\(\s*(`[^`]*`|'[^']*')/g)) {
    if (/ECOSYSTEM_UNAVAILABLE_PATH|ecosysteme-indisponible/.test(m[2])) renvois.push({ f, cible: m[2] })
  }
}
ok(renvois.length >= 2 && renvois.every((r) => /^[`']\$\{ECOSYSTEM_UNAVAILABLE_PATH\}|^[`']\/ecosysteme-indisponible/.test(r.cible)),
  `C. chaque renvoi vers l’écran de refus est un chemin RELATIF (${renvois.length} : ${[...new Set(renvois.map((r) => r.f))].join(', ')})`,
  renvois.map((r) => `${r.f} → ${r.cible}`).join(' · '))
const ecran = code('app/[locale]/ecosysteme-indisponible/page.tsx')
ok(/const aSortie = \(code === 'domain_mismatch' \|\| code === 'unknown_domain'\) && slug/.test(ecran)
   && /adresseEcosysteme\(slug\)/.test(ecran) && !/headers\(\)|ecosystemHref|x-forwarded-proto/.test(ecran),
  'C. l’écran construit la sortie dans l’ENVIRONNEMENT (adresseEcosysteme), pour unknown_domain aussi — jamais depuis l’hôte courant')
const langues = ['fr', 'en', 'es', 'de'].filter((l) => {
  const u = JSON.parse(read(`messages/${l}.json`))?.ecosystem_unavailable?.unknown_domain ?? {}
  return !['title', 'body', 'own_label', 'cta', 'no_link'].every((k) => typeof u[k] === 'string' && u[k].trim())
})
ok(langues.length === 0, 'C. la sortie de unknown_domain a ses textes dans les quatre langues', langues.join(', ') || undefined)

// ── D. L'ADMIN QUI RENOMME L'ÉCOSYSTÈME DE SA PROPRE ADRESSE ─────────────────
section('D. Renommer l’écosystème de sa propre adresse n’éjecte pas l’administrateur')
const page = code('app/[locale]/admin/ecosystemes/page.tsx')
ok(/new URL\(ancienne\)\.host === window\.location\.host/.test(page)
   // `setMsg(…)` contient lui-même des parenthèses (`t(…)`) : on lit la ligne, pas un « jusqu'à la parenthèse ».
   && /if \(surCetteAdresse && adresse\) \{\s*setDemenage\([^\n]*\)\s*setMsg\([^\n]*\)\s*return\s*\}/.test(page),
  'D. l’écran compare l’ADRESSE réelle de la page, et ne recharge rien : il propose la nouvelle adresse')

console.log(failures === 0
  ? '\n✅ L’écosystème se lit dans l’adresse, et nulle part ailleurs ; aucun renvoi ne quitte l’adresse du visiteur.'
  : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une copie du sous-domaine décide, ou un renvoi quitte l’adresse`)
process.exit(failures === 0 ? 0 : 1)

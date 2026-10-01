/**
 * diag-recette-staging.mjs — LA RECETTE STAGING DU 30/09/2026, POINT PAR POINT.
 *
 * Chaque correctif est gardé par sa PROPRIÉTÉ (§E.34), et les modules purs sont EXÉCUTÉS sur des cas
 * fabriqués (§E.33) : l'état de la configuration, la cause d'un appel de tâche qui n'atteint pas le site,
 * la règle du cookie de session sur chaque environnement.
 *
 * CE QU'IL NE VOIT PAS, ET IL FAUT LE LIRE :
 *   · la base — `cron_joignabilite()` et les deux lignes de l'inscription sont prouvées par pgTAP
 *     (`taches_planifiees/joignabilite`, `grand_livre/inscriptions`, `inscription/compte_cree`) ;
 *   · Vercel — la protection de la racine, le passage en Secret des clés, les variables système : ce sont
 *     des gestes de Youssef (docs/reprise.md, recette staging) ;
 *   · la cause exacte du plantage libuv de deux scripts : PROBABLE, non reproduite sans base.
 * Les clés de traduction (point 2) sont gardées par `diag-cles-i18n` ; les deux lignes d'un geste sur le
 * même sujet (point 1) par `diag-grand-livre` ; le retrait d'appliquer_analyse_cv (point 8) par
 * `diag-parcours-expert`.
 *
 * Sortie : 0 vert · 1 rouge · 2 n'a pas tourné.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')
const sansCommentaires = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n').map((l) => (/^\s*\/\//.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n')
const importer = (p) => import(pathToFileURL(join(ROOT, p)).href)

let echecs = 0
const ok = (cond, label, indice) => {
  if (cond) console.log(`  ok   ${label}`)
  else { echecs++; console.log(`  KO   ${label}${indice ? `\n       → ${indice}` : ''}`) }
}
const section = (t) => console.log(`\n═══ ${t} ═══\n`)

let conf, joi, cookie
try {
  conf = await importer('lib/configuration/variables.ts')
  joi = await importer('lib/supervision/joignabilite.ts')
  cookie = await importer('lib/session-cookie.ts')
} catch (err) {
  console.error('✘ un module pur ne se charge pas — le contrôle n’a pas tourné', err)
  process.exit(2)
}

// ─────────────────────────────────────────────────────────────────────────────
section('1. Le grand livre : deux écritures d’un geste se distinguent, et l’écran le montre')
{
  const pres = sansCommentaires(lire('components/admin/journal/presentation.tsx'))
  const liste = sansCommentaires(lire('app/[locale]/admin/journal/page.tsx'))
  const piece = sansCommentaires(lire('app/[locale]/admin/journal/[piece]/page.tsx'))
  ok(/export function DetailEcriture\(/.test(pres) && /export function ResumeEcriture\(/.test(pres), 'le détail et le résumé d’une écriture sont rendus par UN module partagé (§E.20)')
  ok(/<ResumeEcriture ligne=\{l\} \/>/.test(liste), 'la LISTE montre, pour chaque écriture, son objet et ses premiers détails')
  ok(/<DetailEcriture detail=\{l\.detail\} \/>/.test(piece) && /<ResumeEcriture ligne=\{x\} max=\{2\} \/>/.test(piece) && !/JSON\.stringify\(l\.detail/.test(piece),
    'la PIÈCE montre le détail clé par clé (plus de JSON brut), et chaque ligne de sa colonne se distingue sans être ouverte')
  const mig = lire('supabase/migrations/' + readdirSync(join(ROOT, 'supabase/migrations')).find((f) => f.endsWith('_journal_inscription_distincte.sql')))
  ok(/v_piece, 'expert_inscrit', 'reussi', 'utilisateur',\s*new\.id, v_user_type, v_domain_id, 'profiles', v_profil,/.test(mig)
     && /'type_de_compte', case when v_voie = 'administrateur' then 'admin' else v_user_type end/.test(mig),
    'l’inscription d’un expert porte sur son PROFIL ; le compte d’un administrateur n’est plus dit « client »')
  ok(/count\(distinct \(g\.sujet_type, g\.sujet_id\)\)/.test(lire('supabase/tests/database/grand_livre/inscriptions.test.sql')),
    'le test des lignes sœurs exige deux SUJETS différents pour chaque voie')
  // AUCUN NUMÉRO AU GRAND LIVRE, MÊME PARTIEL (décision de Youssef, 01/10/2026) : dans chaque appel à journaliser()
  // de handle_new_user, le numéro (`v_tel`) n'apparaît que sous la forme du FAIT `v_tel is not null`.
  const corps = mig.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
  const appels = [...corps.matchAll(/perform public\.journaliser\(([\s\S]*?)\);/g)].map((m) => m[1])
  const fuites = appels.filter((a) => /v_tel\b/.test(a.replace(/v_tel is not null/g, '')) || /'telephone'|'phone'/.test(a))
  ok(appels.length >= 3 && fuites.length === 0 && appels.some((a) => /'telephone_verifie', v_tel is not null/.test(a)),
    `aucune des ${appels.length} écritures de l’inscription ne porte le numéro — seulement « téléphone vérifié », un booléen`,
    fuites.map((a) => a.slice(0, 80)).join(' · '))
  const testInscr = lire('supabase/tests/database/grand_livre/inscriptions.test.sql')
  ok(/strpos\(g\.detail::text, right\(t\.num, 8\)\) > 0/.test(testInscr) && /'compte_cree', 'reussi'[\s\S]{0,200}"telephone":"\+33600000000"/.test(testInscr),
    'un test prouve qu’aucune ligne d’inscription ne porte le numéro, même partiel, et que la clé « telephone » est refusée')
}

// ─────────────────────────────────────────────────────────────────────────────
section('3. La configuration exigée, dite EN PERMANENCE (exécuté)')
{
  const pleine = Object.fromEntries(conf.VARIABLES.filter((v) => v.exigence === 'deploye').map((v) => [v.nom, v.valeurAttendue ?? 'x'.repeat(v.longueurMin ?? 8)]))
  pleine.NEXT_PUBLIC_DOMAINE_RACINE = 'racine.invalid'
  pleine.NEXT_PUBLIC_SITE_URL = 'https://racine.invalid'
  const e1 = conf.etatConfiguration(pleine, 'abcdef0123456789')
  ok(e1.manquantes.length === 0 && e1.exigees === conf.VARIABLES.filter((v) => v.exigence === 'deploye').length && e1.version === 'abcdef0',
    `toutes posées : zéro manque, ${e1.exigees} exigées, la version raccourcie`, JSON.stringify(e1))
  const moins = { ...pleine }
  delete moins.CRON_SECRET
  const e2 = conf.etatConfiguration(moins, undefined)
  ok(e2.manquantes.includes('CRON_SECRET') && e2.version === null && e2.environnement === null, 'une variable retirée est NOMMÉE ; sans Vercel, ni version ni environnement')
  const route = sansCommentaires(lire('app/api/admin/supervision/route.ts'))
  const page = sansCommentaires(lire('app/[locale]/admin/supervision/page.tsx'))
  ok(/configuration: \{ \.\.\.etatConfiguration\(process\.env, process\.env\.VERCEL_GIT_COMMIT_SHA\), verifiee_a: new Date\(\)\.toISOString\(\) \}/.test(route),
    'la route rejoue le contrôle du démarrage à chaque lecture, avec l’heure et la version')
  ok(/\{data\?\.configuration && \(\s*<section/.test(page) && /t\('config_toutes'/.test(page) && /t\('config_controle'/.test(page),
    'l’écran montre le panneau MÊME quand rien ne manque (« les N variables exigées sont posées »)')
}

// ─────────────────────────────────────────────────────────────────────────────
section('4. La base atteint-elle le site ? La cause, nommée (exécuté)')
{
  const maintenant = Date.parse('2026-09-30T12:00:00Z')
  const a = (x) => ({ job_name: 'sonde', requested_at: '2026-09-30T11:00:00Z', http_status: null, timed_out: false, erreur_connexion: false, secret_refuse: false, source: 'reconciliation', ...x })
  const cas = [
    [a({ source: 'tache', http_status: 503 }), null, 'une ligne close par la TÂCHE : le site a été atteint'],
    [a({ http_status: 401 }), 'protection', '401 d’hébergeur'],
    [a({ http_status: 401, secret_refuse: true }), 'secret_refuse', '401 de notre secret'],
    [a({ http_status: 307, source: 'reponse_brute' }), 'redirection', '307, lu dans la réponse brute'],
    [a({ timed_out: true }), 'delai', 'expiration'],
    [a({ erreur_connexion: true }), 'connexion', 'erreur de connexion'],
    [a({ http_status: 500 }), 'erreur_http', '500 sans verdict de la tâche'],
    [a({ source: 'aucune' }), 'aucune_reponse', 'aucune réponse après une heure'],
    [a({ source: 'aucune', requested_at: '2026-09-30T11:58:00Z' }), null, 'aucune réponse depuis deux minutes : encore attendue'],
    [a({ http_status: 200 }), null, '200'],
  ]
  const faux = cas.filter(([x, attendu]) => joi.causeInjoignable(x, maintenant) !== attendu).map(([, att, q]) => `${q} (attendu ${att})`)
  ok(faux.length === 0, `les ${cas.length} cas fabriqués ont la bonne cause`, faux.join(' · '))
  const route = sansCommentaires(lire('app/api/admin/supervision/route.ts'))
  const pb = sansCommentaires(lire('lib/supervision/problemes.ts'))
  ok(/admin\.rpc\('cron_joignabilite'\)/.test(route) && /causeInjoignable\(a, Date\.now\(\)\)/.test(route),
    'la supervision lit le dernier appel de chaque tâche et le fait juger par le module pur')
  ok(/cle: `site_injoignable_\$\{t\.cause\}`,\s*gravite: 'bloquant'/.test(pb) && /cle: 'lecture_indisponible_joignabilite'/.test(pb),
    'une tâche qui n’atteint pas le site est BLOQUANTE, avec sa cause ; une lecture en panne se dit')
  ok(/if \(v\.nuit === 'impossible' && v\.motifNormal\) \{/.test(pb) && /motifEstNormal\(/.test(route),
    'la vérification Stripe « impossible » parce que la facturation est COUPÉE n’alarme plus (même règle que /admin/facturation)')
  const mig = lire('supabase/migrations/' + readdirSync(join(ROOT, 'supabase/migrations')).find((f) => f.endsWith('_joignabilite_du_site.sql')))
  ok(/left join net\._http_response r on r\.id = l\.request_id/.test(mig), 'la réponse brute de pg_net est lue sans attendre la réconciliation de la nuit')
  const crons = readdirSync(join(ROOT, 'app/api/cron'))
  const lisentLHote = crons.filter((c) => /sousDomaineDeLaRequete|resolveSubdomainFromHost|getDomainConfig|requireAuth\(/.test(sansCommentaires(lire(`app/api/cron/${c}/route.ts`))))
  ok(crons.length >= 7 && lisentLHote.length === 0, `les ${crons.length} routes /api/cron répondent sur la racine : aucune ne lit l’écosystème dans l’adresse`, lisentLHote.join(', '))
}

// ─────────────────────────────────────────────────────────────────────────────
section('5. Une seule adresse du site, sur la racine (exécuté)')
{
  const base = { NEXT_PUBLIC_DOMAINE_RACINE: 'racine.invalid' }
  const juge = (v) => conf.variablesManquantes({ ...base, NEXT_PUBLIC_SITE_URL: v }).filter((m) => m.nom === 'NEXT_PUBLIC_SITE_URL').map((m) => m.motif)
  ok(juge('https://racine.invalid').length === 0 && juge('https://racine.invalid/').length === 0 && juge('https://eco.racine.invalid').includes('hote_hors_racine'),
    'l’adresse du site vaut la racine ; une adresse d’écosystème est signalée (démarrage et supervision)')
  const code = ['app', 'lib', 'components'].flatMap((d) => {
    const out = []
    const m = (r) => { for (const e of readdirSync(join(ROOT, r), { withFileTypes: true })) { const p = `${r}/${e.name}`; if (e.isDirectory()) m(p); else if (/\.(ts|tsx)$/.test(e.name) && /NEXT_PUBLIC_APP_URL/.test(sansCommentaires(lire(p)))) out.push(p) } }
    m(d)
    return out
  })
  ok(code.length === 0 && !conf.VARIABLES.some((v) => v.nom === 'NEXT_PUBLIC_APP_URL'), 'NEXT_PUBLIC_APP_URL n’est lue nulle part : elle se retire de Vercel', code.join(', '))
}

// ─────────────────────────────────────────────────────────────────────────────
section('6. Le cookie de session : aucun hôte en toutes lettres, et la production ne bouge pas (exécuté)')
{
  const r = (host, racine, environnement) => cookie.regleCookieSession({ host, racine, environnement })
  const prod = r('eco.racine.invalid', 'racine.invalid', 'production')
  const racineProd = r('racine.invalid', 'racine.invalid', 'production')
  const stag = r('eco.staging.racine.invalid', 'staging.racine.invalid', 'preview')
  const local = r('localhost:3000', null, undefined)
  ok(prod.nom === 'ss_token' && prod.domaine === '.racine.invalid' && prod.secure && racineProd.domaine === '.racine.invalid',
    'production : ss_token sur .<racine> — ce que la production posera le jour où main reçoit ce code', JSON.stringify(prod))
  ok(stag.nom === 'ss_token_staging' && stag.domaine === '.racine.invalid',
    'staging : un nom DISTINCT, et la portée qu’il avait (le parent de la racine) — aucune session de staging perdue', JSON.stringify(stag))
  ok(local.nom === 'ss_token' && !local.domaine && !local.secure, 'le poste local : ss_token, sans domaine, sans Secure')
  const litteraux = ['lib/session-token.ts', 'lib/session-cookie.ts'].filter((f) => /skilloria\.io/.test(sansCommentaires(lire(f))))
  ok(litteraux.length === 0, 'aucun nom d’hôte en toutes lettres dans le code du cookie', litteraux.join(', '))
}

// ─────────────────────────────────────────────────────────────────────────────
section('7. La série statique ne touche plus la vraie base ; les deux scripts ferment leur connexion')
{
  const lanceur = sansCommentaires(lire('scripts/diag.mjs'))
  ok(/function litLaVraieBase\(nom\)/.test(lanceur) && /if \(!avecBase && litLaVraieBase\(nom\)\) \{/.test(lanceur),
    'le lanceur écarte, par PROPRIÉTÉ, les scripts qui lisent .env.local sans drapeau — --avec-base pour les inclure')
  ok(/process\.exitCode = rouges\.length \+ muets\.length > 0 \? 1 : 0/.test(lanceur) && /ecartes\.push\(/.test(lanceur),
    'un script écarté par construction n’est plus compté « n’a pas tourné » : seules les pannes du contrôle le sont')
  // DÉCISION DE YOUSSEF (01/10/2026) : le script qui imprimait les données d'une personne réelle est SUPPRIMÉ ;
  // les lecteurs restants n'affichent aucune donnée personnelle — le compte-rendu des purges porte des
  // identifiants de comptes : sa longueur s'affiche, jamais son contenu.
  ok(!existsSync(join(ROOT, 'scripts/diag-readonly-expert-achwek.mjs')), 'le script d’enquête sur une personne réelle est supprimé')
  const purges = sansCommentaires(lire('scripts/diag-cron-purges.mjs'))
  ok(!/r\.http_response\.slice\(/.test(purges) && /r\.http_response\.length/.test(purges),
    'diag-cron-purges n’affiche plus le contenu de la réponse des purges (des identifiants de comptes) — sa longueur seulement')
  for (const f of ['scripts/diag-supabase.mjs']) {
    const s = sansCommentaires(lire(f))
    const apresReseau = s.slice(s.search(/await (fetch|principal)\(/))
    ok(/async function sortir\(code\)[\s\S]*?undici\.globalDispatcher\.1/.test(s) && !/process\.exit\(/.test(apresReseau.replace(/async function sortir[\s\S]*?\n\}/, '')),
      `${f} : après l’appel réseau, toute sortie ferme d’abord la connexion`)
  }
}

console.log(echecs === 0 ? '\n✅ La recette staging : chaque point est fermé, et le contrôle le vérifie.' : `\n✘ ${echecs} CONTRÔLE(S) EN ÉCHEC`)
process.exit(echecs === 0 ? 0 : 1)

#!/usr/bin/env node
// scripts/diag-audit-sans-donnee-personnelle.mjs — AUCUNE DONNÉE PERSONNELLE
// DANS LE JOURNAL D'AUDIT. Identifiants seulement.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LE CAS, MESURÉ LE 24/09/2026 (lecture seule sur staging)
//   127 lignes d'audit ; 4 portaient une clé personnelle dans `detail` —
//   `email`, `new_email`, `phone_e164`, `company_name` — sur 4 actions et
//   5 comptes. Et la purge RGPD ne touchait PAS le journal : un compte
//   anonymisé gardait son adresse lisible dans `audit_logs`, indéfiniment.
//   Huit sites écrivaient une donnée personnelle ; la base n'en montrait que
//   quatre actions — c'est le contrôle qui a trouvé les deux dernières.
//
// CE QUE CE CONTRÔLE GARDE
//   A. La liste des clés personnelles vit EN BASE (`audit_logs_cles_
//      personnelles()`), et c'est ELLE qui est lue ici — une seule source.
//   B. Chaque appel `logAudit({…})` de app/, lib/ et components/ : `detail`
//      est absent, un objet LITTÉRAL sans spread, ou une variable dont le
//      `const` littéral est dans le fichier — sinon opaque, donc refusé ;
//      aucune clé de la liste À TOUTE PROFONDEUR, aucune VALEUR visiblement
//      personnelle (`x.email`, `phone`, `newEmail`…) sous une clé innocente.
//   C. Aucune migration n'écrit dans audit_logs : le périmètre inclut le SQL.
//   D. La purge d'un compte nettoie le journal AVANT de poser `anonymized_at`
//      et lève si le nettoyage échoue.
//   E. La migration : le nettoyage passe par la fonction pure, et la
//      postcondition l'EXÉCUTE sur un objet imbriqué (§E.67).
//   F. Témoins.
//
//   LE DÉTECTEUR EST PARTAGÉ avec le grand livre (scripts/lib/detail-sans-pii)
//   — deux copies auraient divergé (§E.20).
//
// CE QU'IL NE VÉRIFIE PAS, ET LE DIT
//   · une donnée personnelle rangée sous une clé innocente et une valeur qui
//     n'a pas l'air d'en être une (`ref: x.contact`) — c'est la relecture de
//     chaque nouvel appel qui la voit ;
//   · le SQL lui-même : ce contrôle LIT la migration, c'est la postcondition
//     en base qui l'exécute.
//
//   node scripts/diag-audit-sans-donnee-personnelle.mjs   → statique, aucun accès base.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appelsDe, chargerClesPersonnelles, fabriquerDetecteur } from './lib/detail-sans-pii.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8').split('\r\n').join('\n')

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ (§E.7). */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => {
      const t = l.trimStart()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')

let failures = 0
const ok = (cond, label, hint) => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`) }
}
const section = (s) => console.log(`\n═══ ${s} ═══\n`)

/** Résolution d'une migration par suffixe descriptif — jamais par numéro (§G.3). */
function migration(suffixe) {
  const dir = join(ROOT, 'supabase/migrations')
  const hits = readdirSync(dir).filter((f) => f.endsWith(`_${suffixe}.sql`))
  if (hits.length !== 1) {
    throw new Error(`migration « ${suffixe} » : ${hits.length} correspondance(s) — ${hits.join(', ') || 'aucune'}`)
  }
  return `supabase/migrations/${hits[0]}`
}

function fichiers(dir, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue
    const rel = `${dir}/${e}`
    if (statSync(join(ROOT, rel)).isDirectory()) fichiers(rel, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel)
  }
  return out
}

// ═══ A. LA LISTE DES CLÉS — LUE EN BASE, PAS RECOPIÉE ══════════════════════
section('A. La liste des clés personnelles — une seule source, en base')

const MIGRATION = migration('audit_sans_donnee_personnelle')
const sql = read(MIGRATION)
const sqlSansCommentaires = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
const CLES = chargerClesPersonnelles(sqlSansCommentaires)
ok(CLES.length >= 10, `la liste est lue dans ${MIGRATION} — ${CLES.length} clés`)
const MESUREES = ['email', 'new_email', 'phone_e164', 'company_name']
ok(MESUREES.every((k) => CLES.includes(k)),
  `elle couvre les quatre clés MESURÉES en base le 24/09/2026 (${MESUREES.join(', ')})`,
  'une clé mesurée qui sort de la liste rouvre le défaut sur les lignes existantes')
const defautDe = fabriquerDetecteur(CLES, 'detail')

// ═══ B. CHAQUE ÉCRITURE — IDENTIFIANTS SEULEMENT ═══════════════════════════
section('B. Chaque appel logAudit : un détail lisible, sans clé ni valeur personnelle')

let appels = 0
const defauts = []
for (const f of [...fichiers('app'), ...fichiers('lib'), ...fichiers('components')]) {
  const src = stripComments(read(f))
  if (!src.includes('logAudit(')) continue
  for (const bloc of appelsDe(src, 'logAudit(')) {
    if (f === 'lib/audit.ts') continue
    appels++
    const d = defautDe(bloc, src)
    if (d) {
      const action = (/action:\s*'([^']+)'/.exec(bloc) || /action:\s*(\w+)/.exec(bloc) || [, '?'])[1]
      defauts.push(`${f} · ${action} — ${d}`)
    }
  }
}
ok(appels >= 50, `${appels} appels logAudit lus (app/, lib/, components/)`, 'moins de 50 : le balayage n’a pas vu les appels — vérifier fichiers() avant de croire le vert')
ok(defauts.length === 0,
  'aucun appel ne porte de clé ni de valeur personnelle, et aucun détail n’est opaque',
  defauts.length ? defauts.join('\n         ') : undefined)

// ═══ C. LE PÉRIMÈTRE INCLUT LE SQL ═════════════════════════════════════════
section('C. Aucun écrivain SQL du journal d’audit')

{
  const ecrivainsSql = readdirSync(join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => /insert\s+into\s+(public\.)?audit_logs\b/i.test(
      read(`supabase/migrations/${f}`).split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')))
  ok(ecrivainsSql.length === 0,
    'aucune migration n’insère dans audit_logs — le contrôle B couvre donc TOUS les écrivains',
    ecrivainsSql.length ? `écrivain(s) SQL hors périmètre de B : ${ecrivainsSql.join(', ')} — à couvrir avant de croire le vert` : undefined)
}

// ═══ D. LA PURGE NETTOIE LE JOURNAL, AVANT LE JALON ════════════════════════
section('D. purgeAccount nettoie audit_logs avant de poser anonymized_at, et lève sinon')

{
  const purge = stripComments(read('lib/account-purge.ts'))
  const iRpc = purge.indexOf(".rpc('audit_logs_nettoyer_compte'")
  const iJalon = purge.indexOf('anonymized_at: new Date()')
  ok(iRpc >= 0, 'purgeAccount appelle audit_logs_nettoyer_compte')
  ok(iRpc >= 0 && iJalon > iRpc,
    'le nettoyage précède le jalon anonymized_at',
    'après le jalon, un nettoyage en échec ne serait jamais rejoué : le compte est déjà « purgé »')
  const apresRpc = iRpc >= 0 ? purge.slice(iRpc, iRpc + 600) : ''
  ok(/throw new Error\(/.test(apresRpc) && /audit/.test(apresRpc.split('throw new Error(')[1] ?? ''),
    'un nettoyage en échec LÈVE — le compte reste non marqué et sera repris',
    'un échec avalé laisserait anonymized_at se poser sur un journal encore sale')
  ok(/p_email/.test(apresRpc),
    'l’adresse est transmise au nettoyage — elle seule relie une invitation au compte qu’elle nomme')
  const trace = appelsDe(purge, 'logAudit(').find((b) => b.includes("action: 'account_purged'"))
  ok(!!trace && /audit_lignes_nettoyees/.test(trace),
    'account_purged dit COMBIEN de lignes ont été nettoyées (le registre dit ce qui a eu lieu, §E.27)')
}

// ═══ E. LA MIGRATION — le nettoyage passe par la fonction pure, et elle s'exécute ═
section('E. La migration : fonction pure, nettoyage par elle, postcondition qui l’exécute')

{
  // Le corps de la fonction : de sa création à la fin de son `$$;` — un
  // délimiteur de deux caractères, que l'extracteur d'accolades ne sait pas suivre.
  const corpsNettoyage = (() => {
    const i = sqlSansCommentaires.indexOf('function public.audit_logs_nettoyer_compte(')
    return i < 0 ? '' : sqlSansCommentaires.slice(i, sqlSansCommentaires.indexOf('$$;', i))
  })()
  ok(/set detail = public\.audit_logs_detail_sans_pii\(a\.detail\)/.test(corpsNettoyage),
    'le nettoyage écrit detail := audit_logs_detail_sans_pii(detail) — jamais une seconde liste')
  ok(/a\.user_id = p_user_id/.test(corpsNettoyage) && /a\.entity_id = p_user_id/.test(corpsNettoyage) && /position\(lower\(p_email\)/.test(corpsNettoyage),
    'trois liens pris : acteur, sujet, et adresse présente dans le détail')
  const iPost = sqlSansCommentaires.indexOf('do $post$')
  const post = iPost < 0 ? '' : sqlSansCommentaires.slice(iPost)
  ok(/to_regprocedure\(s\) is null/.test(post) && /audit_logs_nettoyer_compte\(uuid, text\)/.test(post),
    'postcondition : les signatures sont résolues par TYPES (to_regprocedure), pas par une chaîne rendue (§E.67)')
  ok(/audit_logs_detail_sans_pii\(\s*'\{[^']*"x":\{[^']*\}[^']*\[[^']*\][^']*\}'::jsonb\)/.test(post) && /is distinct from v_attendu/.test(post),
    'postcondition : la fonction pure est EXÉCUTÉE sur un objet imbriqué et un tableau, et son résultat comparé')
  ok(/audit_logs_nettoyer_compte\(gen_random_uuid\(\), null\)/.test(post),
    'postcondition : le nettoyage est EXÉCUTÉ (compte inexistant ⇒ zéro ligne) — un corps plpgsql ne se vérifie qu’en s’exécutant')
  ok(/revoke all on function public\.audit_logs_nettoyer_compte\(uuid, text\) from public, anon, authenticated/.test(sqlSansCommentaires),
    'le nettoyage n’est exécutable que par le serveur (revoke public/anon/authenticated)')
}

// ═══ F. TÉMOINS — les détecteurs rougissent sur les formes connues ═════════
section('F. Témoins')

ok(defautDe("logAudit({ action: 'x', detail: { avant: { email: u.email } } })")?.startsWith('clé personnelle'),
  'témoin : une clé personnelle IMBRIQUÉE est vue')
ok(defautDe("logAudit({ action: 'x', detail: { numero: phone } })")?.startsWith('valeur personnelle'),
  'témoin : une valeur personnelle sous une clé innocente est vue (identifiant nu)')
ok(defautDe("logAudit({ action: 'x', detail: { contact: org.company_name } })")?.startsWith('valeur personnelle'),
  'témoin : un accès `.company_name` sous une clé innocente est vu')
ok(defautDe("logAudit({ action: 'x', detail: { origine, ...detail } })")?.includes('OPAQUE'),
  'témoin : un spread est refusé')
ok(defautDe("logAudit({ action: 'x', detail })")?.includes('OPAQUE'),
  'témoin : le raccourci `detail` est refusé')
ok(defautDe("logAudit({ action: 'x', detail: inconnu })", '')?.includes('OPAQUE'),
  'témoin : une variable sans `const` littéral dans le fichier est opaque')
ok(defautDe("logAudit({ action: 'x', detail: d })", 'const d = { avant: { new_email: x } }')?.startsWith('clé personnelle'),
  'témoin : une variable est jugée sur son littéral `const`')
ok(defautDe("logAudit({ action: 'x', detail: { target_domain_id: t.domain_id, email_verified: true, phone_verified: u.phone_verified } })") === null,
  'témoin : `email_verified` et `phone_verified` (des faits, pas des données) passent')
ok(defautDe("logAudit({ action: 'x', entity_id: id })") === null,
  'témoin : un appel sans détail passe')

// ═══ VERDICT ═══════════════════════════════════════════════════════════════
console.log()
if (failures) {
  console.log(`✘ ${failures} CONTRÔLE(S) EN ÉCHEC — une donnée personnelle peut entrer ou rester dans le journal d’audit`)
  process.exit(1)
}
console.log('✅ le journal d’audit ne porte que des identifiants, et la purge le nettoie')

// scripts/diag-account-lifecycle.mjs — cycle de vie d'un compte :
// JAMAIS ZÉRO ADMINISTRATEUR PLATEFORME, et la purge RGPD doit ABOUTIR.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Deux défauts, liés par une dépendance d'ordre.
//
//   1. La SUPPRESSION en self-service n'était gardée par rien. Le dernier
//      administrateur pouvait la déclencher depuis ses paramètres ; la
//      plateforme se retrouvait sans administrateur 90 jours plus tard.
//      Garder la seule route de self-service ne suffit pas : deux
//      administrateurs qui la formulent coup sur coup la franchissent tous les
//      deux si le compteur ignore les comptes déjà en grâce.
//
//   2. `purgeAccount` écrivait `status: 'deleted'`, valeur ABSENTE du CHECK
//      `users_status_check`. L'UPDATE violait la contrainte et levait à chaque
//      passage : aucune purge n'aboutissait, et les comptes restaient à
//      MI-CHEMIN (profil anonymisé, mais nom/prénom/e-mail/téléphone conservés
//      dans `users`).
//
//   ⚠️ L'ORDRE EST IMPÉRATIF : corriger (2) sans (1) RÉARME le risque que (1)
//      cherche à fermer — la purge se remettrait à aboutir, y compris sur le
//      dernier administrateur. Ce script vérifie les deux ensemble.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-account-lifecycle.mjs        → contrôles statiques.
//                                                    AUCUN accès base.
//   node --env-file=.env.local scripts/diag-account-lifecycle.mjs --db
//                                                  → + inventaire LECTURE
//                                                    SEULE (admins
//                                                    disponibles, comptes
//                                                    mi-purgés).
//
// LECTURE PURE : ce script n'écrit JAMAIS, dans aucun mode.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Retire les commentaires : un anti-pattern doit pouvoir être DOCUMENTÉ. */
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

// ═══ A. LES CINQ CHEMINS QUI PEUVENT RETIRER UN ADMIN DU PARC ══════════════
section('A. Les cinq chemins de retrait d’un administrateur')

// 1. Suppression en self-service — garde AJOUTÉE par ce lot.
const deleteRoute = stripComments(read('app/api/me/account/delete/route.ts'))
ok(/countOtherAvailablePlatformAdmins\(/.test(deleteRoute),
  'chemin 1 — /api/me/account/delete : compte les administrateurs restants')
ok(/wouldRemoveLastAdmin\(/.test(deleteRoute),
  'chemin 1 : réutilise le prédicat anti-lock-out partagé (non réécrit)')
ok(/code: 'last_platform_admin'/.test(deleteRoute) && /409/.test(deleteRoute),
  'chemin 1 : refus SERVEUR 409 last_platform_admin')
ok(/user_type === 'admin'/.test(deleteRoute),
  'chemin 1 : le comptage n’est fait QUE pour les administrateurs',
  'un expert ou une entreprise ne doit pas payer cette requête')
{
  // La garde doit précéder toute écriture, sinon elle refuse un état déjà posé.
  const iGuard = deleteRoute.indexOf('countOtherAvailablePlatformAdmins')
  const iWrite = deleteRoute.indexOf(".from('profiles')")
  ok(iGuard > 0 && iWrite > 0 && iGuard < iWrite,
    'chemin 1 : la garde précède TOUTE écriture')
}

// 2. Purge des suppressions échues — dernier verrou, AJOUTÉ par ce lot.
const purgeDeletions = stripComments(read('app/api/cron/purge-deletions/route.ts'))
ok(/countOtherAvailablePlatformAdmins\(/.test(purgeDeletions) && /wouldRemoveLastAdmin\(/.test(purgeDeletions),
  'chemin 2 — /api/cron/purge-deletions : dernier verrou en place')
ok(/user_type/.test(purgeDeletions),
  'chemin 2 : user_type chargé dans la sélection des comptes échus')
ok(/others === null \|\|/.test(purgeDeletions),
  'chemin 2 : fail-safe INVERSE — comptage indisponible ⇒ ON NE PURGE PAS',
  'reporter au lendemain ne coûte rien ; purger à tort est définitif')
ok(/account_purge_blocked/.test(purgeDeletions),
  'chemin 2 : le refus est tracé (account_purge_blocked)')
ok(/continue/.test(purgeDeletions) && !/deletion_scheduled_at: null/.test(purgeDeletions),
  'chemin 2 : la demande est CONSERVÉE (deletion_scheduled_at intact)',
  'le verrou refuse d’agir, il ne décide pas à la place de l’utilisateur')
ok(/blocked/.test(purgeDeletions), 'chemin 2 : les comptes bloqués sont remontés dans la réponse')

// 3. Purge d'inactivité — déjà fermée AVANT ce lot, on vérifie la non-régression.
const purgeInactive = stripComments(read('app/api/cron/purge-inactive/route.ts'))
{
  const occurrences = (purgeInactive.match(/neq\('user_type', 'admin'\)/g) ?? []).length
  ok(occurrences >= 2,
    `chemin 3 — /api/cron/purge-inactive : les DEUX phases excluent les admins (${occurrences}/2)`,
    'phase purge ET phase avertissement — le chemin le plus silencieux de tous')
}

// 4. Suspension par un administrateur — couverte par une règle PLUS STRICTE.
const guard = stripComments(read('lib/admin/user-actions-guard.ts'))
ok(/'target_is_admin'/.test(guard),
  'chemin 4 — suspension : aucune action sur un autre administrateur (interdit 2)',
  'plus strict que le contrôle sur le nombre ; ne pas l’assouplir')
ok(/'self_forbidden'/.test(guard),
  'chemin 4 : aucune action sur soi-même (interdit 1) ⇒ pas d’auto-suspension')

// 5. Rollback d'inscription — hors risque, on le vérifie quand même.
{
  const callers = ['app/api/auth/public/register-expert/route.ts', 'app/api/auth/register-org/route.ts']
  const others = ['app/api/me/account/delete/route.ts', 'app/api/cron/purge-deletions/route.ts',
    'app/api/cron/purge-inactive/route.ts', 'app/api/admin/user-status/route.ts']
  ok(callers.every((f) => /atomicCleanup\(/.test(read(f))),
    'chemin 5 — atomicCleanup : appelé par les deux routes d’inscription')
  ok(others.every((f) => !/atomicCleanup\(/.test(read(f))),
    'chemin 5 : jamais appelé ailleurs (il ne vise qu’un compte créé dans la même requête)')
}

// ═══ B. LE COMPTEUR — « QUI PEUT ADMINISTRER DEMAIN MATIN ? » ══════════════
section('B. Le compteur d’administrateurs disponibles')

ok(/export async function countOtherAvailablePlatformAdmins/.test(guard),
  'countOtherAvailablePlatformAdmins existe')
ok(!/countActivePlatformAdmins/.test(guard),
  'l’ancien countActivePlatformAdmins a disparu (pas deux compteurs concurrents)')
for (const [needle, label] of [
  [/eq\('user_type', 'admin'\)/, 'user_type = admin'],
  [/eq\('status', 'active'\)/, 'status = active'],
  [/is\('deletion_scheduled_at', null\)/, 'EXCLUT les comptes en grâce'],
  [/is\('anonymized_at', null\)/, 'EXCLUT les comptes purgés'],
]) {
  ok(needle.test(guard), `compteur : ${label}`)
}
ok(/return null/.test(guard),
  'compteur : renvoie `null` en cas d’erreur de lecture (« je ne sais pas »)',
  'chaque appelant tranche ensuite selon la réversibilité de SON action')
ok(/export function platformAdminCountIncludingTarget/.test(guard),
  'platformAdminCountIncludingTarget : une seule formule pour les deux contextes')

// Les deux gardes doivent poser la question avec les mêmes mots.
ok(/from '@\/lib\/org-members'/.test(guard),
  'la garde plateforme importe le prédicat des organisations')
const orgMembers = read('lib/org-members.ts')
ok(/activeAdminCount <= 1/.test(orgMembers),
  'wouldRemoveLastAdmin inchangé (prédicat partagé, non réécrit)')

// Deux codes distincts : deux échelles, deux remèdes, deux messages.
ok(/'last_admin'/.test(stripComments(read('app/api/admin/user-org-role/route.ts'))),
  'échelle ORGANISATION : code last_admin')
ok(/'last_platform_admin'/.test(guard) && /'last_platform_admin'/.test(deleteRoute),
  'échelle PLATEFORME : code last_platform_admin, distinct')

// ═══ C. LA PURGE DOIT ABOUTIR ══════════════════════════════════════════════
section('C. purgeAccount et la contrainte users_status_check')

// Valeurs admises, extraites de la migration — pas recopiées à la main.
const baseline = read('supabase/migrations/00000000000000_baseline.sql')
const checkLine = baseline.split('\n').find((l) => l.includes('users_status_check'))
ok(!!checkLine, 'users_status_check trouvée dans la migration baseline')
const allowed = checkLine ? [...checkLine.matchAll(/'([a-z_]+)'::character varying/g)].map((m) => m[1]) : []
ok(allowed.length === 6, `CHECK : ${allowed.length} valeurs admises — ${allowed.join(', ')}`)
ok(!allowed.includes('deleted'),
  "CHECK : 'deleted' n’est PAS une valeur admise",
  'aucune migration ne l’ajoute — l’écrire fait échouer l’UPDATE')

// Toute écriture littérale de users.status doit appartenir au CHECK.
const STATUS_WRITERS = [
  'lib/account-purge.ts',
  'app/api/profile/route.ts',
  'app/api/admin/user-status/route.ts',
]
// Le lookbehind est INDISPENSABLE : sans lui, `verification_status` et
// `cdi_status` — d'autres colonnes, d'autres contraintes — seraient comptés
// comme des écritures de `users.status` et feraient échouer le contrôle à tort.
const USERS_STATUS_LITERAL = /(?<![_a-zA-Z])status:\s*'([a-z_]+)'/g
for (const f of STATUS_WRITERS) {
  const code = stripComments(read(f))
  const written = [...code.matchAll(USERS_STATUS_LITERAL)].map((m) => m[1])
  const bad = written.filter((v) => !allowed.includes(v))
  ok(bad.length === 0,
    `${f} : n’écrit que des statuts admis (${written.join(', ') || 'aucun littéral'})`,
    bad.length ? `valeurs refusées par le CHECK : ${bad.join(', ')}` : undefined)
}
// /api/admin/user-status écrit une VARIABLE (`nextStatus`) : le contrôle
// littéral ci-dessus ne la voit pas. On vérifie les valeurs qu'elle peut
// prendre — sinon la route de suspension serait le seul écrivain non couvert.
{
  const code = stripComments(read('app/api/admin/user-status/route.ts'))
  const assigned = [...code.matchAll(/nextStatus(?::\s*string)?\s*=\s*'([a-z_]+)'/g)].map((m) => m[1])
  const bad = assigned.filter((v) => !allowed.includes(v))
  ok(assigned.length > 0 && bad.length === 0,
    `user-status : nextStatus ne prend que des valeurs admises (${assigned.join(', ')})`,
    bad.length ? `valeurs refusées par le CHECK : ${bad.join(', ')}` : undefined)
}
const purge = stripComments(read('lib/account-purge.ts'))
ok(/status: 'archived'/.test(purge), 'purgeAccount : status = archived')
ok(!/status: 'deleted'/.test(purge), 'purgeAccount : plus aucun status = deleted')
ok(/anonymized_at: new Date\(\)\.toISOString\(\)/.test(purge),
  'purgeAccount : anonymized_at posé dans le MÊME update (idempotence)')

// ═══ D. INVENTAIRE — LECTURE SEULE ═════════════════════════════════════════
if (process.argv.includes('--db')) {
  section('D. Inventaire (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    console.log('       → node --env-file=.env.local scripts/diag-account-lifecycle.mjs --db')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    // Administrateurs réellement disponibles — le chiffre que garde ce lot.
    const { count: available } = await db
      .from('users').select('id', { count: 'exact', head: true })
      .eq('user_type', 'admin').eq('status', 'active')
      .is('deletion_scheduled_at', null).is('anonymized_at', null)
    console.log(`       Administrateurs disponibles : ${available ?? 0}`)
    ok((available ?? 0) >= 1, 'au moins un administrateur disponible')
    if ((available ?? 0) === 1) {
      console.log('       (un seul : toute demande de suppression sera refusée — comportement voulu)')
    }

    // Administrateurs déjà en grâce : ils ne comptent plus, et le verrou du
    // cron les protégera s'ils sont les derniers.
    const { data: gracedAdmins } = await db
      .from('users').select('id, email, deletion_scheduled_at')
      .eq('user_type', 'admin').is('anonymized_at', null)
      .not('deletion_scheduled_at', 'is', null)
    console.log(`       Administrateurs en grâce : ${(gracedAdmins ?? []).length}`)
    for (const a of gracedAdmins ?? []) {
      console.log(`         · ${a.email} — échéance ${String(a.deletion_scheduled_at).slice(0, 10)}`)
    }

    // ── COMPTES MI-PURGÉS ────────────────────────────────────────────────
    // Échéance dépassée, anonymisation jamais aboutie : des données
    // personnelles subsistent dans `users`. C'est ce que le point E débloque.
    const nowIso = new Date().toISOString()
    const { data: halfPurged, error: hpErr } = await db
      .from('users')
      .select('id, email, first_name, last_name, phone, user_type, deletion_scheduled_at')
      .lte('deletion_scheduled_at', nowIso)
      .is('anonymized_at', null)
      .not('deletion_scheduled_at', 'is', null)
    if (hpErr) {
      console.log(`  KO   lecture des comptes mi-purgés : ${hpErr.message}`)
      failures++
    } else {
      const rows = halfPurged ?? []
      console.log(`\n       Comptes échus NON anonymisés : ${rows.length}`)
      for (const r of rows) {
        const withPii = [r.first_name, r.last_name, r.phone].some((v) => v !== null && v !== '')
        const days = Math.floor((Date.now() - new Date(r.deletion_scheduled_at).getTime()) / 86400000)
        console.log(
          `         · ${r.email} (${r.user_type}) — échu depuis ${days} j` +
            (withPii ? ' — PII ENCORE PRÉSENTES dans users' : ' — pas de PII résiduelle'),
        )
      }
      if (rows.length === 0) {
        console.log('       Aucun. Rien ne traîne.')
      }
    }
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`)
process.exit(failures === 0 ? 0 : 1)

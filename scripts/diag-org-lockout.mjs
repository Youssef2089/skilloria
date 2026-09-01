// scripts/diag-org-lockout.mjs — LOCK-OUT D'ORGANISATION : le compteur d'admins
// doit compter des PERSONNES JOIGNABLES, pas des lignes.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   `countActiveAdmins` (lib/org-members.ts) ne lisait QUE
//   `organization_members`. Une ligne `role_in_org='admin', status='active'`
//   était comptée même quand le COMPTE derrière ne pouvait plus se connecter.
//
//   Le chemin qui casse : `purgeAccount` (lib/account-purge.ts) anonymise et
//   bannit le compte, mais NE TOUCHE PAS sa ligne d'appartenance — et ce n'est
//   pas un oubli, l'historique d'interaction doit survivre. Résultat : le
//   compteur voyait 1, `wouldRemoveLastAdmin` croyait l'organisation pourvue,
//   et celle-ci se retrouvait sans aucun administrateur joignable. Incapable
//   d'inviter ou de promouvoir depuis ses propres écrans, réparable seulement
//   par le back-office. Un lock-out SILENCIEUX, produit par le garde-fou censé
//   l'empêcher.
//
//   Deux pièges se referment ici, et ce script existe pour qu'aucun ne
//   revienne :
//
//   PIÈGE 1 — « simplifier » en écrivant `status = 'active'`.
//     `requireAuth` ne refuse QUE sur 'suspended'. Le CHECK admet six valeurs.
//     Exiger 'active' retirerait du compte l'admin d'une organisation TOUTE
//     NEUVE (`handle_new_user` insère 'draft') et les comptes 'in_review'.
//     L'organisation tomberait à 0 admin et le garde-fou BLOQUERAIT une
//     gestion de membres légitime. Le compteur doit poser EXACTEMENT la
//     question du garde d'accès.
//
//   PIÈGE 2 — remplacer les deux requêtes par une jointure `users!inner`.
//     `organization_members` porte DEUX clés étrangères vers `users`
//     (`user_id`, `invited_by`) : l'embed est ambigu sans nom de contrainte.
//     Une erreur de syntaxe y retomberait sur le fail-safe, c'est-à-dire
//     cesserait SILENCIEUSEMENT de garder.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-org-lockout.mjs        → contrôles statiques.
//                                              AUCUN accès base.
//   node --env-file=.env.local scripts/diag-org-lockout.mjs --db
//                                            → + inventaire LECTURE SEULE
//                                              (admins fantômes, organisations
//                                              déjà verrouillées).
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

const orgMembers = read('lib/org-members.ts')
const orgMembersCode = stripComments(orgMembers)
const authGuard = stripComments(read('lib/auth-guard.ts'))

/**
 * Corps d'une fonction exportée, isolé entre sa déclaration et la première
 * accolade fermante en colonne 0.
 *
 * Indispensable ici : lib/org-members.ts contient PLUSIEURS fonctions qui
 * lisent `users` (joinBlockReason…) et plusieurs `.eq('status','active')`
 * parfaitement légitimes. Chercher dans le fichier entier ferait dire au
 * diagnostic n'importe quoi — dans les deux sens.
 */
function bodyOf(src, declaration) {
  const start = src.indexOf(declaration)
  if (start === -1) return ''
  const end = src.indexOf('\n}', start)
  return end === -1 ? src.slice(start) : src.slice(start, end)
}

const counterBody = bodyOf(orgMembersCode, 'export async function countActiveAdmins')

// ═══ A. LE COMPTEUR REGARDE LE COMPTE, PAS SEULEMENT LA LIGNE ══════════════
section('A. countActiveAdmins compte des personnes joignables')

ok(
  counterBody !== '' && /\.from\('users'\)/.test(counterBody),
  'countActiveAdmins lit bien la table `users`',
  'sans cette lecture, une ligne d’appartenance orpheline reste comptée',
)
for (const [needle, label] of [
  [/anonymized_at/, 'exclut les comptes ANONYMISÉS (purge RGPD)'],
  [/deletion_scheduled_at/, 'exclut les comptes EN GRÂCE (suppression programmée)'],
  [/SUSPENDED_STATUS/, 'exclut les comptes SUSPENDUS'],
]) {
  ok(needle.test(counterBody), `compteur : ${label}`)
}

// PIÈGE 1 — le contrôle qui coûte le plus cher s'il saute.
// On isole la SECONDE requête (celle sur `users`) DANS le compteur :
// `.eq('status','active')` y est interdit, alors qu'il est légitime dans la
// première (sur la LIGNE d'appartenance, où 'active' est le statut d'adhésion).
const usersQuery = counterBody.slice(counterBody.indexOf(".from('users')"))
ok(
  counterBody.includes(".from('users')") && !/\.eq\('status',\s*'active'\)/.test(usersQuery),
  'compteur : n’exige PAS `status = active` sur le COMPTE',
  'handle_new_user insère `draft` — l’exiger mettrait toute organisation neuve à 0 admin',
)
ok(
  /\.neq\('status',\s*SUSPENDED_STATUS\)/.test(counterBody),
  'compteur : égalité stricte sur `suspended` (neq), jamais `!== active`',
)

// Les deux fichiers doivent parler du MÊME statut bloquant. Le littéral est
// recopié (le module pur n'importe pas le garde de requête) : la cohérence est
// donc VÉRIFIÉE ici plutôt que confiée à la vigilance.
ok(
  /SUSPENDED_STATUS = 'suspended'/.test(orgMembersCode) &&
    /SUSPENDED_STATUS = 'suspended'/.test(authGuard),
  'org-members et auth-guard bloquent sur le MÊME littéral `suspended`',
  'si l’un des deux change, le compteur cesse de rejouer la règle du garde d’accès',
)

// PIÈGE 2 — la jointure ambiguë.
ok(
  !/users!inner/.test(counterBody),
  'compteur : pas d’embed `users!inner` (deux FK vers users → ambiguïté)',
  'un embed ambigu échoue, retombe sur le fail-safe, et cesse de garder EN SILENCE',
)

// ═══ B. LE FAIL-SAFE ET LE PRÉDICAT PARTAGÉ N'ONT PAS BOUGÉ ════════════════
section('B. Fail-safe prudent et prédicat partagé')

ok(
  /PRUDENT_COUNT_ON_READ_ERROR = 2/.test(orgMembersCode),
  'fail-safe : compte prudent (2) en cas d’erreur de lecture',
  'une panne de lecture ne doit pas bloquer une opération légitime réversible',
)
// Les DEUX lectures doivent retomber sur le repli : une seule gardée laisserait
// la seconde renvoyer 0 et bloquer toute l'organisation sur une panne.
ok(
  (counterBody.match(/return PRUDENT_COUNT_ON_READ_ERROR/g) ?? []).length >= 2,
  'fail-safe : les DEUX requêtes retombent sur le compte prudent',
  'une seule gardée laisserait l’autre renvoyer 0 et verrouiller l’org sur une panne',
)
// Le cas « aucune ligne admin » est une CERTITUDE, pas une panne.
ok(
  /if \(userIds\.length === 0\) return 0/.test(counterBody),
  'aucune ligne admin → 0 certain, jamais le repli prudent',
)
ok(
  /activeAdminCount <= 1/.test(orgMembersCode),
  'wouldRemoveLastAdmin inchangé (prédicat pur, partagé, non réécrit)',
)
const predicateBody = bodyOf(orgMembersCode, 'export function wouldRemoveLastAdmin')
ok(
  predicateBody !== '' && !predicateBody.includes('.from('),
  'wouldRemoveLastAdmin reste PUR (aucune lecture base)',
  'il est partagé avec l’échelle plateforme : y glisser une requête le rendrait intransportable',
)

// ═══ C. LES TROIS APPELANTS CONSOMMENT TOUJOURS LA GARDE ═══════════════════
section('C. Les trois appelants du compteur')

for (const [file, label] of [
  ['app/api/admin/user-org-role/route.ts', 'back-office : changement de rôle en organisation'],
  ['app/api/me/organisation/members/[id]/route.ts', 'org : rétrograder / retirer un membre'],
  ['app/api/me/organisation/leave/route.ts', 'org : départ volontaire'],
]) {
  ok(/countActiveAdmins\(/.test(stripComments(read(file))), `${label} — appelle countActiveAdmins`)
}

// L'échelle PLATEFORME est une AUTRE garde, avec un autre fail-safe. Elle ne
// doit pas être confondue ni alignée par mégarde sur celle-ci.
const platformGuard = stripComments(read('lib/admin/user-actions-guard.ts'))
ok(
  /return null/.test(platformGuard),
  'échelle PLATEFORME : countOtherAvailablePlatformAdmins renvoie toujours `null` sur erreur',
  'son appelant purge est DÉFINITIF — ce fail-safe-là ne doit jamais devenir un chiffre',
)

// ═══ D. INVENTAIRE BASE — LECTURE SEULE ════════════════════════════════════
if (process.argv.includes('--db')) {
  section('D. Inventaire (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    console.log('       (charger .env.local : `node --env-file=.env.local scripts/diag-org-lockout.mjs --db`)')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    const { data: members, error: memErr } = await db
      .from('organization_members')
      .select('organization_id, user_id')
      .eq('role_in_org', 'admin')
      .eq('status', 'active')

    if (memErr) {
      console.log(`  KO   lecture des appartenances admin : ${memErr.message}`)
      failures++
    } else {
      const rows = members ?? []
      const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))]
      const { data: users, error: usrErr } = ids.length
        ? await db
            .from('users')
            .select('id, email, status, deletion_scheduled_at, anonymized_at')
            .in('id', ids)
        : { data: [], error: null }

      if (usrErr) {
        console.log(`  KO   lecture des comptes : ${usrErr.message}`)
        failures++
      } else {
        const byId = new Map((users ?? []).map((u) => [u.id, u]))
        const unusable = (u) =>
          !u || u.status === 'suspended' || u.deletion_scheduled_at || u.anonymized_at

        // D1 — les lignes fantômes : admin « actif » dont le compte est mort.
        const ghosts = rows.filter((r) => unusable(byId.get(r.user_id)))
        console.log(`\n       Lignes admin actives : ${rows.length}`)
        console.log(`       Dont FANTÔMES (compte injoignable) : ${ghosts.length}`)
        for (const g of ghosts) {
          const u = byId.get(g.user_id)
          const why = !u
            ? 'compte absent'
            : u.anonymized_at
              ? 'ANONYMISÉ (purgé)'
              : u.deletion_scheduled_at
                ? 'en grâce (suppression programmée)'
                : 'suspendu'
          console.log(`         · org ${g.organization_id} — ${u?.email ?? g.user_id} — ${why}`)
        }
        if (ghosts.length === 0) console.log('       Aucune. Rien ne traîne.')

        // D2 — le vrai symptôme : une organisation SANS aucun admin joignable.
        const byOrg = new Map()
        for (const r of rows) {
          const cur = byOrg.get(r.organization_id) ?? { total: 0, usable: 0 }
          cur.total += 1
          if (!unusable(byId.get(r.user_id))) cur.usable += 1
          byOrg.set(r.organization_id, cur)
        }
        const lockedOut = [...byOrg.entries()].filter(([, c]) => c.usable === 0)
        console.log(`\n       Organisations VERROUILLÉES (0 admin joignable) : ${lockedOut.length}`)
        for (const [orgId, c] of lockedOut) {
          console.log(`         · ${orgId} — ${c.total} ligne(s) admin, aucune exploitable`)
        }
        if (lockedOut.length > 0) {
          console.log('\n       Ces organisations ne peuvent plus inviter ni promouvoir depuis')
          console.log('       leurs propres écrans. Seul le back-office peut les débloquer.')
          failures++
        } else {
          console.log('       Aucune. Toute organisation garde au moins un administrateur joignable.')
        }
      }
    }
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`)
process.exit(failures === 0 ? 0 : 1)

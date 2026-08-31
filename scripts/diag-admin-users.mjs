// scripts/diag-admin-users.mjs — vérifie les INVARIANTS de l'écran
// « Utilisateurs » du back-office (gardes, données servies, traçabilité).
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   Cet écran donne accès à l'ensemble des comptes de la plateforme et porte
//   trois actions irréversibles à chaud. Les règles qui l'encadrent sont des
//   règles de SÉCURITÉ, pas des préférences : elles doivent être vérifiables
//   sans lire six fichiers, et elles doivent casser bruyamment le jour où
//   quelqu'un les assouplit sans y penser.
//
//   Trois familles d'invariants, dans l'ordre de gravité :
//     A. Ce qui NE DOIT PAS sortir du serveur (téléphone, jeton de session).
//     B. Les quatre gardes d'action + la ré-authentification.
//     C. La rotation (jamais l'effacement), la traçabilité, la volumétrie.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-admin-users.mjs          → contrôles statiques. AUCUN
//                                                accès base, aucune env var.
//   node scripts/diag-admin-users.mjs --db     → + inventaire LECTURE SEULE
//                                                (parc de comptes, admins
//                                                actifs, orgs sans admin).
//
// LECTURE PURE : ce script n'écrit JAMAIS, dans aucun mode.

import { readFileSync, existsSync } from 'node:fs'
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

const WRITE_ROUTES = [
  'app/api/admin/user-status/route.ts',
  'app/api/admin/user-revoke-session/route.ts',
  'app/api/admin/user-org-role/route.ts',
]
const READ_ROUTES = [
  'app/api/admin/list-users/route.ts',
  'app/api/admin/get-user/[id]/route.ts',
  'app/api/admin/get-user/[id]/sessions/route.ts',
]
const ALL_ROUTES = [...READ_ROUTES, ...WRITE_ROUTES]

// ═══ A. CE QUI NE DOIT PAS SORTIR DU SERVEUR ═══════════════════════════════
section('A. Données personnelles — ce que l’écran ne doit PAS exposer')

for (const f of ALL_ROUTES) {
  ok(existsSync(join(ROOT, f)), `${f} existe`)
}

for (const f of ALL_ROUTES) {
  const code = stripComments(read(f))
  // Le NUMÉRO de téléphone n'est jamais sélectionné ni projeté. Seul
  // `phone_verified` (booléen) l'est — d'où l'exclusion du mot composé.
  const selectsPhone = /(^|[^_a-z])phone(?!_verified)/.test(code)
  ok(!selectsPhone, `${f} : ne sert JAMAIS le numéro de téléphone`,
    'décision produit : « vérifié oui/non » suffit à administrer un compte')
  ok(
    !/last_session_token/.test(code),
    `${f} : ne lit ni ne projette JAMAIS last_session_token`,
    "c'est un secret d'authentification, il ne quitte pas le serveur",
  )
  ok(!/cv_url|linkedin_url|address_line/.test(code), `${f} : aucune donnée de profil détaillée`)
}

const listUsers = read('app/api/admin/list-users/route.ts')
ok(/phone_verified/.test(listUsers), 'list-users : sert bien `phone_verified` (le fait, pas le numéro)')

// ═══ B. LES QUATRE GARDES + LA RÉ-AUTHENTIFICATION ═════════════════════════
section('B. Gardes des actions d’écriture')

const guardModule = 'lib/admin/user-actions-guard.ts'
ok(existsSync(join(ROOT, guardModule)), `${guardModule} existe (garde PARTAGÉE, pas trois copies)`)
const guard = read(guardModule)
ok(/'self_forbidden'/.test(guard), 'garde 1 : jamais sur soi-même')
ok(/'target_is_admin'/.test(guard), 'garde 2 : jamais sur un autre administrateur')
ok(/'last_platform_admin'/.test(guard), 'garde 3 : jamais zéro administrateur plateforme actif')
// Le compteur renvoyait un chiffre PRUDENT (2) en cas d'erreur de lecture. Ce
// choix, juste pour une action réversible, ne l'est pas pour une purge
// définitive : il est devenu `null` — « je ne sais pas » — et chaque appelant
// tranche selon la réversibilité de SON action (cf. diag-account-lifecycle).
ok(
  /return null/.test(guard),
  'countOtherAvailablePlatformAdmins : renvoie `null` sur erreur de lecture',
  'un compteur qui ment poliment est pire qu’un compteur qui se tait',
)
ok(
  /others !== null &&/.test(guard),
  'suspension (réversible) : comptage indisponible ⇒ on laisse passer',
)

for (const f of WRITE_ROUTES) {
  const code = stripComments(read(f))
  ok(/requireAdmin\(request\)/.test(code), `${f} : garde admin`)
  ok(/requireReauth\(request, auth\.user\.id\)/.test(code), `${f} : RÉ-AUTHENTIFICATION exigée`,
    'mécanisme existant (grant HMAC 5 min), aucun second mécanisme')
  ok(/refuseAdminActionOnTarget\(/.test(code), `${f} : applique les gardes partagées`)
  // La ré-auth doit précéder la lecture de la cible : on ne renseigne pas un
  // appelant qui n'a pas re-prouvé son identité.
  const iReauth = code.indexOf('requireReauth')
  const iTarget = code.indexOf('loadAdminActionTarget')
  ok(iReauth > 0 && iTarget > 0 && iReauth < iTarget, `${f} : la ré-auth précède la lecture de la cible`)
}

// Garde 4 — anti-lock-out d'organisation : jamais contourné implicitement.
const roleRoute = stripComments(read('app/api/admin/user-org-role/route.ts'))
ok(
  /wouldRemoveLastAdmin\(/.test(roleRoute) && /countActiveAdmins\(/.test(roleRoute),
  'user-org-role : réutilise la garde anti-lock-out existante (non réécrite)',
)
ok(
  /body\.force === true/.test(roleRoute),
  'user-org-role : `force` n’est vrai que sur un booléen true LITTÉRAL',
  'ni "true", ni 1 : un contournement doit être délibéré, pas une coercition de type',
)
ok(
  /if \(!force\)/.test(roleRoute) && /code: 'last_admin'/.test(roleRoute),
  'user-org-role : refus 409 par DÉFAUT, la garde ne cède que sur force explicite',
)

// ═══ C. ROTATION, TRAÇABILITÉ, VOLUMÉTRIE ══════════════════════════════════
section('C. Rotation de session, traçabilité, volumétrie')

for (const f of ['app/api/admin/user-status/route.ts', 'app/api/admin/user-revoke-session/route.ts']) {
  const code = stripComments(read(f))
  ok(
    !/clearSessionToken/.test(code),
    `${f} : n’appelle JAMAIS clearSessionToken`,
    'clearSessionToken met le jeton à NULL, ce qui DÉSACTIVE la vérification ' +
      '(auth-guard: `if (userRow.last_session_token)`) au lieu de la faire échouer. ' +
      'La bonne primitive est setSessionToken avec un jeton neuf transmis à personne.',
  )
  ok(
    /setSessionToken\(/.test(code) && /generateSessionToken\(\)/.test(code),
    `${f} : rote le jeton (setSessionToken + jeton neuf)`,
  )
  // L'avertissement doit rester DANS le fichier : c'est là que quelqu'un se
  // trompera dans six mois, pas dans un document annexe.
  ok(
    /clearSessionToken/.test(read(f)),
    `${f} : l’avertissement « rotation, jamais effacement » est documenté sur place`,
  )
}

const statusRoute = stripComments(read('app/api/admin/user-status/route.ts'))
ok(
  /action === 'suspend'/.test(statusRoute) && /setSessionToken\(/.test(statusRoute),
  'user-status : suspendre = changer le statut ET roter, dans la même opération',
  'une suspension qui laisse vivre la session en cours ne suspend rien',
)
// Mesure d'ACCÈS : aucune autre table écrite.
for (const table of ['publications', 'candidatures', 'matches', 'conversations']) {
  ok(
    !new RegExp(`from\\('${table}'\\)`).test(statusRoute),
    `user-status : ne touche pas à \`${table}\` (mesure d’accès, pas sanction commerciale)`,
  )
}

// Traçabilité : actions de sécurité tracées AVEC l'IP et le user-agent.
for (const [f, action] of [
  ['app/api/admin/user-status/route.ts', "user_suspended' : 'user_reactivated"],
  ['app/api/admin/user-revoke-session/route.ts', 'user_session_revoked'],
  ['app/api/admin/user-org-role/route.ts', 'org_member_role_changed'],
]) {
  const code = stripComments(read(f))
  ok(new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(code), `${f} : action d’audit posée`)
  ok(/\brequest,\n/.test(code) || /request,\s*\}\)/.test(code), `${f} : audit avec ip_address / user_agent`)
  ok(/target_domain_id/.test(code), `${f} : écosystème de la CIBLE dans detail (domain_id = celui de l’admin)`)
}
const audit = read('lib/audit.ts')
ok(/ip_address: request \?/.test(audit) && /user_agent: request \?/.test(audit),
  'logAudit : remplit ip_address / user_agent quand la requête est fournie')
ok(/from '@\/lib\/request-meta'/.test(audit) && /from '@\/lib\/request-meta'/.test(read('lib/session-log.ts')),
  'extraction IP/UA PARTAGÉE entre audit_logs et session_logs (source unique)')

// RGPD : consultation de FICHE tracée, jamais la liste.
ok(/user_record_viewed/.test(read('app/api/admin/get-user/[id]/route.ts')),
  'get-user : la consultation d’une fiche est tracée (RGPD)')
ok(!/logAudit/.test(listUsers),
  'list-users : la LISTE n’est pas tracée',
  'une écriture par page de pagination serait du bruit qui noierait les accès réels')

// Volumétrie : plus aucun plafond muet.
ok(/count: 'exact'/.test(listUsers) && /has_more/.test(listUsers),
  'list-users : total exact + has_more (pagination réelle)')
for (const f of ['app/api/admin/list-experts/route.ts', 'app/api/admin/list-orgs/route.ts']) {
  const code = read(f)
  ok(/count: 'exact'/.test(code) && /truncated/.test(code) && /LIST_LIMIT/.test(code),
    `${f} : plafond ANNONCÉ (total + truncated), plus silencieux`)
}
for (const f of ['app/[locale]/admin/experts/page.tsx', 'app/[locale]/admin/organisations/page.tsx']) {
  ok(/truncated_notice/.test(read(f)), `${f} : affiche le bandeau de troncature`)
}

// Écrans : règle du bouton Retour + i18n.
ok(!/back_to_list/.test(read('app/[locale]/admin/utilisateurs/page.tsx')),
  'écran liste (MENU) : aucun bouton Retour')
// Ce contrôle exigeait un lien « Retour » LOCAL sur la fiche. C'était une
// erreur : le layout admin monte déjà <GlobalBackButton>, si bien que la page
// en affichait DEUX, empilés. La règle projet dit « un bouton Retour global
// UNIQUE » — donc aucun bouton local, ni ici ni ailleurs sous /admin.
ok(!/back_to_list/.test(read('app/[locale]/admin/utilisateurs/[id]/page.tsx')),
  'écran fiche (DÉTAIL) : aucun bouton Retour local (le global suffit)')
ok(/GlobalBackButton/.test(read('app/[locale]/admin/layout.tsx')),
  'layout admin : rend LE bouton Retour global, pour toutes ses pages de détail')
ok(/ReauthModal/.test(read('app/[locale]/admin/utilisateurs/[id]/page.tsx')),
  'écran fiche : réutilise <ReauthModal> existant')

for (const loc of ['fr', 'en', 'es', 'de']) {
  const m = JSON.parse(read(`messages/${loc}.json`))
  const u = m.admin_back_office?.users
  ok(
    !!u?.title && !!u?.confirm_role_last_admin_warning && !!u?.truncated_notice &&
      !!m.admin_back_office?.sidebar?.nav_utilisateurs,
    `i18n ${loc} : libellés de l’écran Utilisateurs présents`,
  )
}

// ═══ D. INVENTAIRE BASE — LECTURE SEULE ════════════════════════════════════
if (process.argv.includes('--db')) {
  section('D. Inventaire (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    console.log('       (charger .env.local avant : `node --env-file=.env.local scripts/diag-admin-users.mjs --db`)')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    for (const s of ['draft', 'active', 'in_review', 'suspended', 'rejected', 'archived']) {
      const { count } = await db.from('users').select('id', { count: 'exact', head: true }).eq('status', s)
      console.log(`       ${s.padEnd(10)} ${String(count ?? 0).padStart(5)}`)
    }

    const { count: admins } = await db
      .from('users').select('id', { count: 'exact', head: true })
      .eq('user_type', 'admin').eq('status', 'active')
    ok((admins ?? 0) >= 1, `au moins un administrateur plateforme actif (${admins ?? 0})`,
      'la garde 3 refuserait toute action laissant la plateforme sans administrateur')

    // Organisations déjà sans administrateur actif : c'est le cas d'usage même
    // de la route de rôle. Informatif, jamais bloquant.
    const { data: memberRows } = await db
      .from('organization_members')
      .select('organization_id, role_in_org, status')
      .eq('status', 'active')
    const byOrg = new Map()
    for (const m of memberRows ?? []) {
      const cur = byOrg.get(m.organization_id) ?? { total: 0, admins: 0 }
      cur.total++
      if (m.role_in_org === 'admin') cur.admins++
      byOrg.set(m.organization_id, cur)
    }
    const orphan = [...byOrg.entries()].filter(([, v]) => v.admins === 0)
    console.log(
      `\n       Organisations actives sans administrateur : ${orphan.length}` +
        (orphan.length ? ' — cet écran est justement là pour les dépanner.' : ''),
    )
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`)
process.exit(failures === 0 ? 0 : 1)

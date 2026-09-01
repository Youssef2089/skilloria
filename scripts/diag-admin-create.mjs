// scripts/diag-admin-create.mjs — CRÉATION D'UN ADMINISTRATEUR : le point mort
// du trigger, le contournement assumé, et l'invitation qui doit pouvoir repartir.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//
//   PIÈGE 1 — LE POINT MORT DU TRIGGER. `handle_new_user` ne connaît que
//     expert / cdi / entreprise / cabinet. Pour tout autre `role` :
//         RAISE WARNING ... ; RETURN NEW;
//     Le compte `auth.users` est créé, la fonction rend la main SANS ERREUR, et
//     `public.users` n'a AUCUNE ligne. Le compte passerait `requireAuth` puis
//     échouerait partout : `requireAdmin` lit `users.user_type` et ne trouve
//     rien. Compte fantôme, inconnectable, qui OCCUPE l'adresse e-mail.
//     La vérification explicite du miroir + `atomicCleanup` est la SEULE chose
//     qui transforme cet échec muet en échec propre. Elle ressemble à une
//     redondance ; c'est le contrôle que quelqu'un retirera en croyant
//     simplifier. D'où trois contrôles ici, pas un.
//
//   PIÈGE 2 — LE MOT DE PASSE QUI REMONTE. Le créateur ne doit JAMAIS connaître
//     le secret d'un autre administrateur. Un `password` renvoyé, journalisé ou
//     affiché ruinerait tout le montage.
//
//   PIÈGE 3 — LA BASCULE INCOMPLÈTE. `status` doit passer à 'active' : le
//     trigger pose 'draft', et `countOtherAvailablePlatformAdmins` ne compte QUE
//     les 'active'. Un administrateur resté 'draft' existe mais ne compte pas —
//     l'anti-lock-out plateforme le croirait absent.
//
//   PIÈGE 4 — LE RENVOI D'INVITATION SUPPRIMÉ. Sans lui, chaque panne SMTP
//     recrée un problème du jour zéro : un compte créé, valide, et sans accès.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-admin-create.mjs        → contrôles statiques.
//                                               AUCUN accès base.
//   node --env-file=.env.local scripts/diag-admin-create.mjs --db
//                                             → + inventaire LECTURE SEULE
//                                               (parc d'administrateurs,
//                                               comptes fantômes, invitations
//                                               en attente).
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

const createRoute = stripComments(read('app/api/admin/create-admin/route.ts'))
const resendRoute = stripComments(read('app/api/admin/user-resend-invite/route.ts'))
const invitation = stripComments(read('lib/admin/admin-invitation.ts'))
const getUserRoute = stripComments(read('app/api/admin/get-user/[id]/route.ts'))
const listScreen = stripComments(read('app/[locale]/admin/utilisateurs/page.tsx'))
const detailScreen = stripComments(read('app/[locale]/admin/utilisateurs/[id]/page.tsx'))

// ═══ A. LE POINT MORT DU TRIGGER ═══════════════════════════════════════════
section('A. Vérification du miroir — le contrôle à ne jamais retirer')

// Le défaut est bien TOUJOURS là dans la migration : si un jour il disparaît,
// ce diag doit le dire, pas continuer à garder un fantôme.
const trigger = read('supabase/migrations/20260804000000_taxonomie_specialite_autre_et_inscription.sql')
ok(
  /IF v_user_type IS NULL THEN[\s\S]{0,300}?RAISE WARNING[\s\S]{0,200}?RETURN NEW;/.test(trigger),
  'le trigger renvoie toujours SANS ERREUR sur un rôle inconnu (le défaut existe)',
  'si ce n’est plus vrai, relire ce diag AVANT de retirer la vérification du miroir',
)
ok(
  !/WHEN 'admin'/.test(trigger),
  'le trigger ne sait toujours pas créer un admin (d’où le contournement)',
)
// PIÈGE 1 — trois contrôles, parce qu'un seul se retire trop facilement.
// Le SELECT du miroir, identifié par sa projection propre — et pas par un
// `.from('users')` quelconque : l'UPDATE de bascule, juste en dessous, en porte
// un aussi. Cherché trop large, ce contrôle ne mordait pas quand on retirait la
// lecture (constaté au test de mutation), ce qui en faisait un contrôle décoratif.
ok(
  /\.select\('id, locale'\)[\s\S]{0,120}?\.eq\('id', newUserId\)/.test(createRoute),
  'la route RELIT public.users après createUser',
  'sans cette lecture, on répondrait 200 sur un compte fantôme inconnectable',
)
ok(
  /if \(mirrorErr \|\| !mirror\)/.test(createRoute),
  'l’absence de miroir est traitée comme un ÉCHEC, pas ignorée',
)
ok(
  /atomicCleanup\(auth\.supabaseAdmin, \{ userId: newUserId \}\)/.test(createRoute),
  'miroir absent → atomicCleanup (public.users puis auth.users)',
  'auth.admin.deleteUser ne cascade PAS sur public.users — piège P3',
)
ok(
  /mirror_missing/.test(createRoute),
  'l’échec porte un code lisible (mirror_missing), pas un 500 muet',
)

// ═══ B. LE CONTOURNEMENT ASSUMÉ, ET SA BASCULE COMPLÈTE ════════════════════
section('B. Contournement du trigger et bascule')

ok(
  /TRIGGER_BRIDGE_ROLE = 'entreprise'/.test(createRoute),
  'création via un rôle que le trigger SAIT traiter (entreprise)',
)
ok(
  /role: TRIGGER_BRIDGE_ROLE/.test(createRoute) && !/role: 'admin'/.test(createRoute),
  'les métadonnées n’envoient JAMAIS role:"admin" au trigger',
  'il tomberait dans la branche « rôle inconnu » et ne créerait aucun miroir',
)
for (const [needle, label] of [
  [/user_type: 'admin'/, 'user_type = admin'],
  [/role_id: roleRow\.id/, 'role_id = rôle commercial « Admin »'],
  [/status: 'active'/, 'status = active'],
]) {
  ok(needle.test(createRoute), `bascule : ${label}`)
}
// PIÈGE 3 — le contrôle qui coûte cher s'il saute.
ok(
  /status: 'active'/.test(createRoute),
  'bascule : status passe bien à `active`',
  'countOtherAvailablePlatformAdmins ne compte QUE les actifs — un admin en draft ne compterait pas',
)
ok(
  /ADMIN_ROLE_NAME = 'Admin'/.test(createRoute) && /admin_role_missing/.test(createRoute),
  'rôle « Admin » absent → échec EXPLICITE, jamais de repli silencieux',
)
ok(
  /\.eq\('active', true\)/.test(createRoute),
  'l’écosystème cible doit être ACTIF (le trigger l’exige et lèverait sinon)',
)

// ═══ C. LE CRÉATEUR NE CONNAÎT JAMAIS LE SECRET ════════════════════════════
section('C. Mot de passe : jamais chez le créateur')

ok(
  /randomUUID\(\)/.test(createRoute),
  'mot de passe initial ALÉATOIRE',
)
// PIÈGE 2 — le secret qui remonte.
const createResponses = createRoute.match(/return json\([\s\S]*?\)/g) ?? []
ok(
  !createResponses.some((r) => /password/.test(r)),
  'AUCUNE réponse de la route ne contient de mot de passe',
)
ok(
  !/console\.(log|warn|error)\([^)]*password/i.test(createRoute),
  'aucun mot de passe journalisé',
)
ok(
  /email_confirm: true/.test(createRoute),
  'adresse confirmée d’office : un seul e-mail, celui qui compte',
)
ok(
  /resetPasswordForEmail/.test(invitation) && !/resetPasswordForEmail/.test(createRoute),
  'l’envoi vit dans lib/admin/admin-invitation.ts, partagé — pas recopié dans la route',
)
ok(
  /getSupabaseAnon/.test(invitation) && /NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(invitation),
  'l’invitation part d’un client ANON (le chemin qui déclenche réellement le SMTP)',
)

// ═══ D. L'INVITATION DOIT POUVOIR REPARTIR ═════════════════════════════════
section('D. Renvoi d’invitation — le filet du jour zéro')

// PIÈGE 4 — sans ce chemin, chaque panne SMTP recrée un compte sans accès.
ok(
  /sendAdminInvitation\(/.test(resendRoute),
  'la route de renvoi existe et réutilise le MÊME envoi',
)
ok(
  /invitationSent/.test(createRoute) && /invitation_sent: invitationSent/.test(createRoute),
  'la création SIGNALE l’échec d’envoi au lieu de l’avaler',
)
ok(
  !/atomicCleanup[\s\S]{0,200}?invitationSent/.test(createRoute),
  'un échec SMTP n’annule PAS un compte valide',
  'annuler recréerait un jour zéro à chaque hoquet du serveur de mail',
)
// La fenêtre étroite, c'est elle qui fait la sécurité de cette route.
for (const [needle, label] of [
  [/target\.user_type !== 'admin'/, 'la cible doit être un administrateur'],
  [/target\.anonymized_at \|\| target\.deletion_scheduled_at/, 'ni anonymisée, ni en grâce'],
  [/from\('session_logs'\)/, 'JAMAIS connectée — établi sur session_logs'],
]) {
  ok(needle.test(resendRoute), `fenêtre étroite : ${label}`)
}
ok(
  !/last_login_at/.test(resendRoute),
  'le renvoi ne se fie PAS à last_login_at',
  'la migration 20260709000009 l’a rétro-rempli avec created_at : il ne prouve rien',
)

// ═══ E. GARDES ET TRAÇABILITÉ ══════════════════════════════════════════════
section('E. Gardes et traçabilité')

for (const [src, name] of [[createRoute, 'create-admin'], [resendRoute, 'user-resend-invite']]) {
  ok(/requireAdmin\(request\)/.test(src), `${name} : requireAdmin`)
  ok(/requireReauth\(request, auth\.user\.id\)/.test(src), `${name} : ré-authentification exigée`)
  ok(/checkRateLimit\(/.test(src), `${name} : limitation de débit (mécanisme existant)`)
  ok(/rate_limited/.test(src), `${name} : refus lisible quand la limite est atteinte`)
}
ok(
  /action: 'admin_account_created'/.test(createRoute) && /user_id: auth\.user\.id/.test(createRoute),
  'audit `admin_account_created`, user_id = l’administrateur AGISSANT',
)
ok(
  /action: 'admin_invite_resent'/.test(resendRoute),
  'audit `admin_invite_resent` sur le renvoi',
)
// L'adresse est une donnée personnelle : entity_id suffit à désigner la cible.
for (const [src, name] of [[createRoute, 'create-admin'], [resendRoute, 'user-resend-invite']]) {
  const detail = src.slice(src.indexOf('detail: {'), src.indexOf('detail: {') + 400)
  ok(
    src.includes('detail: {') && !/email/.test(detail),
    `${name} : AUCUN e-mail dans le detail d’audit`,
  )
}

// ═══ F. L'ÉCRAN ════════════════════════════════════════════════════════════
section('F. Écran')

ok(
  /action_create_admin/.test(listScreen) && /create-admin/.test(listScreen),
  'liste : le bouton « Créer un administrateur » vit sur la LISTE',
)
ok(
  /ReauthModal/.test(listScreen),
  'liste : la création passe par <ReauthModal> existant',
)
ok(
  !/password/i.test(listScreen.slice(listScreen.indexOf('create_admin_title'))),
  'liste : aucun champ mot de passe dans le formulaire de création',
)
ok(
  /can_resend_invite/.test(getUserRoute) && /actions\?\.can_resend_invite === true/.test(detailScreen),
  'fiche : le renvoi suit un verdict SERVEUR, jamais deviné',
)
ok(
  /invite_pending_notice/.test(detailScreen),
  'fiche : un administrateur jamais connecté est SIGNALÉ, pas silencieux',
)

// ═══ G. i18n — 4 LANGUES ═══════════════════════════════════════════════════
section('G. i18n')

const KEYS = [
  'action_create_admin', 'create_admin_title', 'create_admin_body', 'create_admin_email',
  'create_admin_first_name', 'create_admin_last_name', 'create_admin_ecosystem',
  'create_admin_ecosystem_default', 'create_admin_ecosystem_hint', 'create_admin_submit',
  'toast_admin_created', 'toast_admin_created_no_email', 'invite_pending_notice',
  'action_resend_invite', 'toast_invite_resent', 'err_email_taken', 'err_rate_limited',
  'err_invalid_ecosystem', 'err_mirror_missing', 'err_invitation_failed', 'err_already_signed_in',
]
for (const loc of ['fr', 'en', 'es', 'de']) {
  const u = JSON.parse(read(`messages/${loc}.json`)).admin_back_office?.users ?? {}
  const missing = KEYS.filter((k) => !u[k])
  ok(missing.length === 0, `i18n ${loc} : les ${KEYS.length} libellés sont présents`,
    missing.length ? `manquantes : ${missing.join(', ')}` : undefined)
}

// ═══ H. INVENTAIRE BASE — LECTURE SEULE ════════════════════════════════════
if (process.argv.includes('--db')) {
  section('H. Inventaire (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    console.log('       (charger .env.local : `node --env-file=.env.local scripts/diag-admin-create.mjs --db`)')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    // H1 — le parc d'administrateurs, et son état.
    const { data: admins, error: aErr } = await db
      .from('users')
      .select('id, email, status, created_at, anonymized_at, deletion_scheduled_at')
      .eq('user_type', 'admin')
      .order('created_at', { ascending: true })
    if (aErr) {
      console.log(`  KO   lecture du parc d’administrateurs : ${aErr.message}`)
      failures++
    } else {
      const rows = admins ?? []
      const available = rows.filter(
        (r) => r.status === 'active' && !r.anonymized_at && !r.deletion_scheduled_at,
      )
      console.log(`\n       Administrateurs : ${rows.length} — dont DISPONIBLES : ${available.length}`)
      for (const r of rows) {
        const flags = [
          r.status !== 'active' ? `status=${r.status}` : null,
          r.anonymized_at ? 'ANONYMISÉ' : null,
          r.deletion_scheduled_at ? 'en grâce' : null,
        ].filter(Boolean)
        console.log(`         · ${r.email} — ${flags.length ? flags.join(', ') : 'disponible'}`)
      }
      // Un admin resté en 'draft' : symptôme d'une bascule incomplète (piège 3).
      const draft = rows.filter((r) => r.status === 'draft')
      if (draft.length > 0) {
        console.log(`\n       ⚠ ${draft.length} administrateur(s) en 'draft' — bascule incomplète :`)
        console.log('         ils ne sont PAS comptés par l’anti-lock-out plateforme.')
        failures++
      }
      if (available.length === 0) {
        console.log('\n       ⚠ AUCUN administrateur disponible — la plateforme est verrouillée.')
        failures++
      }

      // H2 — invitations en attente : créés, jamais connectés.
      const ids = rows.map((r) => r.id)
      const { data: logs, error: lErr } = ids.length
        ? await db.from('session_logs').select('user_id').in('user_id', ids)
        : { data: [], error: null }
      if (lErr) {
        console.log(`  KO   lecture des connexions : ${lErr.message}`)
        failures++
      } else {
        const seen = new Set((logs ?? []).map((l) => l.user_id))
        const never = rows.filter((r) => !seen.has(r.id) && !r.anonymized_at)
        console.log(`\n       Invitations EN ATTENTE (jamais connectés) : ${never.length}`)
        for (const r of never) {
          const days = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
          console.log(`         · ${r.email} — créé il y a ${days} j`)
        }
        if (never.length === 0) console.log('       Aucune. Tous les administrateurs se sont connectés.')
      }
    }
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`)
process.exit(failures === 0 ? 0 : 1)

// scripts/diag-admin-purge.mjs — SUPPRESSION DÉFINITIVE depuis le back-office :
// une action IRRÉVERSIBLE, donc trois barrières et aucune seconde mécanique.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   « Supprimer définitivement » = ANONYMISATION IMMÉDIATE, pas DELETE de la
//   ligne. Le schéma ne laisse pas le choix : `messages_sender_id_fkey` est ON
//   DELETE CASCADE (supprimer la ligne effacerait l'historique de l'AUTRE
//   partie) et `audit_logs_user_id_fkey` est ON DELETE RESTRICT (la base
//   refuserait de toute façon). Ce script vérifie que le code n'essaie jamais
//   de reprendre ce choix à son compte.
//
//   Quatre régressions plausibles, et coûteuses :
//
//   1. Réécrire l'effacement au lieu d'appeler `purgeAccount`. Deux mécaniques
//      d'anonymisation divergeront — c'est déjà l'histoire de
//      `deriveCandidatureLifecycle` sur ce projet.
//   2. Appeler `auth.admin.deleteUser` « pour bien nettoyer ». CASCADE sur
//      messages : l'organisation perd des conversations qu'elle a réellement
//      eues.
//   3. Retirer la saisie de l'e-mail, ou ne la vérifier QUE dans le .tsx.
//      C'est la seule des trois barrières qui adresse l'erreur de CIBLE ;
//      côté écran seulement, elle ne garde rien.
//   4. Transformer l'avertissement « dernier admin d'une organisation » en
//      BLOCAGE. Cela subordonnerait un droit RGPD (art. 17) à une structure
//      d'organisation — décision produit explicitement écartée.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//   node scripts/diag-admin-purge.mjs        → contrôles statiques.
//                                              AUCUN accès base.
//   node --env-file=.env.local scripts/diag-admin-purge.mjs --db
//                                            → + inventaire LECTURE SEULE
//                                              (purges administrateur tracées,
//                                              comptes restés à mi-chemin).
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

const purgeRoute = stripComments(read('app/api/admin/user-purge/route.ts'))
const getUserRoute = stripComments(read('app/api/admin/get-user/[id]/route.ts'))
const screen = stripComments(read('app/[locale]/admin/utilisateurs/[id]/page.tsx'))
const accountPurge = stripComments(read('lib/account-purge.ts'))

// ═══ A. RÉUTILISATION : AUCUNE SECONDE MÉCANIQUE D'EFFACEMENT ══════════════
section('A. purgeAccount réutilisée, jamais réécrite')

ok(
  /from '@\/lib\/account-purge'/.test(purgeRoute) && /purgeAccount\(/.test(purgeRoute),
  'la route appelle purgeAccount (lib/account-purge.ts)',
  'la MÊME fonction que les deux purges planifiées — une seule mécanique',
)
// RÉGRESSION 2 — la plus destructrice.
ok(
  !/deleteUser\(/.test(purgeRoute),
  'la route n’appelle JAMAIS auth.admin.deleteUser',
  'messages_sender_id_fkey est ON DELETE CASCADE : l’historique de l’autre partie disparaîtrait',
)
// RÉGRESSION 1 — l'effacement recopié sur place.
for (const [needle, label] of [
  [/ban_duration/, 'le bannissement'],
  [/anonymized_at:/, 'la pose de anonymized_at'],
  [/first_name: null/, 'le vidage des PII'],
]) {
  ok(!needle.test(purgeRoute), `la route ne réimplémente pas ${label}`)
}
ok(
  /ban_duration/.test(accountPurge) && /anonymized_at/.test(accountPurge),
  'lib/account-purge.ts porte toujours l’effacement (bannissement + anonymized_at)',
)

// ═══ B. LES TROIS BARRIÈRES, TOUTES CÔTÉ SERVEUR ═══════════════════════════
section('B. Trois barrières de trois natures différentes')

ok(
  /requireReauth\(request, auth\.user\.id\)/.test(purgeRoute),
  'barrière 1 (IDENTITÉ) : requireReauth — mécanisme existant, pas un second',
)
// RÉGRESSION 3 — la barrière qui adresse l'erreur de CIBLE.
ok(
  /confirm_email/.test(purgeRoute) && /confirm_email_mismatch/.test(purgeRoute),
  'barrière 2 (ATTENTION) : l’e-mail retapé est REVALIDÉ par le serveur',
  'vérifié seulement dans le .tsx, ce champ ne garde rien',
)
ok(
  /typedEmail !== actualEmail/.test(purgeRoute),
  'barrière 2 : la comparaison porte bien sur l’adresse de la CIBLE',
)
ok(
  /refuseAdminActionOnTarget\(/.test(purgeRoute) &&
    /from '@\/lib\/admin\/user-actions-guard'/.test(purgeRoute),
  'barrière 3 (RÈGLE MÉTIER) : garde PARTAGÉE importée, aucune garde nouvelle',
)
// Les interdits ne doivent pas être recopiés dans la route.
ok(
  !/user_type === 'admin'/.test(purgeRoute) && !/=== auth\.user\.id/.test(purgeRoute),
  'la route ne réécrit NI « jamais sur soi-même » NI « jamais sur un admin »',
  'ces deux interdits vivent dans user-actions-guard.ts, et nulle part ailleurs',
)
// L'ordre compte : on ne renseigne pas un appelant non ré-authentifié.
ok(
  purgeRoute.indexOf('requireReauth') < purgeRoute.indexOf('loadAdminActionTarget'),
  'la ré-authentification précède toute lecture de la cible',
)

// ═══ C. DERNIER ADMIN D'UNE ORGANISATION : AVERTIR, PAS BLOQUER ════════════
section('C. Avertissement organisation + acquittement revalidé')

ok(
  /wouldRemoveLastAdmin\(/.test(purgeRoute) && /countActiveAdmins\(/.test(purgeRoute),
  'l’avertissement réutilise le prédicat ET le compteur partagés',
  'trois échelles, un seul raisonnement — rien de recalculé sur place',
)
ok(
  /acknowledge_org_lockout === true/.test(purgeRoute),
  'acquittement REVALIDÉ au serveur (drapeau strictement `true`)',
)
ok(
  /org_lockout_ack_required/.test(purgeRoute),
  'sans acquittement : refus explicite, avec les organisations concernées',
)
// RÉGRESSION 4 — l'avertissement transformé en verrou.
ok(
  /lockedOutOrgs\.length > 0 && !acknowledged/.test(purgeRoute),
  'le verrouillage d’organisation n’est JAMAIS bloquant en soi',
  'bloquer subordonnerait un droit RGPD (art. 17) à une structure d’organisation',
)

// ═══ D. TRAÇABILITÉ — QUI, ET SANS RÉINTRODUIRE LA PII ═════════════════════
section('D. Traçabilité de l’auteur')

ok(
  /action: 'admin_account_purged'/.test(purgeRoute),
  'audit `admin_account_purged` écrit par la route',
)
ok(
  /user_id: auth\.user\.id/.test(purgeRoute),
  'audit : user_id = l’ADMINISTRATEUR AGISSANT',
  'purgeAccount trace déjà la CIBLE ; sans celui-ci le journal dit que c’est arrivé, pas qui l’a fait',
)
ok(
  /action: 'account_purged'/.test(accountPurge),
  'purgeAccount continue de tracer la cible (account_purged)',
)
ok(
  /request,/.test(purgeRoute),
  'audit : IP et user-agent renseignés (action de sécurité)',
)
// L'adresse est précisément ce qu'on efface : l'écrire au journal annulerait
// la purge qu'on est en train de tracer.
const auditDetail = purgeRoute.slice(purgeRoute.indexOf('admin_account_purged'))
ok(
  !/email/.test(auditDetail),
  'audit : AUCUN e-mail dans `detail`',
  'entity_id identifie la cible ; l’adresse est la donnée qu’on efface',
)
ok(
  /org_lockout_acknowledged/.test(purgeRoute),
  'audit : le motif de l’avertissement est porté au journal',
)

// ═══ E. L'ÉCRAN NE DEVINE RIEN ═════════════════════════════════════════════
section('E. Écran : verdict serveur, zone séparée')

ok(
  /can_purge: purgeRefusalCode === null/.test(getUserRoute),
  'get-user sert `can_purge`, dérivé de la garde partagée',
)
ok(
  /purge_org_lockout/.test(getUserRoute) && /wouldRemoveLastAdmin\(/.test(getUserRoute),
  'get-user sert l’avertissement organisation AVANT le clic',
)
ok(
  /already_anonymized/.test(getUserRoute),
  'get-user : un compte déjà purgé ne propose plus l’action',
)
ok(
  /actions\?\.can_purge === true/.test(screen),
  'écran : le bouton suit le verdict SERVEUR',
)
ok(
  /purge_blocked_self/.test(screen) &&
    /purge_blocked_admin/.test(screen) &&
    /purge_blocked_already_anonymized/.test(screen),
  'écran : la RAISON du masquage est affichée, pas seulement le vide',
)
ok(
  /section_danger/.test(screen),
  'écran : l’action irréversible vit dans sa propre zone, hors barre d’actions',
)
ok(
  /confirm_purge_org_lockout_ack/.test(screen),
  'écran : l’acquittement est demandé quand le serveur signale le verrouillage',
)

// ═══ F. i18n — 4 LANGUES, PARITÉ STRICTE ═══════════════════════════════════
section('F. i18n')

const PURGE_KEYS = [
  'action_purge', 'section_danger', 'purge_section_body',
  'purge_blocked_self', 'purge_blocked_admin', 'purge_blocked_already_anonymized',
  'confirm_purge_title', 'confirm_purge_body', 'confirm_purge_irreversible',
  'confirm_purge_org_lockout', 'confirm_purge_org_lockout_ack', 'confirm_purge_email_label',
  'confirm_purge_yes', 'purge_org_unnamed', 'toast_purged',
  'err_confirm_email_mismatch', 'err_already_anonymized', 'err_purge_failed',
]
for (const loc of ['fr', 'en', 'es', 'de']) {
  const u = JSON.parse(read(`messages/${loc}.json`)).admin_back_office?.users ?? {}
  const missing = PURGE_KEYS.filter((k) => !u[k])
  ok(missing.length === 0, `i18n ${loc} : les ${PURGE_KEYS.length} libellés de purge sont présents`,
    missing.length ? `manquantes : ${missing.join(', ')}` : undefined)
}

// ═══ G. INVENTAIRE BASE — LECTURE SEULE ════════════════════════════════════
if (process.argv.includes('--db')) {
  section('G. Inventaire (LECTURE SEULE)')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    console.log('       (charger .env.local : `node --env-file=.env.local scripts/diag-admin-purge.mjs --db`)')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    // G1 — les purges décidées par un administrateur, et par qui.
    const { data: purges, error: pErr } = await db
      .from('audit_logs')
      .select('created_at, user_id, entity_id, detail, ip_address')
      .eq('action', 'admin_account_purged')
      .order('created_at', { ascending: false })
      .limit(50)
    if (pErr) {
      console.log(`  KO   lecture des purges administrateur : ${pErr.message}`)
      failures++
    } else {
      const rows = purges ?? []
      console.log(`\n       Purges décidées depuis le back-office : ${rows.length}`)
      for (const r of rows) {
        const ack = r.detail?.org_lockout_acknowledged ? ' — verrouillage org ACQUITTÉ' : ''
        console.log(`         · ${r.created_at?.slice(0, 16)} — par ${r.user_id} — cible ${r.entity_id}${ack}`)
      }
      if (rows.length === 0) console.log('       Aucune. L’outil de secours n’a jamais servi.')
    }

    // G2 — le symptôme d'une purge qui n'aboutit pas : PII résiduelles.
    const { data: half, error: hErr } = await db
      .from('users')
      .select('id, first_name, last_name, phone, anonymized_at')
      .not('anonymized_at', 'is', null)
    if (hErr) {
      console.log(`  KO   lecture des comptes anonymisés : ${hErr.message}`)
      failures++
    } else {
      const withPii = (half ?? []).filter((r) =>
        [r.first_name, r.last_name, r.phone].some((v) => v !== null && v !== ''),
      )
      console.log(`\n       Comptes anonymisés : ${(half ?? []).length}`)
      console.log(`       Dont PII RÉSIDUELLES dans users : ${withPii.length}`)
      for (const r of withPii) console.log(`         · ${r.id} — purge restée à mi-chemin`)
      if (withPii.length > 0) failures++
      else console.log('       Aucune. Toute purge marquée a bien abouti.')
    }
  }
}

console.log(failures === 0 ? '\n✔ TOUT VERT\n' : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`)
process.exit(failures === 0 ? 0 : 1)

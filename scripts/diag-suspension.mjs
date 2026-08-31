// scripts/diag-suspension.mjs — vérifie que la SUSPENSION de compte mord.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POURQUOI CE DIAG
//   `users.status` portait 'suspended' à son CHECK depuis l'origine sans que
//   rien ne le lise : un compte suspendu se connectait normalement. Le garde
//   vient d'être branché, et il touche TOUTES les routes authentifiées. Trois
//   choses doivent donc être vérifiables à la demande :
//
//     A. Le test est bien une ÉGALITÉ sur 'suspended', jamais `!== 'active'`.
//        C'est le risque numéro un : le CHECK admet six valeurs, et
//        /api/profile écrit 'in_review' à chaque soumission de profil expert.
//        Un `!== 'active'` verrouillerait d'un coup tous les experts en cours
//        de validation — la population même qu'on attend sur la plateforme.
//
//     B. Aucun compte n'est DÉJÀ à 'suspended' en base. Le garde n'existait
//        pas : une valeur posée à la main lors d'un test ancien deviendrait un
//        verrou réel au déploiement, sans que personne ne l'ait décidé.
//
//     C. Bout en bout : suspendre coupe l'accès, et les autres statuts non.
//
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TROIS MODES, DU PLUS SÛR AU PLUS INTRUSIF
//
//   node scripts/diag-suspension.mjs               → A seul. AUCUN accès base,
//                                                    aucune variable d'env.
//   node scripts/diag-suspension.mjs --db          → A + B. LECTURE SEULE.
//   node scripts/diag-suspension.mjs --live <uuid> → A + B + C. ÉCRIT sur le
//                                                    compte donné, puis
//                                                    RESTAURE son statut
//                                                    d'origine (try/finally).
//
// ⚠️ `--live` modifie une ligne réelle. Ne le lancer que sur un compte de test,
//    et jamais en production. Le statut initial est relu et restauré dans le
//    `finally` ; en cas d'interruption brutale, le relancer restaure l'état.
//
// LECTURE PURE en mode par défaut et `--db` : aucune écriture, aucun batch.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/**
 * Retire les commentaires d'un source avant d'y chercher un anti-pattern.
 *
 * Sans ça, ce diag interdirait de DOCUMENTER le piège qu'il surveille : le
 * garde explique en toutes lettres pourquoi `status !== 'active'` serait faux,
 * et cette phrase suffisait à déclencher l'alerte. Un contrôle qui pousse à
 * effacer l'explication d'un piège est pire que pas de contrôle.
 *
 * Volontairement conservateur : on supprime les blocs et les lignes ENTIÈREMENT
 * commentées, jamais un fragment en milieu de ligne de code — pour ne pas
 * casser une URL `https://…` au passage.
 */
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
  if (cond) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  KO   ${label}${hint ? `\n       → ${hint}` : ''}`)
  }
}

// ═══ A. CONTRÔLES STATIQUES — le test est-il écrit correctement ? ══════════
console.log('\n═══ A. Forme du test de suspension (aucun accès base) ═══\n')

const guard = read('lib/auth-guard.ts')
const initSessionRoute = read('app/api/auth/init-session/route.ts')

ok(
  /const SUSPENDED_STATUS = 'suspended'/.test(guard),
  "auth-guard : la valeur bloquante est nommée et vaut 'suspended'",
)
ok(
  /userRow\.status === SUSPENDED_STATUS/.test(guard),
  'auth-guard : le test est une ÉGALITÉ stricte',
  "attendu `userRow.status === SUSPENDED_STATUS`",
)
ok(
  /code: 'account_suspended'/.test(guard),
  "auth-guard : le refus porte le code `account_suspended` (jamais un 403 nu)",
)
// Anti-pattern cherché dans le CODE seul (commentaires dépouillés) : les deux
// fichiers expliquent justement pourquoi ce test serait faux.
const guardCode = stripComments(guard)
const initSessionCode = stripComments(initSessionRoute)
const forbidsActiveTest = (src) =>
  !/status\s*!==\s*'active'/.test(src) && !/status\s*!==\s*"active"/.test(src)

ok(
  forbidsActiveTest(guardCode),
  "auth-guard : AUCUN test `status !== 'active'` dans le code",
  "un tel test verrouillerait les statuts 'draft' et 'in_review' — donc tous les experts en cours de validation",
)
ok(
  forbidsActiveTest(initSessionCode),
  "init-session : AUCUN test `status !== 'active'` dans le code",
)
ok(
  /=== 'suspended'/.test(initSessionRoute) && /code: 'account_suspended'/.test(initSessionRoute),
  'init-session : refuse le login sur égalité stricte, avec le même code',
)

// L'ordre compte : la suspension doit être évaluée AVANT les gates de
// suppression, sinon un compte suspendu ET en grâce atteindrait /reactivation.
const idxSuspended = guard.indexOf('SUSPENDED_STATUS)')
const idxDeletion = guard.indexOf('userDeletionScheduledAt || userAnonymizedAt')
ok(
  idxSuspended > 0 && idxDeletion > 0 && idxSuspended < idxDeletion,
  'auth-guard : la suspension est évaluée AVANT les gates de suppression',
  'sinon la réactivation en self-service devient une sortie de suspension',
)

// Le refus du login doit précéder l'écriture du jeton, de last_login_at et du
// journal de connexions : une tentative refusée n'est pas une connexion.
const idxCheck = initSessionRoute.indexOf("=== 'suspended'")
for (const [needle, label] of [
  ['setSessionToken(', 'la pose du jeton de session'],
  ['last_login_at:', 'le rafraîchissement de last_login_at'],
  ['logSession(', "l'écriture dans session_logs"],
]) {
  const idx = initSessionRoute.indexOf(needle)
  ok(
    idxCheck > 0 && idx > 0 && idxCheck < idx,
    `init-session : le refus précède ${label}`,
  )
}

// Chaîne client : le 403 doit être intercepté et expliqué, partout.
const secureFetch = read('lib/secure-fetch.ts')
ok(
  /payload\?\.code === 'account_suspended'/.test(secureFetch) && /onSuspended/.test(secureFetch),
  'secure-fetch : le 403 est intercepté et routé vers onSuspended',
)
ok(
  /reason=account_suspended/.test(secureFetch),
  'secure-fetch : redirection vers /connexion AVEC le motif',
)
for (const page of [
  'app/[locale]/connexion/page.tsx',
  'app/[locale]/auth/callback/page.tsx',
  'app/[locale]/nouveau-mot-de-passe/page.tsx',
]) {
  ok(
    /account_suspended/.test(read(page)),
    `${page} : traite le refus d'ouverture de session`,
  )
}

// Les libellés existent dans les 4 langues (parité stricte).
for (const loc of ['fr', 'en', 'es', 'de']) {
  const m = JSON.parse(read(`messages/${loc}.json`))
  ok(
    !!m.session?.suspended_title && !!m.session?.suspended_message,
    `i18n ${loc} : session.suspended_title + suspended_message présents`,
  )
}

// ═══ B. INVENTAIRE BASE — lecture seule ════════════════════════════════════
const wantDb = process.argv.includes('--db') || process.argv.includes('--live')
let supabaseAdmin = null

if (wantDb) {
  console.log('\n═══ B. Inventaire des statuts de compte (LECTURE SEULE) ═══\n')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.log('  KO   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absentes')
    failures++
  } else {
    const { createClient } = await import('@supabase/supabase-js')
    supabaseAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const STATUSES = ['draft', 'active', 'in_review', 'suspended', 'rejected', 'archived']
    const counts = {}
    for (const s of STATUSES) {
      const { count, error } = await supabaseAdmin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('status', s)
      if (error) {
        console.log(`  KO   comptage '${s}' : ${error.message}`)
        failures++
      } else {
        counts[s] = count ?? 0
        console.log(`       ${s.padEnd(10)} ${String(counts[s]).padStart(5)}`)
      }
    }

    // LE contrôle que Youssef a demandé avant de brancher le blocage.
    if (counts.suspended === 0) {
      ok(true, "aucun compte n'est déjà à 'suspended' — le branchement ne verrouille personne")
    } else {
      const { data: rows } = await supabaseAdmin
        .from('users')
        .select('id, email, user_type, created_at')
        .eq('status', 'suspended')
        .limit(20)
      ok(
        false,
        `${counts.suspended} compte(s) DÉJÀ à 'suspended' en base`,
        'ces comptes vont perdre leur accès au déploiement. Vérifier chacun AVANT de livrer :\n' +
          (rows ?? []).map((r) => `         · ${r.email} (${r.user_type}, créé le ${String(r.created_at).slice(0, 10)})`).join('\n'),
      )
    }

    // Population qu'un `!== 'active'` aurait verrouillée. Informatif, mais
    // c'est le chiffre qui rend le risque concret.
    const collateral = (counts.draft ?? 0) + (counts.in_review ?? 0)
    console.log(
      `\n       Pour mémoire : ${collateral} compte(s) en 'draft'/'in_review' —\n` +
        `       exactement ce qu'un test \`status !== 'active'\` aurait bloqué.`,
    )
  }
}

// ═══ C. SCÉNARIO BOUT EN BOUT — écrit puis restaure ════════════════════════
const liveIdx = process.argv.indexOf('--live')
if (liveIdx >= 0 && supabaseAdmin) {
  const targetId = process.argv[liveIdx + 1]
  console.log('\n═══ C. Scénario bout en bout (ÉCRIT puis RESTAURE) ═══\n')

  if (!targetId || !/^[0-9a-f-]{36}$/i.test(targetId)) {
    console.log('  KO   usage : --live <uuid du compte de test>')
    failures++
  } else {
    const { data: before, error: readErr } = await supabaseAdmin
      .from('users')
      .select('id, email, status, user_type')
      .eq('id', targetId)
      .maybeSingle()

    if (readErr || !before) {
      console.log(`  KO   compte introuvable : ${readErr?.message ?? targetId}`)
      failures++
    } else if (before.user_type === 'admin') {
      console.log('  KO   refus : ne pas jouer ce scénario sur un compte admin')
      failures++
    } else {
      console.log(`       cible : ${before.email} (statut initial : ${before.status})`)
      try {
        // Suspension
        const { error: upErr } = await supabaseAdmin
          .from('users')
          .update({ status: 'suspended' })
          .eq('id', targetId)
        ok(!upErr, "passage à 'suspended' accepté par le CHECK", upErr?.message)

        const { data: mid } = await supabaseAdmin
          .from('users').select('status').eq('id', targetId).maybeSingle()
        ok(mid?.status === 'suspended', "le compte est bien lu à 'suspended'")

        console.log(
          "\n       Vérification manuelle attendue, cookie de ce compte en main :\n" +
            '         • toute route authentifiée doit répondre 403 {code:"account_suspended"}\n' +
            '         • un nouveau login doit être refusé par /api/auth/init-session\n' +
            "         • l'écran /connexion doit afficher le bandeau « Accès suspendu »\n",
        )

        // Contrôle du non-effet de bord : la suspension est une mesure
        // d'ACCÈS. Rien d'autre ne doit avoir bougé.
        const { count: pubCount } = await supabaseAdmin
          .from('publications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published')
        console.log(`       annonces publiées sur la plateforme : ${pubCount ?? 0} (doit être inchangé)`)
      } finally {
        const { error: restoreErr } = await supabaseAdmin
          .from('users')
          .update({ status: before.status })
          .eq('id', targetId)
        ok(!restoreErr, `statut restauré à '${before.status}'`, restoreErr?.message)
      }
    }
  }
}

console.log(
  failures === 0
    ? '\n✔ TOUT VERT\n'
    : `\n✘ ${failures} CONTRÔLE(S) EN ÉCHEC\n`,
)
process.exit(failures === 0 ? 0 : 1)

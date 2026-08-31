import { NextRequest } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { purgeAccount, type PurgeableUser } from '@/lib/account-purge'
import { logAudit } from '@/lib/audit'
import { wouldRemoveLastAdmin } from '@/lib/org-members'
import {
  countOtherAvailablePlatformAdmins,
  platformAdminCountIncludingTarget,
} from '@/lib/admin/user-actions-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/purge-deletions — PURGE RGPD planifiée (mission S3, section 7).
 *
 * Déclenchée quotidiennement par Vercel Cron (cf. vercel.json). Traite les
 * comptes dont deletion_scheduled_at <= now() ET anonymized_at IS NULL.
 *
 * Pour chaque compte échu (idempotent, échec partiel toléré, JAMAIS de
 * fire-and-forget — tout est awaité) :
 *   1. BLOCAGE LOGIN + LIBÉRATION email : admin.updateUserById → email
 *      placeholder unique (libère l'email d'origine) + ban permanent + mot de
 *      passe aléatoire. (JAMAIS auth.admin.deleteUser : messages.sender_id est
 *      ON DELETE CASCADE → l'historique d'interactions DOIT être préservé.)
 *   2. SUPPRESSION fichiers perso : CV (bucket 'cv') + avatar (bucket 'avatars').
 *   3. ANONYMISATION profil : PII vidées, visible=false.
 *   4. ANONYMISATION user : nom vidé, téléphone libéré, email miroir = placeholder,
 *      status='archived' (valeur admise par users_status_check — cf.
 *      lib/account-purge.ts), anonymized_at=now() (posé EN DERNIER → un échec
 *      amont laisse le compte non marqué et il sera repris au prochain run).
 *   Les enregistrements d'interaction (candidatures/conversations/messages)
 *   sont PRÉSERVÉS sous forme désormais anonymisée.
 *
 * Sécurité : protégé par CRON_SECRET (header Authorization: Bearer <secret>,
 * envoyé automatiquement par Vercel Cron ; ?secret= accepté pour un
 * déclenchement manuel de test).
 */

const BATCH_LIMIT = 200

function getAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase env (URL or SERVICE_ROLE_KEY)')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized', code: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

// L'anonymisation elle-même vit désormais dans lib/account-purge.ts
// (purgeAccount), partagée avec la purge des comptes INACTIFS. Cette route ne
// garde que la SÉLECTION des comptes échus (deletion_scheduled_at <= now()).

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[purge] CRON_SECRET missing')
    return new Response(JSON.stringify({ error: 'Server misconfigured', code: 'missing_env' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return unauthorized()
  }

  const admin = getAdmin()
  const nowIso = new Date().toISOString()

  // `user_type` est chargé pour la garde « dernier administrateur » ci-dessous.
  const { data: dueRaw, error: dueErr } = await admin
    .from('users')
    .select('id, domain_id, email, user_type')
    .lte('deletion_scheduled_at', nowIso)
    .is('anonymized_at', null)
    .not('deletion_scheduled_at', 'is', null)
    .limit(BATCH_LIMIT)
  if (dueErr) {
    console.error('[purge] due query failed', dueErr.message)
    return new Response(JSON.stringify({ error: 'Query failed', code: 'db_error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const due = (dueRaw ?? []) as Array<PurgeableUser & { user_type: string | null }>
  let purged = 0
  const failed: { id: string; error: string }[] = []
  const blocked: string[] = []

  for (const u of due) {
    // ── DERNIER VERROU : JAMAIS ZÉRO ADMINISTRATEUR ────────────────────────
    //
    // La garde posée sur /api/me/account/delete refuse la DEMANDE. Elle ne
    // suffit pas : deux administrateurs qui la formulent à quelques minutes
    // d'intervalle peuvent la franchir tous les deux si leurs requêtes se
    // croisent, et une demande enregistrée AVANT ce lot n'a jamais été gardée
    // du tout. Ce contrôle-ci est le seul qui ne dépende d'aucune réaction
    // humaine — c'est ici, au moment irréversible, qu'il doit tenir.
    //
    // IL NE SUPPRIME RIEN ET NE DÉBLOQUE RIEN TOUT SEUL : il refuse d'agir, il
    // le journalise, et il le remonte dans la réponse. `deletion_scheduled_at`
    // est CONSERVÉ — la demande reste valide et sera honorée dès qu'un autre
    // administrateur existera. On ne décide pas à la place de l'utilisateur.
    if (u.user_type === 'admin') {
      const others = await countOtherAvailablePlatformAdmins(admin, u.id)
      // Comptage indisponible (`null`) → ON NE PURGE PAS. Fail-safe INVERSE de
      // celui des actions réversibles : reporter au lendemain ne coûte rien,
      // purger à tort est définitif.
      const unsafe =
        others === null ||
        wouldRemoveLastAdmin({
          targetIsActiveAdmin: true,
          activeAdminCount: platformAdminCountIncludingTarget(others),
        })
      if (unsafe) {
        blocked.push(u.id)
        console.warn('[purge] admin purge blocked — would leave platform without administrator', {
          uid: u.id,
          others_available: others,
        })
        await logAudit({
          supabaseAdmin: admin,
          user_id: u.id,
          domain_id: u.domain_id,
          action: 'account_purge_blocked',
          entity_type: 'user',
          entity_id: u.id,
          detail: {
            reason: 'last_platform_admin',
            others_available: others,
            deletion_scheduled_at_kept: true,
          },
        })
        continue
      }
    }

    try {
      await purgeAccount(admin, u)
      purged += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[purge] account purge failed', { uid: u.id, msg })
      failed.push({ id: u.id, error: msg })
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      due: due.length,
      purged,
      failed: failed.length,
      errors: failed,
      /** Comptes échus NON purgés parce qu'ils sont le dernier administrateur. */
      blocked: blocked.length,
      blocked_ids: blocked,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}

// POST accepté aussi (déclenchement manuel/scripté éventuel).
export async function POST(request: NextRequest): Promise<Response> {
  return handle(request)
}

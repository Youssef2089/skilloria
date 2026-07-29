import { NextRequest, after } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { purgeAccount, type PurgeableUser } from '@/lib/account-purge'
import { renderInactivityWarningEmail } from '@/lib/emails/templates'
import { sendEmail } from '@/lib/emails/resend'
import { expertSiteOrigin } from '@/lib/emails/domain-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Envoi des emails d'avertissement via `after()` (best-effort, post-response).
export const maxDuration = 60

/**
 * GET /api/cron/purge-inactive — PURGE RGPD des comptes INACTIFS (règle CNIL
 * « recrutement » : conservation ≤ 2 ans après le dernier contact).
 *
 * Déclenchée quotidiennement par Vercel Cron (cf. vercel.json). Deux phases,
 * dans cet ordre :
 *
 *   PHASE 1 — PURGE (24 mois) : anonymise les comptes sans connexion depuis
 *     PURGE_MONTHS ET DÉJÀ AVERTIS (inactivity_warning_sent_at NOT NULL).
 *     Réutilise l'anonymisation partagée `purgeAccount` (lib/account-purge.ts) —
 *     AUCUNE logique dupliquée avec /api/cron/purge-deletions.
 *     La condition « déjà averti » est la garantie d'INFORMATION PRÉALABLE :
 *     jamais de purge sans qu'un email d'avertissement ait effectivement été
 *     envoyé lors d'un run précédent (cf. phase 2).
 *
 *   PHASE 2 — AVERTISSEMENT (23 mois) : pour les comptes inactifs depuis
 *     WARNING_MONTHS et pas encore avertis, envoie un email invitant à se
 *     reconnecter AVANT l'échéance des 2 ans. Une reconnexion (init-session)
 *     met à jour last_login_at ET remet inactivity_warning_sent_at à NULL →
 *     le compteur repart de zéro et le compte sort des deux requêtes.
 *
 *     Envoi via `after()` (piège Vercel : un `void promise` serait tué après la
 *     response). `inactivity_warning_sent_at` n'est posé QU'APRÈS un envoi
 *     réussi → si l'email échoue (ex. Resend non configuré), le compte reste
 *     non-averti, sera re-tenté au prochain run, et NE SERA JAMAIS purgé sans
 *     avertissement délivré.
 *
 * Dernier contact fiable : la colonne last_login_at, jadis morte, est désormais
 * rafraîchie à chaque login (/api/auth/init-session) et rétro-remplie par la
 * migration 20260709000009 (= created_at pour l'existant). Le projet ayant
 * démarré en 2026, aucun compte n'atteint 2 ans d'inactivité avant 2028.
 *
 * Exclusions : comptes déjà anonymisés, comptes en cours de suppression
 * volontaire (deletion_scheduled_at — traités par purge-deletions), et les
 * comptes admin (jamais auto-anonymisés).
 *
 * Sécurité : protégé par CRON_SECRET (Authorization: Bearer <secret> envoyé par
 * Vercel Cron ; ?secret= accepté pour un déclenchement manuel de test).
 */

const BATCH_LIMIT = 200
const WARNING_MONTHS = 23
const PURGE_MONTHS = 24
const VALID_LOCALES = ['fr', 'en', 'es', 'de'] as const

function normalizeLocale(raw: string | null | undefined): string {
  return raw && (VALID_LOCALES as readonly string[]).includes(raw) ? raw : 'fr'
}

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

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function unauthorized(): Response {
  return json({ error: 'Unauthorized', code: 'unauthorized' }, 401)
}

/** Recule `base` de `months` mois (setMonth gère le passage d'année). */
function shiftMonths(base: Date, months: number): Date {
  const d = new Date(base)
  d.setMonth(d.getMonth() + months)
  return d
}

/** Ligne enrichie pour l'email d'avertissement (slug domaine + locale). */
type WarnRow = {
  id: string
  domain_id: string
  email: string | null
  first_name: string | null
  locale: string | null
  last_login_at: string
  // Supabase type l'embed 1-N comme objet OU tableau selon les cas.
  domains: { slug: string } | { slug: string }[] | null
}

function slugOf(domains: WarnRow['domains']): string | null {
  if (!domains) return null
  return Array.isArray(domains) ? (domains[0]?.slug ?? null) : domains.slug
}

async function handle(request: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[purge-inactive] CRON_SECRET missing')
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }
  const authHeader = request.headers.get('authorization') ?? ''
  const querySecret = request.nextUrl.searchParams.get('secret') ?? ''
  if (authHeader !== `Bearer ${secret}` && querySecret !== secret) {
    return unauthorized()
  }

  let admin: SupabaseClient
  try {
    admin = getAdmin()
  } catch {
    return json({ error: 'Server misconfigured', code: 'missing_env' }, 500)
  }

  const now = new Date()
  const warnCutoff = shiftMonths(now, -WARNING_MONTHS).toISOString()
  const purgeCutoff = shiftMonths(now, -PURGE_MONTHS).toISOString()
  const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  // ── PHASE 1 — PURGE (24 mois, déjà averti) ────────────────────────────────
  const { data: dueRaw, error: dueErr } = await admin
    .from('users')
    .select('id, domain_id, email')
    .lte('last_login_at', purgeCutoff)
    .not('inactivity_warning_sent_at', 'is', null)
    .is('anonymized_at', null)
    .is('deletion_scheduled_at', null)
    .neq('user_type', 'admin')
    .limit(BATCH_LIMIT)
  if (dueErr) {
    console.error('[purge-inactive] due query failed', dueErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }

  const due = (dueRaw ?? []) as PurgeableUser[]
  let purged = 0
  const failed: { id: string; error: string }[] = []
  for (const u of due) {
    try {
      await purgeAccount(admin, u)
      purged += 1
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[purge-inactive] account purge failed', { uid: u.id, msg })
      failed.push({ id: u.id, error: msg })
    }
  }

  // ── PHASE 2 — AVERTISSEMENT (23 mois, pas encore averti) ──────────────────
  const { data: warnRaw, error: warnErr } = await admin
    .from('users')
    .select('id, domain_id, email, first_name, locale, last_login_at, domains(slug)')
    .lte('last_login_at', warnCutoff)
    .is('inactivity_warning_sent_at', null)
    .is('anonymized_at', null)
    .is('deletion_scheduled_at', null)
    .neq('user_type', 'admin')
    .limit(BATCH_LIMIT)
  if (warnErr) {
    console.error('[purge-inactive] warn query failed', warnErr.message)
    // La purge (phase 1) a déjà réussi ; on remonte quand même un 200 partiel.
    return json({ ok: true, purged, purge_failed: failed.length, warned_scheduled: 0, warn_query_error: true })
  }

  const warn = (warnRaw ?? []) as WarnRow[]

  // Envoi + marquage via after() : hors du chemin de la response (piège Vercel).
  // sent_at posé UNIQUEMENT si l'email part (information préalable garantie).
  if (warn.length > 0) {
    after(async () => {
      for (const u of warn) {
        if (!u.email) continue
        try {
          const locale = normalizeLocale(u.locale)
          const base = expertSiteOrigin({ origin: siteOrigin, slug: slugOf(u.domains) })
          const loginUrl = `${base}/${locale}/connexion`
          const deadline = shiftMonths(new Date(u.last_login_at), PURGE_MONTHS)
          const deadlineLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(deadline)
          const rendered = renderInactivityWarningEmail({
            locale,
            firstName: u.first_name ?? '',
            deadlineLabel,
            loginUrl,
          })
          const res = await sendEmail({
            to: u.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            preheader: rendered.preheader,
            tag: rendered.tag,
          })
          if (res.ok) {
            await admin
              .from('users')
              .update({ inactivity_warning_sent_at: new Date().toISOString() })
              .eq('id', u.id)
          } else {
            console.warn('[purge-inactive] warning email not sent — sent_at NOT marked', {
              uid: u.id,
              code: res.code,
            })
          }
        } catch (err) {
          console.error('[purge-inactive] warning failed', {
            uid: u.id,
            msg: err instanceof Error ? err.message : String(err),
          })
        }
      }
    })
  }

  return json({
    ok: true,
    purged,
    purge_due: due.length,
    purge_failed: failed.length,
    warned_scheduled: warn.length,
    errors: failed,
  })
}

export async function GET(request: NextRequest): Promise<Response> {
  return handle(request)
}

// POST accepté aussi (déclenchement manuel/scripté éventuel).
export async function POST(request: NextRequest): Promise<Response> {
  return handle(request)
}

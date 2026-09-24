import { NextRequest, after } from 'next/server'
import { sousVerdictDeRun } from '@/lib/cron/verdict-de-run'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { purgeAccount, type PurgeableUser } from '@/lib/account-purge'
import { logAudit } from '@/lib/audit'
import { renderInactivityWarningEmail } from '@/lib/emails/templates'
import { resolveEmailBrandName } from '@/lib/emails/brand'
import { sendEmail } from '@/lib/emails/resend'
import { expertSiteOrigin } from '@/lib/emails/domain-url'
import { prendreBailRun, rendreBailRun } from '@/lib/cron/bail-de-run'
import { siteOrigin as resoudreSiteOrigin } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Envoi des emails d'avertissement via `after()` (best-effort, post-response).
export const maxDuration = 60

/** Nom du bail. MÊME valeur pour GET et POST : c'est la TÂCHE qu'on garde. */
const JOB = 'purge_inactive'

/**
 * GET /api/cron/purge-inactive — PURGE RGPD des comptes INACTIFS (règle CNIL
 * « recrutement » : conservation ≤ 2 ans après le dernier contact).
 *
 * Déclenchée quotidiennement (3 h 30 UTC) par pg_cron — job `purge_inactive_trigger`,
 * cf. supabase/migrations/20260823000000_purges_rgpd_pg_cron.sql. L'ordonnancement
 * a quitté Vercel Cron : plus aucun batch n'est hébergé chez l'hébergeur, la
 * planification suit la base. Le TRAITEMENT n'a pas bougé — deux phases,
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
 *     CHAQUE AVERTISSEMENT LAISSE UNE LIGNE D'AUDIT — envoyé
 *     (`inactivity_warning_sent`) ou non (`inactivity_warning_failed`, avec sa
 *     cause) — et chaque purge dit son origine (`account_purged.detail.origine`).
 *     Le verdict du run ne peut pas le savoir : il est écrit AVANT `after()`.
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
 * Sécurité : protégé par CRON_SECRET (Authorization: Bearer <secret> posé par
 * `trigger_purge_cron()`, qui lit le miroir du secret dans Supabase Vault ;
 * ?secret= accepté pour un déclenchement manuel — le seul filet de rattrapage
 * depuis le retrait des crons Vercel).
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

/**
 * ── LA TRACE DE L'OBLIGATION LÉGALE ─────────────────────────────────────────
 *  L'avertissement à 23 mois est l'« information préalable » exigée par la
 *  CNIL. Sa seule marque était `inactivity_warning_sent_at` — une colonne
 *  qu'une reconnexion remet à NULL : le fait qu'il ait été envoyé, et quand,
 *  disparaissait. Et le verdict du run (`cron_run_log`) est écrit AVANT le
 *  bloc `after()` qui envoie : il compte ce qui était À ENVOYER
 *  (`warned_scheduled`), jamais ce qui l'a été. Ces lignes d'audit sont la
 *  seule trace durable de l'envoi — et de son échec, pour qu'une panne de
 *  messagerie se voie ailleurs que dans une console.
 *  Identifiants seulement : ni adresse, ni prénom (RGPD).
 *  `logAudit` est best-effort (§E.68) — c'est ce que le grand livre fermera.
 */
async function tracerAvertissement(
  admin: SupabaseClient,
  u: WarnRow,
  action: 'inactivity_warning_sent' | 'inactivity_warning_failed',
  issue: { demande_email_id: string | null; marquage_pose: boolean | null; cause: string | null },
): Promise<void> {
  await logAudit({
    supabaseAdmin: admin,
    user_id: u.id,
    domain_id: u.domain_id,
    action,
    entity_type: 'user',
    entity_id: u.id,
    // Champs NOMMÉS, pas un spread : un détail dont les clés viennent
    // d'ailleurs est opaque au contrôle qui garde le journal des données
    // personnelles (diag-audit-sans-donnee-personnelle).
    detail: {
      origine: 'tache_planifiee',
      job: JOB,
      echeance_purge: shiftMonths(new Date(u.last_login_at), PURGE_MONTHS).toISOString(),
      demande_email_id: issue.demande_email_id,
      marquage_pose: issue.marquage_pose,
      cause: issue.cause,
    },
  })
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

  // ── BAIL DE RUN ─────────────────────────────────────────────────────────
  //  Tâche quotidienne : le chevauchement ne peut pas venir de l'ordonnanceur.
  //  Il vient du déclenchement manuel (bouton back-office, appel porteur de
  //  `CRON_SECRET`), que l'advisory lock de `cron_manual_run` ne couvre pas —
  //  celui-ci meurt avec la transaction, ce run HTTP commence après.
  //
  //  Deux runs concurrents anonymiseraient les mêmes comptes et enverraient
  //  l'avertissement d'inactivité EN DOUBLE. L'un est irréversible, l'autre
  //  part chez l'utilisateur.
  //
  //  FAIL-CLOSED : reporter au lendemain ne coûte rien.
  const bail = await prendreBailRun(admin, { job: JOB, maxDurationSec: maxDuration })
  if (bail === 'occupe') {
    return json({ ok: true, note: 'Un run est déjà en cours.', purged: 0, purge_due: 0 }, 200)
  }
  if (bail === 'erreur') {
    return json({ error: 'Run lease unavailable', code: 'bail_indisponible' }, 503)
  }

  try {
    return await purgerInactifs(admin)
  } finally {
    await rendreBailRun(admin, JOB)
  }
}

/** Le traitement lui-même, isolé pour que le bail l'entoure sur TOUS ses chemins. */
async function purgerInactifs(admin: SupabaseClient): Promise<Response> {
  const now = new Date()
  const warnCutoff = shiftMonths(now, -WARNING_MONTHS).toISOString()
  const purgeCutoff = shiftMonths(now, -PURGE_MONTHS).toISOString()
  // ── ORIGINE INCONNAISSABLE ⇒ ON N'AVERTIT PAS AVEC UN LIEN MORT ──────────
  //  L'avertissement d'inactivite a 23 mois est une OBLIGATION LEGALE (CNIL).
  //  Il vaut mieux qu'il ne parte pas — visible dans les journaux et dans le
  //  compte-rendu du cron — que de partir avec un lien vers 'localhost', qui le
  //  rendrait inoperant sans que personne ne le sache. La PURGE, elle, n'a
  //  besoin d'aucun lien et continue.
  const siteOrigin = resoudreSiteOrigin()

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
      await purgeAccount(admin, u, { origine: 'tache_planifiee', job: JOB })
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
  if (warn.length > 0 && !siteOrigin) {
    // L'avertissement CNIL ne part PAS avec un lien mort. Bruyant, et tracé dans
    // le compte-rendu du cron : c'est une obligation légale, son absence doit se
    // voir. La purge, elle, n'a besoin d'aucun lien et a déjà eu lieu.
    console.error(
      `[cron:purge-inactive] ${warn.length} avertissement(s) NON ENVOYÉ(S) — origine du site inconnaissable`,
    )
  }
  if (warn.length > 0 && siteOrigin) {
    after(async () => {
      for (const u of warn) {
        if (!u.email) {
          // Sans adresse, aucun avertissement ne peut partir — et sans
          // avertissement, aucune purge : ce compte resterait éligible À VIE,
          // en silence. La trace le rend cherchable.
          await tracerAvertissement(admin, u, 'inactivity_warning_failed', {
            demande_email_id: null, marquage_pose: null, cause: 'sans_email',
          })
          continue
        }
        try {
          const locale = normalizeLocale(u.locale)
          const base = expertSiteOrigin({ origin: siteOrigin, slug: slugOf(u.domains) })
          const loginUrl = `${base}/${locale}/connexion`
          const deadline = shiftMonths(new Date(u.last_login_at), PURGE_MONTHS)
          const deadlineLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(deadline)
          // D3 : marque = domaine du destinataire (u.domain_id).
          const brandName = await resolveEmailBrandName(admin, u.domain_id)
          const rendered = renderInactivityWarningEmail({
            brandName,
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
            const { error: marqueErr } = await admin
              .from('users')
              .update({ inactivity_warning_sent_at: new Date().toISOString() })
              .eq('id', u.id)
            if (marqueErr) {
              // L'e-mail est parti mais la marque n'est pas posée : le compte
              // sera RÉ-AVERTI au prochain passage. La trace le dit, pour qu'un
              // double envoi se lise comme tel et non comme un bug inexpliqué.
              console.error('[purge-inactive] warning sent but sent_at NOT marked', {
                uid: u.id,
                msg: marqueErr.message,
              })
            }
            await tracerAvertissement(admin, u, 'inactivity_warning_sent', {
              // Accusé de réception de la DEMANDE par Resend — pas une preuve
              // de remise (§E.19).
              demande_email_id: res.id,
              marquage_pose: !marqueErr,
              cause: null,
            })
          } else {
            console.warn('[purge-inactive] warning email not sent — sent_at NOT marked', {
              uid: u.id,
              code: res.code,
            })
            await tracerAvertissement(admin, u, 'inactivity_warning_failed', {
              demande_email_id: null, marquage_pose: null, cause: res.code,
            })
          }
        } catch (err) {
          console.error('[purge-inactive] warning failed', {
            uid: u.id,
            msg: err instanceof Error ? err.message : String(err),
          })
          // Le message d'une exception peut citer l'adresse : il reste dans la
          // console, la trace ne porte que la CLASSE de la panne.
          await tracerAvertissement(admin, u, 'inactivity_warning_failed', {
            demande_email_id: null, marquage_pose: null, cause: 'exception',
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
    // À ENVOYER, pas envoyés : l'envoi a lieu dans `after()`, après ce verdict.
    // Le compte des avertissements réellement partis est le nombre de lignes
    // d'audit `inactivity_warning_sent` du passage (cf. tracerAvertissement).
    warned_scheduled: warn.length,
    errors: failed,
  })
}

/**
 * ⚠️ LE PASSAGE SE CLÔT ICI, ET SUR TOUS LES CHEMINS DE SORTIE.
 *
 *    La tâche écrit son verdict elle-même au lieu de le poser chez `pg_net`,
 *    où il expire en ~6 h avant que la réconciliation ne passe : 7 201 passages
 *    sur 9 853 étaient sans verdict au 22/09/2026, soit 73 %.
 *
 *    Le guichet est PARTAGÉ par les cinq tâches — cinq copies auraient produit
 *    cinq occasions d'oublier une branche de sortie (§E.20), et celle qu'on
 *    oublie est toujours celle de l'échec, qu'on ne joue jamais.
 */
export async function GET(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}

// POST accepté aussi (déclenchement manuel/scripté éventuel).
export async function POST(request: NextRequest): Promise<Response> {
  return sousVerdictDeRun(request, JOB, getAdmin, () => handle(request))
}

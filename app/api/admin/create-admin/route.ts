import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit'
// Cleanup atomique : le MÊME que les deux routes d'inscription publiques.
// `auth.admin.deleteUser` ne cascade pas sur public.users — cf. piège P3.
import { atomicCleanup } from '@/lib/auth-signup'
import { sendAdminInvitation } from '@/lib/admin/admin-invitation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/create-admin — CRÉER un compte administrateur plateforme.
 *
 * Body   : { email, first_name, last_name, domain_slug? }
 * Header : `x-reauth-token` obligatoire.
 *
 * Résout le « problème du jour zéro » partiel : jusqu'ici, fabriquer un
 * administrateur imposait de s'inscrire normalement puis de modifier
 * `user_type` À LA MAIN en base — ni tracé, ni reproductible. Cette route rend
 * l'opération traçable. Elle ne crée PAS le PREMIER administrateur (il faut
 * déjà en être un pour l'appeler) : ce bootstrap-là est un chantier distinct.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ⚠️  LE POINT MORT DU TRIGGER — NE RETIREZ PAS LA VÉRIFICATION DU MIROIR  ║
 * ╠══════════════════════════════════════════════════════════════════════════╣
 * ║ `handle_new_user` mappe le `role` des métadonnées vers `user_type`. Son  ║
 * ║ CASE ne connaît que expert / cdi / entreprise / cabinet. Pour TOUTE      ║
 * ║ autre valeur — 'admin' compris :                                        ║
 * ║                                                                          ║
 * ║     IF v_user_type IS NULL THEN                                          ║
 * ║       RAISE WARNING '[handle_new_user] role inconnu: %...';              ║
 * ║       RETURN NEW;   -- ← SUCCÈS SILENCIEUX, AUCUNE ligne public.users    ║
 * ║     END IF;                                                              ║
 * ║                                                                          ║
 * ║ Le compte `auth.users` est créé, la fonction rend la main SANS ERREUR,   ║
 * ║ et le miroir n'existe pas. Le compte passerait `requireAuth` (JWT        ║
 * ║ valide) puis échouerait partout ensuite — `requireAdmin` lit             ║
 * ║ `users.user_type` et ne trouverait rien. Un compte fantôme,              ║
 * ║ inconnectable, qui occupe l'adresse e-mail et bloque toute recréation.   ║
 * ║                                                                          ║
 * ║ La vérification explicite du miroir ci-dessous, suivie d'`atomicCleanup` ║
 * ║ s'il manque, est la SEULE chose qui transforme cet échec muet en échec   ║
 * ║ propre. Elle ressemble à une redondance. Elle n'en est pas.              ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ═══ POURQUOI ON PASSE PAR 'entreprise' PUIS ON BASCULE ════════════════════
 *   CONTOURNEMENT ASSUMÉ DU TRIGGER. On crée le compte avec `role:'entreprise'`
 *   — que `handle_new_user` sait traiter (→ user_type 'client', et AUCUNE ligne
 *   `profiles`, réservée à expert/cdi) — puis on bascule immédiatement vers
 *   `user_type='admin'`.
 *
 *   L'alternative propre serait d'ajouter une branche `admin` au trigger. C'est
 *   une MIGRATION sur le déclencheur d'inscription, donc sur TOUS les parcours
 *   de création de compte. Décision produit : on ne la fait pas maintenant ; on
 *   la reconsidérera au chantier de mise en production, base vierge et risque
 *   nul. En attendant, le contournement vit ICI et nulle part ailleurs, sous
 *   cleanup atomique.
 *
 *   `users_user_type_check` admet DÉJÀ 'admin' (baseline) : la bascule ne viole
 *   aucune contrainte et n'a jamais eu besoin de migration.
 *
 * ═══ LES TROIS ÉCRITURES DE LA BASCULE ═════════════════════════════════════
 *   - `user_type = 'admin'`   : le rôle réel.
 *   - `role_id = <Admin>`     : rôle COMMERCIAL, sans objet pour un
 *                               administrateur, mais une lecture en base doit
 *                               être sans ambiguïté (décision produit).
 *   - `status = 'active'`     : le trigger pose 'draft'. Ce n'est pas cosmétique :
 *                               `countOtherAvailablePlatformAdmins` ne compte
 *                               QUE les 'active'. Un administrateur resté en
 *                               'draft' ne compterait pas comme disponible, et
 *                               l'anti-lock-out plateforme le croirait absent.
 *
 * ═══ `domain_id` : UN RATTACHEMENT, PAS UNE AUTORISATION ═══════════════════
 *   `users.domain_id` est NOT NULL, il faut donc une valeur. Elle est CHOISIE
 *   au formulaire (défaut : l'écosystème du créateur).
 *
 *   ⚠️ CETTE VALEUR N'ACCORDE AUCUN DROIT. `requireAdmin` (lib/admin-guard.ts)
 *      IGNORE délibérément `domain_id` : l'administrateur est PLATEFORME et voit
 *      tous les écosystèmes. Le rattachement n'est ici qu'une contrainte de
 *      schéma. Ne jamais en déduire un périmètre.
 *
 * ═══ GARDES ════════════════════════════════════════════════════════════════
 *   `requireAdmin` + `requireReauth` : créer un administrateur, c'est créer
 *   quelqu'un qui peut tout faire — l'action la plus sensible de la plateforme.
 *   Plus une limitation de débit sur le mécanisme EXISTANT (`rate_limit_hits`,
 *   clé IP, seuil bas) : une route qui fabrique des administrateurs ne doit pas
 *   pouvoir être martelée.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Seuil BAS et fenêtre longue : créer un administrateur est un acte rare. */
const RATE_BUCKET = 'admin_create'
const RATE_WINDOW_SECONDS = 3600
const RATE_MAX = 5

/** Rôle COMMERCIAL de l'administrateur (seed 20260709000001_commerce_seed.sql). */
const ADMIN_ROLE_NAME = 'Admin'

/** Rôle d'inscription accepté par le trigger — cf. § CONTOURNEMENT ASSUMÉ. */
const TRIGGER_BRIDGE_ROLE = 'entreprise'

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

export async function POST(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  // Ré-auth AVANT tout : on n'ouvre pas cette route à un appelant qui n'a pas
  // re-prouvé son identité, même pour un refus de validation.
  const reauthFail = requireReauth(request, auth.user.id)
  if (reauthFail) return reauthFail

  // Limitation de débit — mécanisme EXISTANT, pas un second. Clé IP : c'est un
  // signal FAIBLE (x-forwarded-for est falsifiable), mais il est ici en renfort
  // de deux gardes fortes, pas à leur place. Fail-open par conception.
  const ip = extractClientIp(request) ?? 'unknown-ip'
  const allowed = await checkRateLimit(
    auth.supabaseAdmin, RATE_BUCKET, ip, RATE_WINDOW_SECONDS, RATE_MAX,
  )
  if (!allowed) {
    return json({ error: 'Too many attempts', code: 'rate_limited' }, 429)
  }

  let body: {
    email?: unknown
    first_name?: unknown
    last_name?: unknown
    domain_slug?: unknown
  }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const email = asString(body.email)?.toLowerCase() ?? null
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return json({ error: 'Invalid email', code: 'invalid_email' }, 400)
  }
  const firstName = asString(body.first_name)
  if (!firstName || firstName.length > 100) {
    return json({ error: 'Invalid first name', code: 'invalid_first_name' }, 400)
  }
  const lastName = asString(body.last_name)
  if (!lastName || lastName.length > 100) {
    return json({ error: 'Invalid last name', code: 'invalid_last_name' }, 400)
  }
  // Défaut = écosystème du CRÉATEUR. Rattachement technique (cf. § domain_id).
  const domainSlug = asString(body.domain_slug)?.toLowerCase() ?? auth.domain.slug
  if (!/^[a-z0-9-]{1,50}$/.test(domainSlug)) {
    return json({ error: 'Invalid ecosystem', code: 'invalid_domain_slug' }, 400)
  }

  // ── L'écosystème doit être ACTIF : le trigger l'exige et lèverait sinon ───
  const { data: domainRow, error: domainErr } = await auth.supabaseAdmin
    .from('domains')
    .select('id, slug')
    .eq('slug', domainSlug)
    .eq('active', true)
    .maybeSingle()
  if (domainErr) {
    console.error('[admin:create-admin] domain lookup failed', domainErr.message)
    return json({ error: 'Query failed', code: 'db_error' }, 500)
  }
  if (!domainRow) {
    return json({ error: 'Unknown or inactive ecosystem', code: 'invalid_domain_slug' }, 400)
  }

  // ── Rôle commercial « Admin » — échec EXPLICITE s'il manque ──────────────
  // Même posture que le trigger avec le rôle « Gratuit » : on ne bricole pas un
  // repli silencieux sur un rôle qui n'a pas le sens voulu.
  const { data: roleRow, error: roleErr } = await auth.supabaseAdmin
    .from('roles')
    .select('id')
    .eq('name', ADMIN_ROLE_NAME)
    .eq('active', true)
    .maybeSingle()
  if (roleErr || !roleRow) {
    console.error('[admin:create-admin] Admin role missing', roleErr?.message ?? 'no row')
    return json({ error: 'Admin role missing', code: 'admin_role_missing' }, 500)
  }

  // ── Pré-check unicité : refus PROPRE avant toute écriture ────────────────
  const { data: existing } = await auth.supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()
  if (existing) {
    return json({ error: 'Email already used', code: 'email_taken' }, 409)
  }

  // ── Création auth.users ──────────────────────────────────────────────────
  // `email_confirm: true` : l'adresse est confirmée d'office (un administrateur
  // en invite un autre, pas d'auto-inscription à vérifier). Le mot de passe est
  // aléatoire, n'est ni renvoyé, ni journalisé, ni affiché — le seul accès passe
  // par le lien envoyé à l'invité.
  const { data: created, error: createErr } = await auth.supabaseAdmin.auth.admin.createUser({
    email,
    password: randomUUID() + randomUUID(),
    email_confirm: true,
    user_metadata: {
      // ⚠️ 'entreprise', pas 'admin' — cf. § CONTOURNEMENT ASSUMÉ DU TRIGGER.
      role: TRIGGER_BRIDGE_ROLE,
      domain_slug: domainRow.slug,
      firstname: firstName,
      lastname: lastName,
    },
  })
  if (createErr || !created?.user) {
    const msg = (createErr?.message ?? '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return json({ error: 'Email already used', code: 'email_taken' }, 409)
    }
    console.error('[admin:create-admin] createUser failed', createErr?.message)
    return json({ error: 'Could not create user', code: 'create_user_failed' }, 500)
  }
  const newUserId = created.user.id

  // ╔════════════════════════════════════════════════════════════════════════╗
  // ║ VÉRIFICATION DU MIROIR — LE CONTRÔLE À NE JAMAIS RETIRER               ║
  // ║ Voir l'encadré en tête de fichier. Un `role` que le trigger ne connaît ║
  // ║ pas produit un RAISE WARNING + RETURN NEW : succès côté auth, AUCUNE   ║
  // ║ ligne public.users, et AUCUNE erreur remontée. Sans cette lecture, on  ║
  // ║ répondrait 200 sur un compte fantôme inconnectable.                   ║
  // ╚════════════════════════════════════════════════════════════════════════╝
  const { data: mirror, error: mirrorErr } = await auth.supabaseAdmin
    .from('users')
    .select('id, locale')
    .eq('id', newUserId)
    .maybeSingle()
  if (mirrorErr || !mirror) {
    console.error('[admin:create-admin] MIROIR ABSENT après createUser', {
      newUserId,
      msg: mirrorErr?.message ?? 'no row',
    })
    await atomicCleanup(auth.supabaseAdmin, { userId: newUserId })
    return json({ error: 'Account mirror missing', code: 'mirror_missing' }, 500)
  }

  // ── Bascule vers le rôle réel ────────────────────────────────────────────
  const { error: promoteErr } = await auth.supabaseAdmin
    .from('users')
    .update({
      user_type: 'admin',
      role_id: roleRow.id,
      // 'active' : cf. § LES TROIS ÉCRITURES. Un admin en 'draft' ne serait pas
      // compté comme disponible par l'anti-lock-out plateforme.
      status: 'active',
      email_verified: true,
    })
    .eq('id', newUserId)
  if (promoteErr) {
    console.error('[admin:create-admin] promotion failed', promoteErr.message)
    await atomicCleanup(auth.supabaseAdmin, { userId: newUserId })
    return json({ error: 'Could not promote to admin', code: 'promote_failed' }, 500)
  }

  // ── Invitation ───────────────────────────────────────────────────────────
  // Un échec SMTP n'annule PAS un compte valide : on le SIGNALE, et l'écran
  // propose de renvoyer l'invitation. Annuler recréerait un jour zéro à chaque
  // hoquet du serveur de mail.
  const origin =
    request.headers.get('origin') ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    request.nextUrl.origin
  const invitationSent = await sendAdminInvitation({
    email,
    origin,
    domainSlug: domainRow.slug,
    // Locale LUE en base (posée par le trigger), jamais codée en dur ici.
    locale: (mirror as { locale: string | null }).locale ?? 'fr',
  })

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    // Convention : `domain_id` = domaine de l'ACTEUR. Celui de la cible va dans
    // `detail` — l'administrateur créé peut relever d'un autre écosystème.
    domain_id: auth.user.domain_id,
    action: 'admin_account_created',
    entity_type: 'user',
    entity_id: newUserId,
    // JAMAIS l'adresse complète : `entity_id` identifie déjà la cible, et
    // l'e-mail est une donnée personnelle qui n'a rien à faire au journal.
    detail: {
      target_domain_id: domainRow.id,
      target_user_type: 'admin',
      invitation_sent: invitationSent,
    },
    request,
  })

  return json({ user_id: newUserId, invitation_sent: invitationSent }, 200)
}

import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { requireReauth } from '@/lib/reauth-token'
import { logAudit } from '@/lib/audit'
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit'
import { contexteDepuisAuth } from '@/lib/journal/contexte'
import { sendAdminInvitation } from '@/lib/admin/admin-invitation'
import { signerPreuveInscription } from '@/lib/inscription/preuve.mjs'
import { refusInscription, nommerLeRefus, INSCRIPTION_INDISPONIBLE } from '@/lib/inscription/refus'

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
 * déjà en être un pour l'appeler) : c'est `scripts/creer-premier-administrateur.mjs`.
 *
 * ═══ LE COMPTE NAÎT ADMINISTRATEUR, EN UNE TRANSACTION (§D.27) ═══════════════
 *   La route signe une preuve (voie `administrateur`, l'acteur = l'administrateur
 *   qui crée) ; `handle_new_user` la vérifie, crée le compte par le rôle de pont
 *   `entreprise` (→ user_type 'client', sans profil ni organisation), puis appelle
 *   `promouvoir_administrateur()` DANS LA MÊME TRANSACTION : user_type 'admin',
 *   role_id Admin, status 'active' (l'anti-lock-out ne compte que les actifs),
 *   `administrateur_cree` sous la pièce de `compte_cree`. La promotion refuse en
 *   base un acteur qui n'est pas administrateur actif (AD002) ; un refus annule
 *   TOUT — le client de pont n'existe jamais seul, et il n'y a plus rien à
 *   nettoyer (l'ancien `atomicCleanup` est retiré).
 *
 *   Pas de consentement aux CGU écrit ici : un administrateur créé par un autre
 *   n'a rien accepté, et on n'écrit pas un consentement qui n'a pas eu lieu.
 *
 * ═══ LE MIROIR SE LIT ENCORE — pour sa langue, et pour ne rien supposer ══════
 *   Le trigger LÈVE désormais sur tout refus (plus de « retour silencieux sans
 *   miroir », §E.23) : un compte créé a son miroir, promu. On relit quand même
 *   `users` — la langue de l'e-mail d'invitation en vient, et un compte qui ne
 *   serait pas administrateur se dit 500, jamais 200.
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

/** Rôle d'inscription de pont que le trigger promeut sur la voie `administrateur`. */
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

  // La pièce du geste naît à son entrée (§D.26) : signée dans la preuve, elle porte
  // `compte_cree` et `administrateur_cree`, écrites par le trigger.
  const journal = contexteDepuisAuth(auth)

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

  const email = asString(body.email)?.toLowerCase() ?? ''
  // Défaut = écosystème du CRÉATEUR. Rattachement technique (cf. § domain_id) ; la base
  // vérifie qu'il est ACTIF (`invalid_domain`).
  const domainSlug = asString(body.domain_slug)?.toLowerCase() ?? auth.domain.slug

  const meta: Record<string, string> = {
    firstname: asString(body.first_name) ?? '',
    lastname: asString(body.last_name) ?? '',
    role: TRIGGER_BRIDGE_ROLE,
    domain_slug: domainSlug,
    voie: 'administrateur',
    piece: journal.piece,
    // L'administrateur qui crée : la promotion vérifie EN BASE qu'il l'est (AD002).
    acteur_id: auth.user.id,
  }

  // ── La question à la base, AVANT de créer : formats, adresse prise, rôle Admin ─
  const verdict = await refusInscription(auth.supabaseAdmin, email, meta)
  if (!verdict.ok) {
    return json({ error: 'Creation refused', code: verdict.code }, verdict.statut)
  }

  let signees: Record<string, string>
  try {
    signees = signerPreuveInscription(email, meta)
  } catch (err) {
    console.error('[admin:create-admin] preuve non signée', err instanceof Error ? err.message : String(err))
    return json({ error: 'Server misconfigured', code: INSCRIPTION_INDISPONIBLE }, 503)
  }

  // `email_confirm: true` : l'adresse est confirmée d'office (un administrateur en
  // invite un autre, pas d'auto-inscription à vérifier). Le mot de passe est aléatoire,
  // n'est ni renvoyé, ni journalisé, ni affiché — le seul accès passe par le lien
  // envoyé à l'invité.
  const { data: created, error: createErr } = await auth.supabaseAdmin.auth.admin.createUser({
    email,
    password: randomUUID() + randomUUID(),
    email_confirm: true,
    user_metadata: { ...meta, ...signees },
  })
  if (createErr || !created?.user) {
    const msg = (createErr?.message ?? '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return json({ error: 'Email already used', code: 'email_taken' }, 409)
    }
    console.error('[admin:create-admin] createUser refusé', createErr?.message)
    const nomme = await nommerLeRefus(auth.supabaseAdmin, email, meta)
    return json({ error: 'Creation refused', code: nomme.code }, nomme.statut)
  }
  const newUserId = created.user.id

  const { data: mirror, error: mirrorErr } = await auth.supabaseAdmin
    .from('users')
    .select('id, locale, user_type, domain_id')
    .eq('id', newUserId)
    .maybeSingle()
  if (mirrorErr || !mirror || (mirror as { user_type: string }).user_type !== 'admin') {
    // Impossible par construction (même transaction) — donc dit, jamais supposé.
    console.error('[admin:create-admin] compte créé mais non administrateur', {
      newUserId,
      msg: mirrorErr?.message ?? (mirror ? `user_type ${String((mirror as { user_type: string }).user_type)}` : 'no row'),
    })
    return json({ error: 'Account not promoted', code: 'promote_failed' }, 500)
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
    domainSlug,
    // Locale LUE en base (posée par le trigger), jamais codée en dur ici.
    locale: (mirror as { locale: string | null }).locale ?? 'fr',
  })

  await logAudit({
    piece: journal.piece,
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
      target_domain_id: (mirror as { domain_id: string }).domain_id,
      target_user_type: 'admin',
      invitation_sent: invitationSent,
    },
    request,
  })

  return json({ user_id: newUserId, invitation_sent: invitationSent }, 200)
}

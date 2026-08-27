import { NextRequest } from 'next/server'
import { AuthError, requireAuth, type AuthContext } from '@/lib/auth-guard'
import { logAudit } from '@/lib/audit'
import {
  eventsForFacts,
  eventHasChannel,
  resolveVoice,
  type NotificationChannel,
  type NotificationEventType,
} from '@/lib/notifications/catalog'
import {
  loadAudienceFacts,
  loadDisabledPreferences,
  setPreference,
  isChannelEnabled,
} from '@/lib/notifications/preferences'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Préférences de notification, PAR ÉVÉNEMENT ET PAR CANAL.
 *
 * GET   → { settings: [{ event, channel, voice, enabled }], phone_verified,
 *           phone, email_address }
 *         `settings` EST le catalogue applicable à CET utilisateur : le client
 *         n'a aucune liste d'événements à connaître, il rend ce qu'on lui
 *         donne. Un réglage absent de la réponse n'existe pas pour lui.
 * PATCH → { event, channel, enabled } — enregistrement immédiat au toggle.
 *
 * SÉCURITÉ (point 20) : le serveur ne se contente pas d'écrire ce qu'on lui
 * envoie. Il vérifie que l'événement existe, que le canal existe POUR cet
 * événement (un SMS sur un message est refusé même si le client le demande),
 * et que l'utilisateur appartient bien au public de cet événement. Borné à
 * auth.uid() dans tous les cas.
 */
export async function GET(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  const [{ data: userRow, error }, facts, disabled] = await Promise.all([
    auth.supabaseAdmin
      .from('users')
      .select('phone, phone_verified, email')
      .eq('id', auth.user.id)
      .maybeSingle(),
    loadAudienceFacts(auth.supabaseAdmin, auth.user.id),
    loadDisabledPreferences(auth.supabaseAdmin, [auth.user.id]),
  ])
  if (error || !userRow) {
    return json({ error: 'Could not load preferences', code: 'db_error' }, 500)
  }

  // `voice` : le vocabulaire à employer pour CE lecteur, dérivé ici et servi.
  // Le client ne déduit rien de son propre type — il rend le libellé qu'on lui
  // désigne. `null` = l'événement n'a qu'une seule voix.
  const settings = eventsForFacts(facts).flatMap((def) =>
    def.channels.map((channel) => ({
      event: def.event,
      channel,
      voice: resolveVoice(def.event, facts),
      enabled: isChannelEnabled(disabled, auth.user.id, def.event, channel),
    })),
  )

  return json({
    settings,
    phone_verified: userRow.phone_verified === true,
    phone: userRow.phone ?? null,
    email_address: userRow.email ?? null,
  })
}

export async function PATCH(request: NextRequest): Promise<Response> {
  let auth: AuthContext
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }

  let body: { event?: unknown; channel?: unknown; enabled?: unknown }
  try {
    body = (await request.json()) as { event?: unknown; channel?: unknown; enabled?: unknown }
  } catch {
    return json({ error: 'Invalid JSON body', code: 'invalid_json' }, 400)
  }

  const event = typeof body.event === 'string' ? (body.event as NotificationEventType) : null
  const channel = body.channel === 'email' || body.channel === 'sms'
    ? (body.channel as NotificationChannel)
    : null
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : null
  if (!event || !channel || enabled === null) {
    return json({ error: 'event, channel and enabled are required', code: 'invalid_body' }, 400)
  }
  // Le canal doit exister POUR cet événement — un client qui demanderait
  // d'activer le SMS sur les messages est refusé ici, pas seulement masqué.
  if (!eventHasChannel(event, channel)) {
    return json({ error: 'Unknown event or channel', code: 'unknown_setting' }, 400)
  }
  // …et l'utilisateur doit appartenir au public de cet événement.
  const facts = await loadAudienceFacts(auth.supabaseAdmin, auth.user.id)
  if (!eventsForFacts(facts).some((d) => d.event === event)) {
    return json({ error: 'Setting not available for this account', code: 'not_applicable' }, 403)
  }

  const res = await setPreference(auth.supabaseAdmin, auth.user.id, event, channel, enabled)
  if (!res.ok) {
    console.error('[me/notification-preferences] update failed', res.message)
    return json({ error: 'Could not update preferences', code: 'db_error' }, 500)
  }

  await logAudit({
    supabaseAdmin: auth.supabaseAdmin,
    user_id: auth.user.id,
    domain_id: auth.user.domain_id,
    action: 'notification_prefs_updated',
    entity_type: 'user',
    entity_id: auth.user.id,
    detail: { event, channel, enabled },
  })

  return json({ ok: true, event, channel, enabled }, 200)
}

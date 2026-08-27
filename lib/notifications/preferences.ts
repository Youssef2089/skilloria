import type { SupabaseClient } from '@supabase/supabase-js'
import type { AudienceFacts, NotificationChannel, NotificationEventType } from './catalog'
import { eventHasChannel } from './catalog'

/**
 * lib/notifications/preferences.ts — lecture et écriture des préférences.
 *
 * RÈGLE FONDATRICE : l'ABSENCE DE LIGNE VAUT « ACTIVÉ ».
 *   `public.notification_preferences` ne stocke que les REFUS. Un utilisateur
 *   qui n'a jamais touché à ses réglages n'a aucune ligne et reçoit tout — ce
 *   qui reproduit exactement le `DEFAULT true` des anciennes colonnes, sans
 *   backfill ni pour les comptes existants, ni pour les événements à venir.
 *
 * SÉCURITÉ (point 20) : ce module ne décide d'aucune autorisation. Il lit un
 *   choix. Le fait qu'un canal EXISTE pour un événement est décidé par le
 *   catalogue, et re-vérifié ici — un canal hors catalogue est toujours
 *   « désactivé », qu'une ligne existe ou non.
 */

/** Clé de dédoublonnage interne : `user:event:channel`. */
function key(userId: string, event: string, channel: string): string {
  return `${userId}:${event}:${channel}`
}

/** Ensemble des couples DÉSACTIVÉS pour ces utilisateurs. */
export type DisabledSet = ReadonlySet<string>

export async function loadDisabledPreferences(
  admin: SupabaseClient,
  userIds: string[],
): Promise<DisabledSet> {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (ids.length === 0) return new Set<string>()

  const { data, error } = await admin
    .from('notification_preferences')
    .select('user_id, event_type, channel, enabled')
    .in('user_id', ids)
  if (error) {
    // Fail-safe : en cas d'erreur de lecture on ne DÉSACTIVE rien (l'ensemble
    // reste vide ⇒ tout est activé). On préfère un envoi de trop à un silence
    // dû à une panne de lecture — l'utilisateur peut toujours se désabonner.
    console.error('[notifications/preferences] load failed', error.message)
    return new Set<string>()
  }

  const disabled = new Set<string>()
  for (const r of (data ?? []) as Array<{
    user_id: string
    event_type: string
    channel: string
    enabled: boolean
  }>) {
    if (r.enabled === false) disabled.add(key(r.user_id, r.event_type, r.channel))
  }
  return disabled
}

/**
 * Ce canal est-il actif pour cet utilisateur et cet événement ?
 * Faux si le catalogue ne définit pas le canal, ou si un refus est enregistré.
 */
export function isChannelEnabled(
  disabled: DisabledSet,
  userId: string,
  event: NotificationEventType,
  channel: NotificationChannel,
): boolean {
  if (!eventHasChannel(event, channel)) return false
  return !disabled.has(key(userId, event, channel))
}

/** Enregistre un choix. `enabled=true` supprime la ligne (retour au défaut). */
export async function setPreference(
  admin: SupabaseClient,
  userId: string,
  event: NotificationEventType,
  channel: NotificationChannel,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (enabled) {
    const { error } = await admin
      .from('notification_preferences')
      .delete()
      .eq('user_id', userId)
      .eq('event_type', event)
      .eq('channel', channel)
    if (error) return { ok: false, message: error.message }
    return { ok: true }
  }

  const { error } = await admin
    .from('notification_preferences')
    .upsert(
      { user_id: userId, event_type: event, channel, enabled: false, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,event_type,channel' },
    )
  if (error) return { ok: false, message: error.message }
  return { ok: true }
}

/**
 * Résout les FAITS d'appartenance servant au catalogue. Deux lectures bornées,
 * jamais un `user_type` : cf. l'en-tête de catalog.ts (l'expert-publiant).
 */
export async function loadAudienceFacts(
  admin: SupabaseClient,
  userId: string,
): Promise<AudienceFacts> {
  const [{ data: profile }, { data: member }] = await Promise.all([
    admin.from('profiles').select('id').eq('user_id', userId).maybeSingle(),
    admin
      .from('organization_members')
      .select('user_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
  ])
  return { isExpert: !!profile, isOrgMember: !!member }
}

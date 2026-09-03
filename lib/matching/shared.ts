import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnonceType } from '@/types/annonce'
import type { ExpertKind } from '@/lib/annonces/audience'
import type { MatchingLocale } from './types'
import { dispatchNotificationsForUsers } from '@/lib/notifications/dispatch'

/**
 * Ce qui reste partagé entre les deux sens de la mise en relation : la locale,
 * et la notification.
 *
 * CE QUI A QUITTÉ CE FICHIER, ET POURQUOI
 *   • le catalogue des types d'annonce → lib/annonces/audience.ts. Le moteur
 *     n'a pas à savoir qu'un type s'appelle « sous-traitance » : il a besoin
 *     d'une réponse, pas d'une liste.
 *   • le chargement du vivier → pool.ts, où les filtres sont lisibles ensemble.
 *   • la configuration → settings.ts, lue en base sans aucun repli codé en dur.
 */

export const NOTIFICATION_TYPE = 'new_match_opportunity'
const NOTIFICATION_CHANNEL = 'inapp'
const NOTIFICATION_STATUS = 'pending'

const VALID_LOCALES: readonly MatchingLocale[] = ['fr', 'en', 'es', 'de']

export function normalizeMatchingLocale(raw: string | null | undefined): MatchingLocale {
  if (raw && (VALID_LOCALES as readonly string[]).includes(raw)) return raw as MatchingLocale
  return 'fr'
}

export function pickRel<T>(value: T | T[] | null): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

const NOTIF_TITLE_KEYS: Record<MatchingLocale, string> = {
  fr: 'Nouvelle opportunité',
  en: 'New opportunity',
  es: 'Nueva oportunidad',
  de: 'Neue Gelegenheit',
}

const NOTIF_BODY_KEYS: Record<MatchingLocale, (params: { title: string }) => string> = {
  fr: ({ title }) => `Skilloria a identifié une annonce qui pourrait vous correspondre : « ${title} ».`,
  en: ({ title }) => `Skilloria identified a listing that may match you: "${title}".`,
  es: ({ title }) => `Skilloria identificó un anuncio que podría coincidir contigo: «${title}».`,
  de: ({ title }) => `Skilloria hat eine Anzeige identifiziert, die zu Ihnen passen könnte: „${title}".`,
}

export type NotifySpec = {
  user_id: string
  profile_id: string
  publication_id: string
  publication_title: string
  publication_type: AnnonceType
  /** Type de l'EXPERT — segment du lien profond (ouverture croisée). */
  user_type: ExpertKind
  domain_id: string
  locale: string
}

/**
 * Taille des paquets d'envoi.
 *
 * POURQUOI CE DÉCOUPAGE EXISTE : le dépêcheur ne lit que les 2 000 premières
 * notifications en attente par appel. Appelé d'un coup avec 12 000
 * destinataires fraîchement notés, il en servait 2 000 — les 10 000 autres ne
 * recevaient jamais leur message, et RIEN ne le signalait. Le plafond de vivier
 * masquait le problème ; il n'y a plus de plafond.
 */
const PAQUET_DESTINATAIRES = 500

export async function notifyAndFlip(args: {
  supabaseAdmin: SupabaseClient
  specs: NotifySpec[]
}): Promise<void> {
  const { supabaseAdmin, specs } = args
  if (specs.length === 0) return

  const userIds = Array.from(new Set(specs.map((s) => s.user_id)))
  const pubIds = Array.from(new Set(specs.map((s) => s.publication_id)))

  // Idempotence : ne jamais renotifier une paire (utilisateur, annonce) déjà
  // notifiée. La lecture est bornée aux destinataires et aux annonces du lot.
  const { data: existing, error: existErr } = await supabaseAdmin
    .from('notifications')
    .select('user_id, entity_id')
    .eq('type', NOTIFICATION_TYPE)
    .in('user_id', userIds)
    .in('entity_id', pubIds)
  if (existErr) {
    // On ne sait pas ce qui existe déjà : on RENONCE à insérer plutôt que de
    // risquer un doublon de notification. Une notification manquée se rattrape
    // au prochain run ; une notification en double se voit et ne se rattrape pas.
    console.error('[matching] notifications existantes illisibles — aucun envoi ce run', existErr.message)
    return
  }
  const dejaNotifie = new Set(
    (existing ?? []).map((r) => `${r.user_id as string}:::${r.entity_id as string}`),
  )

  const rows: Array<Record<string, unknown>> = []
  const aBasculer: NotifySpec[] = []

  for (const s of specs) {
    aBasculer.push(s)
    if (dejaNotifie.has(`${s.user_id}:::${s.publication_id}`)) continue
    const loc = normalizeMatchingLocale(s.locale)
    // Ouverture croisée : le segment suit le type de l'EXPERT (son tableau de
    // bord), jamais celui de l'annonce.
    const segment = s.user_type === 'expert_cdi' ? 'cdi' : 'freelance'
    rows.push({
      user_id: s.user_id,
      domain_id: s.domain_id,
      type: NOTIFICATION_TYPE,
      channel: NOTIFICATION_CHANNEL,
      title: NOTIF_TITLE_KEYS[loc],
      body: NOTIF_BODY_KEYS[loc]({ title: s.publication_title }),
      link_url: `/dashboard/${segment}/missions/${s.publication_id}`,
      status: NOTIFICATION_STATUS,
      entity_id: s.publication_id,
    })
  }

  if (rows.length > 0) {
    // Insertion par paquets : un INSERT de 12 000 lignes d'un coup est une
    // requête que rien ne borne.
    for (let i = 0; i < rows.length; i += PAQUET_DESTINATAIRES) {
      const tranche = rows.slice(i, i + PAQUET_DESTINATAIRES)
      const { error: insErr } = await supabaseAdmin.from('notifications').insert(tranche)
      if (insErr) console.error('[matching] insertion de notifications en échec', insErr.message)
    }

    // Envoi immédiat, PAR PAQUETS de destinataires : le dépêcheur ne lit que
    // ses 2 000 premières lignes en attente par appel.
    const destinataires = Array.from(new Set(rows.map((r) => r.user_id as string)))
    for (let i = 0; i < destinataires.length; i += PAQUET_DESTINATAIRES) {
      const paquet = destinataires.slice(i, i + PAQUET_DESTINATAIRES)
      try {
        await dispatchNotificationsForUsers(supabaseAdmin, paquet, {
          // Borné à l'événement du matching : ce chemin ne dépêche jamais au
          // passage les messages ou candidatures d'un même utilisateur, qui
          // appartiennent à leurs propres routes.
          events: ['new_match_opportunity'],
        })
      } catch (err) {
        console.error('[matching] envoi immédiat échoué (best-effort)', err instanceof Error ? err.message : err)
      }
    }
  }

  // ── Bascule pending → notified, groupée par annonce ──────────────────────
  //  Elle partait UNE requête par match. Douze mille allers-retours pour une
  //  annonce : le genre de boucle qui ne se voit qu'en production.
  const parPublication = new Map<string, string[]>()
  for (const s of aBasculer) {
    const liste = parPublication.get(s.publication_id) ?? []
    liste.push(s.profile_id)
    parPublication.set(s.publication_id, liste)
  }
  for (const [publicationId, profileIds] of parPublication) {
    for (let i = 0; i < profileIds.length; i += PAQUET_DESTINATAIRES) {
      const tranche = profileIds.slice(i, i + PAQUET_DESTINATAIRES)
      const { error: flipErr } = await supabaseAdmin
        .from('matches')
        .update({ status: 'notified' })
        .eq('publication_id', publicationId)
        .in('profile_id', tranche)
        .eq('status', 'pending')
      if (flipErr) console.error('[matching] bascule notified en échec', flipErr.message)
    }
  }
}

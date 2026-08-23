// lib/candidatures/lifecycle-batch.ts
//
// ASSEMBLAGE DES ENTRÉES de la dérivation d'état de vie, pour un LOT de
// candidatures. Ne contient AUCUNE règle : la règle vit dans
// lib/candidatures/lifecycle.ts (qui tient elle-même la règle 30 j de
// lib/publications/expiry.ts). Ici, uniquement le chargement des fenêtres.
//
// POURQUOI CE MODULE
//   Dériver un bucket exige trois entrées : le statut de la candidature, la
//   fenêtre de l'annonce (30 j) et la fenêtre de l'échange (15 j). Recharger ce
//   trio à la main sur chaque site de lecture, c'est se donner autant
//   d'occasions d'en oublier un — un compteur qui ne charge pas les
//   conversations range en « archivé » des échanges bien vivants.
//
// LECTURE PURE : aucune écriture, aucun batch, aucune migration.

import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveCandidatureLifecycle, type CandidatureLifecycle } from '@/lib/candidatures/lifecycle'

/** Colonnes minimales d'une candidature pour dériver son état de vie. */
export type LifecycleCandidatureRow = {
  id: string
  status: string
  unlocked_at: string | null
  publication_id: string
}

/** Fenêtre portée par l'annonce (entrées de `isActivePublished`). */
export type LifecyclePublicationWindow = {
  status: string | null
  published_at: string | null
  expires_at: string | null
}

/** Statuts de candidature qui portent une conversation (donc une fenêtre 15 j). */
const CONVERSABLE_STATUSES = new Set(['unlocked', 'selected'])

/**
 * Charge les fenêtres d'annonce pour un ensemble d'ids. À n'appeler que si
 * l'appelant n'a PAS déjà les publications sous la main.
 */
export async function loadLifecyclePublicationWindows(
  supabaseAdmin: SupabaseClient,
  publicationIds: string[],
): Promise<Map<string, LifecyclePublicationWindow>> {
  const byId = new Map<string, LifecyclePublicationWindow>()
  if (publicationIds.length === 0) return byId
  const { data } = await supabaseAdmin
    .from('publications')
    .select('id, status, published_at, expires_at')
    .in('id', publicationIds)
  for (const p of (data ?? []) as ({ id: string } & LifecyclePublicationWindow)[]) {
    byId.set(p.id, { status: p.status, published_at: p.published_at, expires_at: p.expires_at })
  }
  return byId
}

/**
 * Dérive l'état de vie de chaque candidature du lot.
 *
 * `pubWindows` : fenêtres d'annonce déjà chargées par l'appelant (ou issues de
 * `loadLifecyclePublicationWindows`). Une publication absente de la map est
 * traitée comme introuvable par le helper de dérivation — c'est-à-dire archivée
 * avec la raison `publication_closed`, jamais « active par défaut ».
 *
 * `now` : instant UNIQUE pour tout le lot. Deux candidatures de la même réponse
 * ne doivent pas être dérivées à des `now` différents.
 */
export async function deriveLifecycleByCandidature(
  supabaseAdmin: SupabaseClient,
  rows: LifecycleCandidatureRow[],
  pubWindows: Map<string, LifecyclePublicationWindow>,
  now: Date = new Date(),
): Promise<Map<string, CandidatureLifecycle>> {
  const byCandidature = new Map<string, CandidatureLifecycle>()
  if (rows.length === 0) return byCandidature

  // Fenêtre d'échange (15 j) : n'existe qu'après unlock. On distingue
  // « pas de ligne conversation » de « conversation sans expires_at » — le
  // helper de dérivation ne ferme jamais sur une donnée manquante.
  const conversableIds = rows.filter((r) => CONVERSABLE_STATUSES.has(r.status)).map((r) => r.id)
  const convExpiryByCand = new Map<string, string | null>()
  if (conversableIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('conversations')
      .select('candidature_id, expires_at')
      .in('candidature_id', conversableIds)
    for (const c of (data ?? []) as { candidature_id: string; expires_at: string | null }[]) {
      convExpiryByCand.set(c.candidature_id, c.expires_at)
    }
  }

  for (const r of rows) {
    byCandidature.set(
      r.id,
      deriveCandidatureLifecycle(
        {
          status: r.status,
          unlocked_at: r.unlocked_at,
          publication: pubWindows.get(r.publication_id) ?? null,
          conversation: convExpiryByCand.has(r.id)
            ? { expires_at: convExpiryByCand.get(r.id) ?? null }
            : null,
        },
        now,
      ),
    )
  }
  return byCandidature
}

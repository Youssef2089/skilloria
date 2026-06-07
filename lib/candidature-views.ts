import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * markCandidatureViewedServerSide — best-effort upsert dans
 * `public.candidature_views (user_id, candidature_id, viewed_at)`.
 *
 * Utilisé par les routes ACTION côté ORG (unlock / reject / select) :
 * agir sur une candidature ⇒ l'avoir vue. Cohérent avec la règle "badge =
 * items non consultés" (Lot bascule par item).
 *
 * Best-effort : si l'upsert échoue, on log mais on NE bloque PAS l'action
 * métier (ce n'est qu'un compteur de badge UI). Idempotent grâce à la
 * PRIMARY KEY (user_id, candidature_id) + ON CONFLICT.
 *
 * Sécurité : la garde d'ownership est appliquée par la route appelante
 * (verrou pub.organization_id == auth.org.id ou profile_id == me_profile).
 * Cette fonction ne fait QUE l'écriture — pas de re-check.
 */
export async function markCandidatureViewedServerSide(
  supabaseAdmin: SupabaseClient,
  userId: string,
  candidatureId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('candidature_views')
    .upsert(
      { user_id: userId, candidature_id: candidatureId, viewed_at: new Date().toISOString() },
      { onConflict: 'user_id,candidature_id' },
    )
  if (error) {
    console.error('[markCandidatureViewedServerSide] failed', {
      userId,
      candidatureId,
      msg: error.message,
    })
  }
}

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Helper centralisé pour insérer une ligne dans `audit_logs`.
 *
 * Best-effort : si l'insert échoue, on log un warning mais on ne propage
 * jamais l'erreur — l'audit ne doit pas casser la requête métier.
 *
 * Schéma de la table (rappel) :
 *   audit_logs(user_id, domain_id, action, entity_type, entity_id, detail jsonb)
 */
export type AuditLogParams = {
  supabaseAdmin: SupabaseClient
  user_id: string
  domain_id: string | null
  action: string
  entity_type?: string | null
  entity_id?: string | null
  detail?: Record<string, unknown> | null
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  const { supabaseAdmin, user_id, domain_id, action, entity_type, entity_id, detail } = params

  try {
    const { error } = await supabaseAdmin.from('audit_logs').insert({
      user_id,
      domain_id,
      action,
      entity_type: entity_type ?? null,
      entity_id: entity_id ?? null,
      detail: detail ?? null,
    })

    if (error) {
      console.error('[audit] insert failed', {
        action,
        entity_type,
        entity_id,
        msg: error.message,
      })
    }
  } catch (err) {
    console.error('[audit] insert threw', {
      action,
      entity_type,
      entity_id,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}
